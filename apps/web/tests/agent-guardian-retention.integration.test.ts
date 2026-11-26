import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentGuardianRetentionServiceV1,
  npGuardianRetentionAuditOwnerDigestV1,
  type NpAgentGuardianRetentionOptionsV1,
} from "../../../packages/core/src/agent/guardian-retention-service.js";
import {
  createAgentGuardianExternalObservationServiceV1,
  type NpAgentGuardianExternalObservationOptionsV1,
} from "../../../packages/core/src/agent/guardian-external-observation.js";
import { createAgentGuardianContentObservationServiceV1 } from "../../../packages/core/src/agent/guardian-content-observation.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  npAssertAgentGuardianDeliveryKeyAvailableV1,
  npReadAgentGuardianSourceClosureV1,
} from "../../../packages/core/src/agent/guardian-source-closure.js";
import { npReadAgentEventRowEvidenceV1 } from "../../../packages/core/src/agent/event-evidence.js";
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/contract-diagnostics.js";
import { npRequireAgentSourceReleaseRecordV1 } from "../../../packages/core/src/agent/source-release-read.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentSignals,
  npAgentSourceReleaseEdges,
  npAgentSourceReleases,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAgentContentReceipts } from "../../../packages/core/src/db/schema/guardian.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import {
  resetCollectionMutationObserverV1,
  setCollectionMutationObserverV1,
} from "../../../packages/core/src/collections/mutation-observer.js";
import {
  resetCurrentSiteResolver,
  setCurrentSiteResolver,
} from "../../../packages/core/src/sites/context.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const day = 86_400_000;
const policy = { version: 1, eventDays: 1, receiptDays: 1, signalDays: 1, historyDays: 1 } as const;
async function setup() {
  const f = await fixture();
  const state = {
    clock: new Date(Date.now() + 1000),
    retentionClock: new Date(Date.now() + 100 * day),
    allowed: true,
  };
  const now = () => new Date(state.clock);
  const occurredAt = new Date(state.clock.getTime() - 2000).toISOString();
  const signingKey = new Uint8Array(32).fill(111),
    receiptKey = new Uint8Array(32).fill(112);
  const installationId = "00000000-0000-4000-8000-000000000071";
  const never = () =>
    Promise.reject(new Error("Retention fixtures must not activate Runtime or providers"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "retention-source-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
    now,
  });
  const options: NpAgentGuardianExternalObservationOptionsV1 = {
    binding: {
      id: "00000000-0000-4000-8000-000000000072",
      siteId,
      installationId,
      projectId: "707",
    },
    signatureKeys: [{ id: "sentry-retention-1", bytes: signingKey }],
    receiptKey: { id: "host-retention-1", bytes: receiptKey },
    isInstalledSite: async (id) => id === siteId,
    authorize: async () => {
      if (!state.allowed) throw new Error("Private source authority revoked");
    },
    events,
    now,
  };
  const source = createAgentGuardianExternalObservationServiceV1(options);
  const payload = (firstSeen = occurredAt, issueId = "7071") => ({
    action: "created",
    installation: { uuid: installationId },
    data: { issue: { id: issueId, project: { id: "707" }, issueCategory: "error", firstSeen } },
  });
  function request(body = payload()) {
    const rawBody = new TextEncoder().encode(JSON.stringify(body));
    return {
      rawBody,
      signature: createHmac("sha256", signingKey).update(rawBody).digest("hex"),
      resource: "issue",
      signal: new AbortController().signal,
    };
  }
  function retention(overrides: Partial<NpAgentGuardianRetentionOptionsV1> = {}) {
    return createAgentGuardianRetentionServiceV1({
      policy,
      authorize: async ({ siteId: requested }) => {
        if (requested !== siteId) throw new Error("Wrong retained site");
      },
      proofOwners: [
        { family: "sentry", verifyEvent: source.verifyEvent, verifySignal: source.verifySignal },
      ],
      now: () => new Date(state.retentionClock),
      ...overrides,
    });
  }
  async function record() {
    const result = await source.ingest(request());
    if (!result.eventId || !result.incidentId)
      throw new Error("Expected actual Sentry source graph");
    return { eventId: result.eventId, incidentId: result.incidentId };
  }
  /** Only lifecycle/age fixture state is synthetic. Immutable source Event, receipt,
   * Signal and observed timeline remain the actual authenticated source facts.
   * This is not a fabricated human approval, workflow audit or security signoff. */
  async function terminal(incidentId: string) {
    await f.db
      .update(npAgentIncidents)
      .set({
        status: "dismissed",
        resolvedAt: new Date(state.clock),
        resolutionCode: "FIXTURE_TERMINAL",
      })
      .where(eq(npAgentIncidents.id, incidentId));
  }
  async function drain(owner = retention()) {
    const results = [];
    for (let pass = 0; pass < 3; pass++) {
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const result = await owner.prune({ siteId, cursor, limit: 25 });
        results.push(result);
        cursor = result.nextCursor;
        if (cursor === null) break;
      }
    }
    return results;
  }
  return {
    ...f,
    state,
    now,
    options,
    source,
    payload,
    request,
    retention,
    record,
    terminal,
    drain,
    events,
    receiptKey,
  };
}

