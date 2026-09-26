import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentIncidents,
  npAgentSignals,
  npAgentIncidentSignals,
  npAgentIncidentTimeline,
  npAgentNotifications,
  npAgentFeedback,
  npAgentConnections,
  npAgentConnectionConfigVersions,
} from "../../../packages/core/src/db/schema/agent.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const at = new Date("2026-09-27T00:00:00.000Z");
const digest = `cj1:sha256:${"A".repeat(43)}`;
type Fixture = Awaited<ReturnType<typeof fixture>>;
function incidentValues(site = siteId): typeof npAgentIncidents.$inferInsert {
  return {
    id: randomUUID(),
    siteId: site,
    category: "availability",
    status: "open",
    severity: "medium",
    fingerprint: randomUUID(),
    title: "Synthetic worker check",
    summary: "Retained deterministic observation.",
    firstObservedAt: at,
    lastObservedAt: at,
    createdAt: at,
    updatedAt: at,
  };
}
async function seedIncident(f: Fixture, site = siteId) {
  const [row] = await f.db.insert(npAgentIncidents).values(incidentValues(site)).returning();
  return row;
}
function signalValues(incidentId: string, site = siteId): typeof npAgentSignals.$inferInsert {
  return {
    id: randomUUID(),
    siteId: site,
    detectorId: "fixture.check",
    detectorVersion: 1,
    category: "availability",
    severity: "medium",
    confidenceBasis: "exact-rule",
    fingerprint: randomUUID(),
    evidence: [
      {
        kind: "ops-check",
        checkId: "fixture.worker",
        observedAt: at.toISOString(),
        digest,
        excerpt: null,
      },
    ],
    evidenceDigest: digest,
    status: "attached",
    incidentId,
    windowStartedAt: at,
    windowEndedAt: at,
    createdAt: at,
    updatedAt: at,
    expiresAt: new Date(at.getTime() + 86400000),
  };
}
function timelineValues(incidentId: string): typeof npAgentIncidentTimeline.$inferInsert {
  return {
    siteId,
    incidentId,
    sequence: 1,
    kind: "observed",
    sourceKind: "system",
    sourceFingerprint: digest,
    summary: "Synthetic observation retained.",
    details: { kind: "observed" },
    createdAt: at,
  };
}
function feedbackValues(f: Fixture, incidentId: string): typeof npAgentFeedback.$inferInsert {
  return {
    siteId,
    targetKind: "incident",
    targetId: incidentId,
    targetFingerprint: digest,
    label: "useful",
    policyHashes: [digest],
    recordedByUserId: f.actor.actor.user.id,
    actorFingerprint: digest,
    createdAt: at,
  };
}
async function connection(f: Fixture) {
  const connectionId = randomUUID(),
    configId = randomUUID();
  await f.db.transaction(async (tx) => {
    await tx.insert(npAgentConnections).values({
      id: connectionId,
      siteId,
      kind: "notification",
      provider: "fixture-notification",
      adapterContractVersion: 1,
      name: "Synthetic pending notification",
      authKind: "api_key",
      activeConfigSnapshotId: configId,
      config: {},
      configVersion: 1,
      configHash: digest,
      pricingCatalogFingerprint: digest,
      dataProcessingCeiling: "public-only",
      status: "pending",
    });
    await tx.insert(npAgentConnectionConfigVersions).values({
      id: configId,
      siteId,
      connectionId,
      version: 1,
      adapterId: "fixture-notification",
      adapterContractVersion: 1,
      adapterFingerprint: digest,
      config: {},
      configHash: digest,
      pricingCatalog: [],
      pricingCatalogFingerprint: digest,
      dataProcessingCeiling: "public-only",
      state: "active",
      activatedAt: at,
    });
  });
  return { connectionId, configId };
}
function adminNotification(incidentId: string): typeof npAgentNotifications.$inferInsert {
  const id = randomUUID(),
    deduplicationKey = randomUUID();
  return {
    id,
    siteId,
    channel: "admin",
    incidentId,
    transitionVersion: 1,
    deduplicationKey,
    state: "sent",
    payloadRedacted: { title: "Synthetic observation" },
    attempts: 0,
    deliveryDigestBody: {
      schemaVersion: "np.agent-notification-delivery.v1",
      siteId,
      notificationId: id,
      channel: "admin",
      source: { incidentId, runId: null, actionId: null, transitionVersion: 1 },
      deduplicationKey,
      payloadRedacted: { title: "Synthetic observation" },
      attempt: 0,
      result: { state: "confirmed_local" },
      observedAt: at.toISOString(),
    },
    deliveryResultDigest: digest,
    sentAt: at,
    createdAt: at,
    updatedAt: at,
  };
}

