import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npAgentActions, npAgentPrincipals } from "../../../packages/core/src/db/schema/agent.js";
import { runtimeApprovalResumeFixture } from "./agent-runtime-approval-resume-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const cleanups: Array<() => Promise<void>> = [];
async function executorFixture(operation: "apply" | "schedule" = "apply") {
  const f = await runtimeApprovalResumeFixture(operation, { provider: true });
  cleanups.push(f.dispose);
  if (!f.processor) throw new Error("Expected explicit Runtime executor");
  return { ...f, processor: f.processor };
}

describe.skipIf(skipIfNoTestDb())("explicit Runtime approval resumption", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const dispose of cleanups.splice(0)) await dispose();
  });
  afterAll(closeTestDb);

  it("leaves pending approval unclaimed and ordinary process cannot call a provider", async () => {
    const f = await executorFixture();
    const before = await f.run();
    expect(await f.store.claimApproval({ ...f.input, requestActionId: f.requestActionId })).toEqual(
      { state: "waiting_approval", claim: null },
    );
    expect((await f.run()).attempt).toBe(before.attempt);
    expect(await f.processor.process(f.input)).toEqual({ state: "waiting_approval" });
    expect(f.providerInvoke).not.toHaveBeenCalled();
  });
  it("resumes through real execution, obtains one planner completion and replays the terminal receipt", async () => {
    const f = await executorFixture();
    await f.approve();
    const before = await f.requestAction();
    const input = { ...f.input, requestActionId: f.requestActionId };
    expect(await f.processor.resumeApproval(input)).toEqual({ state: "succeeded" });
    expect(f.providerInvoke).toHaveBeenCalledTimes(1);
    expect(await f.requestAction()).toEqual(before);
    const actions = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.runId, f.input.runId));
    expect(actions).toHaveLength(5);
    expect(await f.processor.resumeApproval(input)).toEqual({ state: "succeeded" });
    expect(f.providerInvoke).toHaveBeenCalledTimes(1);
    expect(
      await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, f.input.runId)),
    ).toEqual(actions);
  });
  it("executes the approved request as a distinct action and keeps its request immutable", async () => {
    const f = await runtimeApprovalResumeFixture();
    const before = await f.requestAction();
    await f.approve();
    const acquired = await f.store.claimApproval({
      ...f.input,
      requestActionId: f.requestActionId,
    });
    if (!acquired.claim) throw new Error("Expected approved claim");
    const claimed = { ...f.input, claim: acquired.claim };
    await expect(f.store.withClaim(f.claimed, () => Promise.resolve())).rejects.toThrow();
    const executed = await f.service.resumeRuntimeApproval({
      ...claimed,
      requestActionId: f.requestActionId,
      sequence: 5,
    });
    const replay = await f.service.resumeRuntimeApproval({
      ...claimed,
      requestActionId: f.requestActionId,
      sequence: 5,
    });
    expect(replay).toEqual(executed);
    expect(await f.requestAction()).toEqual(before);
    const receipt = await f.store.withClaim(claimed, (context) =>
      f.service.inspectRuntimeApproval(context, f.requestActionId),
    );
    expect(receipt).toMatchObject({
      status: "completed",
      requestActionId: f.requestActionId,
      executionSequence: 5,
    });
    expect(receipt.executionActionId).not.toBe(f.requestActionId);
    expect(await f.store.transition({ ...claimed, state: "succeeded" })).toEqual({
      state: "succeeded",
    });
    expect(await f.store.claimApproval({ ...f.input, requestActionId: f.requestActionId })).toEqual(
      { state: "succeeded", claim: null },
    );
    expect(
      await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, f.input.runId)),
    ).toHaveLength(5);
  });
  it("allows a bounded retry after the immutable approval request is fulfilled", async () => {
    const f = await runtimeApprovalResumeFixture();
    await f.approve();
    const acquired = await f.store.claimApproval({
      ...f.input,
      requestActionId: f.requestActionId,
    });
    if (!acquired.claim) throw new Error("Expected approved claim");
    const claimed = { ...f.input, claim: acquired.claim };
    await f.service.resumeRuntimeApproval({
      ...claimed,
      requestActionId: f.requestActionId,
      sequence: 5,
    });
    expect(
      await f.store.waitRetry({
        ...claimed,
        retryAt: new Date(f.options.now().getTime() + 1_000).toISOString(),
      }),
    ).toEqual({ state: "waiting_retry" });
    f.advance(2);
    expect((await f.store.claim(f.input)).claim).not.toBeNull();
  });
  it("claims only once under concurrent explicit resumes", async () => {
    const f = await runtimeApprovalResumeFixture();
    await f.approve();
    const claims = await Promise.all(
      [1, 2].map(() => f.store.claimApproval({ ...f.input, requestActionId: f.requestActionId })),
    );
    expect(claims.filter((result) => result.claim !== null)).toHaveLength(1);
  });
  it("rejects a missing or unrelated approval action without changing the Run", async () => {
    const f = await runtimeApprovalResumeFixture();
    await f.approve();
    const before = await f.run();
    await expect(
      f.store.claimApproval({ ...f.input, requestActionId: randomUUID() }),
    ).rejects.toThrow();
    expect(await f.run()).toEqual(before);
  });
  it("checks live principal revocation before claiming an approved request", async () => {
    const f = await runtimeApprovalResumeFixture();
    await f.approve();
    const before = await f.run();
    await f.db
      .update(npAgentPrincipals)
      .set({ status: "suspended" })
      .where(eq(npAgentPrincipals.id, before.principalId));
    await expect(
      f.store.claimApproval({ ...f.input, requestActionId: f.requestActionId }),
    ).rejects.toThrow();
    expect(await f.run()).toEqual(before);
  });
  it("retains scheduled execution as verifying with zero provider calls", async () => {
    const f = await executorFixture("schedule");
    await f.approve();
    expect(
      await f.processor.resumeApproval({ ...f.input, requestActionId: f.requestActionId }),
    ).toEqual({ state: "verifying" });
    expect((await f.run()).state).toBe("verifying");
    expect(f.providerInvoke).not.toHaveBeenCalled();
    expect(f.applyJobs).toHaveLength(1);
  });
});
