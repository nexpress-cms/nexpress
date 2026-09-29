import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npAgentActions, npAgentInvocations } from "../db/schema/agent.js";
import {
  npRequireAgentQuarantineProposalV1,
  npRequireAgentContainmentCreateOutputV1,
} from "../agent-contract/moderator-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { NpAgentGatewayError } from "./admin-admission.js";
const digest = (purpose: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256")
    .update(purpose + "\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
/** Private owning evidence check; approval failures and uncertain effects cannot satisfy it. */
export async function npRequireIncidentContainmentFailure(input: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  incidentId: string;
  actionId: string;
  auditEventId: string;
}) {
  const fail = (): never => {
    throw new NpAgentGatewayError(
      "INCIDENT_EVIDENCE_INVALID",
      409,
      "Incident operation is unavailable.",
    );
  };
  const { db, siteId, incidentId, actionId, auditEventId } = input;
  const [action] = await db
    .select()
    .from(npAgentActions)
    .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, actionId)))
    .limit(1);
  const evidence = [{ outcome: "rolled_back", reasonCode: "CONTAINMENT_VERIFICATION_FAILED" }];
  const resultDigest = digest("np.agent-moderation-result.v1", {
    actionId,
    state: "failed",
    evidence,
  });
  if (
    !action ||
    action.capabilityId !== "moderation.quarantine" ||
    action.state !== "failed" ||
    action.errorCode !== "CONTAINMENT_VERIFICATION_FAILED" ||
    action.verifierId !== "containment.verify" ||
    action.verificationState !== "failed" ||
    action.containmentId !== null ||
    !action.executionInvocationId ||
    !action.startedAt ||
    !action.finishedAt ||
    !action.verifiedAt ||
    action.effectDigest !== null ||
    action.verificationResultDigest !== resultDigest ||
    serializeAgentCanonicalJson(action.verificationEvidence) !==
      serializeAgentCanonicalJson(evidence) ||
    npRequireAgentQuarantineProposalV1(action.inputCanonical).incidentId !== incidentId
  )
    fail();
  const output = npRequireAgentContainmentCreateOutputV1(action.outputRedacted);
  if (
    output.state !== "failed" ||
    output.containmentId !== null ||
    output.actionId !== actionId ||
    output.resultDigest !== resultDigest ||
    output.verificationRefs.length !== 0 ||
    action.outputHash !== digest("np.agent-capability-output.v1", output)
  )
    fail();
  const executionId = action.executionInvocationId;
  if (!executionId) return fail();
  const [execution] = await db
    .select()
    .from(npAgentInvocations)
    .where(and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, executionId)))
    .limit(1);
  if (
    !execution ||
    execution.auditEventId !== auditEventId ||
    execution.requestHash !== action.executionInvocationFingerprint ||
    !["started", "completed"].includes(execution.state) ||
    !["moderation.quarantine", "agents.incidents.response_execute"].includes(
      execution.operationId,
    ) ||
    execution.requestBody.input?.actionId !== actionId
  )
    fail();
  const [audit] = await db
    .select()
    .from(npAuditEvents)
    .where(and(eq(npAuditEvents.siteId, siteId), eq(npAuditEvents.id, auditEventId)))
    .limit(1);
  if (
    !audit ||
    audit.payload?.outcome !== "rolled_back" ||
    audit.payload.actionId !== actionId ||
    audit.payload.invocationId !== execution.id ||
    audit.payload.requestHash !== execution.requestHash ||
    audit.payload.errorCode !== "CONTAINMENT_VERIFICATION_FAILED"
  )
    fail();
  return { action, execution };
}
