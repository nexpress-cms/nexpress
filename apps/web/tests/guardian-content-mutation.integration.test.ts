import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAuthUser, NpSaveResult } from "../../../packages/core/src/config/types.js";
import {
  autosaveRevision,
  createMemberDocument,
  deleteDocument,
  saveDocument,
  withDeferredPostCommit,
} from "../../../packages/core/src/collections/pipeline.js";
import {
  resetCollectionMutationObserverV1,
  setCollectionMutationObserverV1,
  type NpCollectionMutationObservationV1,
} from "../../../packages/core/src/collections/mutation-observer.js";
import {
  getCollectionRegistration,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npRevisions, npUsers } from "../../../packages/core/src/db/schema/system.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
import {
  resetCurrentSiteResolver,
  setCurrentSiteResolver,
  withCurrentSite,
} from "../../../packages/core/src/sites/context.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const markerAction = "test.collection-mutation-receipt";

function post(title: string) {
  return { title, content: npCreateEmptyRichTextContent() };
}

function documentId(result: NpSaveResult): string {
  if (typeof result.doc.id !== "string") throw new Error("Expected saved document id");
  return result.doc.id;
}

async function staff(): Promise<NpAuthUser> {
  const seeded = await seedUser();
  const db = await getTestDb();
  const [user] = await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, seeded.userId));
  if (!user) throw new Error("Expected seeded staff user");
  return user;
}

async function markers() {
  return (await getTestDb())
    .select()
    .from(npAuditEvents)
    .where(eq(npAuditEvents.action, markerAction))
    .orderBy(asc(npAuditEvents.createdAt));
}

/** Fake source owner only: prove transaction behavior without Agent/Runtime calls. */
function installRecorder() {
  const observations: NpCollectionMutationObservationV1[] = [];
  const state = { reject: false };
  const record = vi.fn(async (input: NpCollectionMutationObservationV1) => {
    observations.push(input);
    await input.db.insert(npAuditEvents).values({
      id: input.writeId,
      siteId: input.siteId,
      actorKind: input.actor.kind,
      actorUserId: input.actor.kind === "staff" ? input.actor.userId : null,
      actorMemberId: input.actor.kind === "member" ? input.actor.memberId : null,
      action: markerAction,
      targetType: "collection-write",
      targetId: input.documentId,
      payload: {
        collection: input.collection,
        writeId: input.writeId,
        actor: input.actor,
        fact: input.fact,
      },
      createdAt: input.occurredAt,
    });
    if (state.reject) throw new Error("Injected receipt failure");
  });
  setCollectionMutationObserverV1({ record });
  return { observations, state, record };
}

