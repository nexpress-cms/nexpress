import { createHash } from "node:crypto";
import type { npAgentRuns, npAgentInvocations } from "../db/schema/agent.js";
import type { npAuditEvents } from "../db/schema/community.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentAuthorizationContextCanonical } from "../agent-contract/canonical-authorization-context.js";
import { npDigestAgentInvocationRequestCanonical } from "../agent-contract/canonical-idempotency-request.js";
import {
  npGetAgentAdminOperationV1,
  npResolveAgentAdminOperationFingerprintsV1,
} from "../agent-contract/admin-operation-registry.js";
import { npSourceReleaseOwnerDigestV1 } from "./source-release-read.js";

type Run = Pick<
  typeof npAgentRuns.$inferSelect,
  | "id"
  | "siteId"
  | "origin"
  | "agentId"
  | "triggerId"
  | "idempotencyKey"
  | "state"
  | "finishedAt"
  | "queuedAt"
  | "agentConfigHash"
  | "manualInput"
  | "manualInputDigest"
  | "recipeId"
  | "goal"
>;
type Invocation = typeof npAgentInvocations.$inferSelect;
type Audit = typeof npAuditEvents.$inferSelect;
const operationId = "agents.configurations.run";
const digestPattern = /^cj1:sha256:[A-Za-z0-9_-]{43}$/u;
function hash(domain: string, value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}
function equal(a: unknown, b: unknown): boolean {
  return serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Caller verifies Run admission/execution integrity and retention eligibility first.
 * Receipts attest immutable history; they never authorize admission or execution.
 */
export async function npVerifyAgentReleaseStudioAttributionV1(input: {
  run: Run;
  invocation: Invocation;
  audit: Audit;
  releasedAt: Date;
}): Promise<{ auditDigest: string; invocationDigest: string } | null> {
  try {
    const { run: r, invocation: i, audit: a, releasedAt } = input;
    const operation = npGetAgentAdminOperationV1(operationId);
    const fingerprints = await npResolveAgentAdminOperationFingerprintsV1(operation);
    const auth = i.authorizationContextBody;
    const request = i.requestBody;
    if (auth.actor.kind !== "staff" || auth.authorityRef.kind !== "staff-session") return null;
    const userId = auth.actor.userId;
    if (
      r.origin !== "runtime" ||
      !r.agentId ||
      !r.triggerId ||
      r.idempotencyKey !== i.id ||
      !r.finishedAt ||
      !["succeeded", "failed", "cancelled", "policy_blocked", "budget_blocked"].includes(r.state) ||
      r.finishedAt > releasedAt ||
      r.siteId !== i.siteId ||
      a.siteId !== r.siteId ||
      i.actorKind !== "staff" ||
      i.principalId !== null ||
      (i.staffUserId !== null && (i.staffUserId !== userId || i.actorDeletedAt !== null)) ||
      (i.staffUserId === null &&
        (!i.actorDeletedAt ||
          !Number.isFinite(i.actorDeletedAt.getTime()) ||
          i.actorDeletedAt < i.requestedAt ||
          i.actorDeletedAt > releasedAt ||
          a.actorUserId !== null)) ||
      i.operationKind !== "admin" ||
      i.operationId !== operationId ||
      i.transport !== "admin" ||
      i.contractVersion !== operation.contractVersion ||
      i.contractFingerprint !== fingerprints.contract ||
      i.capabilityDefinitionBody !== null ||
      i.effectProfileId !== null ||
      i.effectContractVersion !== null ||
      i.mcpExecutionMode !== null ||
      i.mcpRequestedTaskTtlMs !== null ||
      i.runId !== null ||
      i.state !== "completed" ||
      i.resultKind !== "admin_resource" ||
      i.resultId !== r.id ||
      i.oneTimeValueIssued ||
      i.oneTimeResourceId !== null ||
      i.oneTimeRecoveryOperationId !== null ||
      i.errorCode !== null ||
      !i.idempotencyKey ||
      !i.completedAt ||
      !Number.isFinite(releasedAt.getTime()) ||
      !Number.isFinite(i.expiresAt.getTime()) ||
      i.completedAt < i.requestedAt ||
      i.expiresAt <= i.requestedAt ||
      i.expiresAt < i.completedAt ||
      i.expiresAt > releasedAt ||
      i.completedAt > r.queuedAt ||
      i.requestedAt > r.queuedAt ||
      auth.siteId !== r.siteId ||
      auth.transport !== "admin" ||
      auth.gatewayExposure !== null ||
      auth.authorityRef.userId !== userId ||
      !equal(i.authorityRef, auth.authorityRef) ||
      i.actorFingerprint !== hash("np.agent-staff-actor.v1", { siteId: r.siteId, userId }) ||
      auth.actor.actorFingerprint !== i.actorFingerprint ||
      (await npDigestAgentAuthorizationContextCanonical(auth)) !==
        i.authorizationContextFingerprint ||
      request.siteId !== r.siteId ||
      request.actorKind !== "staff" ||
      request.actorFingerprint !== i.actorFingerprint ||
      request.authorizationContextFingerprint !== i.authorizationContextFingerprint ||
      request.operationKind !== "admin" ||
      request.operationId !== operationId ||
      request.contractVersion !== i.contractVersion ||
      request.contractFingerprint !== i.contractFingerprint ||
      request.effectProfile !== null ||
      (await npDigestAgentInvocationRequestCanonical(request)) !== i.requestHash ||
      !equal(i.outputRedacted, { id: r.id, runId: r.id, state: "queued" }) ||
      i.outputHash !== hash("np.agent-admin-output.v1", i.outputRedacted) ||
      a.id !== i.auditEventId ||
      a.actorKind !== "staff" ||
      (a.actorUserId !== null && a.actorUserId !== userId) ||
      a.actorMemberId !== null ||
      a.action !== operation.audit.eventId ||
      a.targetType !== "agent-runtime" ||
      a.targetId !== r.id ||
      a.createdAt.getTime() !== i.requestedAt.getTime() ||
      !equal(a.payload, {
        operationId,
        outcome: "completed",
        siteId: r.siteId,
        staffUserId: userId,
        idempotencyFingerprint: i.requestHash,
      })
    )
      return null;
    const p = request.input;
    const structured = r.manualInput !== null;
    if (
      !exact(p, [
        "idempotencyKey",
        "expectedVersion",
        "configHash",
        "triggerId",
        "parentTargetId",
        "targetId",
        structured ? "manualInputRequestDigest" : "inputJson",
      ]) ||
      p.idempotencyKey !== i.idempotencyKey ||
      p.targetId !== r.agentId ||
      p.parentTargetId !== null ||
      p.configHash !== r.agentConfigHash ||
      p.triggerId !== r.triggerId ||
      !Number.isSafeInteger(p.expectedVersion) ||
      Number(p.expectedVersion) < 1 ||
      Number(p.expectedVersion) > 2_147_483_647
    )
      return null;
    if (structured) {
      // This digest binds the original JSON string, whose formatting is not retained
      // in canonical Run input. Do not invent reconstructed request bytes.
      if (
        typeof p.manualInputRequestDigest !== "string" ||
        !digestPattern.test(p.manualInputRequestDigest) ||
        !r.manualInputDigest
      )
        return null;
    } else {
      if (typeof p.inputJson !== "string") return null;
      const manual: unknown = JSON.parse(p.inputJson);
      if (
        !exact(manual, ["recipeId", "goal"]) ||
        manual.recipeId !== r.recipeId ||
        manual.goal !== r.goal
      )
        return null;
    }
    const { staffUserId: _staffUserId, actorDeletedAt: _actorDeletedAt, ...owner } = i;
    return {
      auditDigest: npSourceReleaseOwnerDigestV1({
        id: a.id,
        siteId: a.siteId,
        actorKind: a.actorKind,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        payload: a.payload,
        createdAt: a.createdAt.toISOString(),
      }),
      invocationDigest: npSourceReleaseOwnerDigestV1({
        ...owner,
        requestedAt: i.requestedAt.toISOString(),
        completedAt: i.completedAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      }),
    };
  } catch {
    return null;
  }
}
