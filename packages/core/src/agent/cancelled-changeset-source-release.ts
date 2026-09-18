import { createHash } from "node:crypto";
import {
  type npAgentActions,
  type npAgentInvocations,
  type npAgentChangesets,
  type npAgentChangesetValidationAttempts,
  type npAgentChangesetPreviews,
} from "../db/schema/agent.js";
import type { npAuditEvents } from "../db/schema/community.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npDigestAgentInvocationRequestCanonical } from "../agent-contract/canonical-idempotency-request.js";
import { npDigestAgentAuthorizationContextCanonical } from "../agent-contract/canonical-authorization-context.js";
import { npBuildAgentChangeSetCapabilityDefinitionCanonicalV1 } from "../agent-contract/installed-capability-contract.js";
import { npDigestAgentChangeSetDraftInputV1 } from "../agent-contract/changeset-wire-contract.js";
import {
  npAgentReleaseActionDigestV1,
  npSourceReleaseOwnerDigestV1,
} from "./source-release-read.js";

import { npVerifyAgentChangeSetPlanEvidenceV1 } from "./changeset-plan-evidence.js";

type Action = typeof npAgentActions.$inferSelect;
type Invocation = typeof npAgentInvocations.$inferSelect;
type ChangeSet = typeof npAgentChangesets.$inferSelect;
type Audit = typeof npAuditEvents.$inferSelect;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const hash = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const digest = (row: object, excluded: string[] = []) => {
  const body = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
  for (const key of excluded) delete body[key];
  return npSourceReleaseOwnerDigestV1(body);
};

