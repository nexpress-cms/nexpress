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

export async function npReadAgentOperatorRunActivityV1(input: {
  db: Db;
  siteId: string;
  runId: string;
  state: string;
  finished: boolean;
  now: Date;
  admission?: NpAgentRuntimeAdmissionV1;
  review: (
    actionId: string,
    expected?: NpAgentOperatorRuntimeResultSelectorV1,
  ) => Promise<NpAgentOperatorReviewV1>;
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

  const completedOperation: Operation | null =
    input.state === "cancelled"
      ? "agent.run.cancel"
      : input.state === "failed"
        ? "agent.run.retry"
        : null;
  if (!completedOperation) return activity;
  const executions = await db
    .select({
      actionId: npAgentInvocations.resultId,
      resultRunId: resultTable.resultRunId,
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
      and(eq(planTable.siteId, resultTable.siteId), eq(planTable.id, resultTable.planId)),
    )
    .where(
      and(
        planTarget,
        eq(resultTable.siteId, siteId),
        eq(resultTable.sourceRunId, runId),
        eq(resultTable.state, "succeeded"),
        sql`${planTable.operation}->>'action' = ${completedOperation}`,
      ),
    )
    .orderBy(desc(resultTable.finishedAt), desc(resultTable.id))
    .limit(limit - activity.length);

  for (const candidate of executions) {
    if (!candidate.actionId) continue;
    try {
      if (completedOperation === "agent.run.cancel") {
        await input.review(candidate.actionId, { runId, operation: completedOperation });
        activity.push({
          operation: completedOperation,
          state: "succeeded",
          actionId: candidate.actionId,
        });
      } else if (candidate.resultRunId && candidate.resultRunId !== runId) {
        await input.review(candidate.actionId, {
          runId,
          operation: completedOperation,
          resultRunId: candidate.resultRunId,
        });
        activity.push({
          operation: completedOperation,
          state: "succeeded",
          actionId: candidate.actionId,
          resultRunId: candidate.resultRunId,
        });
      }
    } catch {
      // Visibility and integrity of the retained result are required for a link.
    }
  }
  return activity;
}
