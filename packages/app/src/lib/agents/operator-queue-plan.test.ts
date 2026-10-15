import { describe, expect, it, vi } from "vitest";
import type { NpAgentOperatorEventObservationV1 } from "@nexpress/core/agents";
const mocks = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("@nexpress/core/agents", () => ({
  npCollectAgentOperatorEventObservationV1: mocks.collect,
}));
import { collectOperatorQueuePlanV1 } from "./operator-queue-plan";
const observation = (): NpAgentOperatorEventObservationV1 => ({
  snapshot: {
    schemaVersion: "np.agent-operator-monitor-snapshot.v1",
    observedAt: "2026-10-15T00:00:00.000Z",
    complete: true,
    paused: false,
    queues: [{ name: "agent.runExecute", ready: 3, active: 1, oldestReadyAgeSeconds: 600 }],
    workers: [],
  },
  failures: [],
  failuresComplete: true,
});
const request = () => ({
  abortSignal: new AbortController().signal,
  input: {
    action: "queue.global.plan" as const,
    target: { kind: "queue" as const, operation: "drain" as const, jobName: "agent.runExecute" },
  },
});
describe("concrete local worker runbook planning", () => {
  it("uses exact measured queue facts and returns a local read-only runbook handoff", async () => {
    mocks.collect.mockResolvedValue(observation());
    const result = await collectOperatorQueuePlanV1(request());
    expect(result.contractId).toBe("runbook");
    expect(result.projectCommand).toBe(
      "pnpm --silent run ops:runbook -- worker-not-draining --json",
    );
    expect(result.artifact).toMatchObject({
      schemaVersion: "np.runbook.v1",
      runbook: "worker-not-draining",
      status: "attention",
      queueTarget: request().input.target,
      execution: "local-cli-handoff-only",
      evidence: [{ summary: { created: 3, active: 1, failed: 0 } }],
    });
    expect(JSON.stringify(result)).not.toMatch(/"applied":true|"executed":true/);
  });
  it("refuses absent selected targets, incomplete facts and aborted requests", async () => {
    const incomplete = observation();
    incomplete.snapshot.complete = false;
    mocks.collect.mockResolvedValue(incomplete);
    await expect(collectOperatorQueuePlanV1(request())).rejects.toThrow("unavailable");
    mocks.collect.mockResolvedValue(observation());
    await expect(
      collectOperatorQueuePlanV1({
        ...request(),
        input: { ...request().input, target: { ...request().input.target, jobName: "missing" } },
      }),
    ).rejects.toThrow("unavailable");
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectOperatorQueuePlanV1({ ...request(), abortSignal: controller.signal }),
    ).rejects.toThrow();
  });
});
