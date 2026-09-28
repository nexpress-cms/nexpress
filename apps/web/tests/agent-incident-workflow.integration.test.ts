import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentInvocations,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import type { NpAgentIncidentTransitionInputV1 } from "../../../packages/core/src/agent-contract/incident-workflow-contract.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
function command(
  expectedVersion: number,
  extra: Partial<NpAgentIncidentTransitionInputV1> = {},
): NpAgentIncidentTransitionInputV1 {
  return {
    schemaVersion: "np.agent-incident-transition-input.v1",
    expectedVersion,
    transition: "investigating",
    resolutionCode: null,
    note: "Investigation assigned to current staff.",
    containmentReviewHash: null,
    containmentDisposition: null,
    idempotencyKey: randomUUID(),
    ...extra,
  };
}
describe.skipIf(skipIfNoTestDb())("Incident human workflow", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  async function setup() {
    const f = await fixture();
    let visible = true;
    const time = new Date();
    const [incident] = await f.db
      .insert(npAgentIncidents)
      .values({
        siteId,
        category: "spam",
        status: "open",
        severity: "medium",
        fingerprint: randomUUID(),
        title: "Bounded incident",
        summary: "Staff investigation.",
        firstObservedAt: time,
        lastObservedAt: time,
      })
      .returning();
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(71),
      canReadIncident: () => false,
      canReadStaffIncident: ({ context }) => {
        expect(context.transaction).toBeDefined();
        return visible;
      },
    }).staff;
    const workflow = createAgentIncidentWorkflowServiceV1({
      reads,
      canReviewContainment: () => true,
    });
    // Studio's ordinary reads do not require a transaction; the workflow reader above intentionally does.
    const studioReads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(72),
      canReadIncident: () => false,
      canReadStaffIncident: () => visible,
    }).staff;
    const studio = createAgentIncidentStudioServiceV1({
      reads: studioReads,
      workflow,
      cursorHmacKey: new Uint8Array(32).fill(73),
    });
    const input = { siteId, actor: f.actor.actor, incidentId: incident.id };
    return {
      f,
      incident,
      workflow,
      studio,
      input,
      hide: () => {
        visible = false;
      },
    };
  }
  it("records immutable staff decisions, replays terminal commands exactly, and rejects new changes to terminal incidents", async () => {
    const x = await setup();
    const started = { ...x.input, command: command(1) };
    await x.workflow.transition(started);
    expect((await x.workflow.transition(started)).replayed).toBe(true);
    const review = await x.workflow.get(x.input);
    expect(review.containment).toMatchObject({
      total: 0,
      active: 0,
      unresolved: 0,
      pendingActions: 0,
    });
    const close = {
      ...x.input,
      command: command(2, {
        transition: "resolved",
        resolutionCode: "REMEDIATED",
        note: "Reviewed current evidence; remediation complete.",
        containmentReviewHash: review.containment.reviewHash,
        containmentDisposition: "acknowledge",
      }),
    };
    await x.workflow.transition(close);
    expect((await x.workflow.transition(close)).replayed).toBe(true);
    const detail = await x.studio.get(x.input);
    expect(detail.incident.status).toBe("resolved");
    expect(detail.workflow?.availableTransitions).toEqual([]);
    expect(detail.timeline.map((t) => t.decision)).toEqual([
      {
        fromStatus: "open",
        toStatus: "investigating",
        resolutionCode: null,
        note: started.command.note,
        containmentDisposition: null,
      },
      {
        fromStatus: "investigating",
        toStatus: "resolved",
        resolutionCode: "REMEDIATED",
        note: close.command.note,
        containmentDisposition: "acknowledge",
      },
    ]);
    await expect(
      x.workflow.transition({
        ...close,
        command: { ...close.command, expectedVersion: 3, idempotencyKey: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "INCIDENT_TRANSITION_INVALID" });
    const rows = await x.f.db
      .select()
      .from(npAgentIncidentTimeline)
      .where(eq(npAgentIncidentTimeline.incidentId, x.incident.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.auditEventId && r.sourceKind === "staff")).toBe(true);
    const invocations = await x.f.db
      .select()
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, siteId),
          eq(npAgentInvocations.operationId, "agents.incidents.transition"),
        ),
      );
    expect(invocations).toHaveLength(2);
    x.hide();
    await expect(x.workflow.transition(close)).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });
  });
  it("requires the current generation, closes dismissals separately from signal feedback, and preserves exact-key intent", async () => {
    const x = await setup();
    const prior = await x.workflow.get(x.input);
    const started = { ...x.input, command: command(1) };
    await x.workflow.transition(started);
    await expect(
      x.workflow.transition({
        ...started,
        command: { ...started.command, note: "Changed same key" },
      }),
    ).rejects.toThrow();
    await expect(x.workflow.transition({ ...x.input, command: command(1) })).rejects.toMatchObject({
      code: "INCIDENT_VERSION_CONFLICT",
    });
    const dismissal = command(2, {
      transition: "dismissed",
      resolutionCode: "DUPLICATE",
      note: "Duplicate of an already investigated report.",
      containmentReviewHash: prior.containment.reviewHash,
      containmentDisposition: "acknowledge",
    });
    await expect(x.workflow.transition({ ...x.input, command: dismissal })).rejects.toMatchObject({
      code: "INCIDENT_CONTAINMENT_REVIEW_STALE",
    });
    const review = await x.workflow.get(x.input);
    await x.workflow.transition({
      ...x.input,
      command: {
        ...dismissal,
        idempotencyKey: randomUUID(),
        containmentReviewHash: review.containment.reviewHash,
      },
    });
    const detail = await x.studio.get(x.input);
    expect(detail.incident.status).toBe("dismissed");
    expect(detail.feedback).toEqual([]);
    expect(detail.timeline[1].decision?.resolutionCode).toBe("DUPLICATE");
  });
  it("checks live sessions for replay and isolates foreign sites", async () => {
    const x = await setup();
    const request = { ...x.input, command: command(1) };
    await x.workflow.transition(request);
    await expect(x.workflow.get({ ...x.input, siteId: "foreign-site" })).rejects.toThrow();
    await x.f.db
      .update(npSessions)
      .set({ accessExpiresAt: new Date(0) })
      .where(eq(npSessions.id, x.input.actor.sessionId));
    await expect(x.workflow.transition(request)).rejects.toThrow();
    expect(await x.f.db.select().from(npAgentIncidentTimeline)).toHaveLength(1);
  });
  it("serializes two distinct decisions at the same version without duplicate timeline or audit commits", async () => {
    const x = await setup();
    const results = await Promise.allSettled([
      x.workflow.transition({ ...x.input, command: command(1) }),
      x.workflow.transition({ ...x.input, command: command(1) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await x.f.db.select().from(npAgentIncidentTimeline)).toHaveLength(1);
    expect((await x.f.db.select().from(npAgentIncidents))[0].versionNumber).toBe(2);
  });
  it("leaves default Studio workflow disabled", async () => {
    const x = await setup();
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(74),
      canReadIncident: () => false,
      canReadStaffIncident: () => true,
    }).staff;
    const studio = createAgentIncidentStudioServiceV1({
      reads,
      cursorHmacKey: new Uint8Array(32).fill(75),
    });
    expect((await studio.get(x.input)).workflow).toBeNull();
    await expect(studio.transition({ ...x.input, command: command(1) })).rejects.toMatchObject({
      code: "INCIDENT_WORKFLOW_DISABLED",
    });
  });
});
