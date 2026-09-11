import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentRuns,
  npAgentInvocations,
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentChangesetRollbackOperations,
  npAgentChangesetExecutions,
  npAgentMcpTasks,
  npAgentApprovals,
  npAgentChangesetRollbackPlans,
} from "../db/schema/agent.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentRunLimitsCanonical,
  npDigestAgentBudgetSnapshotCanonical,
  npDigestAgentRunAdmissionCanonical,
  npDigestAgentActionCanonical,
  npRequireAgentRunLimitsCanonical,
  npRequireAgentBudgetSnapshotCanonical,
  npRequireAgentRunAdmissionCanonical,
  npRequireAgentActionCanonical,
  npRequireAgentChangeSetPlanCanonical,
  npRequireAgentApprovalStatementCanonical,
  npDigestAgentMcpTaskResultCanonical,
  npRequireAgentMcpStoredTerminalResult,
  type NpAgentJsonObject,
} from "../agent-contract/index.js";
import {
  npRequireAgentChangeSetExecutionOutputV1,
  type NpAgentChangeSetCapabilityInvocationRequestV1,
  type NpAgentChangeSetExecutionOutputV1,
} from "../agent-contract/installed-capability-contract.js";
import { npAgentChangeSetActionTargetsV1 } from "./changeset-resources.js";
import type { NpAgentCapabilityAuthenticationV1 } from "./capability-admission.js";

