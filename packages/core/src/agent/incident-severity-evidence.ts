import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { npAuditEvents } from "../db/schema/community.js";
import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentInvocations,
  npAgentIncidents,
  npAgentIncidentSignals,
  npAgentSignals,
} from "../db/schema/agent.js";
import type { npAgentIncidentTimeline } from "../db/schema/agent.js";
import { npRequireAgentIncidentSeverityChangeV1 } from "../agent-contract/incident-severity-contract.js";
import { npRequireAgentIncidentRuleSeverityChangeV1 } from "../agent-contract/incident-rule-severity-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "./incident-service.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
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

/** Bind a system priority increase to its actual attached deterministic Signal and source bytes. */
export async function npRequireIncidentRuleSeverityEvidence(
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
  const keys = new Set([
    "schemaVersion",
    "transitionVersion",
    "status",
    "severity",
    "detectorId",
    "detectorVersion",
    "evidenceDigest",
    "disposition",
    "fromSeverity",
    "toSeverity",
    "signalId",
  ]);
  if (
    entry.kind !== "correlated" ||
    entry.sourceKind !== "system" ||
    entry.sourceId !== null ||
    entry.eventId !== null ||
    entry.runId !== null ||
    entry.actionId !== null ||
    entry.approvalId !== null ||
    entry.providerCallId !== null ||
    entry.auditEventId !== null ||
    !entry.signalId ||
    entry.details.schemaVersion !== "np.agent-incident-rule-severity-entry.v1" ||
    Object.keys(entry.details).length !== keys.size ||
    Object.keys(entry.details).some((key) => !keys.has(key)) ||
    typeof entry.details.transitionVersion !== "number" ||
    !Number.isSafeInteger(entry.details.transitionVersion) ||
    entry.details.transitionVersion < 2 ||
    entry.details.transitionVersion > 2147483647 ||
    typeof entry.details.status !== "string" ||
    !["open", "investigating", "contained", "monitoring"].includes(entry.details.status) ||
    entry.details.disposition !== "correlated"
  )
    fail();
  const change = npRequireAgentIncidentRuleSeverityChangeV1({
    fromSeverity: entry.details.fromSeverity,
    toSeverity: entry.details.toSeverity,
    detectorId: entry.details.detectorId,
    detectorVersion: entry.details.detectorVersion,
    signalId: entry.details.signalId,
    evidenceDigest: entry.details.evidenceDigest,
  });
  if (
    entry.signalId !== change.signalId ||
    entry.details.severity !== change.toSeverity ||
    entry.sourceFingerprint !== change.evidenceDigest
  )
    fail();
  const [source] = await db
    .select({ signal: npAgentSignals, incident: npAgentIncidents })
    .from(npAgentIncidentSignals)
    .innerJoin(
      npAgentSignals,
      and(
        eq(npAgentSignals.siteId, npAgentIncidentSignals.siteId),
        eq(npAgentSignals.id, npAgentIncidentSignals.signalId),
      ),
    )
    .innerJoin(
      npAgentIncidents,
      and(
        eq(npAgentIncidents.siteId, npAgentIncidentSignals.siteId),
        eq(npAgentIncidents.id, npAgentIncidentSignals.incidentId),
      ),
    )
    .where(
      and(
        eq(npAgentIncidentSignals.siteId, entry.siteId),
        eq(npAgentIncidentSignals.incidentId, entry.incidentId),
        eq(npAgentIncidentSignals.signalId, change.signalId),
      ),
    )
    .limit(1);
  if (
    !source ||
    source.signal.incidentId !== entry.incidentId ||
    !["attached", "resolved"].includes(source.signal.status) ||
    source.signal.confidenceBasis !== "exact-rule" ||
    source.signal.scoreBasisPoints !== null ||
    source.signal.severity !== change.toSeverity ||
    source.signal.detectorId !== change.detectorId ||
    source.signal.detectorVersion !== change.detectorVersion ||
    source.signal.evidenceDigest !== change.evidenceDigest ||
    source.signal.category !== source.incident.category ||
    source.signal.fingerprint !== source.incident.fingerprint ||
    source.signal.createdAt.toISOString() !== entry.createdAt.toISOString() ||
    source.incident.versionNumber < Number(entry.details.transitionVersion)
  )
    fail();
  if (!source) return fail();
  const canonical = await npReadAgentIncidentSignalEvidenceV1(source.signal);
  const refs = canonical.evidence.filter((ref) => ref.kind === "event");
  const ids = [...new Set(refs.map((ref) => ref.eventId))].sort();
  const rows = await npReadAgentEventRowsV1(db, entry.siteId, ids);
  if (rows.length !== ids.length) fail();
  for (const row of rows) {
    const event = await npReadAgentEventRowEvidenceV1(row);
    const digest = Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString(
      "hex",
    );
    if (
      refs.some(
        (ref) =>
          ref.eventId === row.id &&
          (ref.digest !== digest ||
            ref.eventKind !== event.kind ||
            ref.observedAt !== event.occurredAt),
      )
    )
      fail();
  }
  return change;
}