/** Exact Runtime proposal-capability attribution; relational lifecycle safety is checked separately. */
export async function npVerifyCancelledChangeSetAttributionV1(input: {
  action: Action;
  invocation: Invocation;
  changeSet: ChangeSet;
  audit: Audit;
  runId: string;
  runFingerprint: string;
  principalId: string;
  agentVersionId: string;
  deadlineAt: string;
  releasedAt: Date;
  agentId?: string;
  agentConfigHash?: string;
  planEvidence?: Omit<
    Parameters<typeof npVerifyAgentChangeSetPlanEvidenceV1>[0],
    "changeSet" | "execution"
  >;
  validation?: typeof npAgentChangesetValidationAttempts.$inferSelect;
  preview?: typeof npAgentChangesetPreviews.$inferSelect;
}) {
  const { action: a, invocation: i, changeSet: c, audit, releasedAt } = input;
  try {
    const capability = a.capabilityId;
    if (
      capability !== "changeset.create" &&
      capability !== "changeset.validate" &&
      capability !== "changeset.preview"
    )
      return null;
    const create = capability === "changeset.create";
    const generation =
      capability === "changeset.validate"
        ? input.validation
        : capability === "changeset.preview"
          ? input.preview
          : undefined;
    if (
      !create &&
      (!generation ||
        generation.siteId !== c.siteId ||
        generation.changesetId !== c.id ||
        generation.admittingInvocationId !== i.id)
    )
      return null;
    const definition = npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(capability);
    const fingerprint = await npDigestAgentCapabilityRegistryCanonical(
      definition,
      definition.capabilities,
    );
    const output = { changeSetId: c.id };
    const invocationOutput = create
      ? output
      : capability === "changeset.validate"
        ? { ...output, attemptId: generation!.id }
        : { ...output, previewId: generation!.id };
    if (c.validationGeneration !== 0) {
      if (
        !input.planEvidence ||
        !(await npVerifyAgentChangeSetPlanEvidenceV1({ changeSet: c, ...input.planEvidence }))
      )
        return null;
    } else if (
      c.sealedPlanBody !== null ||
      c.planHash !== null ||
      c.baseFingerprint !== null ||
      c.riskSummary !== null ||
      c.rollbackWindowSeconds !== null
    )
      return null;
    const authority = {
      schemaVersion: "np.agent-authorization-context.v1",
      siteId: c.siteId,
      actor: {
        kind: "principal",
        principalId: input.principalId,
        actorFingerprint: hash("np.agent-principal-actor.v1", {
          siteId: c.siteId,
          principalId: input.principalId,
        }),
      },
      transport: "runtime",
      gatewayExposure: null,
      authorityRef: {
        kind: "runtime-run",
        principalId: input.principalId,
        runId: input.runId,
        agentVersionId: input.agentVersionId,
        deadlineAt: input.deadlineAt,
      },
    };
    if (
      c.siteId !== a.siteId ||
      c.siteId !== i.siteId ||
      c.siteId !== audit.siteId ||
      c.creatorKind !== "runtime" ||
      c.createdByUserId !== null ||
      c.actorDeletedAt !== null ||
      !same(c.policyRefs, []) ||
      (create &&
        (c.principalId !== input.principalId ||
          c.agentVersionId !== input.agentVersionId ||
          !c.agentId ||
          !c.agentConfigHash ||
          (input.agentId !== undefined && c.agentId !== input.agentId) ||
          (input.agentConfigHash !== undefined && c.agentConfigHash !== input.agentConfigHash) ||
          c.runFingerprint !== input.runFingerprint ||
          c.invocationId !== i.id ||
          c.invocationFingerprint !== i.requestHash ||
          c.sourceOperationId !== "changeset.create" ||
          c.actorFingerprint !== i.actorFingerprint)) ||
      c.state !== "cancelled" ||
      !["OPERATOR_CANCELLED", "CHANGESET_EXPIRED"].includes(c.cancellationCode ?? "") ||
      c.updatedAt > releasedAt ||
      c.updatedAt < c.createdAt ||
      c.rollbackEligibleUntil !== null ||
      c.scheduledFor !== null ||
      c.appliedAt !== null ||
      c.verifiedAt !== null ||
      c.rolledBackAt !== null ||
      (c.cancellationCode === "CHANGESET_EXPIRED" && c.expiresAt > c.updatedAt) ||
      (create && c.runId !== input.runId && !(c.runId === null && c.runSourceReleaseId !== null)) ||
      (a.runId !== input.runId && !(a.runId === null && a.runSourceReleaseId !== null)) ||
      a.runFingerprint !== input.runFingerprint ||
      a.invocationId !== i.id ||
      a.invocationFingerprint !== i.requestHash ||
      a.auditEventId !== audit.id ||
      a.capabilityId !== capability ||
      a.capabilityContractVersion !== 1 ||
      a.capabilityFingerprint !== fingerprint ||
      !same(a.capabilityDefinitionBody, definition) ||
      a.effectProfileId !== (create ? "changeset.draft-create" : "domain.read") ||
      a.effectContractVersion !== 1 ||
      a.risk !== (create ? "reversible" : "read") ||
      a.state !== "succeeded" ||
      !same(a.inputRedacted, {}) ||
      [
        a.executionInvocationId,
        a.executionInvocationFingerprint,
        a.approvalId,
        a.containmentId,
        a.enforcementAdapterId,
        a.enforcementAdapterContractVersion,
        a.enforcementAdapterFingerprint,
        a.effectDigest,
        a.targetVersionDigest,
        a.verifierId,
        a.verificationState,
        a.verificationResultDigest,
        a.verificationEvidence,
        a.verifiedAt,
        a.undoRef,
        a.compensatorId,
        a.compensationResultDigest,
        a.compensationEvidence,
        a.compensatedAt,
        a.compensatesActionId,
        a.errorCode,
      ].some((value) => value !== null) ||
      !a.finishedAt ||
      !a.startedAt ||
      a.finishedAt > releasedAt ||
      a.startedAt < a.createdAt ||
      a.finishedAt < a.startedAt ||
      !same(a.requiredScopes, definition.capabilities[0].descriptor.requiredScopes) ||
      !same(a.targetRefs, []) ||
      !same(a.targetVersionFacts, []) ||
      !same(a.outputRedacted, output) ||
      a.outputHash !== hash("np.agent-runtime-changeset-output.v1", output) ||
      !a.idempotencyKey ||
      a.idempotencyKey !== i.idempotencyKey ||
      i.runId !== input.runId ||
      i.actorKind !== "principal" ||
      i.principalId !== input.principalId ||
      i.actorFingerprint !== authority.actor.actorFingerprint ||
      i.transport !== "runtime" ||
      i.staffUserId !== null ||
      i.actorDeletedAt !== null ||
      i.mcpExecutionMode !== null ||
      i.mcpRequestedTaskTtlMs !== null ||
      i.oneTimeValueIssued ||
      i.oneTimeResourceId !== null ||
      i.oneTimeRecoveryOperationId !== null ||
      i.operationKind !== "capability" ||
      i.operationId !== capability ||
      i.contractVersion !== 1 ||
      i.contractFingerprint !== fingerprint ||
      i.effectProfileId !== a.effectProfileId ||
      i.effectContractVersion !== 1 ||
      !same(i.capabilityDefinitionBody, definition) ||
      !same(i.authorizationContextBody, authority) ||
      !same(i.authorityRef, authority.authorityRef) ||
      i.state !== "completed" ||
      !i.completedAt ||
      i.errorCode !== null ||
      i.completedAt < i.requestedAt ||
      i.completedAt > releasedAt ||
      i.expiresAt > releasedAt ||
      i.expiresAt <= i.requestedAt ||
      i.resultKind !== "changeset" ||
      i.resultId !== c.id ||
      !same(i.outputRedacted, invocationOutput) ||
      i.outputHash !== hash("np.agent-changeset-result.v1", invocationOutput) ||
      i.auditEventId !== audit.id ||
      i.requestBody.siteId !== c.siteId ||
      i.requestBody.actorKind !== i.actorKind ||
      i.requestBody.actorFingerprint !== i.actorFingerprint ||
      i.requestBody.operationKind !== i.operationKind ||
      i.requestBody.operationId !== i.operationId ||
      i.requestBody.contractVersion !== i.contractVersion ||
      i.requestBody.contractFingerprint !== fingerprint ||
      i.requestBody.effectProfile?.id !== i.effectProfileId ||
      i.requestBody.effectProfile?.contractVersion !== 1 ||
      i.requestBody.authorizationContextFingerprint !== i.authorizationContextFingerprint ||
      (await npDigestAgentAuthorizationContextCanonical(i.authorizationContextBody)) !==
        i.authorizationContextFingerprint ||
      (await npDigestAgentInvocationRequestCanonical(i.requestBody)) !== i.requestHash ||
      !same(i.requestBody.input, a.inputCanonical) ||
      (await npAgentReleaseActionDigestV1(a)) !== a.inputHash ||
      (create &&
        ((await npDigestAgentChangeSetDraftInputV1(i.requestBody.input)) !== c.sourceInputHash ||
          hash("np.agent-changeset-source-idempotency.v1", i.idempotencyKey) !==
            c.sourceIdempotencyFingerprint)) ||
      (!create &&
        (!same(generation!.authorizationContextBody, authority) ||
          !same(generation!.authorityRef, authority.authorityRef) ||
          generation!.authorizationContextFingerprint !== i.authorizationContextFingerprint ||
          generation!.requesterKind !== "principal" ||
          generation!.requesterId !== input.principalId ||
          generation!.requesterFingerprint !== i.actorFingerprint)) ||
      (capability === "changeset.validate" &&
        !same(i.requestBody.input, {
          changeSetId: c.id,
          draftVersion: input.validation!.draftVersion,
          draftHash: input.validation!.draftHash,
        })) ||
      (capability === "changeset.preview" &&
        !same(i.requestBody.input, { changeSetId: c.id, planHash: input.preview!.planHash })) ||
      audit.actorKind !== "agent-principal" ||
      audit.action !== `agents.${capability.replace("changeset.", "changesets.")}` ||
      audit.targetType !== "agent-changeset" ||
      audit.targetId !== c.id ||
      audit.createdAt > releasedAt ||
      !same(audit.payload, {
        requestHash: i.requestHash,
        operationId: i.operationId,
        outcome: "completed",
      })
    )
      return null;
    return {
      actionDigest: digest(a, ["runId", "runSourceReleaseId"]),
      invocationDigest: digest(i),
      changeSetDigest: digest(c, ["runId", "runSourceReleaseId"]),
      auditDigest: digest(audit, ["actorUserId", "actorMemberId"]),
    };
  } catch {
    return null;
  }
}
