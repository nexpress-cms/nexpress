import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentChangesetExecutions,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npRequireAgentChangeSetExecutionOutputV1,
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  type NpAgentChangeSetCapabilityInvocationRequestV1,
} from "../../../packages/core/src/agent-contract/installed-capability-contract.js";
import { runtimeApprovalResumeFixture } from "./agent-runtime-approval-resume-fixture.js";
import { decideApproval } from "./agent-changeset-execution-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Runtime approved compensation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("prepares and separately approves rollback, executes once, and replays the exact receipt", async () => {
    const f = await runtimeApprovalResumeFixture("apply", { rollback: true });
    await f.approve();
    const first = await f.store.claimApproval({ ...f.input, requestActionId: f.requestActionId });
    if (!first.claim) throw new Error("Expected apply claim");
    const claimed = { ...f.input, claim: first.claim };
    const applied = await f.service.resumeRuntimeApproval({
      ...claimed,
      requestActionId: f.requestActionId,
      sequence: 5,
    });
    expect(
      npRequireAgentChangeSetExecutionOutputV1(applied.output).changeSet.execution?.state,
    ).toBe("succeeded");
    const invoke = async (input: unknown, sequence: number) =>
      npRequireAgentChangeSetExecutionOutputV1(
        (
          await f.service.invokeRuntimeCapability({
            ...claimed,
            sequence,
            request: npRequireAgentInstalledCapabilityInvocationRequestV1({
              schemaVersion: "np.agent-invocation-request.v1",
              capabilityId: "changeset.rollback",
              arguments: { input, idempotencyKey: randomUUID() },
            }) as NpAgentChangeSetCapabilityInvocationRequestV1,
          })
        ).output,
      );
    const prepared = await invoke({ mode: "prepare", changeSetId: f.required.changeSet.id }, 6);
    const rollback = prepared.changeSet.rollback;
    if (!rollback?.planHash) throw new Error("Expected prepared rollback");
    expect(rollback.state).toBe("ready");
    const requested = await invoke(
      {
        mode: "request_approval",
        changeSetId: f.required.changeSet.id,
        rollbackPlanId: rollback.rollbackPlanId,
        planHash: rollback.planHash,
      },
      7,
    );
    if (requested.state !== "approval_required") throw new Error("Expected compensation approval");
    await f.store.transition({ ...claimed, state: "waiting_approval" });
    const detail = await f.service.approvals!.get({
      siteId: f.input.siteId,
      actor: f.actor.actor,
      id: requested.approvalId,
    });
    await decideApproval(f.service.approvals!, f.actor, detail);
    const original = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.id, requested.actionId));
    const acquired = await f.store.claimApproval({
      ...f.input,
      requestActionId: requested.actionId,
    });
    if (!acquired.claim) throw new Error("Expected rollback claim");
    const resume = {
      ...f.input,
      claim: acquired.claim,
      requestActionId: requested.actionId,
      sequence: 8,
    };
    const executed = await f.service.resumeRuntimeApproval(resume);
    expect(
      npRequireAgentChangeSetExecutionOutputV1(executed.output).changeSet.rollback?.state,
    ).toBe("verified");
    expect(await f.service.resumeRuntimeApproval(resume)).toEqual(executed);
    expect(
      await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, requested.actionId)),
    ).toEqual(original);
    expect(
      await f.store.withClaim({ ...f.input, claim: acquired.claim }, (context) =>
        f.service.inspectRuntimeApproval(context, requested.actionId),
      ),
    ).toMatchObject({ status: "completed", executionSequence: 8 });
    const executions = await f.db
      .select()
      .from(npAgentChangesetExecutions)
      .where(eq(npAgentChangesetExecutions.changesetId, f.required.changeSet.id));
    expect(executions.map((row) => row.purpose).sort()).toEqual(["apply", "rollback"]);
    expect(executions.every((row) => row.state === "succeeded")).toBe(true);
    expect(
      await f.store.transition({ ...f.input, claim: acquired.claim, state: "succeeded" }),
    ).toEqual({
      state: "succeeded",
    });
  }, 90000);
});
