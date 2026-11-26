import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentInvocations,
  npAgentOperatorExecutions,
  npAgentOperatorPlans,
} from "../db/schema/agent.js";
import {
  npAgentActivityRuntimeOperationLimitV1,
  type NpAgentActivityRuntimeOperationV1,
} from "../agent-contract/activity-runtime-operations.js";
import type { NpAgentApprovalDetailV1 } from "../agent-contract/approval-contract.js";
import type { NpAgentOperatorReviewV1 } from "../agent-contract/operator-review-contract.js";
import type { NpAgentRuntimeAdmissionV1 } from "./runtime-admission.js";
import {
  npReadAgentRuntimeOperatorPlanV1,
  npRuntimeOperatorContractIdV1,
} from "./runtime-operator-controls.js";
import {
  npDigestAgentOperatorPlanArtifactV1,
  type NpAgentOperatorRuntimeResultSelectorV1,
} from "./operator-review.js";

type Db = ReturnType<typeof getDb>;
type Operation = NpAgentActivityRuntimeOperationV1["operation"];
const resultTable = npAgentOperatorExecutions;
const planTable = npAgentOperatorPlans;
const limit = npAgentActivityRuntimeOperationLimitV1;

function runtimeExecutions(db: Db) {
  return db
    .select({
      actionId: npAgentInvocations.resultId,
      sourceRunId: resultTable.sourceRunId,
      resultRunId: resultTable.resultRunId,
      operation: sql<string>`${planTable.operation}->>'action'`,
      state: resultTable.state,
    })
    .from(resultTable)
    .innerJoin(
      npAgentInvocations,
      and(
        eq(npAgentInvocations.siteId, resultTable.siteId),
        eq(npAgentInvocations.id, resultTable.invocationId),
        eq(npAgentInvocations.operationId, "ops.execute"),
      ),
    )
    .innerJoin(
      planTable,
      and(
        eq(planTable.siteId, resultTable.siteId),
        eq(planTable.id, resultTable.planId),
        eq(planTable.contractId, npRuntimeOperatorContractIdV1),
        sql`${planTable.operation}->'target'->>'runId' = ${resultTable.sourceRunId}::text`,
      ),
    );
}

type Review = (
  actionId: string,
  expected?: NpAgentOperatorRuntimeResultSelectorV1,
) => Promise<NpAgentOperatorReviewV1>;

