import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import {
  npDigestAgentNotificationDeliveryCanonical,
  npRequireAgentNotificationDeliveryCanonical,
} from "../../../packages/core/src/agent-contract/canonical-notification-policy.js";
import { npPruneAgentIncidentRetentionV1 } from "../../../packages/core/src/agent/incident-retention.js";
import { NpAgentGatewayError } from "../../../packages/core/src/agent/admin-admission.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentNotificationsServiceV1 } from "../../../packages/core/src/agent/incident-notifications-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import {
  npAgentChangesetRollbackPlans,
  npAgentFeedback,
  npAgentIncidents,
  npAgentIncidentSignals,
  npAgentIncidentTimeline,
  npAgentNotifications,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSettings, npSites } from "../../../packages/core/src/db/schema/system.js";
import { PgBossAdapter } from "../../../packages/core/src/jobs/pg-boss-adapter.js";
import { approvedRollbackFixture } from "./agent-changeset-rollback-fixture.js";
import { fixture as staffFixture } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  getTestDb,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const day = 86_400_000;
const old = new Date("2025-09-01T00:10:00.000Z");
const now = new Date("2026-10-15T00:00:00.000Z");
const policy = { signalDays: 90, historyDays: 365 };
type Options = Partial<
  Omit<Parameters<typeof npPruneAgentIncidentRetentionV1>[0], "db" | "siteId">
>;
async function prune(siteId = "default", options: Options = {}) {
  return npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
    npPruneAgentIncidentRetentionV1({
      db,
      siteId,
      cursor: null,
      limit: 25,
      now,
      policy,
      beforeStatement: () => Promise.resolve(),
      ...options,
    }),
  );
}

/** Explicit synthetic legacy/import graph. No human closure, authenticated audit,
 * production content, provider outcome or source release is fabricated. */
async function graph(siteId = "default") {
  const db = await getTestDb();
  const incidentId = randomUUID(),
    signalId = randomUUID();
  const body = npRequireAgentSignalEvidenceCanonical({
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId,
    detectorId: "retention.fixture",
    detectorVersion: 1,
    category: "spam",
    window: { startedAt: "2025-09-01T00:00:00.000Z", endedAt: "2025-09-01T00:09:59.999Z" },
    subject: null,
    evidence: [
      {
        kind: "revision",
        collection: "posts",
        documentId: randomUUID(),
        revisionId: randomUUID(),
        observedAt: "2025-09-01T00:00:00.000Z",
        digest: "a".repeat(64),
        excerpt: null,
      },
    ],
  });
  const evidenceDigest = await npDigestAgentSignalEvidenceCanonical(body);
  await db.insert(npAgentIncidents).values({
    id: incidentId,
    siteId,
    category: "spam",
    status: "resolved",
    severity: "high",
    fingerprint: `retention:${incidentId}`,
    title: "Old imported Incident",
    summary: "Reference-free retention fixture",
    signalCount: 1,
    eventCount: 0,
    firstObservedAt: new Date(body.window.startedAt),
    lastObservedAt: old,
    resolvedAt: old,
    resolutionCode: "FIXTURE_IMPORTED",
    createdAt: old,
    updatedAt: old,
  });
  await db.insert(npAgentSignals).values({
    id: signalId,
    siteId,
    detectorId: body.detectorId,
    detectorVersion: 1,
    category: "spam",
    severity: "high",
    confidenceBasis: "exact-rule",
    fingerprint: `retention:${incidentId}`,
    evidence: body.evidence,
    evidenceDigest,
    status: "attached",
    incidentId,
    windowStartedAt: new Date(body.window.startedAt),
    windowEndedAt: new Date(body.window.endedAt),
    expiresAt: new Date(old.getTime() + 30 * day),
    createdAt: old,
    updatedAt: old,
  });
  await db.insert(npAgentIncidentSignals).values({ siteId, incidentId, signalId });
  await db.insert(npAgentIncidentTimeline).values({
    siteId,
    incidentId,
    sequence: 1,
    kind: "observed",
    sourceKind: "system",
    sourceFingerprint: evidenceDigest,
    signalId,
    summary: "Imported advisory observation",
    details: { schemaVersion: "retention.fixture.v1" },
    createdAt: old,
  });
  const feedbackId = randomUUID();
  const feedback = {
    siteId,
    targetKind: "incident",
    targetId: incidentId,
    targetFingerprint: `feedback:${incidentId}`,
    label: "false-positive",
    policyHashes: [],
    actorFingerprint: "fixture-import",
    createdAt: old,
  };
  await db.insert(npAgentFeedback).values({ ...feedback, id: feedbackId });
  await db.insert(npAgentFeedback).values({ ...feedback, supersedesId: feedbackId });
  const notificationId = randomUUID();
  const deduplicationKey = `incident:${incidentId}:admin:1:resolved`;
  const payloadRedacted = {
    incidentId,
    incidentVersion: 1,
    transition: "resolved",
    severity: "high",
    status: "resolved",
    summary: "Incident resolved.",
    adminPath: `/admin/agents/incidents/${incidentId}`,
  };
  const delivery = npRequireAgentNotificationDeliveryCanonical({
    schemaVersion: "np.agent-notification-delivery.v1",
    siteId,
    notificationId,
    channel: "admin",
    source: { incidentId, runId: null, actionId: null, transitionVersion: 1 },
    deduplicationKey,
    payloadRedacted,
    attempt: 0,
    result: { state: "confirmed_local" },
    observedAt: old.toISOString(),
  });
  await db.insert(npAgentNotifications).values({
    id: notificationId,
    siteId,
    channel: "admin",
    incidentId,
    transitionVersion: 1,
    deduplicationKey,
    state: "sent",
    payloadRedacted,
    attempts: 0,
    deliveryDigestBody: delivery,
    deliveryResultDigest: await npDigestAgentNotificationDeliveryCanonical(delivery),
    sentAt: old,
    createdAt: old,
    updatedAt: old,
  });
  return { db, siteId, incidentId, signalId, notificationId, rows: 7 };
}