describe.skipIf(skipIfNoTestDb())("Incident retained persistence boundaries", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("persists all six owners and preserves incident evidence when a detached signal is pruned", async () => {
    const f = await fixture();
    const incident = await seedIncident(f);
    const [signal] = await f.db
      .insert(npAgentSignals)
      .values(signalValues(incident.id))
      .returning();
    await f.db
      .insert(npAgentIncidentSignals)
      .values({ siteId, incidentId: incident.id, signalId: signal.id });
    const [timeline] = await f.db
      .insert(npAgentIncidentTimeline)
      .values({ ...timelineValues(incident.id), signalId: signal.id })
      .returning();
    const [notification] = await f.db
      .insert(npAgentNotifications)
      .values(adminNotification(incident.id))
      .returning();
    const [feedback] = await f.db
      .insert(npAgentFeedback)
      .values(feedbackValues(f, incident.id))
      .returning();
    expect(notification.state).toBe("sent");
    expect(feedback.targetId).toBe(incident.id);
    await expect(
      f.db.delete(npAgentSignals).where(eq(npAgentSignals.id, signal.id)),
    ).rejects.toThrow();
    await f.db
      .update(npAgentIncidentTimeline)
      .set({ signalId: null })
      .where(eq(npAgentIncidentTimeline.id, timeline.id));
    await f.db.delete(npAgentSignals).where(eq(npAgentSignals.id, signal.id));
    expect(await f.db.select().from(npAgentIncidentSignals)).toEqual([]);
    expect((await f.db.select().from(npAgentIncidentTimeline))[0]).toMatchObject({
      summary: timeline.summary,
      sourceFingerprint: digest,
    });
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(1);
  });

  it("rejects cross-site signal, join and timeline references and duplicate timeline sequences", async () => {
    const f = await fixture();
    const local = await seedIncident(f),
      foreign = await seedIncident(f, "draft-other");
    await expect(f.db.insert(npAgentSignals).values(signalValues(foreign.id))).rejects.toThrow();
    const [foreignSignal] = await f.db
      .insert(npAgentSignals)
      .values(signalValues(foreign.id, "draft-other"))
      .returning();
    await expect(
      f.db
        .insert(npAgentIncidentSignals)
        .values({ siteId, incidentId: local.id, signalId: foreignSignal.id }),
    ).rejects.toThrow();
    await expect(
      f.db
        .insert(npAgentIncidentTimeline)
        .values({ ...timelineValues(local.id), signalId: foreignSignal.id }),
    ).rejects.toThrow();
    await f.db.insert(npAgentIncidentTimeline).values(timelineValues(local.id));
    await expect(
      f.db.insert(npAgentIncidentTimeline).values(timelineValues(local.id)),
    ).rejects.toThrow();
    await expect(
      f.db.insert(npAgentIncidentTimeline).values({
        ...timelineValues(local.id),
        sequence: 2,
        kind: "agent_assessment",
        sourceKind: "agent",
        details: { kind: "agent_assessment" },
      }),
    ).rejects.toThrow();
  });

  it("keeps local notifications immediate and requires an exact external connection snapshot tuple", async () => {
    const f = await fixture();
    const incident = await seedIncident(f);
    const first = await connection(f),
      second = await connection(f);
    await expect(
      f.db
        .insert(npAgentNotifications)
        .values({ ...adminNotification(incident.id), connectionId: first.connectionId }),
    ).rejects.toThrow();
    await expect(
      f.db.insert(npAgentNotifications).values({ ...adminNotification(incident.id), attempts: 1 }),
    ).rejects.toThrow();
    const external: typeof npAgentNotifications.$inferInsert = {
      siteId,
      channel: "email",
      incidentId: incident.id,
      transitionVersion: 1,
      deduplicationKey: randomUUID(),
      state: "queued",
      payloadRedacted: {},
      connectionId: first.connectionId,
      connectionConfigSnapshotId: first.configId,
      adapterId: "fixture-notification",
      adapterContractVersion: 1,
      adapterFingerprint: digest,
      connectionConfigVersion: 1,
      connectionConfigHash: digest,
      accountSubjectKeyId: "fixture",
      accountSubjectDigest: digest,
      destinationKeyId: "fixture",
      destinationFingerprint: digest,
      adapterIdempotency: "enforced",
      destinationDescriptor: {
        schemaVersion: "np.agent-connection-destination-descriptor.v1",
        kind: "notification",
        adapterId: "fixture-notification",
        descriptor: {},
      },
      createdAt: at,
      updatedAt: at,
    };
    const [stored] = await f.db.insert(npAgentNotifications).values(external).returning();
    expect(stored.state).toBe("queued");
    await expect(
      f.db.insert(npAgentNotifications).values({
        ...external,
        deduplicationKey: randomUUID(),
        connectionConfigSnapshotId: second.configId,
      }),
    ).rejects.toThrow();
    await expect(
      f.db
        .insert(npAgentNotifications)
        .values({ ...external, deduplicationKey: randomUUID(), destinationFingerprint: null }),
    ).rejects.toThrow();
  });

  it("keeps feedback supersession single-successor, same-site and non-self-referential", async () => {
    const f = await fixture();
    const incident = await seedIncident(f);
    const [original] = await f.db
      .insert(npAgentFeedback)
      .values(feedbackValues(f, incident.id))
      .returning();
    const [corrected] = await f.db
      .insert(npAgentFeedback)
      .values({ ...feedbackValues(f, incident.id), label: "incorrect", supersedesId: original.id })
      .returning();
    expect(corrected.supersedesId).toBe(original.id);
    await expect(
      f.db
        .insert(npAgentFeedback)
        .values({ ...feedbackValues(f, incident.id), supersedesId: original.id }),
    ).rejects.toThrow();
    await expect(
      f.db.insert(npAgentFeedback).values({
        ...feedbackValues(f, incident.id),
        siteId: "draft-other",
        supersedesId: corrected.id,
      }),
    ).rejects.toThrow();
    const id = randomUUID();
    await expect(
      f.db
        .insert(npAgentFeedback)
        .values({ ...feedbackValues(f, incident.id), id, supersedesId: id }),
    ).rejects.toThrow();
  });
});