export async function npReadAgentOperatorRunActivityV1(input: {
  db: Db;
  siteId: string;
  runId: string;
  state: string;
  finished: boolean;
  now: Date;
  admission?: NpAgentRuntimeAdmissionV1;
  review: Review;
  readApproval?: (id: string) => Promise<NpAgentApprovalDetailV1>;
}): Promise<NpAgentActivityRuntimeOperationV1[]> {
  const { db, siteId, runId, now } = input;
  const planTarget = and(
    eq(planTable.siteId, siteId),
    eq(planTable.contractId, npRuntimeOperatorContractIdV1),
    sql`${planTable.operation}->'target'->>'runId' = ${runId}`,
  );
  const activity: NpAgentActivityRuntimeOperationV1[] = [];
  const pendingOperation =
    input.state === "failed" ? "agent.run.retry" : input.finished ? null : "agent.run.cancel";
  if (pendingOperation && input.admission && input.readApproval) {
    const requests = await db
      .select({
        id: planTable.id,
        approvalActionId: planTable.approvalActionId,
        planActionId: npAgentInvocations.resultId,
      })
      .from(planTable)
      .innerJoin(
        npAgentInvocations,
        and(
          eq(npAgentInvocations.siteId, planTable.siteId),
          eq(npAgentInvocations.id, planTable.invocationId),
        ),
      )
      .where(
        and(
          planTarget,
          gt(planTable.expiresAt, now),
          isNotNull(planTable.approvalActionId),
          sql`${planTable.operation}->>'action' = ${pendingOperation}`,
        ),
      )
      .orderBy(desc(planTable.createdAt), desc(planTable.id))
      .limit(limit);

    for (const candidate of requests) {
      if (!candidate.planActionId) continue;
      try {
        const { plan } = await input.review(candidate.planActionId);
        if (
          !plan ||
          plan.planId !== candidate.id ||
          plan.execution.kind !== "agent-executable" ||
          plan.operation.action !== pendingOperation ||
          plan.operation.target.runId !== runId
        )
          continue;
        const { item } = await input.readApproval(plan.execution.approvalId);
        if (
          item.approval.id !== plan.execution.approvalId ||
          item.target.kind !== "action" ||
          item.target.actionId !== candidate.approvalActionId ||
          item.approval.expiresAt !== plan.expiresAt ||
          Date.parse(plan.expiresAt) <= now.getTime() ||
          (item.approval.state !== "pending" && item.approval.state !== "approved")
        )
          continue;
        const current = await npReadAgentRuntimeOperatorPlanV1(input.admission, {
          siteId,
          input: plan.operation,
          executionId: candidate.id,
        });
        if (
          npDigestAgentOperatorPlanArtifactV1({
            operation: plan.operation,
            contractId: npRuntimeOperatorContractIdV1,
            artifact: current,
          }) !== plan.planDigest
        )
          continue;
        activity.push({
          operation: pendingOperation,
          state: item.approval.state,
          approvalId: item.approval.id,
          expiresAt: item.approval.expiresAt,
        });
        break;
      } catch {
        // Expired, stale or inaccessible requests have no review link here.
      }
    }
  }

  const executions = await runtimeExecutions(db)
    .where(and(eq(resultTable.siteId, siteId), eq(resultTable.sourceRunId, runId)))
    .orderBy(desc(resultTable.reservedAt), desc(resultTable.id))
    .limit(limit - activity.length);

  for (const { actionId, operation, state, resultRunId } of executions) {
    if (!actionId || !isRuntimeOperation(operation)) continue;
    try {
      if (state === "succeeded") {
        if (operation === "agent.run.cancel" && input.state === "cancelled") {
          await input.review(actionId, { runId, operation, state });
          activity.push({ operation, state, actionId });
        } else if (
          operation === "agent.run.retry" &&
          input.state === "failed" &&
          resultRunId &&
          resultRunId !== runId
        ) {
          await input.review(actionId, { runId, operation, state, resultRunId });
          activity.push({ operation, state, actionId, resultRunId });
        }
      } else if (state === "failed" || state === "conflicted") {
        await input.review(actionId, { runId, operation, state });
        activity.push({ operation, state, actionId });
      } else if (state === "reserved" || state === "dispatching" || state === "unknown") {
        if (activity.some((item) => item.operation === operation && item.state === state)) continue;
        await input.review(actionId, { runId, operation, state });
        activity.push({ operation, state });
      }
    } catch {
      // Visibility and integrity of the retained result are required for a link.
    }
  }
  return activity;
}

function isRuntimeOperation(value: string): value is Operation {
  return value === "agent.run.cancel" || value === "agent.run.retry";
}

export async function npReadAgentOperatorRetrySourceV1(input: {
  db: Db;
  siteId: string;
  runId: string;
  review: Review;
}): Promise<string | undefined> {
  const { db, siteId, runId } = input;
  const candidates = await runtimeExecutions(db)
    .where(
      and(
        eq(resultTable.siteId, siteId),
        eq(resultTable.resultRunId, runId),
        eq(resultTable.state, "succeeded"),
        sql`${planTable.operation}->>'action' = 'agent.run.retry'`,
      ),
    )
    .orderBy(desc(resultTable.finishedAt), desc(resultTable.id))
    .limit(limit);
  for (const { actionId, sourceRunId } of candidates) {
    if (!actionId || !sourceRunId || sourceRunId === runId) continue;
    try {
      await input.review(actionId, {
        runId: sourceRunId,
        operation: "agent.run.retry",
        state: "succeeded",
        resultRunId: runId,
      });
      return sourceRunId;
    } catch {
      // Only a verified, currently visible execution can establish the retry relationship.
    }
  }
}
