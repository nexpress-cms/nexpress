import { randomUUID } from "node:crypto";
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentGuardianContentObservationServiceV1,
  type NpAgentGuardianContentObservationOptionsV1,
} from "../../../packages/core/src/agent/guardian-content-observation.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  createAgentIncidentServiceV1,
  type NpAgentIncidentStaffContextV1,
} from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { createAgentGuardianOperationsServiceV1 } from "../../../packages/core/src/agent/guardian-operations-service.js";
import {
  npDigestAgentEventCanonical,
  npRequireAgentEventCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import { npReadAgentEventRowEvidenceV1 } from "../../../packages/core/src/agent/event-evidence.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAgentContentReceipts } from "../../../packages/core/src/db/schema/guardian.js";
import { npMembers } from "../../../packages/core/src/db/schema/community.js";
import { npRevisions, npSessions, npUsers } from "../../../packages/core/src/db/schema/system.js";
import {
  autosaveRevision,
  createMemberDocument,
  deleteDocument,
  promoteMemberDocument,
  saveDocument,
  updateMemberDocument,
  withDeferredPostCommit,
} from "../../../packages/core/src/collections/pipeline.js";
import { publishScheduledDocuments } from "../../../packages/core/src/collections/scheduled.js";
import {
  resetCollectionMutationObserverV1,
  setCollectionMutationObserverV1,
} from "../../../packages/core/src/collections/mutation-observer.js";
import {
  getCollectionRegistration,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import {
  resetCurrentSiteResolver,
  setCurrentSiteResolver,
} from "../../../packages/core/src/sites/context.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
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

const siteId = "default";
const start = "2026-10-18T10:00:01.000Z";
function post(title: string) {
  return { title, content: npCreateEmptyRichTextContent() };
}
function id(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected document id");
  return value;
}
async function staff() {
  const seeded = await seedUser();
  const db = await getTestDb();
  const [row] = await db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
  const [session] = await db.select().from(npSessions).where(eq(npSessions.userId, seeded.userId));
  const actor: NpAgentIncidentStaffContextV1["actor"] = {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      tokenVersion: row.tokenVersion,
    },
    sessionId: session.id,
  };
  return actor;
}
async function fixture(overrides: Partial<NpAgentGuardianContentObservationOptionsV1> = {}) {
  const db = await getTestDb();
  const actors = [await staff(), await staff(), await staff()];
  const never = () => Promise.reject(new Error("Content collection must not activate Runtime"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "content-source-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
  });
  const state = { allowCollection: true, rejectOneEvent: false };
  const authorize = vi.fn(async () => {
    if (!state.allowCollection) throw new Error("Current collector authority unavailable");
  });
  const options: NpAgentGuardianContentObservationOptionsV1 = {
    receiptKey: { id: "content-source-key-1", bytes: new Uint8Array(32).fill(71) },
    installedSiteIds: [siteId],
    authorize,
    events: {
      record: async (input) => {
        const result = await events.record(input);
        if (state.rejectOneEvent) {
          state.rejectOneEvent = false;
          throw new Error("Injected delivery failure");
        }
        return result;
      },
    },
    ...overrides,
  };
  const source = createAgentGuardianContentObservationServiceV1(options);
  setCollectionMutationObserverV1(source.mutationObserver);
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(72),
    canReadIncident: () => false,
    canReadStaffIncident: async ({ incident, context }) => {
      try {
        await source.evidence({
          db: context.transaction ?? db,
          siteId: context.siteId,
          actor: context.actor,
          incident,
        });
        return true;
      } catch {
        return false;
      }
    },
  });
  async function incident(detector = "guardian.content-churn") {
    const [signal] = await db
      .select()
      .from(npAgentSignals)
      .where(eq(npAgentSignals.detectorId, detector))
      .orderBy(asc(npAgentSignals.createdAt))
      .limit(1);
    if (!signal?.incidentId) throw new Error("Expected content Incident");
    return (await reads.staff.get({ incidentId: signal.incidentId }, { siteId, actor: actors[0] }))
      .incident;
  }
  return { db, actors, source, options, state, authorize, incident, reads, events };
}
async function churn(f: Awaited<ReturnType<typeof fixture>>, documentId?: string) {
  let current = documentId ?? null;
  for (const [index, who] of [0, 1, 0, 1, 2].entries()) {
    const saved = await saveDocument(
      "posts",
      current,
      post(`Committed private title ${index}`),
      f.actors[who].user,
    );
    current = id(saved.doc.id);
  }
  if (!current) throw new Error("Expected churn document");
  return current;
}