describe.skipIf(skipIfNoTestDb())("Guardian closed-delivery proof retention", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    resetCollectionMutationObserverV1();
    await truncateAll();
    registerTestCollections();
    setCurrentSiteResolver(() => siteId);
  });
  afterEach(() => {
    resetCollectionMutationObserverV1();
    resetCurrentSiteResolver();
  });
  afterAll(closeTestDb);

  it("prunes an aged observational source graph, retains exact source/closure audit edges and blocks old replay and fresh identity rebinding", async () => {
    const f = await setup(),
      graph = await f.record();
    const [originalEventRow] = await f.db.select().from(npAgentEvents);
    const originalEvent = await npReadAgentEventRowEvidenceV1(originalEventRow);
    await f.terminal(graph.incidentId);
    const [sourceAudit] = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agent.guardian_external.source"));
    const results = await f.drain();
    expect(results.reduce((sum, r) => sum + r.eventsPruned, 0)).toBe(1);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    expect(await f.db.select().from(npAgentIncidents)).toEqual([]);
    const [release] = await f.db
      .select()
      .from(npAgentSourceReleases)
      .where(eq(npAgentSourceReleases.sourceKind, "guardian-event"));
    const body = await npRequireAgentSourceReleaseRecordV1(release);
    expect(body).toMatchObject({
      kind: "guardian-event",
      family: "sentry",
      sourceId: graph.eventId,
    });
    const edges = await f.db.select().from(npAgentSourceReleaseEdges);
    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual(
      expect.objectContaining({
        ownerKind: "guardian-audit",
        ownerId: sourceAudit.id,
        ownerEvidenceDigest: npGuardianRetentionAuditOwnerDigestV1(sourceAudit),
      }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        ownerKind: "guardian-closure-audit",
        edgeCode: "guardian-closure",
      }),
    );
    expect(
      await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.id, sourceAudit.id)),
    ).toEqual([sourceAudit]);
    expect((await npCollectAgentHealthSummaryV1()).issues).toEqual([]);
    for (const edge of edges) {
      await expect(
        f.db
          .update(npAuditEvents)
          .set({ payload: { altered: true } })
          .where(eq(npAuditEvents.id, edge.ownerId)),
      ).rejects.toThrow();
    }
    expect(await f.source.ingest(f.request())).toMatchObject({
      disposition: "ignored",
      code: "SOURCE_CLOSED",
      eventId: null,
    });
    // Sentry's signed identity includes firstSeen. Exercise the common denial
    // seam with the consumed key and a fresh time without inventing upstream facts.
    await expect(
      npAssertAgentGuardianDeliveryKeyAvailableV1(
        f.db,
        { ...originalEvent, occurredAt: f.state.retentionClock.toISOString() },
        "sentry",
      ),
    ).rejects.toMatchObject({ code: "GUARDIAN_SOURCE_ALREADY_RELEASED" });
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(JSON.stringify(results)).not.toContain(graph.eventId);
  });

  it("holds active and unknown advisory history, including the source Event it still references", async () => {
    const f = await setup(),
      graph = await f.record();
    expect((await f.drain()).every((r) => r.eventsPruned === 0)).toBe(true);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    await f.terminal(graph.incidentId);
    await f.db.insert(npAgentIncidentTimeline).values({
      siteId,
      incidentId: graph.incidentId,
      sequence: 2,
      kind: "verification",
      sourceKind: "system",
      sourceFingerprint: `retention-unresolved:${graph.incidentId}`,
      summary: "Unresolved synthetic follow-up",
      details: { schemaVersion: "retention.unresolved.v1" },
      createdAt: f.state.clock,
    });
    const results = await f.drain();
    expect(results.every((r) => r.eventsPruned === 0 && r.historyPruned === 0)).toBe(true);
    expect(await f.db.select().from(npAgentSourceReleases)).toEqual([]);
  });

  it("holds the entire closed graph when an actual historical receipt MAC key is unavailable", async () => {
    const f = await setup(),
      graph = await f.record();
    await f.terminal(graph.incidentId);
    const missingKey = createAgentGuardianExternalObservationServiceV1({
      ...f.options,
      receiptKey: { id: "host-retention-2", bytes: new Uint8Array(32).fill(113) },
    });
    const owner = f.retention({
      proofOwners: [
        {
          family: "sentry",
          verifyEvent: missingKey.verifyEvent,
          verifySignal: missingKey.verifySignal,
        },
      ],
    });
    const results = await f.drain(owner);
    expect(results.flatMap((r) => r.skipped)).toContainEqual(
      expect.objectContaining({ reason: "PROOF_UNAVAILABLE" }),
    );
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(1);
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    expect(await f.db.select().from(npAgentSourceReleases)).toEqual([]);
  });

  it("holds a closed canonical Guardian Signal when its actual rule verifier is absent", async () => {
    const f = await setup(),
      graph = await f.record();
    await f.terminal(graph.incidentId);
    const result = await f
      .retention({ proofOwners: [{ family: "sentry", verifyEvent: f.source.verifyEvent }] })
      .prune({ siteId });
    expect(result.historyPruned).toBe(0);
    expect(result.eventsPruned).toBe(0);
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
    expect(await f.db.select().from(npAgentSourceReleases)).toEqual([]);
  });

  it("accepts an explicitly retained historical key without reopening the stable closed namespace", async () => {
    const f = await setup(),
      graph = await f.record();
    await f.terminal(graph.incidentId);
    const rotated = createAgentGuardianExternalObservationServiceV1({
      ...f.options,
      receiptKey: { id: "host-retention-2", bytes: new Uint8Array(32).fill(113) },
      resolveReceiptKey: (id) => (id === "host-retention-1" ? f.receiptKey : null),
    });
    await f.drain(
      f.retention({
        proofOwners: [
          {
            family: "sentry",
            verifyEvent: rotated.verifyEvent,
            verifySignal: rotated.verifySignal,
          },
        ],
      }),
    );
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    const first = await npReadAgentGuardianSourceClosureV1(f.db, siteId, "sentry");
    expect(await rotated.ingest(f.request())).toMatchObject({ code: "SOURCE_CLOSED" });
    f.state.retentionClock = new Date(f.state.retentionClock.getTime() + day);
    await f.retention().prune({ siteId });
    const next = await npReadAgentGuardianSourceClosureV1(f.db, siteId, "sentry");
    expect(next?.namespaceDigest).toBe(first?.namespaceDigest);
    expect(next?.revision).toBe((first?.revision ?? 0) + 1);
    const [oldClosureEdge] = await f.db
      .select()
      .from(npAgentSourceReleaseEdges)
      .where(eq(npAgentSourceReleaseEdges.ownerKind, "guardian-closure-audit"));
    const [oldClosureAudit] = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.id, oldClosureEdge.ownerId));
    expect(npGuardianRetentionAuditOwnerDigestV1(oldClosureAudit)).toBe(
      oldClosureEdge.ownerEvidenceDigest,
    );
  });

  it("does not use canonical envelope hashes as a substitute for a tampered source audit", async () => {
    const f = await setup(),
      graph = await f.record();
    await f.terminal(graph.incidentId);
    const [audit] = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agent.guardian_external.source"));
    await f.db
      .update(npAuditEvents)
      .set({ payload: { ...audit.payload, sourceMac: `hmac-sha256:${"A".repeat(43)}` } })
      .where(eq(npAuditEvents.id, audit.id));
    const results = await f.drain();
    expect(results.every((r) => r.eventsPruned === 0 && r.historyPruned === 0)).toBe(true);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    expect(await f.db.select().from(npAgentSourceReleases)).toEqual([]);
  });

  it("pins opaque references from another site's settings and never deletes another site's rows", async () => {
    const f = await setup(),
      graph = await f.record();
    await f.terminal(graph.incidentId);
    await f.db.insert(npSettings).values({
      siteId: "draft-other",
      key: "retention.reference",
      value: { incidentId: graph.incidentId, eventId: graph.eventId },
    });
    const before = await f.db.select().from(npSettings).where(eq(npSettings.siteId, "draft-other"));
    await f.drain();
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(1);
    expect(
      await f.db.select().from(npSettings).where(eq(npSettings.siteId, "draft-other")),
    ).toEqual(before);
    expect(await f.db.select().from(npAgentSourceReleases)).toEqual([]);
  });

  it("rolls back deletion, release edges and closure when authority is revoked after the final write", async () => {
    const fresh = await setup();
    const freshGraph = await fresh.record();
    await fresh.terminal(freshGraph.incidentId);
    // Retain the authenticated Event with a real opaque reference while the
    // observational history ages out through its owning retention service.
    await fresh.db
      .insert(npSettings)
      .values({ siteId, key: "retention.rollback-hold", value: { eventId: freshGraph.eventId } });
    await fresh.drain();
    expect(await fresh.db.select().from(npAgentIncidents)).toEqual([]);
    expect(await fresh.db.select().from(npAgentEvents)).toHaveLength(1);
    await fresh.db.delete(npSettings).where(eq(npSettings.key, "retention.rollback-hold"));
    fresh.state.retentionClock = new Date(fresh.state.retentionClock.getTime() + day);
    let calls = 0;
    const owner = fresh.retention({
      authorize: async () => {
        calls++;
        if (calls === 2) throw new Error("Private late authority failure");
      },
    });
    const beforeEvents = await fresh.db.select().from(npAgentEvents);
    const beforeHistory = await fresh.db.select().from(npAgentIncidents);
    const beforeReleases = await fresh.db.select().from(npAgentSourceReleases);
    const beforeAudits = await fresh.db.select().from(npAuditEvents);
    await expect(owner.prune({ siteId })).rejects.toMatchObject({
      code: "GUARDIAN_RETENTION_UNAVAILABLE",
    });
    expect(await fresh.db.select().from(npAgentEvents)).toEqual(beforeEvents);
    expect(await fresh.db.select().from(npAgentIncidents)).toEqual(beforeHistory);
    expect(await fresh.db.select().from(npAgentSourceReleases)).toEqual(beforeReleases);
    expect(await fresh.db.select().from(npAuditEvents)).toEqual(beforeAudits);
  });

  it("requires current maintenance authority independently of immutable source proof", async () => {
    const f = await setup(),
      graph = await f.record();
    await f.terminal(graph.incidentId);
    f.state.allowed = false;
    await expect(
      f
        .retention({
          authorize: async () => {
            if (!f.state.allowed) throw new Error("Private current maintenance denial");
          },
        })
        .prune({ siteId }),
    ).rejects.toMatchObject({ code: "GUARDIAN_RETENTION_UNAVAILABLE" });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
  });

  it("prunes actual emitted content receipts only after closure and keeps held late CMS commits", async () => {
    const f = await setup();
    const content = createAgentGuardianContentObservationServiceV1({
      receiptKey: { id: "cms-retention-1", bytes: new Uint8Array(32).fill(114) },
      installedSiteIds: [siteId],
      authorize: async () => {},
      events: f.events,
      now: f.now,
    });
    setCollectionMutationObserverV1(content.mutationObserver);
    const saved = await saveDocument(
      "posts",
      null,
      { title: "Retention CMS fact", content: npCreateEmptyRichTextContent() },
      f.actor.actor.user,
      { status: "draft" },
    );
    if (typeof saved.doc.id !== "string") throw new Error("Expected CMS document");
    const collected = await content.collect({ siteId, limit: 25 });
    expect(collected).toMatchObject({ emitted: 1 });
    const [emitted] = await f.db.select().from(npAgentContentReceipts);
    const owner = f.retention({
      proofOwners: [
        {
          family: "content",
          verifyEvent: content.verifyEvent,
          verifySignal: content.verifySignal,
          verifyReceipt: content.verifyReceiptForRetention,
        },
      ],
    });
    let captured: () => void = () => {},
      resume: () => void = () => {};
    const capture = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const continueCapture = new Promise<void>((resolve) => {
      resume = resolve;
    });
    setCollectionMutationObserverV1({
      record: async (input) => {
        captured();
        await continueCapture;
        await content.mutationObserver.record(input);
      },
    });
    const lateWrite = saveDocument(
      "posts",
      saved.doc.id,
      { title: "Late actual CMS write" },
      f.actor.actor.user,
      { status: "draft" },
    );
    await Promise.race([
      capture,
      lateWrite.then(() => {
        throw new Error("Expected paused actual CMS update");
      }),
    ]);
    try {
      await f.drain(owner);
    } finally {
      resume();
      await lateWrite;
    }
    expect(await f.db.select().from(npAgentContentReceipts)).toEqual([
      expect.objectContaining({ state: "pending", emittedEventId: null }),
    ]);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    const [release] = await f.db.select().from(npAgentSourceReleases);
    expect(await npRequireAgentSourceReleaseRecordV1(release)).toMatchObject({
      kind: "guardian-event",
      family: "content",
      sourceId: emitted.emittedEventId,
    });

    // The real CMS update began before closure and committed after it. Content
    // capture did not hold Runtime/fence/quota locks across the independent prune.
    const late = await content.collect({ siteId, limit: 25 });
    expect(late.emitted).toBe(0);
    const [held] = await f.db.select().from(npAgentContentReceipts);
    expect(held).toMatchObject({
      state: "held",
      failureCode: "DELIVERY_CLOSED",
      emittedEventId: null,
    });
    await f.drain(owner);
    expect(await f.db.select().from(npAgentContentReceipts)).toEqual([held]);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
  });
});
