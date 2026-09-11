import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentMcpTaskServiceV1 } from "../../../packages/core/src/agent/mcp-task-service.js";
import {
  npAgentMcpTasks,
  npAgentInvocations,
  npAgentRuns,
  npAgentChangesetExecutions,
} from "../../../packages/core/src/db/schema/agent.js";
import { npRequireAgentChangeSetExecutionOutputV1 } from "../../../packages/core/src/agent-contract/installed-capability-contract.js";
import {
  gatewayExecutionFixture,
  gatewayExecutionRequest,
  readyGatewayExecution,
  approveGatewayExecution,
} from "./agent-changeset-gateway-execution-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Gateway durable MCP execution task", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it.each(["stdio", "mcp-http"] as const)(
    "binds %s approval/result and atomically cancels scheduled work",
    async (transport) => {
      const f = await gatewayExecutionFixture("approved-execute", "schedule", {
        transport,
        tasks: ({ admission, getService, now }) =>
          createAgentMcpTaskServiceV1({
            admission,
            now,
            cursorKey: { id: "gateway-task", key: new Uint8Array(32).fill(53) },
            refreshInvocation: (input) => getService().refreshGatewayInvocation(input),
            cancelInTransaction: (input) => getService().cancelGatewayInvocation(input),
          }),
      });
      const tasks = f.principal.tasks!;
      const authentication = f.principal.authentication;
      const plan = await readyGatewayExecution(f);
      const proposed = gatewayExecutionRequest("changeset.schedule", {
        changeSetId: plan.id,
        planHash: plan.planHash,
        approvalId: null,
        scheduledFor: f.executionCommand.scheduledFor,
      });
      const invoke = (request: typeof proposed, taskRequest?: { requestedTtlMs: number | null }) =>
        f.service.invokeCapability({
          authentication,
          request,
          ...(taskRequest ? { taskRequest } : {}),
        });
      const first = await invoke(proposed, { requestedTtlMs: null });
      expect(first.task?.status).toBe("working");
      const output = npRequireAgentChangeSetExecutionOutputV1(first.output);
      if (output.state !== "approval_required") throw new Error("Expected approval");
      const [invocation] = await f.db
        .select()
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.id, first.invocationId));
      const [task] = await f.db
        .select()
        .from(npAgentMcpTasks)
        .where(eq(npAgentMcpTasks.invocationId, first.invocationId));
      expect(invocation).toMatchObject({
        mcpExecutionMode: "task",
        mcpRequestedTaskTtlMs: 3600000,
        runId: output.runId,
      });
      expect(task).toMatchObject({
        runId: output.runId,
        status: "completed",
        requestedTtlMs: null,
      });
      const frozen = await tasks.result(authentication, task.id);
      expect(frozen).toMatchObject({ kind: "tool_result", result: { structuredContent: output } });
      expect((await invoke(proposed, { requestedTtlMs: null })).task).toMatchObject({
        taskId: task.id,
        status: "completed",
      });
      await expect(invoke(proposed)).rejects.toThrow();
      await expect(invoke(proposed, { requestedTtlMs: 60000 })).rejects.toThrow();
      await approveGatewayExecution(f, output.approvalId);
      const execute = gatewayExecutionRequest("changeset.schedule", {
        ...proposed.arguments.input,
        approvalId: output.approvalId,
      });
      const scheduled = await invoke(execute, { requestedTtlMs: 60000 });
      expect(scheduled.task?.status).toBe("working");
      expect(npRequireAgentChangeSetExecutionOutputV1(scheduled.output).state).toBe("accepted");
      expect((await tasks.cancel(authentication, scheduled.task!.taskId)).status).toBe("cancelled");
      const [execution] = await f.db
        .select()
        .from(npAgentChangesetExecutions)
        .where(eq(npAgentChangesetExecutions.invocationId, scheduled.invocationId));
      expect(execution).toMatchObject({
        state: "failed",
        committedAt: null,
        errorCode: "EXECUTION_CANCELLED",
      });
      const [run] = await f.db
        .select()
        .from(npAgentRuns)
        .where(eq(npAgentRuns.invocationId, scheduled.invocationId));
      expect(run.state).toBe("cancelled");
      expect(await tasks.result(authentication, task.id)).toEqual(frozen);
      await expect(tasks.cancel(authentication, scheduled.task!.taskId)).rejects.toThrow();
      expect(await f.seo()).toBeUndefined();
    },
    90_000,
  );
});