describe.skipIf(skipIfNoTestDb())("Guardian retained content activity observations", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    resetCollectionMutationObserverV1();
    await truncateAll();
    registerTestCollections();
    setCurrentSiteResolver(() => siteId);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(start));
  });
  afterEach(() => {
    resetCollectionMutationObserverV1();
    resetCurrentSiteResolver();
    registerTestCollections();
    vi.useRealTimers();
  });
  afterAll(closeTestDb);

  it("captures atomically without Events, then emits the exact signed actor/document/time fact", async () => {
    const f = await fixture();
    const saved = await saveDocument(
      "posts",
      null,
      post("Private source content"),
      f.actors[0].user,
    );
    const [receipt] = await f.db.select().from(npAgentContentReceipts);
    expect(receipt.state).toBe("pending");
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(JSON.stringify(receipt)).not.toContain("Private source content");
    expect(JSON.stringify(receipt)).not.toContain("snapshot");
    await expect(
      withDeferredPostCommit(() =>
        f.db.transaction(async (tx) => {
          await saveDocument("posts", id(saved.doc.id), { title: "Rollback" }, f.actors[0].user, {
            tx,
          });
          throw new Error("Outer rollback");
        }),
      ),
    ).rejects.toThrow("Outer rollback");
    expect(await f.db.select().from(npAgentContentReceipts)).toHaveLength(1);
    f.state.allowCollection = false;
    await expect(f.source.collect({ siteId })).rejects.toThrow(
      "Current collector authority unavailable",
    );
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    f.state.allowCollection = true;
    expect(await f.source.collect({ siteId })).toEqual({
      state: "collecting",
      held: 0,
      processed: 1,
      emitted: 1,
      blocked: 0,
      sampled: 0,
      backlog: 0,
    });
    const [event] = await f.db.select().from(npAgentEvents);
    const canonical = await npReadAgentEventRowEvidenceV1(event);
    expect(canonical).toMatchObject({
      kind: "content.activity.observed",
      occurredAt: start,
      actor: { kind: "staff", userId: f.actors[0].user.id },
      subject: { kind: "document", collection: "posts", documentId: saved.doc.id },
      payload: { receiptId: receipt.id, activity: receipt.body },
    });
    expect(event.dispatchedAt).toEqual(event.recordedAt);
    expect(await f.source.verifyEvent({ db: f.db, siteId, eventId: event.id })).toEqual({
      schemaVersion: "np.agent-guardian-verified-event.v1",
      eventId: event.id,
      source: "content",
      observedAt: start,
      sourceDigest: event.eventHash,
      detectorId: null,
    });
    const [emitted] = await f.db.select().from(npAgentContentReceipts);
    expect(emitted).toMatchObject({
      state: "emitted",
      emittedEventId: event.id,
      emittedAt: event.recordedAt,
      bodyHash: receipt.bodyHash,
      sourceMac: receipt.sourceMac,
    });
    expect((await f.source.collect({ siteId })).processed).toBe(0);
  });

  it("delivers real lifecycle receipts after deletion without counting promotions as saves or revisions", async () => {
    const f = await fixture();
    resetCollectionMutationObserverV1();
    await saveDocument(
      "posts",
      null,
      { ...post("Scheduled lifecycle"), publishedAt: new Date(Date.now() - 60_000) },
      f.actors[0].user,
      { status: "scheduled" },
    );
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
    const pending = await createMemberDocument(
      "discussions",
      { title: "Private lifecycle source", body: npCreateEmptyRichTextContent() },
      member.memberId,
    );
    const documentId = id(pending.doc.id);
    const table = registration.table as PgTable;
    const columns = getTableColumns(table);
    setCollectionMutationObserverV1(f.source.mutationObserver);
    expect((await publishScheduledDocuments()).published).toBe(1);
    for (let index = 0; index < 5; index++) {
      // Fixture preparation is deliberately outside capture. Each observed
      // transition still comes from the real conditional promotion owner.
      if (index > 0)
        await f.db.update(table).set({ status: "pending" }).where(eq(columns.id, documentId));
      await promoteMemberDocument("discussions", documentId, f.actors[index % 3].user.id);
    }
    await deleteDocument("discussions", documentId, f.actors[0].user);
    const receipts = await f.db.select().from(npAgentContentReceipts);
    expect(receipts).toHaveLength(7);
    expect(receipts.every((row) => row.body.fact.revision === null)).toBe(true);
    expect(receipts.filter((row) => row.body.fact.kind === "member-promotion")).toHaveLength(5);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(await f.source.collect({ siteId })).toMatchObject({
      emitted: 7,
      blocked: 0,
      backlog: 0,
    });
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    expect(await f.db.select().from(npAgentIncidents)).toEqual([]);
    const delivered = await f.db.select().from(npAgentContentReceipts);
    for (const receipt of delivered) {
      expect(
        await f.source.verifyReceiptForRetention({ db: f.db, siteId, receiptId: receipt.id }),
      ).toMatchObject({ state: "emitted", emittedEventId: receipt.emittedEventId });
      expect(
        await f.source.verifyEvent({ db: f.db, siteId, eventId: id(receipt.emittedEventId) }),
      ).toMatchObject({ source: "content", detectorId: null });
    }
    expect(JSON.stringify(delivered)).not.toMatch(
      /Private lifecycle source|snapshot|changedFields/,
    );
  });

  it("freezes exact churn cohorts, coalesces later windows and leaves a closed window closed", async () => {
    const f = await fixture();
    const documentId = await churn(f);
    expect((await f.source.collect({ siteId })).emitted).toBe(5);
    const first = await f.incident();
    expect(
      await f.source.evidence({ db: f.db, siteId, actor: f.actors[0], incident: first }),
    ).toEqual([
      expect.objectContaining({
        detectorId: "guardian.content-churn",
        observedCount: 5,
        distinctAccountCount: 3,
        basis: "committed-saves",
        countBasis: "at-least",
        window: { startedAt: "2026-10-18T10:00:00.000Z", endedAt: start },
      }),
    ]);
    await saveDocument("posts", documentId, { title: "Later in same window" }, f.actors[2].user);
    await f.source.collect({ siteId });
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-18T10:10:01.000Z"));
    await churn(f, documentId);
    await f.source.collect({ siteId });
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(2);
    const [active] = await f.db.select().from(npAgentIncidents);
    expect(active).toMatchObject({ id: first.id, signalCount: 2, severity: "medium" });
    await f.db
      .update(npAgentIncidents)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolutionCode: "EXPECTED_ACTIVITY",
        versionNumber: sql`${npAgentIncidents.versionNumber}+1`,
        updatedAt: new Date(),
      })
      .where(eq(npAgentIncidents.id, active.id));
    await churn(f, documentId);
    await f.source.collect({ siteId });
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(2);
    expect(await f.db.select().from(npAgentIncidents)).toEqual([
      expect.objectContaining({ id: first.id, status: "resolved" }),
    ]);
  });

  it("uses real new autosave revisions and retains their proof after history pruning", async () => {
    const f = await fixture();
    const registration = getCollectionRegistration("posts");
    registerCollection("posts", registration.table, {
      ...registration.config,
      versions: { drafts: { autosave: true }, max: 2 },
    });
    const saved = await saveDocument("posts", null, post("Persisted main"), f.actors[0].user);
    const documentId = id(saved.doc.id);
    for (let index = 0; index < 18; index++)
      await autosaveRevision("posts", documentId, post(`Draft ${index}`), f.actors[0].user);
    const reused = await autosaveRevision("posts", documentId, post("Draft 17"), f.actors[0].user);
    expect(reused.reused).toBe(true);
    await f.source.collect({ siteId });
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    await autosaveRevision("posts", documentId, post("Draft 18"), f.actors[0].user);
    await f.source.collect({ siteId });
    const incident = await f.incident("guardian.revision-volume");
    const evidence = await f.source.evidence({ db: f.db, siteId, actor: f.actors[0], incident });
    expect(evidence).toEqual([
      expect.objectContaining({
        detectorId: "guardian.revision-volume",
        observedCount: 20,
        basis: "persisted-revisions",
        countBasis: "at-least",
        distinctAccountCount: 1,
      }),
    ]);
    expect(incident.severity).toBe("low");
    expect(await f.db.select().from(npRevisions)).toHaveLength(2);
    await f.db.delete(npRevisions).where(eq(npRevisions.documentId, documentId));
    expect(await f.source.evidence({ db: f.db, siteId, actor: f.actors[0], incident })).toEqual(
      evidence,
    );
    const [main] = await f.db.select().from(postsTable).where(eq(postsTable.id, documentId));
    expect(main.title).toBe("Persisted main");
  });

  it("keeps versions-off saves separate from revision volume", async () => {
    const f = await fixture();
    let documentId: string | null = null;
    for (let index = 0; index < 20; index++)
      documentId = id(
        (await saveDocument("tags", documentId, { name: `Tag ${index}` }, f.actors[index % 3].user))
          .doc.id,
      );
    await f.source.collect({ siteId });
    const signals = await f.db.select().from(npAgentSignals);
    expect(signals).toHaveLength(1);
    expect(signals[0].detectorId).toBe("guardian.content-churn");
    const receipts = await f.db.select().from(npAgentContentReceipts);
    expect(receipts.every((receipt) => receipt.body.fact.revision === null)).toBe(true);
    expect(
      (
        await f.source.evidence({
          db: f.db,
          siteId,
          actor: f.actors[0],
          incident: await f.incident(),
        })
      )[0].basis,
    ).toBe("committed-saves");
  });

  it("namespaces staff/member identities and does not use nullable staff authorship as identity", async () => {
    const f = await fixture();
    const memberId = f.actors[0].user.id;
    await f.db.insert(npMembers).values({
      id: memberId,
      email: "same-id-member@example.com",
      password: "unused-fixture",
      handle: "same-id-member",
      displayName: "Member",
      emailVerified: true,
      status: "active",
    });
    const saved = await createMemberDocument(
      "discussions",
      { title: "Member starts", body: npCreateEmptyRichTextContent() },
      memberId,
    );
    const documentId = id(saved.doc.id);
    await saveDocument("discussions", documentId, { title: "Staff one" }, f.actors[0].user);
    await saveDocument("discussions", documentId, { title: "Staff two" }, f.actors[1].user);
    await updateMemberDocument("discussions", documentId, { title: "Member revises" }, memberId);
    await saveDocument("discussions", documentId, { title: "Staff final" }, f.actors[0].user);
    await f.source.collect({ siteId });
    const evidence = await f.source.evidence({
      db: f.db,
      siteId,
      actor: f.actors[0],
      incident: await f.incident(),
    });
    expect(evidence[0].distinctAccountCount).toBe(3);
    expect(
      (await f.db.select().from(npRevisions)).some((revision) => revision.authorId === null),
    ).toBe(true);
  });

  it("blocks a bad retained source without starving a later valid pending receipt", async () => {
    const f = await fixture();
    await saveDocument("posts", null, post("Bad signature"), f.actors[0].user);
    vi.setSystemTime(new Date("2026-10-18T10:00:02.000Z"));
    await saveDocument("posts", null, post("Valid later"), f.actors[0].user);
    const receipts = await f.db
      .select()
      .from(npAgentContentReceipts)
      .orderBy(asc(npAgentContentReceipts.occurredAt));
    await f.db
      .update(npAgentContentReceipts)
      .set({ sourceMac: `hmac-sha256:${"A".repeat(43)}` })
      .where(eq(npAgentContentReceipts.id, receipts[0].id));
    expect(await f.source.collect({ siteId })).toEqual({
      state: "collecting",
      held: 0,
      processed: 2,
      emitted: 1,
      blocked: 1,
      sampled: 0,
      backlog: 1,
    });
    const [blocked] = await f.db
      .select()
      .from(npAgentContentReceipts)
      .where(eq(npAgentContentReceipts.id, receipts[0].id));
    expect(blocked.failureCode).toBe("SOURCE_INTEGRITY");
    expect(blocked.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect((await f.source.collect({ siteId })).processed).toBe(0);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
  });

  it("requires the exact retained key and never substitutes the new current key", async () => {
    const f = await fixture();
    await saveDocument("posts", null, post("Old key fact"), f.actors[0].user);
    const rotated = {
      ...f.options,
      receiptKey: { id: "content-source-key-2", bytes: new Uint8Array(32).fill(73) },
    };
    const unavailable = createAgentGuardianContentObservationServiceV1(rotated);
    expect((await unavailable.collect({ siteId })).blocked).toBe(1);
    expect((await f.db.select().from(npAgentContentReceipts))[0].failureCode).toBe(
      "KEY_UNAVAILABLE",
    );
    vi.setSystemTime(new Date(Date.now() + 300_001));
    const retained = createAgentGuardianContentObservationServiceV1({
      ...rotated,
      resolveReceiptKey: async (keyId) =>
        keyId === f.options.receiptKey.id ? f.options.receiptKey.bytes : null,
    });
    expect((await retained.collect({ siteId })).emitted).toBe(1);
  });

  it("rolls back failed delivery inside its savepoint and retries without an orphan Event", async () => {
    const f = await fixture();
    await saveDocument("posts", null, post("Retry first"), f.actors[0].user);
    vi.setSystemTime(new Date(Date.now() + 1));
    await saveDocument("posts", null, post("Valid second"), f.actors[0].user);
    f.state.rejectOneEvent = true;
    expect(await f.source.collect({ siteId })).toMatchObject({
      emitted: 1,
      blocked: 1,
      backlog: 1,
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    const [blocked] = await f.db
      .select()
      .from(npAgentContentReceipts)
      .where(eq(npAgentContentReceipts.state, "blocked"));
    expect(blocked.failureCode).toBe("DELIVERY_UNAVAILABLE");
    vi.setSystemTime(new Date(Date.now() + 300_001));
    expect((await f.source.collect({ siteId })).emitted).toBe(1);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(2);
  });

  it("caps content Events independently at 100 per site/window and retains every extra signed fact", async () => {
    const f = await fixture();
    await withDeferredPostCommit(() =>
      f.db.transaction(async (tx) => {
        let documentId: string | null = null;
        for (let index = 0; index < 101; index++)
          documentId = id(
            (
              await saveDocument(
                "tags",
                documentId,
                { name: `Single-account save ${index}` },
                f.actors[0].user,
                { tx },
              )
            ).doc.id,
          );
      }),
    );
    const results = [];
    for (let index = 0; index < 5; index++) results.push(await f.source.collect({ siteId }));
    expect(results.map((result) => result.processed)).toEqual([25, 25, 25, 25, 1]);
    expect(results.reduce((total, result) => total + result.emitted, 0)).toBe(100);
    expect(results.reduce((total, result) => total + result.sampled, 0)).toBe(1);
    expect(results[4].backlog).toBe(0);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(100);
    const retained = await f.db.select().from(npAgentContentReceipts);
    expect(retained).toHaveLength(101);
    expect(retained.filter((row) => row.state === "sampled")).toEqual([
      expect.objectContaining({
        failureCode: "COVERAGE_CAPPED",
        emittedEventId: null,
        emittedAt: null,
        sourceMac: expect.stringMatching(/^hmac-sha256:/),
      }),
    ]);
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
  });

  it("discovers a late committing source on the next indexed pass without a high-water cursor", async () => {
    const f = await fixture();
    resetCollectionMutationObserverV1();
    const saved = await saveDocument("posts", null, post("Existing row"), f.actors[0].user);
    setCollectionMutationObserverV1(f.source.mutationObserver);
    let release = () => {};
    let ready = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const captured = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const pending = withDeferredPostCommit(() =>
      f.db.transaction(async (tx) => {
        await saveDocument("posts", id(saved.doc.id), { title: "Late commit" }, f.actors[0].user, {
          tx,
        });
        ready();
        await gate;
      }),
    );
    await captured;
    try {
      expect((await f.source.collect({ siteId })).processed).toBe(0);
    } finally {
      release();
      await pending;
    }
    expect((await f.source.collect({ siteId })).emitted).toBe(1);
  });

  it("requires current session/site authority and current document ACL for source evidence", async () => {
    const f = await fixture();
    await churn(f);
    await f.source.collect({ siteId });
    const incident = await f.incident();
    const input = { db: f.db, siteId, actor: f.actors[0], incident };
    const registration = getCollectionRegistration("posts");
    registerCollection("posts", registration.table, {
      ...registration.config,
      access: { read: ({ user }) => user?.role === "viewer" },
    });
    await expect(f.source.evidence(input)).rejects.toThrow();
    const [event] = await f.db.select().from(npAgentEvents).limit(1);
    const diagnostic = await f.source.verifyEvent({ db: f.db, siteId, eventId: event.id });
    expect(Object.keys(diagnostic).sort()).toEqual([
      "detectorId",
      "eventId",
      "observedAt",
      "schemaVersion",
      "source",
      "sourceDigest",
    ]);
    registerTestCollections();
    await f.db.update(npUsers).set({ role: "viewer" }).where(eq(npUsers.id, f.actors[0].user.id));
    await expect(f.source.evidence(input)).rejects.toThrow();
    await f.db.update(npUsers).set({ role: "admin" }).where(eq(npUsers.id, f.actors[0].user.id));
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actors[0].sessionId));
    await expect(f.source.evidence(input)).rejects.toThrow();
  });

  it("keeps original content proof visible and exportable after authorized human severity escalation", async () => {
    const f = await fixture();
    await churn(f);
    await f.source.collect({ siteId });
    const incident = await f.incident();
    const before = await f.source.evidence({ db: f.db, siteId, actor: f.actors[0], incident });
    const workflow = createAgentIncidentWorkflowServiceV1({
      reads: f.reads.staff,
      canReviewContainment: () => false,
    });
    const studio = createAgentIncidentStudioServiceV1({
      reads: f.reads.staff,
      workflow,
      guardianContentObservations: f.source,
      cursorHmacKey: new Uint8Array(32).fill(74),
    });
    const input = { siteId, actor: f.actors[0], incidentId: incident.id };
    await studio.escalate({
      ...input,
      command: {
        schemaVersion: "np.agent-incident-severity-input.v1",
        expectedVersion: incident.versionNumber,
        severity: "high",
        note: "Additional staff context requires priority review.",
        idempotencyKey: randomUUID(),
      },
    });
    const detail = await studio.get(input);
    expect(detail.incident.severity).toBe("high");
    expect(detail.guardianContentEvidence).toEqual(before);
    expect((await f.db.select().from(npAgentSignals))[0].severity).toBe("medium");
    const operations = createAgentGuardianOperationsServiceV1({
      studio,
      authorizeDiagnostics: ({ db, siteId: currentSiteId, actor }) =>
        f.reads.staff.authorize({ siteId: currentSiteId, actor, transaction: db }),
      sources: [
        {
          id: "content",
          readiness: () => Promise.resolve("enabled"),
          verifyEvent: f.source.verifyEvent.bind(f.source),
        },
      ],
    });
    const exported = await operations.exportIncident({
      ...input,
      expectedVersion: detail.incident.versionNumber,
    });
    expect(exported.incident.severity).toBe("high");
    expect(exported.sources).toEqual([
      expect.objectContaining({ source: "content", observedCount: 5, countBasis: "at-least" }),
    ]);
  });

  it("rejects self-consistent forged Event claims and tampered Signal/Incident fingerprints", async () => {
    const f = await fixture();
    await churn(f);
    await f.source.collect({ siteId });
    const incident = await f.incident();
    const input = { db: f.db, siteId, actor: f.actors[0], incident };
    const [event] = await f.db.select().from(npAgentEvents).orderBy(asc(npAgentEvents.id)).limit(1);
    const canonical = await npReadAgentEventRowEvidenceV1(event);
    if (canonical.payload.kind !== "content.activity.observed")
      throw new Error("Expected content Event");
    const forged = npRequireAgentEventCanonical({
      ...canonical,
      actor: { kind: "staff", userId: randomUUID() },
      payload: {
        ...canonical.payload,
        activity: { ...canonical.payload.activity, actor: { kind: "staff", userId: randomUUID() } },
      },
    });
    await f.db
      .update(npAgentEvents)
      .set({
        actor: forged.actor,
        payload: forged.payload,
        eventHash: await npDigestAgentEventCanonical(forged),
      })
      .where(eq(npAgentEvents.id, event.id));
    await expect(f.source.evidence(input)).rejects.toThrow();
    await expect(f.source.verifyEvent({ db: f.db, siteId, eventId: event.id })).rejects.toThrow();
    await f.db
      .update(npAgentEvents)
      .set({ actor: event.actor, payload: event.payload, eventHash: event.eventHash })
      .where(eq(npAgentEvents.id, event.id));
    const [signal] = await f.db.select().from(npAgentSignals);
    await f.db
      .update(npAgentSignals)
      .set({ fingerprint: "forged-content-fingerprint" })
      .where(eq(npAgentSignals.id, signal.id));
    await expect(f.source.evidence(input)).rejects.toThrow();
    await f.db
      .update(npAgentSignals)
      .set({ fingerprint: signal.fingerprint })
      .where(eq(npAgentSignals.id, signal.id));
    await f.db
      .update(npAgentIncidents)
      .set({ fingerprint: "forged-content-fingerprint" })
      .where(and(eq(npAgentIncidents.siteId, siteId), eq(npAgentIncidents.id, incident.id)));
    await expect(f.source.evidence(input)).rejects.toThrow();
  });
});
