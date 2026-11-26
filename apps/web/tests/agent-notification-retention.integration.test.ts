import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentNotificationsServiceV1 } from "../../../packages/core/src/agent/incident-notifications-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import { createAgentNotificationDeliveryServiceV1 } from "../../../packages/core/src/agent/notification-delivery-service.js";
import { npPruneAgentIncidentRetentionV1 } from "../../../packages/core/src/agent/incident-retention.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../../../packages/core/src/agent-contract/runtime-contract.js";
import { npAgentNotificationDeliveryLimitsV1 } from "../../../packages/core/src/agent-contract/notification-delivery-contract.js";
import {
  npAgentSignals,
  npAgentIncidentSignals,
  npAgentConnectionConfigVersions,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentNotifications,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { notificationDeliveryFixture } from "./agent-notification-delivery-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const DAY = 86_400_000;
const policy = { signalDays: 90, historyDays: 365 };
const cleanup: Awaited<ReturnType<typeof notificationDeliveryFixture>>[] = [];
async function fixture(options: { idempotency?: "enforced" | "none"; siteId?: string } = {}) {
  let clock = new Date();
  const now = () => clock;
  const f = await notificationDeliveryFixture({ ...options, now });
  cleanup.push(f);
  let dispatch = true;
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  rules.providerDataMaximum = "internal-redacted";
  rules.escalation.channels = ["email", "slack"];
  rules.escalation.minimumSeverity = "low";
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(101),
    canReadIncident: () => false,
    canReadStaffIncident: () => true,
    now,
  }).staff;
  const delivery = createAgentNotificationDeliveryServiceV1({
    connections: f.connections,
    vault: f.vault,
    registry: f.registry,
    reads,
    cursorHmacKey: new Uint8Array(32).fill(102),
    now,
    notBefore: new Date(clock.getTime() - 60000).toISOString(),
    resolveRoutes: () =>
      Promise.resolve([
        { channel: "email", connectionId: f.connectionId },
        { channel: "slack", connectionId: f.connectionId },
      ]),
    authorizeRoute: ({ phase }) =>
      Promise.resolve(
        phase === "dispatch" && !dispatch
          ? null
          : {
              policy: {
                autonomy: "advise",
                capabilityModes: rules.capabilityModes,
                layers: [rules],
              },
              recipient: { siteId: f.siteId, actor: f.actor },
            },
      ),
  });
  const notifications = createAgentIncidentNotificationsServiceV1({
    delivery,
    reads,
    cursorHmacKey: new Uint8Array(32).fill(103),
    now,
  });
  const workflow = createAgentIncidentWorkflowServiceV1({
    reads,
    notifications,
    canReviewContainment: () => true,
    now,
  });
  const [incident] = await f.db
    .insert(npAgentIncidents)
    .values({
      siteId: f.siteId,
      category: "spam",
      severity: "critical",
      status: "open",
      fingerprint: randomUUID(),
      signalCount: 1,
      eventCount: 0,
      title: "Retention fixture Incident",
      summary: "Fake delivery history",
      firstObservedAt: clock,
      lastObservedAt: clock,
      createdAt: clock,
      updatedAt: clock,
    })
    .returning();
  if (!incident) throw new Error("Expected fixture Incident");
  const evidence = npRequireAgentSignalEvidenceCanonical({
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId: f.siteId,
    detectorId: "notification.retention.fixture",
    detectorVersion: 1,
    category: "spam",
    window: {
      startedAt: new Date(clock.getTime() - 600000).toISOString(),
      endedAt: clock.toISOString(),
    },
    subject: null,
    evidence: [
      {
        kind: "revision",
        collection: "posts",
        documentId: randomUUID(),
        revisionId: randomUUID(),
        observedAt: clock.toISOString(),
        digest: "a".repeat(64),
        excerpt: null,
      },
    ],
  });
  const [signal] = await f.db
    .insert(npAgentSignals)
    .values({
      siteId: f.siteId,
      detectorId: evidence.detectorId,
      detectorVersion: 1,
      category: "spam",
      severity: "critical",
      confidenceBasis: "exact-rule",
      fingerprint: randomUUID(),
      evidence: evidence.evidence,
      evidenceDigest: await npDigestAgentSignalEvidenceCanonical(evidence),
      subject: null,
      status: "attached",
      incidentId: incident.id,
      windowStartedAt: new Date(evidence.window.startedAt),
      windowEndedAt: clock,
      expiresAt: new Date(clock.getTime() + DAY),
      createdAt: clock,
      updatedAt: clock,
    })
    .returning();
  if (!signal) throw new Error("Expected canonical synthetic Signal");
  await f.db
    .insert(npAgentIncidentSignals)
    .values({ siteId: f.siteId, incidentId: incident.id, signalId: signal.id });

  const input = { siteId: f.siteId, actor: f.actor, incidentId: incident.id };
  const review = await workflow.get(input);
  await workflow.transition({
    ...input,
    command: {
      schemaVersion: "np.agent-incident-transition-input.v1",
      expectedVersion: 1,
      transition: "resolved",
      resolutionCode: "NO_FURTHER_ACTION",
      note: "Retention fixture closure.",
      containmentReviewHash: review.containment.reviewHash,
      containmentDisposition: "acknowledge",
      idempotencyKey: randomUUID(),
    },
  });
  const rows = () =>
    f.db
      .select()
      .from(npAgentNotifications)
      .where(eq(npAgentNotifications.incidentId, incident.id));
  const external = async () => (await rows()).filter((row) => row.channel !== "admin");
  const local = (await rows()).find((row) => row.channel === "admin");
  if (!local || (await external()).length !== 2) throw new Error("Expected real frozen routing");
  const process = async (selected?: Awaited<ReturnType<typeof external>>[number]) => {
    const row = selected ?? (await external())[0];
    if (!row) throw new Error("Expected delivery");
    await delivery.process({
      siteId: f.siteId,
      notificationId: row.id,
      expectedAttempt: row.attempts,
    });
  };
  const timeline = () =>
    f.db
      .select()
      .from(npAgentIncidentTimeline)
      .where(eq(npAgentIncidentTimeline.incidentId, incident.id));
  const later = () => new Date(clock.getTime() + 366 * DAY);
  const prune = (options: Partial<Parameters<typeof npPruneAgentIncidentRetentionV1>[0]> = {}) =>
    npWithAgentRuntimeControlTransactionV1(f.siteId, ({ db }) =>
      npPruneAgentIncidentRetentionV1({
        db,
        siteId: f.siteId,
        cursor: null,
        limit: 25,
        rootIds: [local.id],
        now: later(),
        policy,
        beforeStatement: () => Promise.resolve(),
        ...options,
      }),
    );
  return {
    ...f,
    delivery,
    notifications,
    incident,
    local,
    rows,
    external,
    timeline,
    process,
    later,
    prune,
    suppress: () => {
      dispatch = false;
    },
    advance: (seconds: number) => {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
  };
}