type Db = ReturnType<typeof getDb>;
function object(value: object): NpAgentJsonObject {
  return value as unknown as NpAgentJsonObject;
}
function hash(value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update("np.agent-execution-projection.v1\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}
function invalid(): never {
  throw new Error("Invalid ChangeSet execution projection.");
}

/** Projection only. The caller owns current authority, domain mutation and transaction. */
export async function npAdmitChangeSetExecutionProjectionV1(input: {
  db: Db;
  authentication: NpAgentCapabilityAuthenticationV1;
  invocationId: string;
  requestHash: string;
  request: NpAgentChangeSetCapabilityInvocationRequestV1;
  changeSetId: string;
  executionId?: string;
  approvalId?: string;
  rollbackPlanId?: string;
  now?: Date;
}): Promise<{ runId: string; actionId: string }> {
  const { db, authentication, request } = input,
    now = input.now ?? new Date();
  const siteId = authentication.principal.siteId,
    principalId = authentication.principal.id;
  if (
    !["changeset.apply", "changeset.schedule", "changeset.rollback"].includes(request.capabilityId)
  )
    return invalid();
  const [invocation] = await db
    .select()
    .from(npAgentInvocations)
    .where(
      and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, input.invocationId)),
    )
    .limit(1);
  if (
    !invocation ||
    invocation.principalId !== principalId ||
    invocation.requestHash !== input.requestHash ||
    invocation.operationId !== request.capabilityId ||
    invocation.runId ||
    !invocation.effectProfileId ||
    !invocation.effectContractVersion
  )
    return invalid();
  const definition = invocation.capabilityDefinitionBody;
  if (!definition) return invalid();
  const descriptor = definition.capabilities[0].descriptor;
  const selectedProfile = descriptor.effectProfiles.find(
    (profile) => profile.id === invocation.effectProfileId,
  );
  if (
    !selectedProfile ||
    selectedProfile.kind !== (invocation.effectProfileId === "domain.read" ? "read" : "mutation")
  )
    return invalid();
  const [parent] = await db
    .select()
    .from(npAgentChangesets)
    .where(and(eq(npAgentChangesets.siteId, siteId), eq(npAgentChangesets.id, input.changeSetId)))
    .limit(1);
  if (!parent) return invalid();
  const [admittedExecution] = input.executionId
    ? await db
        .select()
        .from(npAgentChangesetExecutions)
        .where(
          and(
            eq(npAgentChangesetExecutions.siteId, siteId),
            eq(npAgentChangesetExecutions.id, input.executionId),
            eq(npAgentChangesetExecutions.changesetId, parent.id),
            eq(npAgentChangesetExecutions.invocationId, invocation.id),
          ),
        )
        .limit(1)
    : [];
  if (input.executionId && !admittedExecution) return invalid();
  const approvalId = admittedExecution?.approvalId ?? input.approvalId;
  let resources = input.rollbackPlanId
    ? await db
        .select({ resourceKey: npAgentChangesetRollbackOperations.canonicalResourceKey })
        .from(npAgentChangesetRollbackOperations)
        .where(
          and(
            eq(npAgentChangesetRollbackOperations.siteId, siteId),
            eq(npAgentChangesetRollbackOperations.rollbackPlanId, input.rollbackPlanId),
          ),
        )
    : await db
        .select({ resourceKey: npAgentChangesetOperations.resourceKey })
        .from(npAgentChangesetOperations)
        .where(
          and(
            eq(npAgentChangesetOperations.siteId, siteId),
            eq(npAgentChangesetOperations.changesetId, parent.id),
          ),
        );
  if (
    resources.length === 0 &&
    request.capabilityId === "changeset.rollback" &&
    request.arguments.input.mode === "prepare"
  )
    resources = await db
      .select({ resourceKey: npAgentChangesetOperations.resourceKey })
      .from(npAgentChangesetOperations)
      .where(
        and(
          eq(npAgentChangesetOperations.siteId, siteId),
          eq(npAgentChangesetOperations.changesetId, parent.id),
        ),
      );
  const runId = randomUUID(),
    actionId = randomUUID();
  // No provider is installed for this one-capability Gateway projection. The
  // canonical legacy provider-call ceiling is positive; zero token/cost limits
  // and absent provider identity do not grant provider authority.
  const limits = npRequireAgentRunLimitsCanonical({
    schemaVersion: "np.agent-run-limits.v1",
    maxAttempts: 1,
    maxProviderCalls: 1,
    maxCapabilityCalls: 1,
    maxInputTokens: 0,
    maxOutputTokens: 0,
    maxCostMicros: 0,
    maxWallClockSeconds: 86400,
  });
  const [counts] = await db
    .select({
      active: sql<number>`count(*) filter (where ${npAgentRuns.finishedAt} is null)::int`,
      hour: sql<number>`count(*) filter (where ${npAgentRuns.queuedAt} >= ${new Date(now.getTime() - 3600000)})::int`,
    })
    .from(npAgentRuns)
    .where(and(eq(npAgentRuns.siteId, siteId), eq(npAgentRuns.principalId, principalId)));
  const budget = npRequireAgentBudgetSnapshotCanonical({
    schemaVersion: "np.agent-budget-snapshot.v1",
    siteId,
    principalId,
    agentId: null,
    recipe: null,
    capturedAt: now.toISOString(),
    sourceRefs: [],
    limits,
    counters: {
      concurrentRuns: counts?.active ?? 0,
      concurrentProviderCalls: 0,
      runsRollingHour: counts?.hour ?? 0,
      providerCallsRollingHour: 0,
      inputTokensUtcDay: 0,
      outputTokensUtcDay: 0,
      inputTokensUtcMonth: 0,
      outputTokensUtcMonth: 0,
      costMicrosUtcDay: 0,
      costMicrosUtcMonth: 0,
      incidentAnalysesFingerprintUtcDay: 0,
      directActionsRollingHour: 0,
      directActionsSubjectRollingHour: 0,
    },
    windows: {
      rollingHourStartedAt: new Date(now.getTime() - 3600000).toISOString(),
      utcDay: now.toISOString().slice(0, 10),
      utcMonth: now.toISOString().slice(0, 7),
    },
    reservation: { runs: 1, providerCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 },
  });
  const runLimitsHash = await npDigestAgentRunLimitsCanonical(limits),
    budgetSnapshotHash = await npDigestAgentBudgetSnapshotCanonical(budget);
  const deadlineAt = new Date(now.getTime() + limits.maxWallClockSeconds * 1000);
  const admission = npRequireAgentRunAdmissionCanonical({
    schemaVersion: "np.agent-run-admission.v1",
    siteId,
    origin: "gateway",
    principalId,
    invocationId: invocation.id,
    triggerId: null,
    agent: null,
    lineage: {
      rootRunId: runId,
      parentRunId: null,
      causalDepth: 0,
      causalEventId: null,
      causalActionId: null,
    },
    recipe: null,
    goal: request.capabilityId,
    eventRef: null,
    policyRefs: [],
    runLimitsHash,
    budgetSnapshotHash,
    idempotencyKey: `invocation:${invocation.id}`,
    connection: null,
    admittedAt: now.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
  });
  const admissionFingerprint = await npDigestAgentRunAdmissionCanonical(admission);
  const awaitingApproval = !!input.approvalId && !input.executionId;
  await db.insert(npAgentRuns).values({
    id: runId,
    siteId,
    origin: "gateway",
    principalId,
    invocationId: invocation.id,
    admissionFingerprint,
    rootRunId: runId,
    causalDepth: 0,
    state: awaitingApproval ? "waiting_approval" : "queued",
    goal: request.capabilityId,
    policyRefs: [],
    runLimits: limits,
    runLimitsHash,
    budgetSnapshot: object(budget),
    budgetSnapshotHash,
    idempotencyKey: `invocation:${invocation.id}`,
    attempt: 1,
    usage: {
      providerCalls: 0,
      capabilityCalls: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
    },
    queuedAt: now,
    startedAt: awaitingApproval ? now : null,
    deadlineAt,
  });
  const [rollbackPlan] = input.rollbackPlanId
    ? await db
        .select()
        .from(npAgentChangesetRollbackPlans)
        .where(
          and(
            eq(npAgentChangesetRollbackPlans.siteId, siteId),
            eq(npAgentChangesetRollbackPlans.id, input.rollbackPlanId),
            eq(npAgentChangesetRollbackPlans.changesetId, parent.id),
          ),
        )
        .limit(1)
    : [];
  const sealed = npRequireAgentChangeSetPlanCanonical(
    rollbackPlan?.sealedPlanBody ?? parent.sealedPlanBody,
  );
  const [approval] = approvalId
    ? await db
        .select()
        .from(npAgentApprovals)
        .where(and(eq(npAgentApprovals.siteId, siteId), eq(npAgentApprovals.id, approvalId)))
        .limit(1)
    : [];
  const statement = approval
    ? npRequireAgentApprovalStatementCanonical(approval.statementBody)
    : null;
  const targetRefs = npAgentChangeSetActionTargetsV1(resources.map((row) => row.resourceKey));
  const requiredScopes = [
    ...new Set([
      ...descriptor.requiredScopes,
      ...sealed.body.requiredScopes,
      ...(statement?.requiredScopes ?? []),
    ]),
  ].sort();
  const targetVersionFacts = targetRefs.map((targetRef) => ({
    targetRef: { ...targetRef },
    // Existing complete base inventory binds this covered target; not a new row-version claim.
    versionDigest: sealed.body.baseFingerprint,
  }));
  const canonical = npRequireAgentActionCanonical({
    schemaVersion: "np.agent-action.v1",
    siteId,
    actionId,
    invocationFingerprint: invocation.requestHash,
    runFingerprint: admissionFingerprint,
    sequence: 1,
    capabilityId: request.capabilityId,
    capabilityContractVersion: invocation.contractVersion,
    capabilityFingerprint: invocation.contractFingerprint,
    effectProfile: {
      id: invocation.effectProfileId,
      contractVersion: invocation.effectContractVersion,
    },
    risk:
      invocation.effectProfileId === "domain.read" ? "read" : (statement?.risk ?? descriptor.risk),
    requiredScopes,
    targetRefs,
    targetVersionFacts,
    input: object(request.arguments.input),
  });
  const actionRow = {
    id: actionId,
    siteId,
    runId,
    runFingerprint: admissionFingerprint,
    invocationId: invocation.id,
    invocationFingerprint: invocation.requestHash,
    sequence: 1,
    capabilityId: request.capabilityId,
    capabilityContractVersion: invocation.contractVersion,
    capabilityFingerprint: invocation.contractFingerprint,
    capabilityDefinitionBody: definition,
    effectProfileId: invocation.effectProfileId,
    effectContractVersion: invocation.effectContractVersion,
    risk: canonical.risk,
    state: "executing",
    idempotencyKey: request.arguments.idempotencyKey,
    inputRedacted: { changeSetId: parent.id },
    inputCanonical: canonical.input,
    requiredScopes: canonical.requiredScopes,
    targetRefs: canonical.targetRefs,
    targetVersionFacts: canonical.targetVersionFacts,
    inputHash: await npDigestAgentActionCanonical(canonical),
    approvalId: invocation.effectProfileId === "domain.read" ? null : (approvalId ?? null),
    auditEventId: invocation.auditEventId,
    startedAt: now,
    createdAt: now,
  } satisfies typeof npAgentActions.$inferInsert;
  await db.insert(npAgentActions).values(actionRow);
  await db
    .update(npAgentInvocations)
    .set({ runId })
    .where(eq(npAgentInvocations.id, invocation.id));
  return { runId, actionId };
}

