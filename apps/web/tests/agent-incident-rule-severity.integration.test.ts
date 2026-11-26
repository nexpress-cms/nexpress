import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentEvents,
  npAgentIncidents,
  npAgentIncidentSignals,
  npAgentIncidentTimeline,
  npAgentInvocations,
  npAgentNotifications,
  npAgentProviderCalls,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import type { NpAgentIncidentSeverity } from "../../../packages/core/src/agent-contract/types.js";
import {
  npObserveIncidentCandidate,
  type NpIncidentObservationCandidate,
} from "../../../packages/core/src/agent/incident-observation-service.js";
import {
  npRequireIncidentRuleSeverityEvidence,
  npRequireIncidentSeverityEvidence,
} from "../../../packages/core/src/agent/incident-severity-evidence.js";
import { createAgentIncidentNotificationsServiceV1 } from "../../../packages/core/src/agent/incident-notifications-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import { npReadAgentEventRowEvidenceV1 } from "../../../packages/core/src/agent/event-evidence.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/** Synthetic source owner exercises persisted canonical Events; no model or Runtime is invoked. */
async function setup(options: { notifications?: boolean } = {}) {
  const f = await fixture();
  const now = () => new Date();
  const fingerprint = randomUUID();
  let visible = true;
  let failRecording = false;
  const forbiddenDispatch = vi.fn((): Promise<never> =>
    Promise.reject(new Error("Rule observation must not invoke Runtime or providers")),
  );
  const events = createAgentRuntimeEventServiceV1({
    admission: {
      admit: forbiddenDispatch,
      retry: forbiddenDispatch,
      withCurrentRun: forbiddenDispatch,
      withRunAuthority: forbiddenDispatch,
    },
    deploymentAuthority: {
      policyId: "rule-severity-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: forbiddenDispatch,
    now,
  });
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(108),
    canReadIncident: () => false,
    canReadStaffIncident: () => visible,
    now,
  }).staff;
  const notifications = createAgentIncidentNotificationsServiceV1({
    reads,
    cursorHmacKey: new Uint8Array(32).fill(109),
    now,
  });
  const recording =
    options.notifications === false
      ? undefined
      : {
          record: async (input: Parameters<typeof notifications.record>[0]) => {
            await notifications.record(input);
            if (failRecording) throw new Error("Synthetic notification failure");
          },
        };
  const workflow = createAgentIncidentWorkflowServiceV1({
    reads,
    canReviewContainment: () => true,
    notifications: recording,
    now,
  });
  const studio = createAgentIncidentStudioServiceV1({
    reads,
    workflow,
    notifications,
    cursorHmacKey: new Uint8Array(32).fill(110),
    now,
  });
  const input = { siteId, actor: f.actor.actor };
  async function candidate(
    severity: NpAgentIncidentSeverity,
    basis: NpIncidentObservationCandidate["confidenceBasis"] = "exact-rule",
    db = f.db,
  ) {
    const occurredAt = new Date(Date.now() - 1).toISOString();
    const { eventId } = await events.record({
      siteId,
      db,
      event: {
        version: "np.agent-event.v1",
        siteId,
        kind: "ops.check.changed",
        occurredAt,
        source: { kind: "ops", component: "ops.checks" },
        subject: { kind: "site", siteId },
        actor: null,
        causation: null,
        correlationId: null,
        deduplicationKey: randomUUID(),
        privacy: "internal",
        payload: {
          kind: "ops.check.changed",
          checkId: "database.health",
          previousStatus: "pass",
          currentStatus: "warn",
        },
      },
    });
    const [event] = await db.select().from(npAgentEvents).where(eq(npAgentEvents.id, eventId));
    const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId,
      detectorId: "guardian.test-rule-severity",
      detectorVersion: 1,
      category: "availability",
      window: { startedAt: occurredAt, endedAt: occurredAt },
      subject: { kind: "site", siteId },
      evidence: [
        {
          kind: "event",
          eventId,
          eventKind: event.kind,
          observedAt: occurredAt,
          digest: Buffer.from(event.eventHash.slice("cj1:sha256:".length), "base64url").toString(
            "hex",
          ),
          excerpt: null,
        },
      ],
    });
    return {
      canonicalEvidence,
      evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonicalEvidence),
      fingerprint,
      severity,
      confidenceBasis: basis,
      scoreBasisPoints: basis === "statistical" ? 9900 : null,
      title: "Synthetic deterministic source",
      summary: "Bounded source observation.",
    } satisfies NpIncidentObservationCandidate;
  }
  async function observe(
    value: NpIncidentObservationCandidate,
    db?: typeof f.db,
  ): ReturnType<typeof npObserveIncidentCandidate> {
    if (!db) return f.db.transaction((tx) => observe(value, tx as typeof f.db));
    return npObserveIncidentCandidate({
      candidate: value,
      transaction: db,
      notifications: recording,
      now,
      resolveEvidence: async (sourceDb) => {
        for (const ref of value.canonicalEvidence.evidence) {
          if (ref.kind !== "event") return false;
          const [row] = await sourceDb
            .select()
            .from(npAgentEvents)
            .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, ref.eventId)));
          if (!row) return false;
          const canonical = await npReadAgentEventRowEvidenceV1(row);
          if (
            canonical.occurredAt !== ref.observedAt ||
            canonical.kind !== ref.eventKind ||
            Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString("hex") !==
              ref.digest
          )
            return false;
        }
        return true;
      },
    });
  }
  async function snapshot() {
    return {
      events: await f.db.select().from(npAgentEvents).orderBy(asc(npAgentEvents.id)),
      incidents: await f.db.select().from(npAgentIncidents).orderBy(asc(npAgentIncidents.id)),
      signals: await f.db.select().from(npAgentSignals).orderBy(asc(npAgentSignals.id)),
      links: await f.db
        .select()
        .from(npAgentIncidentSignals)
        .orderBy(asc(npAgentIncidentSignals.id)),
      timeline: await f.db
        .select()
        .from(npAgentIncidentTimeline)
        .orderBy(asc(npAgentIncidentTimeline.sequence)),
      notifications: await f.db
        .select()
        .from(npAgentNotifications)
        .orderBy(asc(npAgentNotifications.id)),
      invocations: await f.db.select().from(npAgentInvocations).orderBy(asc(npAgentInvocations.id)),
      audits: await f.db.select().from(npAuditEvents).orderBy(asc(npAuditEvents.id)),
    };
  }
  return {
    ...f,
    input,
    candidate,
    observe,
    notifications,
    workflow,
    studio,
    snapshot,
    forbiddenDispatch,
    hide: () => {
      visible = false;
    },
    failRecording: () => {
      failRecording = true;
    },
  };
}

