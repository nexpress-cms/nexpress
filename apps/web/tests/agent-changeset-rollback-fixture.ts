import { randomUUID } from "node:crypto";
import { executionFixture, decideApproval } from "./agent-changeset-execution-fixture.js";

export async function approvedRollbackFixture(
  options: Parameters<typeof executionFixture>[0] = {},
) {
  const f = await executionFixture(options);
  const applied = await f.service.apply({ actor: f.actor, id: f.id, command: f.executionCommand });
  const prepareCommand = {
    schemaVersion: "np.agent-rollback-plan-create-input.v1",
    expectedVersion: applied.changeSet.draftVersion,
    planHash: applied.changeSet.planHash!,
    idempotencyKey: randomUUID(),
  };
  const prepared = await f.service.prepareRollback({
    actor: f.actor,
    id: f.id,
    command: prepareCommand,
  });
  const plan = prepared.rollbackDetail;
  if (!plan?.summary.planHash) throw new Error("Expected ready rollback plan");
  const requested = await f.service.requestRollbackApproval({
    actor: f.actor,
    id: f.id,
    rollbackPlanId: plan.summary.rollbackPlanId,
    command: {
      schemaVersion: "np.agent-rollback-plan-request-approval-input.v1",
      expectedVersion: plan.version,
      planHash: plan.summary.planHash,
      idempotencyKey: randomUUID(),
    },
  });
  const approved = await decideApproval(f.service.approvals!, f.approver, requested);
  const current = await f.service.getReview({ actor: f.actor, id: f.id });
  if (!current.rollbackDetail) throw new Error("Expected approved rollback plan");
  const rollbackCommand = {
    schemaVersion: "np.agent-rollback-plan-execute-input.v1",
    expectedVersion: current.rollbackDetail.version,
    planHash: plan.summary.planHash,
    approvalId: approved.item.approval.id,
    statementHash: approved.item.statementHash,
    idempotencyKey: randomUUID(),
  };
  return {
    ...f,
    applied,
    prepared,
    prepareCommand,
    rollbackApproved: approved,
    rollbackPlanId: plan.summary.rollbackPlanId,
    rollbackCommand,
  };
}
