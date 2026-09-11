import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { npUsers, grantSiteMembership } from "@nexpress/core";
import { npVerifyChangeSetExecutionV1 } from "../../../packages/core/src/agent/changeset-execution-verification.js";
import { approvedRollbackFixture } from "./agent-changeset-rollback-fixture.js";
import { siteId } from "./agent-changeset-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";
import {
  npAgentChangesetExecutions,
  npAgentChangesetRollbackPlans,
  npAgentApprovals,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npDeleteAgentSiteRows,
  npInspectAgentSiteDeletionRows,
} from "../../../packages/core/src/agent/site-deletion.js";
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/contract-diagnostics.js";

async function failedInspectionFixture() {
  const uncertainEffect: { ordinal?: number } = {};
  const inspect = vi.fn((input: { ordinal: number }): Promise<"succeeded" | "failed" | "unknown"> =>
    Promise.resolve(input.ordinal === uncertainEffect.ordinal ? "unknown" : "failed"),
  );
  const f = await approvedRollbackFixture({
    document: true,
    deferVerification: true,
    inspectPostCommitEffect: inspect,
  });
  await f.service.executeRollback({
    actor: f.actor,
    id: f.id,
    rollbackPlanId: f.rollbackPlanId,
    command: f.rollbackCommand,
  });
  const [execution] = await f.db
    .select()
    .from(npAgentChangesetExecutions)
    .where(eq(npAgentChangesetExecutions.rollbackPlanId, f.rollbackPlanId));
  expect(execution.effects.length).toBeGreaterThan(0);
  uncertainEffect.ordinal = execution.effects[0].ordinal;
  const effects = execution.effects.map((effect, index) =>
    index === 0
      ? { ...effect, state: "unknown" as const, errorCode: "EFFECT_AMBIGUOUS" as const }
      : effect,
  );
  await f.db
    .update(npAgentChangesetExecutions)
    .set({ effects })
    .where(eq(npAgentChangesetExecutions.id, execution.id));
  const job = f.verifyJobs.find((item) => item.executionId === execution.id)!;
  await f.service.processVerification(job);
  const read = async () => {
    const [row] = await f.db
      .select()
      .from(npAgentChangesetExecutions)
      .where(eq(npAgentChangesetExecutions.id, execution.id));
    const [plan] = await f.db
      .select()
      .from(npAgentChangesetRollbackPlans)
      .where(eq(npAgentChangesetRollbackPlans.id, f.rollbackPlanId));
    return { row, plan, original: await f.execution() };
  };
  const before = await read();
  expect(before.row.state).toBe("failed");
  expect(before.plan.state).toBe("failed");
  inspect.mockClear();
  const convergenceCalls = f.verifyConvergence.mock.calls.length;
  return { ...f, inspect, job, read, before, convergenceCalls };
}