/** Advances transport evidence from the existing execution journal; never executes work. */
export async function npReconcileChangeSetExecutionProjectionV1(input: {
  db?: Db;
  siteId: string;
  invocationId: string;
  output?: NpAgentChangeSetExecutionOutputV1;
  failureCode?: "AUTHORIZATION_CHANGED";
  now?: Date;
}): Promise<void> {
  if (!input.db) {
    await getDb().transaction((db) => npReconcileChangeSetExecutionProjectionV1({ ...input, db }));
    return;
  }
  const db = input.db,
    now = input.now ?? new Date();
  const [invocation] = await db
    .select()
    .from(npAgentInvocations)
    .where(
      and(
        eq(npAgentInvocations.siteId, input.siteId),
        eq(npAgentInvocations.id, input.invocationId),
      ),
    )
    .limit(1);
  if (!invocation?.runId) return;
  if (!invocation.resultId) return invalid();
  await db
    .select({ id: npAgentChangesets.id })
    .from(npAgentChangesets)
    .where(
      and(
        eq(npAgentChangesets.siteId, input.siteId),
        eq(npAgentChangesets.id, invocation.resultId),
      ),
    )
    .for("update");
  const [execution] = await db
    .select()
    .from(npAgentChangesetExecutions)
    .where(
      and(
        eq(npAgentChangesetExecutions.siteId, input.siteId),
        eq(npAgentChangesetExecutions.invocationId, invocation.id),
      ),
    )
    .for("update")
    .limit(1);
  const [run] = await db
    .select()
    .from(npAgentRuns)
    .where(and(eq(npAgentRuns.siteId, input.siteId), eq(npAgentRuns.id, invocation.runId)))
    .for("update")
    .limit(1);
  if (!run || run.invocationId !== invocation.id) return invalid();
  if (run.finishedAt) return;
  const output = input.output ? npRequireAgentChangeSetExecutionOutputV1(input.output) : null;
  if (output && (output.runId !== run.id || output.changeSet.id !== invocation.resultId))
    return invalid();
  const approvalId =
    !execution && typeof invocation.outputRedacted?.approvalId === "string"
      ? invocation.outputRedacted.approvalId
      : null;
  const [proposalApproval] = approvalId
    ? await db
        .select()
        .from(npAgentApprovals)
        .where(and(eq(npAgentApprovals.siteId, input.siteId), eq(npAgentApprovals.id, approvalId)))
        .limit(1)
    : [];
  const approvalTerminal =
    proposalApproval &&
    ["approved", "consumed", "rejected", "revoked", "expired"].includes(proposalApproval.state);
  const approvalFailed =
    proposalApproval && ["rejected", "revoked", "expired"].includes(proposalApproval.state);
  if (
    !input.failureCode &&
    execution?.state === "succeeded" &&
    (!output || !npHasFreshChangeSetExecutionOutputV1(execution, output))
  )
    return;
  const state = execution?.errorCode === "EXECUTION_CANCELLED" ? "cancelled" : execution?.state;
  const terminal =
    !!input.failureCode ||
    !!approvalTerminal ||
    state === "succeeded" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "ambiguous";
  const next =
    input.failureCode || approvalFailed
      ? "failed"
      : approvalTerminal
        ? "succeeded"
        : state === "succeeded"
          ? "succeeded"
          : state === "failed" || state === "ambiguous"
            ? "failed"
            : state === "cancelled"
              ? "cancelled"
              : state === "committed" || state === "verifying"
                ? "verifying"
                : state === "running"
                  ? "running"
                  : output?.state === "approval_required"
                    ? "waiting_approval"
                    : !execution && output?.state === "completed"
                      ? "succeeded"
                      : "queued";
  const finished = terminal || next === "succeeded";
  const failed = next === "failed" || next === "cancelled";
  if (finished && !failed && !output) return;
  const actionTerminal = finished || output?.state === "approval_required";
  await db
    .update(npAgentRuns)
    .set({
      state: next,
      startedAt: run.startedAt ?? (next === "queued" ? null : now),
      finishedAt: finished ? now : null,
      ...(output && !(approvalId && run.result) ? { result: object(output) } : {}),
      errorCode: failed
        ? (input.failureCode ??
          (approvalFailed
            ? `APPROVAL_${proposalApproval.state.toUpperCase()}`
            : "CAPABILITY_EXECUTION_FAILED"))
        : null,
      errorMessage: failed ? "Operation failed" : null,
    })
    .where(eq(npAgentRuns.id, run.id));
  await db
    .update(npAgentActions)
    .set({
      state: failed ? "failed" : actionTerminal ? "succeeded" : "executing",
      finishedAt: actionTerminal ? now : null,
      errorCode: failed
        ? (input.failureCode ??
          (approvalFailed
            ? `APPROVAL_${proposalApproval.state.toUpperCase()}`
            : "CAPABILITY_EXECUTION_FAILED"))
        : null,
      outputRedacted: actionTerminal && output ? object(output) : null,
      outputHash: actionTerminal && output ? hash(output) : null,
    })
    .where(
      and(
        eq(npAgentActions.siteId, input.siteId),
        eq(npAgentActions.invocationId, invocation.id),
        isNull(npAgentActions.finishedAt),
      ),
    );
  if ((!finished && output?.state !== "approval_required") || (!output && !failed)) return;
  const result = npRequireAgentMcpStoredTerminalResult(
    failed
      ? {
          schemaVersion: "np.agent-mcp-stored-task-result.v1",
          kind: "jsonrpc_error",
          error:
            next === "cancelled"
              ? { code: -32800, message: "Request cancelled" }
              : { code: -32603, message: "Internal error" },
        }
      : {
          schemaVersion: "np.agent-mcp-stored-task-result.v1",
          kind: "tool_result",
          result: npProjectAgentMcpInvocationOutputV1(input.siteId, object(output!)),
        },
  );
  await db
    .update(npAgentMcpTasks)
    .set({
      status: next === "cancelled" ? "cancelled" : failed ? "failed" : "completed",
      ...(next === "cancelled" ? { safeStatusCode: "REQUEST_CANCELLED", cancelledAt: now } : {}),
      terminalResult: result,
      terminalResultDigest: await npDigestAgentMcpTaskResultCanonical(result),
      lastUpdatedAt: now,
    })
    .where(
      and(
        eq(npAgentMcpTasks.siteId, input.siteId),
        eq(npAgentMcpTasks.invocationId, invocation.id),
        eq(npAgentMcpTasks.status, "working"),
        sql`${npAgentMcpTasks.expiresAt}>${now}`,
      ),
    );
}

