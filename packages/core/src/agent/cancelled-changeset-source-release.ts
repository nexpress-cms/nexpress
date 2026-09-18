import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  type npAgentActions,
  type npAgentInvocations,
  type npAgentChangesets,
  npAgentChangesetOperations,
} from "../db/schema/agent.js";
import type { npAuditEvents } from "../db/schema/community.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npDigestAgentInvocationRequestCanonical } from "../agent-contract/canonical-idempotency-request.js";
import { npDigestAgentAuthorizationContextCanonical } from "../agent-contract/canonical-authorization-context.js";
import { npBuildAgentChangeSetCapabilityDefinitionCanonicalV1 } from "../agent-contract/installed-capability-contract.js";
import { npDigestAgentChangeSetDraftInputV1 } from "../agent-contract/changeset-wire-contract.js";
import { npDigestAgentChangeSetProposalCanonical } from "../agent-contract/canonical-changeset.js";
import {
  npAgentReleaseActionDigestV1,
  npSourceReleaseOwnerDigestV1,
} from "./source-release-read.js";

type Db = ReturnType<typeof getDb>;
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

/** Exact draft-create proof only. No execution or authority is inferred from cancellation. */
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
}) {
  const { action: a, invocation: i, changeSet: c, audit, releasedAt } = input;
  try {
    const definition = npBuildAgentChangeSetCapabilityDefinitionCanonicalV1("changeset.create");
    const fingerprint = await npDigestAgentCapabilityRegistryCanonical(
      definition,
      definition.capabilities,
    );
    const output = { changeSetId: c.id };
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
      c.principalId !== input.principalId ||
      c.agentVersionId !== input.agentVersionId ||
      !c.agentId ||
      !c.agentConfigHash ||
      (input.agentId !== undefined && c.agentId !== input.agentId) ||
      (input.agentConfigHash !== undefined && c.agentConfigHash !== input.agentConfigHash) ||
      c.runFingerprint !== input.runFingerprint ||
      c.invocationId !== i.id ||
      c.invocationFingerprint !== i.requestHash ||
      c.sourceOperationId !== "changeset.create" ||
      c.actorFingerprint !== i.actorFingerprint ||
      c.state !== "cancelled" ||
      !["OPERATOR_CANCELLED", "CHANGESET_EXPIRED"].includes(c.cancellationCode ?? "") ||
      c.updatedAt > releasedAt ||
      c.updatedAt < c.createdAt ||
      c.validationGeneration !== 0 ||
      c.sealedPlanBody !== null ||
      c.planHash !== null ||
      c.baseFingerprint !== null ||
      c.riskSummary !== null ||
      c.rollbackWindowSeconds !== null ||
      c.rollbackEligibleUntil !== null ||
      c.scheduledFor !== null ||
      c.appliedAt !== null ||
      c.verifiedAt !== null ||
      c.rolledBackAt !== null ||
      (c.cancellationCode === "CHANGESET_EXPIRED" && c.expiresAt > c.updatedAt) ||
      (c.runId !== input.runId && !(c.runId === null && c.runSourceReleaseId !== null)) ||
      (a.runId !== input.runId && !(a.runId === null && a.runSourceReleaseId !== null)) ||
      a.runFingerprint !== input.runFingerprint ||
      a.invocationId !== i.id ||
      a.invocationFingerprint !== i.requestHash ||
      a.auditEventId !== audit.id ||
      a.capabilityId !== "changeset.create" ||
      a.capabilityContractVersion !== 1 ||
      a.capabilityFingerprint !== fingerprint ||
      !same(a.capabilityDefinitionBody, definition) ||
      a.effectProfileId !== "changeset.draft-create" ||
      a.effectContractVersion !== 1 ||
      a.risk !== "reversible" ||
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
      i.operationId !== "changeset.create" ||
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
      !same(i.outputRedacted, output) ||
      i.outputHash !== hash("np.agent-changeset-result.v1", output) ||
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
      (await npDigestAgentChangeSetDraftInputV1(i.requestBody.input)) !== c.sourceInputHash ||
      hash("np.agent-changeset-source-idempotency.v1", i.idempotencyKey) !==
        c.sourceIdempotencyFingerprint ||
      audit.actorKind !== "agent-principal" ||
      audit.action !== "agents.changesets.create" ||
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

/** Relational work can name only the ChangeSet, so a Run-literal scan is insufficient. */
export async function npCancelledChangeSetDependenciesSafeV1(
  db: Db,
  c: ChangeSet,
  beforeStatement: () => Promise<void>,
) {
  await beforeStatement();
  const blockers = await db.execute(sql`select
    exists(select 1 from np_agent_approvals where site_id=${c.siteId} and (target_id=${c.id}::uuid or target_changeset_id=${c.id}::uuid)) or
    exists(select 1 from np_agent_changeset_executions where site_id=${c.siteId} and changeset_id=${c.id}::uuid) or
    exists(select 1 from np_agent_changeset_rollback_plans where site_id=${c.siteId} and changeset_id=${c.id}::uuid) or
    exists(select 1 from np_agent_changeset_rollback_operations where site_id=${c.siteId} and changeset_id=${c.id}::uuid) or
    exists(select 1 from np_agent_changeset_validation_attempts where site_id=${c.siteId} and changeset_id=${c.id}::uuid) or
    exists(select 1 from np_agent_changeset_previews where site_id=${c.siteId} and changeset_id=${c.id}::uuid)
    as blocked`);
  if (blockers.rows[0]?.blocked !== false) return false;
  await beforeStatement();
  const bounded = await db.execute(sql`select count(*) <= 500 and
    coalesce(sum(octet_length(to_jsonb(o)::text)),0) <= 8388608 as safe
    from np_agent_changeset_operations o where site_id=${c.siteId} and changeset_id=${c.id}::uuid`);
  if (bounded.rows[0]?.safe !== true) return false;
  await beforeStatement();
  const ops = await db
    .select()
    .from(npAgentChangesetOperations)
    .where(
      and(
        eq(npAgentChangesetOperations.siteId, c.siteId),
        eq(npAgentChangesetOperations.changesetId, c.id),
      ),
    )
    .orderBy(npAgentChangesetOperations.ordinal)
    .limit(501);
  if (
    ops.length > 500 ||
    ops.some(
      (o, n) =>
        o.ordinal !== n + 1 ||
        o.state !== "draft" ||
        o.beforeHash !== null ||
        o.beforeSnapshot !== null ||
        o.snapshotHash !== null ||
        o.afterHash !== null ||
        o.resultDigest !== null ||
        o.issues.length !== 0,
    )
  )
    return false;
  if (
    (await npDigestAgentChangeSetProposalCanonical({
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: c.siteId,
      changeSetId: c.id,
      draftVersion: c.draftVersion,
      title: c.title,
      summary: c.summary,
      operations: ops.map((o) => ({
        ordinal: o.ordinal,
        operation: o.input,
        canonicalResourceKey: o.resourceKey,
      })),
    })) !== c.draftHash
  )
    return false;
  await beforeStatement();
  const jobs = await db.execute(sql`select to_regclass('pgboss.job') is not null as present`);
  if (jobs.rows[0]?.present === true) {
    await beforeStatement();
    const pending =
      await db.execute(sql`select 1 from pgboss.job where state::text in ('created','retry','active')
      and (data->>'siteId'=${c.siteId} or data->>'siteId' is null) and position(${c.id} in data::text)>0 limit 1`);
    if (pending.rows.length) return false;
  }
  return true;
}