describe.skipIf(skipIfNoTestDb())("Rollback persistence and recovery", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("deletes a terminal same-site execution/approval/rollback cycle atomically", async () => {
    const f = await approvedRollbackFixture();
    const [approval] = await f.db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.id, f.rollbackApproved.item.approval.id));
    expect(approval.targetChangesetId).toBe(f.id);
    await expect(
      f.db
        .update(npAgentApprovals)
        .set({ targetChangesetId: null })
        .where(eq(npAgentApprovals.id, approval.id)),
    ).rejects.toThrow();
    await expect(
      f.db
        .update(npAgentApprovals)
        .set({
          statementBody: {
            ...approval.statementBody,
            target: { ...approval.statementBody.target, changeSetId: randomUUID() },
          } as typeof approval.statementBody,
        })
        .where(eq(npAgentApprovals.id, approval.id)),
    ).rejects.toThrow();
    const result = await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    expect(result.changeSet.state).toBe("rolled_back");
    const [plan] = await f.db
      .select()
      .from(npAgentChangesetRollbackPlans)
      .where(eq(npAgentChangesetRollbackPlans.id, f.rollbackPlanId));
    const [execution] = await f.db
      .select()
      .from(npAgentChangesetExecutions)
      .where(
        and(
          eq(npAgentChangesetExecutions.rollbackPlanId, f.rollbackPlanId),
          eq(npAgentChangesetExecutions.purpose, "rollback"),
        ),
      );
    expect(plan).toMatchObject({
      state: "verified",
      approvalId: f.rollbackApproved.item.approval.id,
    });
    expect(execution).toMatchObject({ state: "succeeded", verificationState: "passed" });
    expect((await npCollectAgentHealthSummaryV1()).issues).toEqual([]);
    await expect(
      f.db.delete(npAgentApprovals).where(eq(npAgentApprovals.id, plan.approvalId!)),
    ).rejects.toThrow();
    f.advance(86400);
    await f.service.reconcilePreviews({ siteId, limit: 100 });
    await npDeleteAgentSiteRows(f.db, siteId);
    const inventory = await npInspectAgentSiteDeletionRows(f.db, siteId);
    expect(inventory).toHaveLength(39);
    expect(inventory.every((item) => item.count === 0)).toBe(true);
  });
  it("verifies rollback with its own operation journal and preserves the original result", async () => {
    const f = await approvedRollbackFixture({ deferVerification: true });
    const original = await f.execution();
    const result = await f.service.executeRollback({
      actor: f.actor,
      id: f.id,
      rollbackPlanId: f.rollbackPlanId,
      command: f.rollbackCommand,
    });
    expect(result.changeSet.state).toBe("rolling_back");
    const [reserved] = await f.db
      .select()
      .from(npAgentChangesetExecutions)
      .where(eq(npAgentChangesetExecutions.rollbackPlanId, f.rollbackPlanId));
    expect(reserved.state).toBe("committed");
    const job = f.verifyJobs.find((item) => item.executionId === reserved.id);
    expect(job).toBeDefined();
    await f.service.processVerification(job!);
    const [verified] = await f.db
      .select()
      .from(npAgentChangesetExecutions)
      .where(eq(npAgentChangesetExecutions.id, reserved.id));
    expect(verified).toMatchObject({
      state: "succeeded",
      purpose: "rollback",
      verificationState: "passed",
    });
    const [plan] = await f.db
      .select()
      .from(npAgentChangesetRollbackPlans)
      .where(eq(npAgentChangesetRollbackPlans.id, f.rollbackPlanId));
    expect(plan).toMatchObject({
      state: "verified",
      resultDigest: verified.resultDigest,
      verificationDigest: verified.verificationDigest,
    });
    expect(await f.execution()).toEqual(original);
    expect((await f.service.getReview({ actor: f.actor, id: f.id })).changeSet.state).toBe(
      "rolled_back",
    );
  });
  it("keeps terminal evidence unchanged for unknown, missing observer, fingerprint mismatch and lost authority", async () => {
    const f = await failedInspectionFixture();
    await f.service.processVerification(f.job);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(await f.read()).toEqual(f.before);
    f.inspect.mockClear();
    const readResources = vi.fn(() => Promise.reject(new Error("must not read")));
    const base = {
      siteId,
      changeSetId: f.id,
      executionId: f.job.executionId,
      verificationFingerprint: f.before.row.verificationContractFingerprint,
      verifyConvergence: f.verifyConvergence,
      readResources,
    };
    await npVerifyChangeSetExecutionV1(base);
    await npVerifyChangeSetExecutionV1({
      ...base,
      verificationFingerprint: `cj1:sha256:${"B".repeat(43)}`,
      inspectPostCommitEffect: f.inspect,
    });
    expect(readResources).not.toHaveBeenCalled();
    expect(f.inspect).not.toHaveBeenCalled();
    await f.db
      .update(npUsers)
      .set({ role: "viewer" })
      .where(eq(npUsers.id, f.approver.actor.user.id));
    await grantSiteMembership(siteId, f.approver.actor.user.id, "viewer");
    await f.service.processVerification(f.job);
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.verifyConvergence).toHaveBeenCalledTimes(f.convergenceCalls);
    expect(await f.read()).toEqual(f.before);
  });

  it("rechecks current authority after inspection and discards confirmation after authority loss", async () => {
    const f = await failedInspectionFixture();
    f.inspect.mockImplementation(async () => {
      await f.db
        .update(npUsers)
        .set({ role: "viewer" })
        .where(eq(npUsers.id, f.approver.actor.user.id));
      await grantSiteMembership(siteId, f.approver.actor.user.id, "viewer");
      return "succeeded";
    });
    await f.service.processVerification(f.job);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(f.verifyConvergence).toHaveBeenCalledTimes(f.convergenceCalls);
    expect(await f.read()).toEqual(f.before);
  });

  it("lets only one concurrent inspection CAS record confirmation without changing terminal history", async () => {
    const f = await failedInspectionFixture();
    const resolvers: Array<(state: "succeeded" | "failed" | "unknown") => void> = [];
    f.inspect.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const first = f.service.processVerification(f.job),
      second = f.service.processVerification(f.job);
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[0]("succeeded");
    await vi.waitFor(async () =>
      expect((await f.read()).row.version).toBe(f.before.row.version + 1),
    );
    resolvers[1]("failed");
    await Promise.all([first, second]);
    const after = await f.read();
    expect(after.row.version).toBe(f.before.row.version + 1);
    expect(after.row.effects[0].state).toBe("succeeded");
    expect({ ...after.row, effects: f.before.row.effects, version: f.before.row.version }).toEqual(
      f.before.row,
    );
    expect(after.plan).toEqual(f.before.plan);
    expect(after.original).toEqual(f.before.original);
    expect(f.verifyConvergence).toHaveBeenCalledTimes(f.convergenceCalls);
  });
});
