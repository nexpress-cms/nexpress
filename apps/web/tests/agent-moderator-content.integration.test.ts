import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npInspectCommunityContentContainmentV1,
  npQuarantineCommunityContentV1,
  npRestoreCommunityContentV1,
  type NpCommunityContentContainmentInputV1,
} from "../../../packages/core/src/community/content-containment.js";
import {
  npAuditEvents,
  npComments,
  npMembers,
} from "../../../packages/core/src/db/schema/community.js";
import { npRevisions } from "../../../packages/core/src/db/schema/system.js";
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import {
  withDeferredPostCommit,
  type NpTransaction,
} from "../../../packages/core/src/collections/pipeline.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { discussionsTable } from "../../../packages/core/src/integration/fixtures.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function fixture(status: "pending" | "visible" = "visible") {
  const db = await getTestDb();
  const user = await seedUser({ role: "admin" });
  const [member] = await db
    .insert(npMembers)
    .values({
      email: `${randomUUID()}@example.com`,
      handle: `moderator-${randomUUID()}`,
      displayName: "Moderator test member",
      status: "active",
    })
    .returning();
  const [document] = await db
    .insert(discussionsTable)
    .values({
      title: "Reviewed community thread",
      slug: `moderator-${randomUUID()}`,
      body: npCreateEmptyRichTextContent(),
      status: "published",
      memberAuthorId: member.id,
    })
    .returning();
  const [comment] = await db
    .insert(npComments)
    .values({
      targetType: "discussions",
      targetId: document.id,
      memberId: member.id,
      bodyMd: "An original comment under review",
      bodyHtml: "<p>An original comment under review</p>",
      status,
    })
    .returning();
  const input: NpCommunityContentContainmentInputV1 = {
    siteId: "default",
    target: { kind: "comment", collection: "discussions", id: comment.id },
    user: { id: user.userId, name: user.name, email: user.email, role: user.role, tokenVersion: 0 },
  };
  async function transaction<T>(callback: (tx: NpTransaction) => Promise<T>): Promise<T> {
    return withCurrentSite("default", () => withDeferredPostCommit(() => db.transaction(callback)));
  }
  async function quarantine() {
    return transaction(async (tx) => {
      const inspected = await npInspectCommunityContentContainmentV1(tx, input);
      return npQuarantineCommunityContentV1(tx, {
        ...input,
        expectedVersionDigest: inspected.versionDigest,
        reasonCode: "REPEATED_LINK_SPAM",
      });
    });
  }
  return { db, document, comment, input, transaction, quarantine };
}