/** One bounded MCP representation shared by normal calls and immutable task results. */
export function npProjectAgentMcpInvocationOutputV1(siteId: string, output: NpAgentJsonObject) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "resource_link"; uri: string; name: string; mimeType: string }
  > = [{ type: "text", text: serializeAgentCanonicalJson(output) }];
  if (
    output.schemaVersion === "np.agent-changeset-execution-result.v1" &&
    output.state === "accepted"
  ) {
    const parsed = npRequireAgentChangeSetExecutionOutputV1(output);
    content.push({
      type: "resource_link",
      uri: `nexpress://site/${siteId}/runs/${parsed.runId}`,
      name: "ChangeSet execution status",
      mimeType: "application/json",
    });
  }
  return { content, structuredContent: output, isError: false };
}

/** A queued response cannot become the immutable result of a later successful commit. */
export function npHasFreshChangeSetExecutionOutputV1(
  execution: Pick<
    typeof npAgentChangesetExecutions.$inferSelect,
    "id" | "purpose" | "rollbackPlanId" | "planHash" | "resultDigest"
  >,
  output: Pick<NpAgentChangeSetExecutionOutputV1, "state"> & {
    changeSet: Pick<NpAgentChangeSetExecutionOutputV1["changeSet"], "execution" | "rollback">;
  },
): boolean {
  if (output.state !== "completed") return false;
  if (execution.purpose === "rollback")
    return (
      output.changeSet.rollback?.rollbackPlanId === execution.rollbackPlanId &&
      output.changeSet.rollback.state === "verified" &&
      output.changeSet.rollback.planHash === execution.planHash
    );
  return (
    output.changeSet.execution?.executionId === execution.id &&
    output.changeSet.execution.state === "succeeded" &&
    output.changeSet.execution.resultDigest === execution.resultDigest
  );
}