describe.skipIf(skipIfNoTestDb())("Deterministic Incident severity correlation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("raises once from an actual attached exact-rule Signal, projects its proof, and replays without authority or dispatch", async () => {
    const f = await setup();
    const original = await f.snapshot();
    const low = await f.observe(await f.candidate("low"));
    const higher = await f.candidate("high");
    const result = await f.observe(higher);
    expect(result).toMatchObject({
      incidentId: low.incidentId,
      versionNumber: 2,
      disposition: "correlated",
    });
    const stored = await f.snapshot();
    expect(stored.incidents[0]).toMatchObject({
      severity: "high",
      status: "open",
      signalCount: 2,
      eventCount: 2,
      versionNumber: 2,
    });
    const entry = stored.timeline[1];
    expect(entry).toMatchObject({
      kind: "correlated",
      sourceKind: "system",
      signalId: result.signalId,
      sourceId: null,
      auditEventId: null,
      runId: null,
      actionId: null,
      approvalId: null,
      providerCallId: null,
      details: {
        schemaVersion: "np.agent-incident-rule-severity-entry.v1",
        fromSeverity: "low",
        toSeverity: "high",
        transitionVersion: 2,
      },
    });
    const change = await npRequireIncidentRuleSeverityEvidence(f.db, entry);
    expect(change).toEqual({
      fromSeverity: "low",
      toSeverity: "high",
      detectorId: higher.canonicalEvidence.detectorId,
      detectorVersion: 1,
      evidenceDigest: higher.evidenceDigest,
      signalId: result.signalId,
    });
    await expect(npRequireIncidentSeverityEvidence(f.db, entry)).rejects.toThrow();
    expect(
      (await f.studio.get({ ...f.input, incidentId: low.incidentId })).timeline[1],
    ).toMatchObject({ ruleSeverityChange: change });
    expect((await f.notifications.list(f.input)).items).toMatchObject([
      { incidentVersion: 2, transition: "escalated", severity: "high", status: "open" },
    ]);
    expect(stored.audits).toEqual(original.audits);
    expect(stored.invocations).toEqual(original.invocations);
    for (const table of [npAgentRuns, npAgentProviderCalls, npAgentActions, npAgentApprovals])
      expect(await f.db.select().from(table)).toEqual([]);
    expect(f.forbiddenDispatch).not.toHaveBeenCalled();
    expect(await f.observe(higher)).toMatchObject({ ...result, disposition: "replayed" });
    expect(await f.snapshot()).toEqual(stored);
    f.hide();
    expect((await f.notifications.list(f.input)).items).toEqual([]);
    await expect(f.studio.get({ ...f.input, incidentId: low.incidentId })).rejects.toThrow();
  });

  it("preserves a higher staff judgment and its original audited notification proof", async () => {
    const f = await setup();
    const first = await f.observe(await f.candidate("medium"));
    const input = { ...f.input, incidentId: first.incidentId };
    await f.workflow.escalate({
      ...input,
      command: {
        schemaVersion: "np.agent-incident-severity-input.v1",
        expectedVersion: 1,
        severity: "critical",
        note: "Current staff evidence requires urgent attention.",
        idempotencyKey: randomUUID(),
      },
    });
    await f.observe(await f.candidate("high"));
    await f.observe(await f.candidate("critical"));
    const stored = await f.snapshot();
    expect(stored.incidents[0]).toMatchObject({ severity: "critical", versionNumber: 4 });
    expect(
      stored.timeline.filter(
        (entry) => entry.details.schemaVersion === "np.agent-incident-rule-severity-entry.v1",
      ),
    ).toEqual([]);
    expect(await npRequireIncidentSeverityEvidence(f.db, stored.timeline[1])).toMatchObject({
      fromSeverity: "medium",
      toSeverity: "critical",
    });
    await expect(npRequireIncidentRuleSeverityEvidence(f.db, stored.timeline[1])).rejects.toThrow();
    expect(
      (await f.notifications.list(f.input)).items.filter((item) => item.transition === "escalated"),
    ).toMatchObject([{ severity: "critical", incidentVersion: 2 }]);
    expect((await f.studio.get(input)).timeline[1].severityChange).toMatchObject({
      toSeverity: "critical",
    });
  });

  for (const basis of ["statistical", "external"] as const)
    it(`retains a higher ${basis} observation without giving it priority authority`, async () => {
      const f = await setup();
      const first = await f.observe(await f.candidate("low"));
      await f.observe(await f.candidate("critical", basis));
      const stored = await f.snapshot();
      expect(stored.incidents[0]).toMatchObject({
        severity: "low",
        versionNumber: 2,
        signalCount: 2,
      });
      expect(stored.timeline[1].details.schemaVersion).toBe("np.agent-incident-signal-entry.v1");
      expect(stored.notifications).toEqual([]);
      expect(
        (await f.studio.get({ ...f.input, incidentId: first.incidentId })).timeline.every(
          (entry) => !entry.ruleSeverityChange,
        ),
      ).toBe(true);
    });

  it("keeps hidden Signals beyond the display cap without granting them priority authority", async () => {
    const f = await setup();
    let incidentId = "";
    for (let i = 0; i < 100; i++)
      incidentId = (await f.observe(await f.candidate("low"))).incidentId;
    const higher = await f.candidate("critical");
    const result = await f.observe(higher);
    const stored = await f.snapshot();
    expect(result).toMatchObject({ incidentId, disposition: "suppressed", versionNumber: 101 });
    expect(stored.incidents[0]).toMatchObject({
      severity: "low",
      signalCount: 100,
      eventCount: 100,
    });
    expect(stored.signals).toHaveLength(101);
    expect(stored.signals.find((signal) => signal.id === result.signalId)).toMatchObject({
      status: "suppressed",
      severity: "critical",
    });
    expect(stored.links).toHaveLength(100);
    expect(stored.timeline[100].details).toMatchObject({
      schemaVersion: "np.agent-incident-signal-entry.v1",
      disposition: "suppressed",
    });
    expect(stored.notifications).toEqual([]);
    expect(await f.observe(higher)).toMatchObject({ disposition: "replayed", versionNumber: 101 });
  });

  it("serializes competing deterministic increases and never lowers the persisted maximum", async () => {
    const f = await setup();
    await f.observe(await f.candidate("low"));
    const high = await f.candidate("high");
    const critical = await f.candidate("critical");
    const observations = await Promise.allSettled([f.observe(high), f.observe(critical)]);
    for (const observation of observations)
      if (observation.status === "rejected") throw observation.reason;
    const stored = await f.snapshot();
    expect(stored.incidents[0]).toMatchObject({
      severity: "critical",
      versionNumber: 3,
      signalCount: 3,
    });
    const escalations = stored.timeline.filter(
      (entry) => entry.details.schemaVersion === "np.agent-incident-rule-severity-entry.v1",
    );
    expect(escalations.length).toBeGreaterThanOrEqual(1);
    for (const entry of escalations) await npRequireIncidentRuleSeverityEvidence(f.db, entry);
    expect((await f.notifications.list(f.input)).items).toHaveLength(escalations.length);
    expect(new Set(stored.notifications.map((notice) => notice.deduplicationKey)).size).toBe(
      escalations.length,
    );
  });

  it("rolls back source, Signal, priority, timeline and local notice together on recording failure", async () => {
    const f = await setup();
    await f.observe(await f.candidate("low"));
    const before = await f.snapshot();
    f.failRecording();
    await expect(
      f.db.transaction(async (tx) => {
        const db = tx as typeof f.db;
        await f.observe(await f.candidate("high", "exact-rule", db), db);
      }),
    ).rejects.toThrow("Synthetic notification failure");
    expect(await f.snapshot()).toEqual(before);
  });

  it("records verified priority history with the optional notification owner absent", async () => {
    const f = await setup({ notifications: false });
    await f.observe(await f.candidate("low"));
    await f.observe(await f.candidate("high"));
    const stored = await f.snapshot();
    expect(stored.incidents[0].severity).toBe("high");
    expect(await npRequireIncidentRuleSeverityEvidence(f.db, stored.timeline[1])).toMatchObject({
      toSeverity: "high",
    });
    expect(stored.notifications).toEqual([]);
  });

  it("does not reopen or emit again when a raised source is replayed after human closure", async () => {
    const f = await setup();
    const first = await f.observe(await f.candidate("low"));
    const higher = await f.candidate("high");
    await f.observe(higher);
    const input = { ...f.input, incidentId: first.incidentId };
    const review = await f.workflow.get(input);
    await f.workflow.transition({
      ...input,
      command: {
        schemaVersion: "np.agent-incident-transition-input.v1",
        expectedVersion: 2,
        transition: "resolved",
        resolutionCode: "REMEDIATED",
        note: "Synthetic source reviewed and remediated.",
        containmentReviewHash: review.containment.reviewHash,
        containmentDisposition: "acknowledge",
        idempotencyKey: randomUUID(),
      },
    });
    const stored = await f.snapshot();
    expect(stored.incidents[0]).toMatchObject({
      status: "resolved",
      severity: "high",
      versionNumber: 3,
    });
    expect(await f.observe(higher)).toMatchObject({
      incidentId: first.incidentId,
      disposition: "replayed",
      versionNumber: 3,
    });
    expect(await f.snapshot()).toEqual(stored);
    expect(
      (await f.notifications.list(f.input)).items.some((item) => item.transition === "escalated"),
    ).toBe(true);
  });

  it("rejects forged rule provenance and hides a notice and Studio judgment when its canonical Event is tampered", async () => {
    const f = await setup();
    const first = await f.observe(await f.candidate("low"));
    const higher = await f.candidate("high");
    await f.observe(higher);
    const stored = await f.snapshot();
    const entry = stored.timeline[1];
    const forged = [
      { ...entry, siteId: "draft-other" },
      { ...entry, sourceKind: "staff" },
      { ...entry, sourceId: f.actor.actor.user.id },
      { ...entry, auditEventId: randomUUID() },
      { ...entry, runId: randomUUID() },
      { ...entry, actionId: randomUUID() },
      { ...entry, approvalId: randomUUID() },
      { ...entry, providerCallId: randomUUID() },
      { ...entry, sourceFingerprint: `cj1:sha256:${"A".repeat(43)}` },
      { ...entry, signalId: stored.timeline[0].signalId },
      { ...entry, details: { ...entry.details, signalId: stored.timeline[0].signalId } },
      { ...entry, details: { ...entry.details, detectorVersion: 2 } },
      { ...entry, details: { ...entry.details, toSeverity: "critical", severity: "critical" } },
      { ...entry, details: { ...entry.details, disposition: "suppressed" } },
      { ...entry, details: { ...entry.details, rawModelJudgment: "raise priority" } },
    ];
    for (const value of forged)
      await expect(npRequireIncidentRuleSeverityEvidence(f.db, value)).rejects.toThrow();
    const ref = higher.canonicalEvidence.evidence[0];
    if (ref.kind !== "event") throw new Error("Expected actual Event fixture");
    await f.db
      .update(npAgentEvents)
      .set({
        payload: {
          kind: "ops.check.changed",
          checkId: "database.health",
          previousStatus: "pass",
          currentStatus: "fail",
        },
      })
      .where(eq(npAgentEvents.id, ref.eventId));
    await expect(npRequireIncidentRuleSeverityEvidence(f.db, entry)).rejects.toThrow();
    expect((await f.notifications.list(f.input)).items).toEqual([]);
    expect(
      (await f.studio.get({ ...f.input, incidentId: first.incidentId })).timeline.some(
        (item) => item.ruleSeverityChange,
      ),
    ).toBe(false);
  });
});
