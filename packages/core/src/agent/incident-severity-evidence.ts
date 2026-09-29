import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { npAuditEvents } from "../db/schema/community.js";
import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAgentInvocations } from "../db/schema/agent.js";
import type { npAgentIncidentTimeline } from "../db/schema/agent.js";
import { npRequireAgentIncidentSeverityChangeV1 } from "../agent-contract/incident-severity-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
/** Bind an immutable staff judgment to its admitted command and audit owner. */
export async function npRequireIncidentSeverityEvidence(
  db: ReturnType<typeof getDb>,
  entry: typeof npAgentIncidentTimeline.$inferSelect,
) {
  const fail = (): never => {
    throw new NpAgentGatewayError(
      "INCIDENT_EVIDENCE_INVALID",
      409,
      "Incident severity evidence is unavailable.",
    );
  };
  if (
    entry.kind !== "human_note" ||
    entry.sourceKind !== "staff" ||
    !entry.auditEventId ||
    entry.details.schemaVersion !== "np.agent-incident-severity-entry.v1" ||
    typeof entry.details.invocationId !== "string" ||
    typeof entry.details.transitionVersion !== "number" ||
    !Number.isInteger(entry.details.transitionVersion) ||
    entry.details.transitionVersion < 2 ||
    typeof entry.details.status !== "string" ||
    !["open", "investigating", "contained", "monitoring"].includes(entry.details.status)
  )
    fail();
  const invocationId = canonicalBodyUuid(
    entry.details.invocationId,
    "incident.severity.invocationId",
  );
  const auditEventId = entry.auditEventId;
  if (!auditEventId) return fail();
  const change = npRequireAgentIncidentSeverityChangeV1({
    fromSeverity: entry.details.fromSeverity,
    toSeverity: entry.details.toSeverity,
    note: entry.details.note,
  });
  const [invocation] = await db
    .select()
    .from(npAgentInvocations)
    .where(
      and(eq(npAgentInvocations.siteId, entry.siteId), eq(npAgentInvocations.id, invocationId)),
    )
    .limit(1);
  const command = invocation?.requestBody.input;
  if (
    !invocation ||
    invocation.operationId !== "agents.incidents.escalate" ||
    invocation.actorKind !== "staff" ||
    invocation.operationKind !== "admin" ||
    !["started", "completed"].includes(invocation.state) ||
    invocation.auditEventId !== entry.auditEventId ||
    invocation.actorFingerprint !== entry.sourceFingerprint ||
    invocation.staffUserId !== entry.sourceId ||
    command?.schemaVersion !== "np.agent-incident-severity-input.v1" ||
    command.targetId !== entry.incidentId ||
    command.expectedVersion !== Number(entry.details.transitionVersion) - 1 ||
    command.severity !== change.toSeverity ||
    command.note !== change.note ||
    entry.details.severity !== change.toSeverity
  )
    fail();
  const [audit] = await db
    .select()
    .from(npAuditEvents)
    .where(and(eq(npAuditEvents.siteId, entry.siteId), eq(npAuditEvents.id, auditEventId)))
    .limit(1);
  if (
    !audit ||
    audit.action !== "agents.incidents.escalate" ||
    audit.actorKind !== "staff" ||
    audit.actorUserId !== entry.sourceId ||
    audit.targetType !== "agent-incident" ||
    audit.targetId !== entry.incidentId ||
    audit.payload?.idempotencyFingerprint !== invocation.requestHash
  )
    fail();
  return change;
}
