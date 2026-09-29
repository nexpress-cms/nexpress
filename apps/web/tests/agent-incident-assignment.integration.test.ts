import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgents,
  npAgentVersions,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentInvocations,
  npAgentRuns,
  npAgentActions,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentAssignmentServiceV1 } from "../../../packages/core/src/agent/incident-assignment-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { npBuildAgentRuntimeDefinitionInputV1 } from "../../../packages/core/src/agent/runtime-service.js";
import { type NpAgentIncidentAssignmentInputV1 } from "../../../packages/core/src/agent-contract/incident-assignment-contract.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
function command(
  expectedVersion: number,
  agentId: string | null,
): NpAgentIncidentAssignmentInputV1 {
  return {
    schemaVersion: "np.agent-incident-assignment-input.v1",
    expectedVersion,
    agentId,
    idempotencyKey: randomUUID(),
  };
}
describe.skipIf(skipIfNoTestDb())("Incident configured Agent assignment", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  async function setup() {
    const f = await runtimeFixture();
    let visible = true;
    const time = new Date();
    const [incident] = await f.db
      .insert(npAgentIncidents)
      .values({
        siteId,
        category: "availability",
        status: "open",
        severity: "medium",
        fingerprint: randomUUID(),
        title: "Worker backlog",
        summary: "Observed backlog.",
        firstObservedAt: time,
        lastObservedAt: time,
      })
      .returning();
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(71),
      canReadIncident: () => false,
      canReadStaffIncident: () => visible,
    }).staff;
    const assignment = createAgentIncidentAssignmentServiceV1({ reads });
    const studio = createAgentIncidentStudioServiceV1({
      reads,
      assignment,
      cursorHmacKey: new Uint8Array(32).fill(72),
    });
    const input = { siteId, actor: f.actor.actor, incidentId: incident.id };
    return {
      f,
      incident,
      reads,
      assignment,
      studio,
      input,
      hide: () => {
        visible = false;
      },
    };
  }
  it("assigns and clears through current staff admission, exact replay and typed immutable history without execution", async () => {
    const x = await setup();
    expect(await x.studio.assignment(x.input)).toMatchObject({
      assignedAgentId: null,
      canAssign: true,
      candidates: [{ id: x.f.created.resourceId, name: "Worker observer", status: "active" }],
    });
    const request = { ...x.input, command: command(1, x.f.created.resourceId) };
    await expect(x.studio.assign(request)).resolves.toMatchObject({ replayed: false });
    await expect(x.studio.assign(request)).resolves.toMatchObject({ replayed: true });
    expect(await x.assignment.get(x.input)).toMatchObject({
      incidentVersion: 2,
      current: { id: x.f.created.resourceId, eligible: true },
    });
    await x.assignment.assign({ ...x.input, command: command(2, null) });
    const detail = await x.studio.get(x.input);
    expect(detail.incident.assignedAgentId).toBeNull();
    expect(detail.incident.status).toBe("open");
    expect(detail.timeline.map((r) => r.assignment)).toEqual([
      { fromAgentId: null, toAgentId: x.f.created.resourceId },
      { fromAgentId: x.f.created.resourceId, toAgentId: null },
    ]);
    const rows = await x.f.db
      .select()
      .from(npAgentIncidentTimeline)
      .where(eq(npAgentIncidentTimeline.incidentId, x.incident.id));
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (r) =>
          r.kind === "human_note" &&
          r.sourceKind === "staff" &&
          r.auditEventId !== null &&
          r.sourceFingerprint !== null,
      ),
    ).toBe(true);
    const invocations = await x.f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.operationId, "agents.incidents.assign"));
    expect(invocations).toHaveLength(2);
    expect(await x.f.db.select().from(npAgentRuns)).toHaveLength(0);
    expect(await x.f.db.select().from(npAgentActions)).toHaveLength(0);
  });
  it("preserves paused configuration eligibility, denies drafts, wrong categories, foreign IDs and tampered configuration", async () => {
    const x = await setup();
    const agentId = x.f.created.resourceId;
    await x.f.service.executeAdmin({
      siteId,
      actor: x.f.actor.actor,
      operationId: "agents.configurations.pause",
      targetId: agentId,
      command: { expectedVersion: 2, reason: "Pause observer", idempotencyKey: randomUUID() },
    });
    expect((await x.assignment.get(x.input)).candidates).toMatchObject([
      { id: agentId, status: "paused" },
    ]);
    await x.assignment.assign({ ...x.input, command: command(1, agentId) });
    const draft = await x.f.service.executeAdmin({
      siteId,
      actor: x.f.actor.actor,
      operationId: "agents.configurations.create",
      targetId: null,
      command: {
        ...npBuildAgentRuntimeDefinitionInputV1({ ...x.f.definition, name: "Unactivated" }),
        idempotencyKey: randomUUID(),
      },
    });
    await expect(
      x.assignment.assign({ ...x.input, command: command(2, draft.resourceId) }),
    ).rejects.toMatchObject({ code: "INCIDENT_ASSIGNMENT_INELIGIBLE" });
    const foreign = await x.f.service.executeAdmin({
      siteId: "draft-other",
      actor: x.f.actor.actor,
      operationId: "agents.configurations.create",
      targetId: null,
      command: {
        ...npBuildAgentRuntimeDefinitionInputV1({ ...x.f.definition, name: "Foreign observer" }),
        idempotencyKey: randomUUID(),
      },
    });
    await expect(
      x.assignment.assign({ ...x.input, command: command(2, foreign.resourceId) }),
    ).rejects.toMatchObject({ code: "INCIDENT_ASSIGNMENT_INELIGIBLE" });
    await x.f.db
      .update(npAgentIncidents)
      .set({ category: "spam" })
      .where(eq(npAgentIncidents.id, x.incident.id));
    expect(await x.assignment.get(x.input)).toMatchObject({
      candidates: [],
      current: { id: agentId, eligible: false },
    });
    await x.assignment.assign({ ...x.input, command: command(2, null) });
    await x.f.db
      .update(npAgentIncidents)
      .set({ category: "availability" })
      .where(eq(npAgentIncidents.id, x.incident.id));
    await x.f.db
      .update(npAgentVersions)
      .set({ configHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentVersions.id, x.f.runInput.expectedVersionId));
    expect((await x.assignment.get(x.input)).candidates).toEqual([]);
    await expect(
      x.assignment.assign({ ...x.input, command: command(3, agentId) }),
    ).rejects.toMatchObject({ code: "INCIDENT_ASSIGNMENT_INELIGIBLE" });
  });
  it("checks source visibility and live sessions even on exact replays, and keeps absent installation disabled", async () => {
    const x = await setup();
    const request = { ...x.input, command: command(1, x.f.created.resourceId) };
    await x.assignment.assign(request);
    const absent = createAgentIncidentStudioServiceV1({
      reads: x.reads,
      cursorHmacKey: new Uint8Array(32).fill(73),
    });
    await expect(async () => absent.assignment(x.input)).rejects.toMatchObject({ status: 503 });
    x.hide();
    await expect(x.assignment.assign(request)).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });
    await x.f.db
      .update(npSessions)
      .set({ accessExpiresAt: new Date(0) })
      .where(eq(npSessions.id, x.input.actor.sessionId));
    await expect(x.assignment.get(x.input)).rejects.toMatchObject({ status: 401 });
  });
  it("serializes competing CAS assignments, blocks terminal mutations and rejects cross-site Incident reads", async () => {
    const x = await setup();
    const first = { ...x.input, command: command(1, x.f.created.resourceId) };
    const results = await Promise.allSettled([
      x.assignment.assign(first),
      x.assignment.assign({ ...x.input, command: command(1, x.f.created.resourceId) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "INCIDENT_VERSION_CONFLICT" },
    });
    await x.f.db
      .update(npAgentIncidents)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        updatedAt: new Date(),
        resolutionCode: "NO_FURTHER_ACTION",
      })
      .where(and(eq(npAgentIncidents.siteId, siteId), eq(npAgentIncidents.id, x.incident.id)));
    expect((await x.assignment.get(x.input)).canAssign).toBe(false);
    await expect(
      x.assignment.assign({ ...x.input, command: command(2, null) }),
    ).rejects.toMatchObject({ code: "INCIDENT_ASSIGNMENT_CLOSED" });
    await expect(x.assignment.get({ ...x.input, siteId: "draft-other" })).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });
    const [agent] = await x.f.db
      .select()
      .from(npAgents)
      .where(eq(npAgents.id, x.f.created.resourceId));
    expect(agent.status).toBe("active");
  });
});
