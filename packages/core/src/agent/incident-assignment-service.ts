import {
  npAgentConfigurationStatusesV1,
  type NpAgentConfigurationStatusV1,
} from "../agent-contract/runtime-contract.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgents,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentInvocations,
} from "../db/schema/agent.js";
import {
  npRequireAgentIncidentAssignmentInputV1,
  npRequireAgentIncidentAssignmentV1,
  type NpAgentIncidentAssignmentInputV1,
  type NpAgentIncidentAssignmentV1,
} from "../agent-contract/incident-assignment-contract.js";
import { NpAgentContractError } from "../agent-contract/contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
  canonicalBodyEnum,
} from "../agent-contract/canonical-body-validation.js";
import { createAgentAdminAdmissionV1, NpAgentGatewayError } from "./admin-admission.js";
import type {
  NpAgentIncidentStaffContextV1,
  NpAgentIncidentStaffReadServiceV1,
} from "./incident-service.js";
import { npRequireAgentRuntimeVersionV1 } from "./runtime-service.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
type Db = ReturnType<typeof getDb>;
type Staff = Omit<NpAgentIncidentStaffContextV1, "transaction">;
type Agent = typeof npAgents.$inferSelect;
export interface NpAgentIncidentAssignmentServiceOptionsV1 {
  reads: NpAgentIncidentStaffReadServiceV1;
  now?: () => Date;
}
export interface NpAgentIncidentAssignmentServiceV1 {
  get(input: Staff & { incidentId: string }): Promise<NpAgentIncidentAssignmentV1>;
  assign(
    input: Staff & { incidentId: string; command: NpAgentIncidentAssignmentInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
}
function fail(code = "INCIDENT_ASSIGNMENT_UNAVAILABLE", status = 409): never {
  throw new NpAgentGatewayError(code, status, "Incident assignment is unavailable.");
}
// Assignment identifies a configured observer. It never resolves/grants execution authority.
const categoryRecipes: Readonly<Record<string, string>> = {
  spam: "moderator.repeated-link-spam",
  authentication: "guardian.credential-stuffing",
  "agent-abuse": "guardian.agent-abuse",
  availability: "operator.worker-not-draining",
};
export function createAgentIncidentAssignmentServiceV1(
  options: NpAgentIncidentAssignmentServiceOptionsV1,
): NpAgentIncidentAssignmentServiceV1 {
  const admission = createAgentAdminAdmissionV1({ now: options.now });
  async function project(
    db: Db,
    row: Agent,
    category: string,
  ): Promise<NpAgentIncidentAssignmentV1["current"]> {
    const versionId = row.activeVersionId ?? row.draftVersionId;
    if (!versionId) return null;
    try {
      const e = await npRequireAgentRuntimeVersionV1({
        db,
        siteId: row.siteId,
        agentId: row.id,
        versionId,
        active: false,
      });
      const expected =
        row.status === "active" ? "active" : row.status === "archived" ? "revoked" : "suspended";
      if (e.principal.status !== expected) return null;
      const eligible =
        (row.status === "active" || row.status === "paused") &&
        e.agent.activeVersionId === e.version.id &&
        e.version.status === "active" &&
        serializeAgentCanonicalJson(e.principal.scopes) ===
          serializeAgentCanonicalJson(e.version.scopes) &&
        e.definition.settings.some((s) => s.recipeId === categoryRecipes[category]);
      return {
        id: row.id,
        name: e.definition.name,
        status: canonicalBodyEnum<NpAgentConfigurationStatusV1>(
          row.status,
          "assignment.status",
          new Set(npAgentConfigurationStatusesV1),
        ),
        eligible,
      };
    } catch (error) {
      if (error instanceof NpAgentGatewayError || error instanceof NpAgentContractError)
        return null;
      throw error;
    }
  }
  async function snapshot(
    db: Db,
    input: Staff & { incidentId: string },
  ): Promise<NpAgentIncidentAssignmentV1> {
    const context = { siteId: input.siteId, actor: input.actor, transaction: db };
    const { incident } = await options.reads.get({ incidentId: input.incidentId }, context);
    const rows = await db
      .select()
      .from(npAgents)
      .where(and(eq(npAgents.siteId, input.siteId), inArray(npAgents.status, ["active", "paused"])))
      .orderBy(asc(npAgents.id))
      .limit(101);
    if (rows.length > 100) fail("INCIDENT_ASSIGNMENT_LIMIT_REACHED");
    const candidates: NpAgentIncidentAssignmentV1["candidates"] = [];
    let current: NpAgentIncidentAssignmentV1["current"] = null;
    for (const row of rows) {
      const view = await project(db, row, incident.category);
      if (row.id === incident.assignedAgentId) current = view;
      if (view?.eligible && (view.status === "active" || view.status === "paused"))
        candidates.push({ id: view.id, name: view.name, status: view.status });
    }
    if (incident.assignedAgentId && !rows.some((r) => r.id === incident.assignedAgentId)) {
      const [row] = await db
        .select()
        .from(npAgents)
        .where(and(eq(npAgents.siteId, input.siteId), eq(npAgents.id, incident.assignedAgentId)))
        .limit(1);
      if (row) current = await project(db, row, incident.category);
    }
    const reread = await options.reads.get({ incidentId: input.incidentId }, context);
    if (serializeAgentCanonicalJson(reread.incident) !== serializeAgentCanonicalJson(incident))
      fail("INCIDENT_VERSION_CONFLICT");
    return npRequireAgentIncidentAssignmentV1({
      schemaVersion: "np.agent-incident-assignment.v1",
      incidentId: incident.id,
      incidentVersion: incident.versionNumber,
      assignedAgentId: incident.assignedAgentId,
      current,
      candidates,
      canAssign:
        !["resolved", "dismissed"].includes(incident.status) && incident.versionNumber < 2147483647,
    });
  }
  async function transaction<T>(siteId: string, fn: (db: Db) => Promise<T>): Promise<T> {
    canonicalBodySiteId(siteId, "incident.siteId");
    for (let attempt = 0; ; attempt++)
      try {
        return await getDb().transaction(
          (tx) => npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) => fn(db), tx as Db),
          { isolationLevel: "serializable" },
        );
      } catch (error) {
        const e = error as { code?: string; cause?: { code?: string } };
        if (attempt >= 2 || !["40001", "23505"].includes(e.cause?.code ?? e.code ?? ""))
          throw error;
      }
  }
  return {
    get(input) {
      canonicalBodyUuid(input.incidentId, "incident.id");
      return transaction(input.siteId, (db) => snapshot(db, input));
    },
    async assign(input) {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodyUuid(input.incidentId, "incident.id");
      const command = npRequireAgentIncidentAssignmentInputV1(input.command);
      return transaction(input.siteId, async (db) => {
        // Live staff/evidence authorization applies before admission, including exact replay.
        await snapshot(db, input);
        const result = await admission({
          db,
          siteId: input.siteId,
          actor: input.actor,
          operationId: "agents.incidents.assign",
          targetId: input.incidentId,
          command,
          mutate: async ({ db, command, now, invocationId }) => {
            const view = await snapshot(db, input);
            if (view.incidentVersion !== command.expectedVersion) fail("INCIDENT_VERSION_CONFLICT");
            if (!view.canAssign) fail("INCIDENT_ASSIGNMENT_CLOSED");
            if (command.agentId === view.assignedAgentId) fail("INCIDENT_ASSIGNMENT_UNCHANGED");
            if (command.agentId !== null && !view.candidates.some((c) => c.id === command.agentId))
              fail("INCIDENT_ASSIGNMENT_INELIGIBLE");
            const [invocation] = await db
              .select({
                actorFingerprint: npAgentInvocations.actorFingerprint,
                auditEventId: npAgentInvocations.auditEventId,
              })
              .from(npAgentInvocations)
              .where(
                and(
                  eq(npAgentInvocations.siteId, input.siteId),
                  eq(npAgentInvocations.id, invocationId),
                ),
              )
              .limit(1);
            if (!invocation?.auditEventId) fail();
            const versionNumber = command.expectedVersion + 1;
            const changed = await db
              .update(npAgentIncidents)
              .set({ assignedAgentId: command.agentId, versionNumber, updatedAt: now })
              .where(
                and(
                  eq(npAgentIncidents.siteId, input.siteId),
                  eq(npAgentIncidents.id, input.incidentId),
                  eq(npAgentIncidents.versionNumber, command.expectedVersion),
                ),
              )
              .returning({ id: npAgentIncidents.id });
            if (changed.length !== 1) fail("INCIDENT_VERSION_CONFLICT");
            const [seq] = await db
              .select({ n: sql<number>`coalesce(max(${npAgentIncidentTimeline.sequence}),0)+1` })
              .from(npAgentIncidentTimeline)
              .where(
                and(
                  eq(npAgentIncidentTimeline.siteId, input.siteId),
                  eq(npAgentIncidentTimeline.incidentId, input.incidentId),
                ),
              );
            const sequence = Number(seq?.n);
            if (!Number.isSafeInteger(sequence) || sequence > 2147483647)
              fail("INCIDENT_ASSIGNMENT_LIMIT_REACHED");
            await db.insert(npAgentIncidentTimeline).values({
              siteId: input.siteId,
              incidentId: input.incidentId,
              sequence,
              kind: "human_note",
              sourceKind: "staff",
              sourceId: input.actor.user.id,
              sourceFingerprint: invocation.actorFingerprint,
              auditEventId: invocation.auditEventId,
              summary: command.agentId
                ? "Incident Agent assigned."
                : "Incident Agent assignment cleared.",
              details: {
                schemaVersion: "np.agent-incident-assignment-entry.v1",
                fromAgentId: view.assignedAgentId,
                toAgentId: command.agentId,
              },
              createdAt: now,
            });
            return {
              resourceId: input.incidentId,
              output: {
                schemaVersion: "np.agent-incident-assignment-result.v1",
                incidentId: input.incidentId,
                assignedAgentId: command.agentId,
                versionNumber,
              },
            };
          },
        });
        return { resourceId: result.resourceId, replayed: result.replayed };
      });
    },
  };
}