describe.skipIf(skipIfNoTestDb())("committed collection mutation source seam", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    resetCollectionMutationObserverV1();
    await truncateAll();
    registerTestCollections();
    setCurrentSiteResolver(() => "default");
  });
  afterEach(() => {
    resetCollectionMutationObserverV1();
    resetCurrentSiteResolver();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("leaves ordinary writes available when no source owner is installed", async () => {
    const user = await staff();
    const saved = await saveDocument("posts", null, post("Unobserved"), user);
    const id = documentId(saved);
    await saveDocument("posts", id, { title: "Still unobserved" }, user);
    expect(await markers()).toEqual([]);
    const revisions = await (
      await getTestDb()
    )
      .select()
      .from(npRevisions)
      .where(eq(npRevisions.documentId, id));
    expect(revisions).toHaveLength(2);
  });

  it("records actual staff create/update rows and revisions without copying content", async () => {
    const user = await staff();
    const f = installRecorder();
    const saved = await saveDocument("posts", null, post("Private source title"), user, {
      status: "draft",
    });
    const id = documentId(saved);
    await saveDocument("posts", id, { title: "Private changed title" }, user, {
      status: "published",
    });
    expect(f.observations).toHaveLength(2);
    expect(new Set(f.observations.map((item) => item.writeId)).size).toBe(2);
    const revisions = await (
      await getTestDb()
    )
      .select()
      .from(npRevisions)
      .where(eq(npRevisions.documentId, id))
      .orderBy(asc(npRevisions.version));
    for (const [index, observation] of f.observations.entries()) {
      const revision = revisions[index];
      expect(observation).toMatchObject({
        siteId: "default",
        collection: "posts",
        documentId: id,
        actor: { kind: "staff", userId: user.id },
        fact: {
          kind: "document-save",
          operation: index === 0 ? "create" : "update",
          status: index === 0 ? "draft" : "published",
          revision: {
            id: revision.id,
            version: revision.version,
            status: revision.status,
            createdAt: revision.createdAt,
          },
        },
      });
      expect(observation.writeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(observation.occurredAt).toBeInstanceOf(Date);
      expect(Object.keys(observation.fact).sort()).toEqual([
        "kind",
        "operation",
        "revision",
        "status",
      ]);
    }
    const stored = await markers();
    expect(stored).toHaveLength(2);
    expect(JSON.stringify(stored)).not.toContain("Private");
    expect(JSON.stringify(stored)).not.toContain("snapshot");
    expect(JSON.stringify(stored)).not.toContain("changedFields");
  });

  it("records an honest committed-save fact with no revision when versions are disabled", async () => {
    const user = await staff();
    const f = installRecorder();
    const saved = await saveDocument("tags", null, { name: "No history" }, user);
    expect(f.observations).toHaveLength(1);
    expect(f.observations[0].fact).toEqual({
      kind: "document-save",
      operation: "create",
      status: saved.doc.status,
      revision: null,
    });
    expect(
      await (
        await getTestDb()
      )
        .select()
        .from(npRevisions)
        .where(eq(npRevisions.documentId, documentId(saved))),
    ).toEqual([]);
    expect(await markers()).toHaveLength(1);
  });

  it("rolls back the document, revision and same-TX receipt when the owner rejects", async () => {
    const user = await staff();
    const f = installRecorder();
    f.state.reject = true;
    const registration = getCollectionRegistration("posts");
    const afterCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    registerCollection("posts", registration.table, {
      ...registration.config,
      hooks: { afterCreate: [afterCreate] },
    });
    await expect(saveDocument("posts", null, post("Rolled back"), user)).rejects.toThrow(
      "Injected receipt failure",
    );
    expect(f.record).toHaveBeenCalledOnce();
    expect(await (await getTestDb()).select().from(postsTable)).toEqual([]);
    expect(await (await getTestDb()).select().from(npRevisions)).toEqual([]);
    expect(await markers()).toEqual([]);
    expect(afterCreate).not.toHaveBeenCalled();
  });

  it("uses the caller's exact transaction and survives only its outer commit", async () => {
    const user = await staff();
    const f = installRecorder();
    const db = await getTestDb();
    await expect(
      withDeferredPostCommit(() =>
        db.transaction(async (tx) => {
          const saved = await saveDocument("posts", null, post("Outer rollback"), user, { tx });
          expect(f.observations[0].db).toBe(tx);
          expect(
            await tx
              .select()
              .from(npAuditEvents)
              .where(eq(npAuditEvents.targetId, documentId(saved))),
          ).toHaveLength(1);
          expect(await markers()).toEqual([]);
          throw new Error("Outer rollback");
        }),
      ),
    ).rejects.toThrow("Outer rollback");
    expect(await db.select().from(postsTable)).toEqual([]);
    expect(await db.select().from(npRevisions)).toEqual([]);
    expect(await markers()).toEqual([]);
    await withDeferredPostCommit(() =>
      db.transaction(async (tx) => {
        await saveDocument("posts", null, post("Outer commit"), user, { tx });
        expect(f.observations[1].db).toBe(tx);
        expect(await markers()).toEqual([]);
      }),
    );
    expect(await markers()).toHaveLength(1);
  });

  it("records only new autosaves and rolls back both revision and receipt on rejection", async () => {
    const user = await staff();
    const saved = await saveDocument("posts", null, post("Main row"), user);
    const id = documentId(saved);
    const f = installRecorder();
    const first = await autosaveRevision("posts", id, post("Unsaved draft"), user);
    const reused = await autosaveRevision("posts", id, post("Unsaved draft"), user);
    expect(first.reused).toBe(false);
    expect(reused).toEqual({ ...first, reused: true });
    expect(f.observations).toHaveLength(1);
    expect(f.observations[0]).toMatchObject({
      siteId: "default",
      collection: "posts",
      documentId: id,
      actor: { kind: "staff", userId: user.id },
      fact: {
        kind: "revision-autosave",
        revision: {
          id: first.id,
          version: first.version,
          status: "autosave",
          createdAt: first.createdAt,
        },
      },
    });
    f.state.reject = true;
    await expect(autosaveRevision("posts", id, post("Rejected autosave"), user)).rejects.toThrow(
      "Injected receipt failure",
    );
    const db = await getTestDb();
    const revisions = await db.select().from(npRevisions).where(eq(npRevisions.documentId, id));
    expect(revisions).toHaveLength(2);
    expect(revisions.some((row) => row.snapshot.title === "Rejected autosave")).toBe(false);
    expect(await markers()).toHaveLength(1);
    const [main] = await db.select().from(postsTable).where(eq(postsTable.id, id));
    expect(main.title).toBe("Main row");
  });

  it("captures the installed owner and primitive editing actor before hooks can replace them", async () => {
    const user = await staff();
    const originalId = user.id;
    const other = await staff();
    const f = installRecorder();
    const replacement = { record: vi.fn(async () => {}) };
    const registration = getCollectionRegistration("posts");
    registerCollection("posts", registration.table, {
      ...registration.config,
      hooks: {
        beforeCreate: [
          async ({ data, user: mutableUser }) => {
            if (mutableUser) mutableUser.id = other.id;
            setCollectionMutationObserverV1(replacement);
            return data;
          },
        ],
      },
    });
    await saveDocument("posts", null, post("Captured actor"), user);
    expect(f.record).toHaveBeenCalledOnce();
    expect(f.observations[0].actor).toEqual({ kind: "staff", userId: originalId });
    expect(replacement.record).not.toHaveBeenCalled();
    expect(user.id).toBe(other.id);
    const [revision] = await (await getTestDb()).select().from(npRevisions);
    expect(revision.authorId).toBe(other.id);
  });

  it("keeps member editing identity independent of nullable staff revision authorship", async () => {
    const member = await seedActiveMember();
    const f = installRecorder();
    const saved = await createMemberDocument(
      "discussions",
      { title: "Member source fact", body: npCreateEmptyRichTextContent() },
      member.memberId,
    );
    expect(f.observations).toHaveLength(1);
    expect(f.observations[0]).toMatchObject({
      documentId: documentId(saved),
      actor: { kind: "member", memberId: member.memberId },
      fact: { kind: "document-save", operation: "create" },
    });
    const [revision] = await (
      await getTestDb()
    )
      .select()
      .from(npRevisions)
      .where(eq(npRevisions.documentId, documentId(saved)));
    expect(revision.authorId).toBeNull();
    expect((await markers())[0].actorMemberId).toBe(member.memberId);
  });

  it("retains exact receipt metadata after revision pruning and excluded document deletion", async () => {
    const user = await staff();
    const registration = getCollectionRegistration("posts");
    registerCollection("posts", registration.table, {
      ...registration.config,
      versions: { drafts: { autosave: true }, max: 1 },
    });
    const f = installRecorder();
    const saved = await saveDocument("posts", null, post("Pruned source"), user);
    const id = documentId(saved);
    const firstFact = f.observations[0].fact;
    if (firstFact.kind !== "document-save" || !firstFact.revision)
      throw new Error("Expected actual initial revision");
    await saveDocument("posts", id, { title: "Prunes initial history" }, user);
    const db = await getTestDb();
    expect(
      await db.select().from(npRevisions).where(eq(npRevisions.id, firstFact.revision.id)),
    ).toEqual([]);
    const retained = await markers();
    expect(retained).toHaveLength(2);
    const firstMarker = retained.find((item) => item.id === f.observations[0].writeId);
    expect(firstMarker?.payload.fact).toEqual(JSON.parse(JSON.stringify(firstFact)));
    await deleteDocument("posts", id, user);
    expect(f.observations).toHaveLength(2);
    expect(await markers()).toEqual(retained);
  });

  it("never records rejected ACL or cross-site writes", async () => {
    const user = await staff();
    const saved = await saveDocument("posts", null, post("Protected"), user);
    const f = installRecorder();
    const registration = getCollectionRegistration("posts");
    registerCollection("posts", registration.table, {
      ...registration.config,
      access: { update: () => false },
    });
    await expect(
      saveDocument("posts", documentId(saved), { title: "Denied" }, user),
    ).rejects.toThrow();
    await expect(
      withCurrentSite("content-other", () =>
        saveDocument("posts", documentId(saved), { title: "Wrong site" }, user),
      ),
    ).rejects.toThrow();
    expect(f.record).not.toHaveBeenCalled();
    expect(await markers()).toEqual([]);
  });
});