describe.skipIf(skipIfNoTestDb())("Moderator content quarantine and exact restoration", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
    // Reuse an existing boolean fixture column as the declared hidden field.
    const config = getCollectionConfig("discussions");
    registerCollection("discussions", getCollectionTable("discussions"), {
      ...config,
      community: { ...config.community, reports: true, moderation: { hiddenField: "locked" } },
    });
  });
  afterAll(closeTestDb);

  it.each(["pending", "visible"] as const)(
    "restores a %s comment without publishing or rewriting it",
    async (status) => {
      const f = await fixture(status);
      const installed = await f.quarantine();
      expect(
        (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0],
      ).toMatchObject({ status: "hidden", bodyMd: f.comment.bodyMd });
      await f.transaction((tx) =>
        npRestoreCommunityContentV1(tx, {
          ...f.input,
          originalState: installed.originalState,
          expectedVersionDigest: installed.installedVersionDigest,
        }),
      );
      expect(
        (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0],
      ).toEqual(f.comment);
      expect(
        (await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.targetId, f.comment.id)))
          .map((row) => row.action)
          .sort(),
      ).toEqual(["comment.hide", "comment.restore"]);
    },
  );

  it.each(["pending", "published"] as const)(
    "preserves %s document state and runs revisions and hooks after commit",
    async (status) => {
      const f = await fixture();
      f.input.target = { kind: "document", collection: "discussions", id: f.document.id };
      await f.db
        .update(discussionsTable)
        .set({ status, visibility: status === "pending" ? "private" : "public" })
        .where(eq(discussionsTable.id, f.document.id));
      const after = vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data));
      const config = getCollectionConfig("discussions");
      registerCollection("discussions", getCollectionTable("discussions"), {
        ...config,
        hooks: { afterUpdate: [after] },
      });
      const installed = await f.quarantine();
      expect(after).toHaveBeenCalledOnce();
      expect(
        (
          await f.db.select().from(discussionsTable).where(eq(discussionsTable.id, f.document.id))
        )[0],
      ).toMatchObject({ status: "pending", locked: true });
      await f.transaction((tx) =>
        npRestoreCommunityContentV1(tx, {
          ...f.input,
          originalState: installed.originalState,
          expectedVersionDigest: installed.installedVersionDigest,
        }),
      );
      expect(
        (
          await f.db.select().from(discussionsTable).where(eq(discussionsTable.id, f.document.id))
        )[0],
      ).toMatchObject({
        status,
        visibility: status === "pending" ? "private" : "public",
        locked: false,
        title: f.document.title,
        body: f.document.body,
      });
      expect(after).toHaveBeenCalledTimes(2);
      expect(
        await f.db.select().from(npRevisions).where(eq(npRevisions.documentId, f.document.id)),
      ).toHaveLength(2);
    },
  );

  it("rejects edits, stale concurrent quarantine and current read ACL denial", async () => {
    const f = await fixture();
    const inspected = await f.transaction((tx) =>
      npInspectCommunityContentContainmentV1(tx, f.input),
    );
    const attempts = await Promise.allSettled(
      [1, 2].map(() =>
        f.transaction((tx) =>
          npQuarantineCommunityContentV1(tx, {
            ...f.input,
            expectedVersionDigest: inspected.versionDigest,
            reasonCode: "SPAM",
          }),
        ),
      ),
    );
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const result = attempts.find((attempt) => attempt.status === "fulfilled");
    if (!result || result.status !== "fulfilled") throw new Error("No containment was installed");
    await f.db
      .update(npComments)
      .set({ bodyMd: "Human edited hidden content", editedAt: new Date() })
      .where(eq(npComments.id, f.comment.id));
    await expect(
      f.transaction((tx) =>
        npRestoreCommunityContentV1(tx, {
          ...f.input,
          originalState: result.value.originalState,
          expectedVersionDigest: result.value.installedVersionDigest,
        }),
      ),
    ).rejects.toThrow("Content containment conflict");
    const config = getCollectionConfig("discussions");
    registerCollection("discussions", getCollectionTable("discussions"), {
      ...config,
      access: { read: () => false },
    });
    await expect(
      f.transaction((tx) => npInspectCommunityContentContainmentV1(tx, f.input)),
    ).rejects.toThrow();
    expect(
      (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0],
    ).toMatchObject({ status: "hidden", bodyMd: "Human edited hidden content" });
    expect(
      await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.targetId, f.comment.id)),
    ).toHaveLength(1);
  });

  it("rolls back document, revision, audit and deferred hooks when the containing action fails", async () => {
    const f = await fixture();
    f.input.target = { kind: "document", collection: "discussions", id: f.document.id };
    const after = vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data));
    const config = getCollectionConfig("discussions");
    registerCollection("discussions", getCollectionTable("discussions"), {
      ...config,
      hooks: { afterUpdate: [after] },
    });
    await expect(
      f.transaction(async (tx) => {
        const inspected = await npInspectCommunityContentContainmentV1(tx, f.input);
        await npQuarantineCommunityContentV1(tx, {
          ...f.input,
          expectedVersionDigest: inspected.versionDigest,
          reasonCode: "SPAM",
        });
        expect(after).not.toHaveBeenCalled();
        throw new Error("Action persistence failed");
      }),
    ).rejects.toThrow("Action persistence failed");
    expect(
      (await f.db.select().from(discussionsTable).where(eq(discussionsTable.id, f.document.id)))[0],
    ).toEqual(f.document);
    expect(
      await f.db.select().from(npRevisions).where(eq(npRevisions.documentId, f.document.id)),
    ).toEqual([]);
    expect(
      await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.targetId, f.document.id)),
    ).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });
});