describe.skipIf(skipIfNoTestDb())("dependency-safe external notification retention", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const f of cleanup.splice(0).reverse()) await f.dispose();
  });
  afterAll(closeTestDb);

  it("expires a whole confirmed group through the existing maintenance cursor, retaining the audited Incident and Connection snapshot", async () => {
    const f = await fixture();
    for (const row of await f.external()) await f.process(row);
    const snapshot = await f.db.select().from(npAgentConnectionConfigVersions);
    const audit = await f.db.select().from(npAuditEvents);
    const incident = await f.db.select().from(npAgentIncidents);
    const originalTimeline = await f.timeline();
    const history = originalTimeline.filter((row) => row.kind !== "notification");
    const before = new Date(f.local.createdAt.getTime() + 365 * DAY - 1);
    expect((await f.prune({ policy: undefined })).pruned).toBe(0);
    expect((await f.prune({ now: before })).pruned).toBe(0);
    expect(
      (
        await pruneAgentRuntimeEventsV1({
          siteId: f.siteId,
          now: f.later(),
          incidentRetention: policy,
        })
      ).pruned,
    ).toBe(6);
    expect(await f.rows()).toEqual([]);
    const retained = await f.timeline();
    expect(retained.filter((row) => row.kind !== "notification")).toEqual(history);
    expect(retained.filter((row) => row.kind === "notification")).toEqual([
      expect.objectContaining({
        sourceId: null,
        sequence: Math.max(...originalTimeline.map((row) => row.sequence)),
        details: {
          schemaVersion: "np.agent-notification-routing-expired.v1",
          localDeduplicationKey: f.local.deduplicationKey,
        },
      }),
    ]);
    expect(await f.db.select().from(npAgentIncidents)).toEqual(incident);
    expect(await f.db.select().from(npAuditEvents)).toEqual(audit);
    expect(await f.db.select().from(npAgentConnectionConfigVersions)).toEqual(snapshot);
    expect((await f.prune()).pruned).toBe(0);
    expect(f.send).toHaveBeenCalledTimes(2);
    const closure = history.find((row) => row.kind === "state_transition");
    if (!closure) throw new Error("Expected retained transition");
    await f.db.transaction((tx) =>
      f.notifications.record({
        db: tx as typeof f.db,
        siteId: f.siteId,
        incidentId: f.incident.id,
        transitionVersion: f.local.transitionVersion,
        transition: "resolved",
        timelineId: closure.id,
      }),
    );
    expect((await f.rows()).filter((row) => row.channel === "admin")).toHaveLength(1);
    expect((await f.rows())[0]?.id).not.toBe(f.local.id);
    expect(await f.external()).toEqual([]);
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it("accepts canonically proven permanent failure and pre-dispatch suppression without sending during pruning", async () => {
    const f = await fixture();
    const routes = await f.external();
    f.send.mockResolvedValue({ state: "permanent_failure", errorCode: "DESTINATION_REJECTED" });
    await f.process(routes[0]);
    f.suppress();
    await f.process(routes[1]);
    expect((await f.external()).map((row) => row.state).sort()).toEqual(["failed", "suppressed"]);
    expect((await f.prune()).pruned).toBe(6);
    expect(await f.rows()).toEqual([]);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("accepts exhausted proven not-sent retries only after every attempt fact is old enough", async () => {
    const f = await fixture();
    const [first, second] = await f.external();
    f.send.mockResolvedValue({ state: "retryable_not_sent", errorCode: "NOT_DISPATCHED" });
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = (await f.external()).find((entry) => entry.id === first?.id);
      await f.process(row);
      f.advance(npAgentNotificationDeliveryLimitsV1.retryDelaySeconds[attempt] ?? 0);
    }
    f.send.mockResolvedValue({ state: "confirmed", providerMessageId: null });
    await f.process(second);
    expect((await f.external()).find((row) => row.id === first?.id)).toMatchObject({
      state: "failed",
      attempts: 5,
    });
    expect((await f.prune()).pruned).toBe(10);
    expect(await f.rows()).toEqual([]);
  });

  it("keeps confirmed siblings and the source receipt when another route is queued, sending or ambiguous", async () => {
    const f = await fixture({ idempotency: "none" });
    const routes = await f.external();
    await f.process(routes[0]);
    const before = await f.rows();
    expect((await f.prune()).pruned).toBe(0);
    expect(await f.rows()).toEqual(before);
    await f.db
      .update(npAgentNotifications)
      .set({ state: "sending", attempts: 1 })
      .where(eq(npAgentNotifications.id, routes[1]!.id));
    expect((await f.prune()).pruned).toBe(0);
    await f.db
      .update(npAgentNotifications)
      .set({ state: "queued", attempts: 0 })
      .where(eq(npAgentNotifications.id, routes[1]!.id));
    f.send.mockResolvedValue({ state: "ambiguous", errorCode: "TIMEOUT" });
    await f.process(routes[1]);
    expect((await f.external()).find((row) => row.id === routes[1]!.id)).toMatchObject({
      state: "failed",
    });
    expect((await f.prune()).pruned).toBe(0);
    expect(await f.rows()).toHaveLength(3);
  });

  it("retains earlier ambiguity until a later confirmation resolves the same enforced-idempotency operation", async () => {
    const f = await fixture();
    const [first, second] = await f.external();
    await f.process(second);
    f.send.mockResolvedValue({ state: "ambiguous", errorCode: "TIMEOUT" });
    await f.process(first);
    f.advance(30);
    f.send.mockResolvedValue({ state: "permanent_failure", errorCode: "DESTINATION_REJECTED" });
    await f.process((await f.external()).find((row) => row.id === first?.id));
    expect((await f.prune()).pruned).toBe(0);
    expect(await f.rows()).toHaveLength(3);
  });

  it("expires a confirmed enforced-idempotency operation after an earlier ambiguous retry", async () => {
    const f = await fixture();
    const [first, second] = await f.external();
    f.send.mockResolvedValue({ state: "ambiguous", errorCode: "TIMEOUT" });
    await f.process(first);
    f.advance(30);
    f.send.mockResolvedValue({ state: "confirmed", providerMessageId: null });
    await f.process((await f.external()).find((row) => row.id === first?.id));
    await f.process(second);
    expect((await f.prune()).pruned).toBe(7);
    expect(await f.rows()).toEqual([]);
  });

  it("requires both an aged closed Incident and aged delivery facts, and isolates another site", async () => {
    const f = await fixture();
    for (const row of await f.external()) await f.process(row);
    const other = await fixture({ siteId: "external-retention-other" });
    for (const row of await other.external()) await other.process(row);
    const target = (await f.external())[0]!;
    const [closed] = await f.db
      .select()
      .from(npAgentIncidents)
      .where(eq(npAgentIncidents.id, f.incident.id));
    if (!closed) throw new Error("Expected closed Incident");
    await f.db
      .update(npAgentIncidents)
      .set({ status: "open", resolvedAt: null })
      .where(eq(npAgentIncidents.id, f.incident.id));
    expect((await f.prune()).pruned).toBe(0);
    await f.db.update(npAgentIncidents).set(closed).where(eq(npAgentIncidents.id, closed.id));
    const [attempt] = (await f.timeline()).filter((row) => row.sourceId === target.id);
    if (!attempt) throw new Error("Expected delivery fact");
    await f.db
      .update(npAgentIncidentTimeline)
      .set({ createdAt: f.later() })
      .where(eq(npAgentIncidentTimeline.id, attempt.id));
    expect((await f.prune()).pruned).toBe(0);
    await f.db
      .update(npAgentIncidentTimeline)
      .set(attempt)
      .where(eq(npAgentIncidentTimeline.id, attempt.id));
    expect((await f.prune()).pruned).toBe(6);
    expect(await other.rows()).toHaveLength(3);
    expect((await other.prune()).pruned).toBe(6);
  });

  it("pins mismatched result, routing, source and attempt proof, preserving every row on each rejected probe", async () => {
    const f = await fixture();
    for (const row of await f.external()) await f.process(row);
    const rows = await f.rows();
    const target = rows.find((row) => row.channel !== "admin")!;
    const timeline = await f.timeline();
    const marker = timeline.find(
      (row) => row.details.schemaVersion === "np.agent-notification-routing.v1",
    )!;
    const attempt = timeline.find((row) => row.sourceId === target.id)!;
    const probes = [
      async () => {
        await f.db
          .update(npAgentNotifications)
          .set({
            state: "failed",
            sentAt: null,
            deliveryDigestBody: null,
            deliveryResultDigest: null,
          })
          .where(eq(npAgentNotifications.id, target.id));
      },
      async () => {
        await f.db
          .update(npAgentNotifications)
          .set({ deliveryResultDigest: `cj1:sha256:${"B".repeat(43)}` })
          .where(eq(npAgentNotifications.id, target.id));
      },
      async () => {
        await f.db
          .update(npAgentNotifications)
          .set({ payloadRedacted: { ...target.payloadRedacted, recipientFingerprint: "invalid" } })
          .where(eq(npAgentNotifications.id, target.id));
      },
      async () => {
        await f.db
          .update(npAgentIncidentTimeline)
          .set({ details: { ...marker.details, notificationIds: [target.id] } })
          .where(eq(npAgentIncidentTimeline.id, marker.id));
      },
      async () => {
        await f.db
          .update(npAgentIncidentTimeline)
          .set({ sourceFingerprint: "invalid" })
          .where(eq(npAgentIncidentTimeline.id, attempt.id));
      },
      async () => {
        await f.db
          .update(npAgentIncidentTimeline)
          .set({ details: { ...attempt.details, schemaVersion: "unknown.notification.v1" } })
          .where(eq(npAgentIncidentTimeline.id, attempt.id));
      },
    ];
    for (const probe of probes) {
      await probe();
      const before = await f.rows(),
        facts = await f.timeline();
      expect((await f.prune()).pruned).toBe(0);
      expect(await f.rows()).toEqual(before);
      expect(await f.timeline()).toEqual(facts);
      await f.db
        .update(npAgentNotifications)
        .set(target)
        .where(eq(npAgentNotifications.id, target.id));
      await f.db
        .update(npAgentIncidentTimeline)
        .set(marker)
        .where(eq(npAgentIncidentTimeline.id, marker.id));
      await f.db
        .update(npAgentIncidentTimeline)
        .set(attempt)
        .where(eq(npAgentIncidentTimeline.id, attempt.id));
    }
    expect((await f.prune()).pruned).toBe(6);
  });

  it("preserves generic settings and immutable global audit references to any group member", async () => {
    const f = await fixture();
    for (const row of await f.external()) await f.process(row);
    const target = (await f.external())[0]!;
    await f.db.insert(npSettings).values({
      siteId: f.siteId,
      key: "retention.reference",
      value: { notificationId: target.id },
    });
    expect((await f.prune()).pruned).toBe(0);
    await f.db
      .delete(npSettings)
      .where(and(eq(npSettings.siteId, f.siteId), eq(npSettings.key, "retention.reference")));
    await f.db.insert(npAuditEvents).values({
      actorKind: "system",
      action: "retention.fixture",
      targetType: "agent-notification",
      targetId: target.id,
      siteId: null,
      payload: {},
    });
    const before = await f.rows();
    expect((await f.prune()).pruned).toBe(0);
    expect(await f.rows()).toEqual(before);
  });

  it("advances past a group exceeding the remaining budget and rolls back a timeout after child deletion", async () => {
    const f = await fixture();
    for (const row of await f.external()) await f.process(row);
    const before = await f.rows(),
      timeline = await f.timeline();
    expect(await f.prune({ maximumRows: 5, limit: 1 })).toEqual({
      examined: 1,
      pruned: 0,
      nextCursor: f.local.id,
    });
    await expect(
      npWithAgentRuntimeControlTransactionV1(f.siteId, ({ db }) =>
        npPruneAgentIncidentRetentionV1({
          db,
          siteId: f.siteId,
          cursor: null,
          limit: 25,
          rootIds: [f.local.id],
          now: f.later(),
          policy,
          beforeStatement: async () => {
            const rows = await db
              .select({ details: npAgentIncidentTimeline.details })
              .from(npAgentIncidentTimeline)
              .where(eq(npAgentIncidentTimeline.incidentId, f.incident.id));
            if (
              !rows.some((row) => row.details.schemaVersion === "np.agent-notification-attempt.v1")
            )
              throw new Error("fixture budget expired after deletion");
          },
        }),
      ),
    ).rejects.toThrow("fixture budget expired after deletion");
    expect(await f.rows()).toEqual(before);
    expect(await f.timeline()).toEqual(timeline);
    expect((await f.prune()).pruned).toBe(6);
  });
});
