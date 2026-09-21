import { beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  handlers: new Map<string, () => Promise<void>>(),
  start: vi.fn(),
  work: vi.fn(),
  offWork: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("./handlers.js", () => ({ getAllJobHandlers: () => control.handlers }));
vi.mock("../plugins/host.js", () => ({ getRegisteredPluginSchedules: () => [] }));
vi.mock("pg-boss", () => ({
  PgBoss: class {
    start = control.start;
    work = control.work;
    offWork = control.offWork;
    stop = control.stop;
    createQueue = vi.fn();
    updateQueue = vi.fn();
    getQueue = () => Promise.resolve({ policy: "stately" });
    getDb = () => ({ executeSql: vi.fn() });
  },
}));
import { PgBossAdapter } from "./pg-boss-adapter.js";

describe("adapter-owned Agent subscriptions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    control.handlers.clear();
    control.handlers.set("agent:eventDispatch", async () => {});
    control.handlers.set("agent:runExecute", async () => {});
  });
  const create = () => new PgBossAdapter("postgres://example.test/db");

  it("reports only completed work registrations and removes evidence during pause and stop", async () => {
    const adapter = create();
    control.work.mockImplementation(() => {
      expect(adapter.getWorkerSubscriptionEvidence().state).toBe("transitioning");
      expect(adapter.getWorkerSubscriptionEvidence().agentQueues).toEqual([]);
      return Promise.resolve();
    });
    await adapter.start();
    expect(adapter.getWorkerSubscriptionEvidence()).toEqual({
      schemaVersion: "np.worker-subscription.v1",
      state: "active",
      registeredAgentQueues: ["agent.eventDispatch", "agent.runExecute"],
      agentQueues: ["agent.eventDispatch", "agent.runExecute"],
    });
    control.offWork
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("partial pause"));
    await expect(adapter.pauseProcessing()).rejects.toThrow("partial pause");
    expect(adapter.getWorkerSubscriptionEvidence().state).toBe("unavailable");
    expect(adapter.getWorkerSubscriptionEvidence().agentQueues).toEqual([]);
    await adapter.pauseProcessing();
    expect(adapter.getWorkerSubscriptionEvidence().state).toBe("paused");
    expect(adapter.isProcessingPaused()).toBe(true);
    control.work
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("partial resume"));
    await expect(adapter.resumeProcessing()).rejects.toThrow("partial resume");
    expect(adapter.getWorkerSubscriptionEvidence().agentQueues).toEqual([]);
    expect(adapter.isProcessingPaused()).toBe(true);
    control.work.mockClear();
    await adapter.resumeProcessing();
    expect(control.work).toHaveBeenCalledTimes(1);
    expect(adapter.getWorkerSubscriptionEvidence().agentQueues).toHaveLength(2);
    control.stop.mockRejectedValueOnce(new Error("stop failure"));
    await expect(adapter.stop()).rejects.toThrow("stop failure");
    expect(adapter.getWorkerSubscriptionEvidence().state).toBe("stopped");
    expect(adapter.getWorkerSubscriptionEvidence().agentQueues).toEqual([]);
  });

  it("does not turn producer connections or failed starts into Agent evidence", async () => {
    const producer = create();
    await producer.startProducer();
    expect(producer.getWorkerSubscriptionEvidence()).toMatchObject({
      state: "producer",
      agentQueues: [],
      registeredAgentQueues: [],
    });
    expect(control.work).not.toHaveBeenCalled();
    const noAgentWorker = create();
    control.handlers.clear();
    await noAgentWorker.start();
    await noAgentWorker.pauseProcessing();
    expect(noAgentWorker.getWorkerSubscriptionEvidence()).toMatchObject({
      state: "paused",
      registeredAgentQueues: [],
      agentQueues: [],
    });
    control.handlers.set("agent:eventDispatch", async () => {});
    control.handlers.set("agent:runExecute", async () => {});
    const worker = create();
    control.work.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("work failed"));
    await expect(worker.start()).rejects.toThrow("work failed");
    expect(worker.getWorkerSubscriptionEvidence()).toMatchObject({
      state: "unavailable",
      agentQueues: [],
      registeredAgentQueues: ["agent.eventDispatch"],
    });
  });

  it("a delayed startup cannot restore positive evidence after stop", async () => {
    const adapter = create();
    let release: (() => void) | undefined;
    control.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const starting = adapter.start();
    await adapter.stop();
    release?.();
    await starting;
    expect(adapter.getWorkerSubscriptionEvidence()).toMatchObject({
      state: "stopped",
      agentQueues: [],
    });
  });
});
