import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentNotifications,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentNotificationsServiceV1 } from "../../../packages/core/src/agent/incident-notifications-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import {
  npDetectAgentRepeatedLinkSpamV1,
  npAgentModeratorWindowStartedAtV1,
} from "../../../packages/core/src/agent/moderator-detector.js";
import type { NpAgentModeratorFactV1 } from "../../../packages/core/src/agent-contract/moderator-contract.js";
import type { NpAgentIncidentTransitionInputV1 } from "../../../packages/core/src/agent-contract/incident-workflow-contract.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
const windowStartedAt = npAgentModeratorWindowStartedAtV1(
  new Date(Date.now() - 600000).toISOString(),
);
const settings = {
  recipeId: "moderator.repeated-link-spam" as const,
  recipeVersion: 1 as const,
  collectionSlugs: ["posts"],
  windowSeconds: 600 as const,
  minIndependentAccounts: 3,
  minItems: 5,
  automaticConfidenceBasisPoints: 9900,
};
const digest = `cj1:sha256:${"A".repeat(43)}`;
function facts(count = 5): NpAgentModeratorFactV1[] {
  return Array.from({ length: count }, () => {
    const documentId = randomUUID();
    return {
      schemaVersion: "np.agent-moderator-fact.v1",
      siteId,
      observedAt: windowStartedAt,
      subject: { kind: "document", collection: "posts", documentId },
      memberId: randomUUID(),
      targetVersionDigest: digest,
      domainHashes: ["a".repeat(64)],
      spamVerdict: "pass",
      profanityVerdict: "pass",
      evidence: {
        kind: "revision",
        collection: "posts",
        documentId,
        revisionId: randomUUID(),
        observedAt: windowStartedAt,
        digest: "a".repeat(64),
        excerpt: null,
      },
    };
  });
}
async function candidate(rows = facts()) {
  const [result] = await npDetectAgentRepeatedLinkSpamV1({
    siteId,
    windowStartedAt,
    settings,
    facts: rows,
  });
  if (!result) throw new Error("Fixture detector did not yield candidate");
  return result;
}

