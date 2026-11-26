import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentInvocations,
  npAgentOperatorExecutions,
  npAgentOperatorPlans,
} from "../../../packages/core/src/db/schema/agent.js";
import { operatorExecutionFixture, operatorRequest } from "./agent-operator-execution-fixture.js";
import { siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Approved Operator execution", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);
  it("requires real human approval and preserves the exact one-use result on replay", async () => {
    const f = await operatorExecutionFixture();
    const planned = await f.plan();
    expect(f.state.executions).toBe(0);
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    const review = await f.approvals.get({ siteId, actor: f.actor.actor, id: planned.approvalId });
    expect(review.actionReview).toMatchObject({
      capabilityId: "ops.execute",
      planId: planned.output.planId,
      operation: { action: "cache.revalidate", target: { kind: "site" } },
    });
    expect(JSON.stringify(review)).not.toContain("privatePath");
    await f.decide(planned.approvalId);
    const result = await f.invoke(planned.request);
    expect(result.output).toMatchObject({
      action: "cache.revalidate",
      state: "succeeded",
      verificationRefs: ["cache:fixture-applied"],
    });
    expect(await f.invoke(planned.request)).toEqual(result);
    expect(f.state.executions).toBe(1);
    const rows = await f.db.select().from(npAgentOperatorExecutions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: "succeeded",
      planId: planned.output.planId,
      invocationId: result.invocationId,
    });
    const [approval] = await f.db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.id, planned.approvalId));
    expect(approval.state).toBe("consumed");
    const [action] = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.id, rows[0].actionId));
    expect(action.state).toBe("succeeded");
    await expect(
      f.invoke({
        ...planned.request,
        arguments: { ...planned.request.arguments, idempotencyKey: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.executions).toBe(1);
  });
  it("rechecks requester, approver, policy and exact target before consuming approval", async () => {
    const f = await operatorExecutionFixture();
    const planned = await f.plan();
    await f.decide(planned.approvalId);
    for (const field of ["allowed", "approvalAllowed"] as const) {
      f.state[field] = false;
      await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "FORBIDDEN" });
      f.state[field] = true;
    }
    f.rules.capabilityModes = [
      { capabilityId: "ops.execute", mode: "observe" },
      { capabilityId: "ops.plan", mode: "approved" },
    ];
    await expect(f.invoke(planned.request)).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
    f.rules.capabilityModes = [
      { capabilityId: "ops.execute", mode: "approved" },
      { capabilityId: "ops.plan", mode: "approved" },
    ];
    await expect(
      f.invoke(
        operatorRequest("ops.execute", {
          ...planned.request.arguments.input,
          target: { kind: "navigation", location: "header" },
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.invoke(
        operatorRequest("ops.execute", {
          ...planned.request.arguments.input,
          planDigest: `cj1:sha256:${"B".repeat(43)}`,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.executions).toBe(0);
    expect(await f.db.select().from(npAgentOperatorExecutions)).toHaveLength(0);
    await f.decide(planned.approvalId, "revoke");
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.executions).toBe(0);
  });
  it("blocks expired or modified plans without exposing or executing the private artifact", async () => {
    const f = await operatorExecutionFixture();
    const planned = await f.plan();
    await f.decide(planned.approvalId);
    const [plan] = await f.db
      .select()
      .from(npAgentOperatorPlans)
      .where(eq(npAgentOperatorPlans.id, planned.output.planId));
    await f.db
      .update(npAgentOperatorPlans)
      .set({ artifactCanonical: { privatePath: "/private/tampered" } })
      .where(eq(npAgentOperatorPlans.id, plan.id));
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    await f.db
      .update(npAgentOperatorPlans)
      .set({ artifactCanonical: plan.artifactCanonical })
      .where(eq(npAgentOperatorPlans.id, plan.id));
    f.advance(3601);
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await f.approvals.reconcileExpired({ siteId })).toMatchObject({ expired: 1 });
    const [expired] = await f.db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.id, planned.approvalId));
    expect(expired.state).toBe("expired");
    expect(f.state.executions).toBe(0);
  });
  it("retains uncertain dispatch and never repeats an effect after an adapter exception", async () => {
    const f = await operatorExecutionFixture();
    const planned = await f.plan();
    await f.decide(planned.approvalId);
    f.state.fail = true;
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    f.state.fail = false;
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.invoke({
        ...planned.request,
        arguments: { ...planned.request.arguments, idempotencyKey: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.executions).toBe(1);
    const [journal] = await f.db.select().from(npAgentOperatorExecutions);
    expect(journal.state).toBe("unknown");
    expect(journal.resultCanonical).toBeNull();
  });
  it("serializes simultaneous execution requests around one durable dispatch", async () => {
    const f = await operatorExecutionFixture();
    const planned = await f.plan();
    await f.decide(planned.approvalId);
    const results = await Promise.allSettled([
      f.invoke(planned.request),
      f.invoke(planned.request),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(f.state.executions).toBe(1);
    expect(await f.db.select().from(npAgentOperatorExecutions)).toHaveLength(1);
    expect((await f.invoke(planned.request)).output).toMatchObject({ state: "succeeded" });
  });
  it("revalidates retained requester access and rejects altered request, output and private evidence", async () => {
    const f = await operatorExecutionFixture();
    const planned = await f.plan();
    await f.decide(planned.approvalId);
    const result = await f.invoke(planned.request);
    f.state.allowed = false;
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.state.allowed = true;
    const [invocation] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, result.invocationId));
    const [journal] = await f.db.select().from(npAgentOperatorExecutions);
    await f.db
      .update(npAgentInvocations)
      .set({
        requestBody: {
          ...invocation.requestBody,
          input: {
            ...invocation.requestBody.input,
            target: { kind: "navigation", location: "private" },
          },
        },
      })
      .where(eq(npAgentInvocations.id, invocation.id));
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    await f.db
      .update(npAgentInvocations)
      .set({ requestBody: invocation.requestBody, outputHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentInvocations.id, invocation.id));
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    await f.db
      .update(npAgentInvocations)
      .set({ outputHash: invocation.outputHash })
      .where(eq(npAgentInvocations.id, invocation.id));
    await f.db
      .update(npAgentOperatorExecutions)
      .set({ evidenceCanonical: { applied: false } })
      .where(eq(npAgentOperatorExecutions.id, journal.id));
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    await f.db
      .update(npAgentOperatorExecutions)
      .set({ evidenceCanonical: journal.evidenceCanonical })
      .where(eq(npAgentOperatorExecutions.id, journal.id));
    expect(await f.invoke(planned.request)).toEqual(result);
    expect(f.state.executions).toBe(1);
  });
  it("binds approval review checks to original evidence and rechecks the live direct-action budget", async () => {
    const f = await operatorExecutionFixture();
    const planned = await f.plan();
    const [plan] = await f.db
      .select()
      .from(npAgentOperatorPlans)
      .where(eq(npAgentOperatorPlans.id, planned.output.planId));
    const [invocation] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, plan.invocationId));
    await f.db
      .update(npAgentInvocations)
      .set({
        outputRedacted: {
          ...invocation.outputRedacted,
          checks: [{ id: "target.current-authority", status: "fail" }],
        },
      })
      .where(eq(npAgentInvocations.id, invocation.id));
    await expect(
      f.approvals.get({ siteId, actor: f.actor.actor, id: planned.approvalId }),
    ).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
    await f.db
      .update(npAgentInvocations)
      .set({ outputRedacted: invocation.outputRedacted })
      .where(eq(npAgentInvocations.id, invocation.id));
    await f.decide(planned.approvalId);
    f.budget.directActionsPerHour = 0;
    await expect(f.invoke(planned.request)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.plan()).rejects.toMatchObject({ code: "OPERATOR_BUDGET_BLOCKED" });
    expect(f.state.executions).toBe(0);
    expect(await f.db.select().from(npAgentOperatorExecutions)).toHaveLength(0);
  });
  it("retains confirmed failed and conflicted outcomes without retrying their effects", async () => {
    let outcome: "failed" | "conflicted" = "failed";
    let effects = 0;
    const f = await operatorExecutionFixture({
      execute: async () => {
        effects++;
        return {
          state: outcome,
          evidence: { verified: true },
          verificationRefs: ["cache:verified-no-success"],
        };
      },
    });
    for (const state of ["failed", "conflicted"] as const) {
      outcome = state;
      const planned = await f.plan();
      await f.decide(planned.approvalId);
      const result = await f.invoke(planned.request);
      expect(result.output).toMatchObject({ state });
      expect(await f.invoke(planned.request)).toEqual(result);
      const [journal] = await f.db
        .select()
        .from(npAgentOperatorExecutions)
        .where(eq(npAgentOperatorExecutions.planId, planned.output.planId));
      const [action] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.id, journal.actionId));
      expect(action).toMatchObject({
        state: "failed",
        errorCode: state === "failed" ? "OPERATOR_EXECUTION_FAILED" : "OPERATOR_EXECUTION_CONFLICT",
      });
    }
    expect(effects).toBe(2);
  });
});