async function orphan(state = "resolved", valid = true) {
  const f = await graph();
  // Isolate an orphan from the explicit synthetic import graph only. No ordinary
  // audit or Action/approval/recovery record is removed by the fixture.
  await f.db.delete(npAgentNotifications).where(eq(npAgentNotifications.incidentId, f.incidentId));
  await f.db.delete(npAgentFeedback).where(eq(npAgentFeedback.targetId, f.incidentId));
  await f.db
    .delete(npAgentIncidentTimeline)
    .where(eq(npAgentIncidentTimeline.incidentId, f.incidentId));
  await f.db
    .delete(npAgentIncidentSignals)
    .where(eq(npAgentIncidentSignals.incidentId, f.incidentId));
  await f.db
    .update(npAgentSignals)
    .set({
      incidentId: null,
      status: state,
      ...(valid ? {} : { evidenceDigest: `cj1:sha256:${"B".repeat(43)}` }),
    })
    .where(eq(npAgentSignals.id, f.signalId));
  await f.db.delete(npAgentIncidents).where(eq(npAgentIncidents.id, f.incidentId));
  return f;
}

describe.skipIf(skipIfNoTestDb())("Reference-safe terminal Incident retention", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("requires explicit host policy and the entire history minimum before deleting a closed cohort atomically", async () => {
    const f = await graph();
    expect(await prune("default", { policy: undefined })).toEqual({
      examined: 0,
      pruned: 0,
      nextCursor: null,
    });
    expect(await prune("default", { now: new Date(old.getTime() + 365 * day - 1) })).toEqual({
      examined: 0,
      pruned: 0,
      nextCursor: null,
    });
    expect(await prune()).toEqual({ examined: 2, pruned: f.rows, nextCursor: null });
    for (const table of [
      npAgentIncidents,
      npAgentSignals,
      npAgentIncidentSignals,
      npAgentIncidentTimeline,
      npAgentFeedback,
      npAgentNotifications,
    ])
      expect(await f.db.select().from(table)).toEqual([]);
    expect(await prune()).toEqual({ examined: 0, pruned: 0, nextCursor: null });
  });

  it("retains active roots, recent children and unknown local delivery evidence; prunes only a valid unreferenced terminal orphan", async () => {
    const active = await graph();
    await active.db
      .update(npAgentIncidents)
      .set({ status: "open", resolvedAt: null })
      .where(eq(npAgentIncidents.id, active.incidentId));
    const recent = await graph();
    await recent.db
      .update(npAgentIncidentTimeline)
      .set({ createdAt: new Date(now.getTime() - day) })
      .where(eq(npAgentIncidentTimeline.incidentId, recent.incidentId));
    const unknown = await graph();
    await unknown.db
      .update(npAgentNotifications)
      .set({ deliveryResultDigest: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentNotifications.id, unknown.notificationId));
    const terminal = await orphan();
    const open = await orphan("open");
    const invalid = await orphan("resolved", false);
    expect((await prune()).pruned).toBe(2);
    expect(await active.db.select().from(npAgentIncidents)).toHaveLength(3);
    expect(
      await active.db.select().from(npAgentSignals).where(eq(npAgentSignals.id, terminal.signalId)),
    ).toEqual([]);
    expect(
      await active.db.select().from(npAgentSignals).where(eq(npAgentSignals.id, open.signalId)),
    ).toHaveLength(1);
    expect(
      await active.db.select().from(npAgentSignals).where(eq(npAgentSignals.id, invalid.signalId)),
    ).toHaveLength(1);
  });

  it("preserves immutable audit, private flood checkpoints and opaque references from other Agent records", async () => {
    const audited = await graph(),
      checkpoint = await graph(),
      referenced = await graph();
    await audited.db.insert(npAuditEvents).values({
      actorKind: "system",
      action: "retention.fixture",
      targetType: "agent-incident",
      targetId: audited.incidentId,
      siteId: null,
      payload: { signalId: audited.signalId },
    });
    await audited.db.insert(npSettings).values({
      siteId: "default",
      key: `agent.moderator.flood.v1:${randomUUID()}:state`,
      value: {
        phase: "scan",
        incidentId: checkpoint.incidentId,
        eventRefs: [{ signalId: checkpoint.signalId }],
      },
    });
    await audited.db
      .update(npAgentIncidents)
      .set({
        primarySubject: { kind: "document", collection: "posts", documentId: referenced.signalId },
      })
      .where(eq(npAgentIncidents.id, audited.incidentId));
    const beforeAudit = await audited.db.select().from(npAuditEvents);
    expect(
      await prune("default", {
        rootIds: [audited.incidentId, checkpoint.incidentId, referenced.incidentId].sort(),
      }),
    ).toMatchObject({ examined: 3, pruned: 0 });
    expect(await audited.db.select().from(npAgentIncidents)).toHaveLength(3);
    expect(await audited.db.select().from(npAuditEvents)).toEqual(beforeAudit);
    expect(await audited.db.select().from(npSettings)).toHaveLength(1);
  });

  it("pins a terminal cohort referenced by an actual retained rollback plan without changing its audit or approval history", async () => {
    const rollback = await approvedRollbackFixture();
    const f = await graph(rollback.actor.siteId);
    await f.db
      .update(npAgentChangesetRollbackPlans)
      .set({ issues: [{ incidentId: f.incidentId, signalId: f.signalId }] })
      .where(eq(npAgentChangesetRollbackPlans.id, rollback.rollbackPlanId));
    const before = await f.db.select().from(npAgentChangesetRollbackPlans);
    const audit = await f.db.select().from(npAuditEvents);
    expect((await prune(f.siteId, { rootIds: [f.incidentId] })).pruned).toBe(0);
    expect(await f.db.select().from(npAgentChangesetRollbackPlans)).toEqual(before);
    expect(await f.db.select().from(npAuditEvents)).toEqual(audit);
    expect(
      await f.db.select().from(npAgentIncidents).where(eq(npAgentIncidents.id, f.incidentId)),
    ).toHaveLength(1);
  }, 60_000);

  it("keeps another site isolated and advances past an oversized cohort without partially deleting it", async () => {
    const f = await graph();
    await f.db.insert(npSites).values({ id: "retention-other", name: "Other retention site" });
    const other = await graph("retention-other");
    expect(
      await prune("default", { rootIds: [f.incidentId], maximumRows: f.rows - 1, limit: 1 }),
    ).toEqual({ examined: 1, pruned: 0, nextCursor: f.incidentId });
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(2);
    expect((await prune()).pruned).toBe(f.rows);
    expect(await f.db.select().from(npAgentIncidents)).toEqual([
      expect.objectContaining({ id: other.incidentId, siteId: other.siteId }),
    ]);
  });

  it("rolls back a budget failure after child deletion and safely replays the same root", async () => {
    const f = await graph();
    await expect(
      npWithAgentRuntimeControlTransactionV1("default", ({ db }) =>
        npPruneAgentIncidentRetentionV1({
          db,
          siteId: "default",
          cursor: null,
          limit: 25,
          now,
          policy,
          beforeStatement: async () => {
            const [remaining] = await db
              .select({ id: npAgentNotifications.id })
              .from(npAgentNotifications)
              .where(eq(npAgentNotifications.id, f.notificationId));
            if (!remaining)
              throw new NpAgentGatewayError(
                "RUNTIME_MAINTENANCE_TIMEOUT",
                503,
                "Fixture budget expired.",
              );
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_MAINTENANCE_TIMEOUT" });
    expect(await f.db.select().from(npAgentNotifications)).toHaveLength(1);
    expect(await f.db.select().from(npAgentFeedback)).toHaveLength(2);
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(1);
    expect((await prune()).pruned).toBe(f.rows);
  });

  it("expires an actual workflow-closed Incident's confirmed local feed while preserving its audit and Incident skeleton", async () => {
    const staff = await staffFixture();
    const siteId = staff.actor.siteId;
    const time = new Date();
    const [incident] = await staff.db
      .insert(npAgentIncidents)
      .values({
        siteId,
        category: "spam",
        status: "open",
        severity: "high",
        fingerprint: randomUUID(),
        title: "Observed fixture Incident",
        summary: "Actual workflow closure acceptance",
        firstObservedAt: time,
        lastObservedAt: time,
        createdAt: time,
        updatedAt: time,
      })
      .returning();
    if (!incident) throw new Error("Expected initial Incident");
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(80),
      canReadIncident: () => false,
      canReadStaffIncident: () => true,
    }).staff;
    const notifications = createAgentIncidentNotificationsServiceV1({
      reads,
      cursorHmacKey: new Uint8Array(32).fill(81),
    });
    const workflow = createAgentIncidentWorkflowServiceV1({
      reads,
      canReviewContainment: () => true,
      notifications,
    });
    const input = { siteId, actor: staff.actor.actor, incidentId: incident.id };
    const review = await workflow.get(input);
    await workflow.transition({
      ...input,
      command: {
        schemaVersion: "np.agent-incident-transition-input.v1",
        expectedVersion: 1,
        transition: "resolved",
        resolutionCode: "NO_FURTHER_ACTION",
        note: "Reviewed closure for retention acceptance.",
        containmentReviewHash: review.containment.reviewHash,
        containmentDisposition: "acknowledge",
        idempotencyKey: randomUUID(),
      },
    });
    const [closed] = await staff.db
      .select()
      .from(npAgentIncidents)
      .where(eq(npAgentIncidents.id, incident.id));
    const [notification] = await staff.db
      .select()
      .from(npAgentNotifications)
      .where(eq(npAgentNotifications.incidentId, incident.id));
    if (!closed || !notification) throw new Error("Expected real closure notification");
    const audit = await staff.db.select().from(npAuditEvents);
    const timeline = await staff.db.select().from(npAgentIncidentTimeline);
    const later = new Date(closed.updatedAt.getTime() + 366 * day);
    expect(
      await prune(siteId, { now: later, rootIds: [incident.id, notification.id].sort() }),
    ).toMatchObject({ pruned: 1 });
    expect(await staff.db.select().from(npAgentNotifications)).toEqual([]);
    expect(
      await staff.db.select().from(npAgentIncidents).where(eq(npAgentIncidents.id, incident.id)),
    ).toEqual([closed]);
    expect(await staff.db.select().from(npAgentIncidentTimeline)).toEqual(timeline);
    expect(await staff.db.select().from(npAuditEvents)).toEqual(audit);
  });

  it("pins live pg-boss references without initializing a worker or external delivery", async () => {
    const f = await graph();
    const databaseUrl = getTestDatabaseUrl();
    if (!databaseUrl) throw new Error("Expected isolated test database");
    const adapter = new PgBossAdapter(databaseUrl, { supervise: false, schedule: false });
    try {
      await adapter.startProducer();
      const boss = Reflect.get(adapter, "boss") as { createQueue(name: string): Promise<void> };
      await boss.createQueue("incident.retention.fixture");
      await f.db.execute(
        sql`insert into pgboss.job(name,data) values('incident.retention.fixture',${JSON.stringify({ siteId: "default", incidentId: f.incidentId })}::jsonb)`,
      );
      expect((await prune("default", { rootIds: [f.incidentId] })).pruned).toBe(0);
      expect(await f.db.select().from(npAgentIncidents)).toHaveLength(1);
    } finally {
      await adapter.stop();
      await f.db.execute(sql`drop schema if exists pgboss cascade`);
    }
  });
});