function command(
  expectedVersion: number,
  extra: Partial<NpAgentIncidentTransitionInputV1> = {},
): NpAgentIncidentTransitionInputV1 {
  return {
    schemaVersion: "np.agent-incident-transition-input.v1",
    expectedVersion,
    transition: "investigating",
    resolutionCode: null,
    note: "Reviewed notification fixture.",
    containmentReviewHash: null,
    containmentDisposition: null,
    idempotencyKey: randomUUID(),
    ...extra,
  };
}
describe.skipIf(skipIfNoTestDb())("Incident local Admin notifications", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  async function setup() {
    const f = await fixture();
    let visible = true;
    let clock = new Date();
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(80),
      canReadIncident: () => false,
      canReadStaffIncident: () => visible,
    }).staff;
    const notifications = createAgentIncidentNotificationsServiceV1({
      reads,
      cursorHmacKey: new Uint8Array(32).fill(81),
      now: () => clock,
    });
    const writer = createAgentIncidentWriteServiceV1({
      resolveEvidence: () => true,
      notifications,
    });
    const workflow = createAgentIncidentWorkflowServiceV1({
      reads,
      canReviewContainment: () => true,
      notifications,
    });
    const input = { siteId, actor: f.actor.actor };
    return {
      f,
      notifications,
      writer,
      workflow,
      input,
      hide: () => {
        visible = false;
      },
      expire: () => {
        clock = new Date(clock.getTime() + 960000);
      },
    };
  }
  it("atomically records actual opens once, suppresses correlation/replay, and drops rolled-back source transitions", async () => {
    const x = await setup();
    const firstFacts = facts();
    const c = await candidate(firstFacts);
    const result = await x.writer.observe(c);
    await x.writer.observe(c);
    await x.writer.observe(await candidate([...firstFacts, ...facts(1)]));
    const rows = await x.f.db.select().from(npAgentNotifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: "admin",
      state: "sent",
      attempts: 0,
      transitionVersion: 1,
      connectionId: null,
      runId: null,
      actionId: null,
    });
    expect(rows[0].sentAt).toEqual(rows[0].createdAt);
    const list = await x.notifications.list(x.input);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      incidentId: result.incidentId,
      incidentVersion: 1,
      status: "open",
      transition: "opened",
      summary: "Incident opened.",
    });
    expect(JSON.stringify(list)).not.toContain(c.summary);
    await expect(
      x.f.db.transaction(async (tx) => {
        await x.writer.observe(await candidate(facts(8)), { transaction: tx as typeof x.f.db });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await x.f.db.select().from(npAgentNotifications)).toHaveLength(1);
    const [entry] = await x.f.db
      .select()
      .from(npAgentIncidentTimeline)
      .where(eq(npAgentIncidentTimeline.kind, "observed"));
    await expect(
      x.notifications.record({
        db: x.f.db,
        siteId,
        incidentId: result.incidentId,
        transitionVersion: 1,
        transition: "opened",
        timelineId: entry.id,
      }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOTIFICATIONS_INVALID" });
  });
  it("uses persisted critical workflow transitions, exact replay and historical status with current visibility", async () => {
    const x = await setup();
    const t = new Date();
    const [incident] = await x.f.db
      .insert(npAgentIncidents)
      .values({
        siteId,
        category: "availability",
        severity: "critical",
        status: "open",
        fingerprint: randomUUID(),
        title: "Synthetic critical fixture",
        summary: "Private source summary",
        firstObservedAt: t,
        lastObservedAt: t,
      })
      .returning();
    const input = { ...x.input, incidentId: incident.id };
    const start = { ...input, command: command(1) };
    await x.workflow.transition(start);
    await x.workflow.transition(start);
    const review = await x.workflow.get(input);
    const close = {
      ...input,
      command: command(2, {
        transition: "resolved",
        resolutionCode: "REMEDIATED",
        containmentReviewHash: review.containment.reviewHash,
        containmentDisposition: "acknowledge",
      }),
    };
    await x.workflow.transition(close);
    await x.workflow.transition(close);
    const entries = await x.f.db
      .select()
      .from(npAgentIncidentTimeline)
      .where(eq(npAgentIncidentTimeline.incidentId, incident.id));
    const resolvedEntry = entries.find(
      (entry) =>
        entry.kind === "state_transition" &&
        entry.details.toStatus === "resolved" &&
        entry.details.transitionVersion === 3,
    );
    if (!resolvedEntry) throw new Error("Expected the persisted resolution entry");
    // Synthetic later version: status and severity still match the older entry.
    await x.f.db
      .update(npAgentIncidents)
      .set({ versionNumber: 4 })
      .where(eq(npAgentIncidents.id, incident.id));
    await expect(
      x.notifications.record({
        db: x.f.db,
        siteId,
        incidentId: incident.id,
        transitionVersion: 4,
        transition: "resolved",
        timelineId: resolvedEntry.id,
      }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOTIFICATIONS_INVALID" });
    const list = await x.notifications.list(x.input);
    expect(list.items.map((v) => v.transition)).toEqual(["resolved", "investigating"]);
    expect(list.items.map((v) => v.status)).toEqual(["resolved", "investigating"]);
    expect(await x.f.db.select().from(npAgentNotifications)).toHaveLength(2);
    x.hide();
    expect((await x.notifications.list(x.input)).items).toEqual([]);
  });
  it("limits high closure alerts to resolution and critical alerts to each real status transition", async () => {
    const x = await setup();
    for (const severity of ["medium", "high", "critical"] as const) {
      for (const transition of ["resolved", "dismissed"] as const) {
        const time = new Date();
        const [incident] = await x.f.db
          .insert(npAgentIncidents)
          .values({
            siteId,
            category: "availability",
            severity,
            status: "open",
            fingerprint: randomUUID(),
            title: "Versioned synthetic severity fixture",
            summary: "Test-owned persisted incident.",
            firstObservedAt: time,
            lastObservedAt: time,
          })
          .returning();
        const input = { ...x.input, incidentId: incident.id };
        await x.workflow.transition({ ...input, command: command(1) });
        const review = await x.workflow.get(input);
        await x.workflow.transition({
          ...input,
          command: command(2, {
            transition,
            resolutionCode: transition === "resolved" ? "REMEDIATED" : "FALSE_POSITIVE",
            containmentReviewHash: review.containment.reviewHash,
            containmentDisposition: "acknowledge",
          }),
        });
        const rows = await x.f.db
          .select()
          .from(npAgentNotifications)
          .where(eq(npAgentNotifications.incidentId, incident.id));
        expect(rows).toHaveLength(
          severity === "critical" ? 2 : severity === "high" && transition === "resolved" ? 1 : 0,
        );
      }
    }
  });
  it("rejects forged delivery bodies, untrusted transitions and another-site recipients", async () => {
    const x = await setup();
    const result = await x.writer.observe(await candidate());
    const [entry] = await x.f.db.select().from(npAgentIncidentTimeline);
    await expect(
      x.notifications.record({
        db: x.f.db,
        siteId,
        incidentId: result.incidentId,
        transitionVersion: 1,
        transition: "resolved",
        timelineId: entry.id,
      }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOTIFICATIONS_INVALID" });
    await expect(x.notifications.list({ ...x.input, siteId: "other-site" })).rejects.toThrow();
    await x.f.db
      .update(npAgentNotifications)
      .set({ payloadRedacted: { secret: "must never escape" } });
    expect((await x.notifications.list(x.input)).items).toEqual([]);
    await expect(
      x.notifications.record({
        db: x.f.db,
        siteId,
        incidentId: result.incidentId,
        transitionVersion: 1,
        transition: "opened",
        timelineId: entry.id,
      }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOTIFICATIONS_INVALID" });
  });
  it("continues through hidden bounded pages without totals and binds cursors to session and expiry", async () => {
    const x = await setup();
    for (let i = 0; i < 22; i++) {
      // Separate deterministic windows produce independently owned incidents.
      const time = new Date(Date.parse(windowStartedAt) - (i + 1) * 600000).toISOString();
      const fs = facts().map((f) => ({
        ...f,
        observedAt: time,
        evidence: { ...f.evidence, observedAt: time },
      }));
      const [v] = await npDetectAgentRepeatedLinkSpamV1({
        siteId,
        windowStartedAt: time,
        settings,
        facts: fs,
      });
      await x.writer.observe(v);
    }
    const page = await x.notifications.list(x.input);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBeTruthy();
    const next = await x.notifications.list({ ...x.input, cursor: page.nextCursor });
    expect(next.items).toHaveLength(2);
    expect(next.nextCursor).toBeNull();
    x.hide();
    const hidden = await x.notifications.list(x.input);
    expect(hidden.items).toEqual([]);
    expect(hidden.nextCursor).toBeTruthy();
    expect(JSON.stringify(hidden)).not.toContain(page.items[0].incidentId);
    await expect(
      x.notifications.list({ ...x.input, cursor: page.nextCursor?.slice(0, -2) + "xx" }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOTIFICATIONS_CURSOR_INVALID" });
    x.expire();
    await expect(
      x.notifications.list({ ...x.input, cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOTIFICATIONS_CURSOR_INVALID" });
    await x.f.db
      .update(npSessions)
      .set({ accessExpiresAt: new Date(0) })
      .where(eq(npSessions.id, x.input.actor.sessionId));
    await expect(x.notifications.list(x.input)).rejects.toThrow();
  });
});
