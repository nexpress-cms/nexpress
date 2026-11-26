import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAgentWorkerHealthV2 } from "@nexpress/core/agent-contract";
import type { NpAgentQueueBacklogV1 } from "@nexpress/core/jobs-contract";
import { NP_AGENT_WORKER_QUEUE_NAMES } from "@nexpress/core/jobs-contract";
const owners = vi.hoisted(() => ({ pause: vi.fn(), backlog: vi.fn(), workers: vi.fn() }));
vi.mock("@nexpress/core/agents", () => ({ npCollectAgentWorkerHealthV2: owners.workers }));
vi.mock("@nexpress/core/jobs", () => ({
  getJobsPauseState: owners.pause,
  npCollectAgentQueueBacklogV1: owners.backlog,
}));
import {
  collectOperatorWorkerObservation,
  diagnoseOperatorWorkerObservation,
} from "./operator-worker-observation";
const clock = "2026-10-01T00:00:00.000Z";
const thresholds = { staleAfterSeconds: 300, minimumPendingJobs: 2 };
function fixture() {
  const backlog: NpAgentQueueBacklogV1 = {
    schemaVersion: "np.agent-queue-backlog.v1",
    source: "pg-boss",
    generatedAt: clock,
    state: "observed",
    queues: NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
      queue,
      createdReady: 0,
      createdScheduled: 0,
      retryReady: 0,
      retryScheduled: 0,
      active: 0,
      oldestReadyAgeSeconds: null,
      oldestActiveAgeSeconds: null,
    })),
  };
  const workers: NpAgentWorkerHealthV2 = {
    schemaVersion: "np.agent-worker-health.v2",
    summary: {
      schemaVersion: "np.agent-worker-health.v1",
      generatedAt: clock,
      state: "observed",
      sampledWorkers: 1,
      hasMore: false,
      subscribedWorkers: 1,
      pausedWorkers: 0,
      inactiveWorkers: 0,
      staleWorkers: 0,
      stoppedWorkers: 0,
      unknownWorkers: 0,
    },
    queues: NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
      queue,
      subscribedWorkers: 1,
      pausedRegisteredWorkers: 0,
      staleRegisteredWorkers: 0,
      stoppedRegisteredWorkers: 0,
    })),
  };
  return { paused: false, backlog, workers };
}
// Versioned synthetic acceptance cases: observations never assert draining or dead workers.
describe("Operator worker evaluation fixtures v1", () => {
  it("distinguishes scheduled idle from due work and aged pending attention", () => {
    const input = fixture();
    input.backlog.queues[0].createdScheduled = 10;
    expect(diagnoseOperatorWorkerObservation(thresholds, input).classification).toBe("idle");
    Object.assign(input.backlog.queues[0], { createdReady: 2, oldestReadyAgeSeconds: 299 });
    expect(diagnoseOperatorWorkerObservation(thresholds, input).classification).toBe("observed");
    input.backlog.queues[0].oldestReadyAgeSeconds = 300;
    const result = diagnoseOperatorWorkerObservation(thresholds, input);
    expect(result.classification).toBe("attention");
    expect(result.checks[0]?.state).toBe("warn");
    expect(result.checks[0]?.detail?.length).toBeLessThanOrEqual(500);
    expect(result.facts).toMatchObject({ scheduled: 10, ready: 2, backlogObservedAt: clock });
  });
  it("keeps intentional pause distinct even when queue observations are unavailable", () => {
    expect(
      diagnoseOperatorWorkerObservation(thresholds, { paused: true, backlog: null, workers: null })
        .classification,
    ).toBe("paused");
    expect(
      diagnoseOperatorWorkerObservation(thresholds, { paused: null, backlog: null, workers: null })
        .facts.ready,
    ).toBeNull();
  });
  it("never calls a partial or legacy worker sample healthy", () => {
    const input = fixture();
    input.workers.summary.hasMore = true;
    expect(diagnoseOperatorWorkerObservation(thresholds, input).classification).toBe("unknown");
    input.workers.summary.hasMore = false;
    input.workers.summary.unknownWorkers = 1;
    expect(diagnoseOperatorWorkerObservation(thresholds, input).checks[0]?.state).toBe("warn");
  });
  it("does not combine a young large queue and unrelated old single job into threshold evidence", () => {
    const input = fixture();
    Object.assign(input.backlog.queues[0], { createdReady: 1, oldestReadyAgeSeconds: 900 });
    Object.assign(input.backlog.queues[1], { createdReady: 10, oldestReadyAgeSeconds: 10 });
    expect(diagnoseOperatorWorkerObservation(thresholds, input).classification).toBe("observed");
  });
});
describe("deployment observation authority and owners", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const input = fixture();
    owners.pause.mockResolvedValue({
      paused: false,
      reason: "PRIVATE",
      changedByUserId: "PRIVATE",
    });
    owners.backlog.mockResolvedValue(input.backlog);
    owners.workers.mockResolvedValue(input.workers);
  });
  const options = () => ({
    ...thresholds,
    authorize: vi.fn(async () => {}),
    abortSignal: new AbortController().signal,
  });
  it("reads actual owners only after authorization and returns only safe aggregate facts", async () => {
    const config = options();
    const result = await collectOperatorWorkerObservation(config);
    expect(config.authorize).toHaveBeenCalledTimes(2);
    expect(owners.workers).toHaveBeenCalledExactlyOnceWith();
    expect(owners.backlog).toHaveBeenCalledExactlyOnceWith();
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("withholds all observations if deployment authority is lost during reads", async () => {
    const config = options();
    config.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    await expect(collectOperatorWorkerObservation(config)).rejects.toThrow("revoked");
  });
  it("does not read after denial and treats failed owner reads as unknown", async () => {
    const config = options();
    config.authorize.mockRejectedValueOnce(new Error("denied"));
    await expect(collectOperatorWorkerObservation(config)).rejects.toThrow("denied");
    expect(owners.pause).not.toHaveBeenCalled();
    owners.pause.mockRejectedValueOnce(new Error("private backend error"));
    expect((await collectOperatorWorkerObservation(options())).classification).toBe("unknown");
  });
  it("honors cancellation before reads and does not expose a cancelled snapshot", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectOperatorWorkerObservation({ ...options(), abortSignal: controller.signal }),
    ).rejects.toThrow();
    expect(owners.backlog).not.toHaveBeenCalled();
    const during = new AbortController();
    owners.pause.mockImplementationOnce(() => {
      during.abort();
      return Promise.resolve({ paused: false });
    });
    await expect(
      collectOperatorWorkerObservation({ ...options(), abortSignal: during.signal }),
    ).rejects.toThrow();
  });
});
