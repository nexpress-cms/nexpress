import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAuthUser, NpSaveResult } from "../../../packages/core/src/config/types.js";
import {
  autosaveRevision,
  createMemberDocument,
  deleteDocument,
  deleteMemberDocument,
  promoteMemberDocument,
  saveDocument,
  withDeferredPostCommit,
  type NpTransaction,
} from "../../../packages/core/src/collections/pipeline.js";
import { publishScheduledDocuments } from "../../../packages/core/src/collections/scheduled.js";
import { NpNotFoundError, NpValidationError } from "../../../packages/core/src/errors.js";
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

async function pendingMemberDocument() {
  const registration = getCollectionRegistration("discussions");
  registerCollection("discussions", registration.table, {
    ...registration.config,
    community: {
      ...registration.config.community,
      memberWrite: {
        ...registration.config.community?.memberWrite,
        defaultStatus: "pending",
      },
    },
  });
  const member = await seedActiveMember();
  const saved = await createMemberDocument(
    "discussions",
    { title: "Pending source fact", body: npCreateEmptyRichTextContent() },
    member.memberId,
  );
  return { member, id: documentId(saved) };
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
    user.id = originalId;
    setCollectionMutationObserverV1({ record: f.record });
    registerCollection("posts", registration.table, {
      ...registration.config,
      hooks: {
        beforeDelete: [
          async ({ data, user: mutableUser }) => {
            if (mutableUser) mutableUser.id = other.id;
            data.status = "archived";
            setCollectionMutationObserverV1(replacement);
            return data;
          },
        ],
      },
    });
    const [saved] = await (await getTestDb()).select().from(postsTable);
    await deleteDocument("posts", saved.id, user);
    expect(f.observations[1]).toMatchObject({
      actor: { kind: "staff", userId: originalId },
      fact: { kind: "document-delete", status: "published", revision: null },
    });
    expect(replacement.record).not.toHaveBeenCalled();
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
    await deleteMemberDocument("discussions", documentId(saved), member.memberId);
    expect(f.observations[1]).toMatchObject({
      actor: { kind: "member", memberId: member.memberId },
      fact: { kind: "document-delete", status: saved.doc.status, revision: null },
    });
    expect(await markers()).toHaveLength(2);
  });

  it("retains exact receipt metadata after revision pruning and records actual deletion separately", async () => {
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
    expect(f.observations).toHaveLength(3);
    const committed = await markers();
    expect(committed).toHaveLength(3);
    for (const marker of retained) expect(committed).toContainEqual(marker);
    expect(f.observations[2].fact).toEqual({
      kind: "document-delete",
      status: "published",
      revision: null,
    });
  });

  it("never records rejected ACL or cross-site writes", async () => {
    const user = await staff();
    const saved = await saveDocument("posts", null, post("Protected"), user);
    const f = installRecorder();
    const registration = getCollectionRegistration("posts");
    registerCollection("posts", registration.table, {
      ...registration.config,
      access: { update: () => false, delete: () => false },
    });
    await expect(
      saveDocument("posts", documentId(saved), { title: "Denied" }, user),
    ).rejects.toThrow();
    await expect(
      withCurrentSite("content-other", () =>
        saveDocument("posts", documentId(saved), { title: "Wrong site" }, user),
      ),
    ).rejects.toThrow();
    await expect(deleteDocument("posts", documentId(saved), user)).rejects.toThrow();
    await expect(
      withCurrentSite("content-other", () => deleteDocument("posts", documentId(saved), user)),
    ).rejects.toThrow();
    expect(f.record).not.toHaveBeenCalled();
    expect(await markers()).toEqual([]);
  });

  it("records only actual scheduled publications with their system owner and no new revision", async () => {
    const user = await staff();
    const saved = await saveDocument(
      "posts",
      null,
      { ...post("Scheduled source"), publishedAt: new Date(Date.now() - 60_000) },
      user,
      { status: "scheduled" },
    );
    const db = await getTestDb();
    const revisions = await db.select().from(npRevisions);
    const f = installRecorder();
    const first = await publishScheduledDocuments();
    expect(first.byCollection.posts).toEqual([documentId(saved)]);
    expect(f.observations).toHaveLength(1);
    expect(f.observations[0]).toMatchObject({
      siteId: "default",
      documentId: documentId(saved),
      actor: { kind: "system", component: "content.publish-scheduled" },
      fact: { kind: "scheduled-publish", revision: null },
    });
    expect((await publishScheduledDocuments()).published).toBe(0);
    expect(f.record).toHaveBeenCalledOnce();
    expect(await db.select().from(npRevisions)).toEqual(revisions);
    expect(await markers()).toHaveLength(1);
  });

  it("rolls back scheduled publication and suppresses follow-ups when its receipt fails", async () => {
    const user = await staff();
    const saved = await saveDocument(
      "posts",
      null,
      { ...post("Scheduled rollback"), publishedAt: new Date(Date.now() - 60_000) },
      user,
      { status: "scheduled" },
    );
    const registration = getCollectionRegistration("posts");
    const afterUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    registerCollection("posts", registration.table, {
      ...registration.config,
      hooks: { afterUpdate: [afterUpdate] },
    });
    const f = installRecorder();
    f.state.reject = true;
    await expect(publishScheduledDocuments()).rejects.toThrow("Injected receipt failure");
    const [row] = await (
      await getTestDb()
    )
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, documentId(saved)));
    expect(row.status).toBe("scheduled");
    expect(await markers()).toEqual([]);
    expect(afterUpdate).not.toHaveBeenCalled();
  });

  it("records one staff promotion across concurrent attempts without inventing revision history", async () => {
    const user = await staff();
    const pending = await pendingMemberDocument();
    const db = await getTestDb();
    const revisions = await db.select().from(npRevisions);
    const f = installRecorder();
    await expect(
      withCurrentSite("content-other", () =>
        promoteMemberDocument("discussions", pending.id, user.id),
      ),
    ).rejects.toThrow();
    expect(f.record).not.toHaveBeenCalled();
    const attempts = await Promise.allSettled([
      promoteMemberDocument("discussions", pending.id, user.id),
      promoteMemberDocument("discussions", pending.id, user.id),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(NpValidationError);
    expect(f.record).toHaveBeenCalledOnce();
    expect(f.observations[0]).toMatchObject({
      documentId: pending.id,
      actor: { kind: "staff", userId: user.id },
      fact: { kind: "member-promotion", revision: null },
    });
    expect(await db.select().from(npRevisions)).toEqual(revisions);
    expect(await markers()).toHaveLength(1);
  });

  it("rolls back a rejected promotion before its audit and first-approval follow-ups", async () => {
    const user = await staff();
    const pending = await pendingMemberDocument();
    const db = await getTestDb();
    const before = await db.select().from(npAuditEvents);
    const f = installRecorder();
    f.state.reject = true;
    await expect(promoteMemberDocument("discussions", pending.id, user.id)).rejects.toThrow(
      "Injected receipt failure",
    );
    expect(await markers()).toEqual([]);
    expect(await db.select().from(npAuditEvents)).toEqual(before);
    f.state.reject = false;
    const promoted = await promoteMemberDocument("discussions", pending.id, user.id);
    expect(promoted.doc.status).toBe("published");
    expect(await markers()).toHaveLength(1);
  });

  it("rolls back deletion, cascades and its receipt with either owner or outer transaction failure", async () => {
    const user = await staff();
    const saved = await saveDocument("posts", null, post("Retain on failure"), user);
    const id = documentId(saved);
    const db = await getTestDb();
    const revisions = await db.select().from(npRevisions);
    const registration = getCollectionRegistration("posts");
    const afterDelete = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    registerCollection("posts", registration.table, {
      ...registration.config,
      hooks: { afterDelete: [afterDelete] },
    });
    const f = installRecorder();
    f.state.reject = true;
    await expect(deleteDocument("posts", id, user)).rejects.toThrow("Injected receipt failure");
    f.state.reject = false;
    await expect(
      withDeferredPostCommit(() =>
        db.transaction(async (tx) => {
          await deleteDocument("posts", id, user, { tx: tx as unknown as NpTransaction });
          expect(f.observations.at(-1)?.db).toBe(tx);
          throw new Error("Outer deletion rollback");
        }),
      ),
    ).rejects.toThrow("Outer deletion rollback");
    expect(await db.select().from(postsTable).where(eq(postsTable.id, id))).toHaveLength(1);
    expect(await db.select().from(npRevisions)).toEqual(revisions);
    expect(await markers()).toEqual([]);
    expect(afterDelete).not.toHaveBeenCalled();
    await deleteDocument("posts", id, user);
    expect(await db.select().from(postsTable)).toEqual([]);
    expect(await db.select().from(npRevisions)).toEqual([]);
    expect(await markers()).toHaveLength(1);
    expect(afterDelete).toHaveBeenCalledOnce();
  });

  it("keeps a losing concurrent deletion from claiming another committed mutation", async () => {
    const user = await staff();
    const saved = await saveDocument("posts", null, post("Delete once"), user);
    const f = installRecorder();
    const attempts = await Promise.allSettled([
      deleteDocument("posts", documentId(saved), user),
      deleteDocument("posts", documentId(saved), user),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(NpNotFoundError);
    expect(f.record).toHaveBeenCalledOnce();
    expect(await markers()).toHaveLength(1);
  });
});
