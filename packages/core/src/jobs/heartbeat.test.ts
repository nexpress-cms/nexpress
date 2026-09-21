import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbControl = vi.hoisted(() => ({
  releaseInsert: null as (() => void) | null,
  writes: [] as string[],
  metadata: [] as Record<string, unknown>[],
  immediate: false,
}));

vi.mock("../db/runtime.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: (value: { meta: Record<string, unknown> }) => ({
        onConflictDoUpdate: async () => {
          dbControl.metadata.push(value.meta);
          if (!dbControl.immediate)
            await new Promise<void>((resolve) => {
              dbControl.releaseInsert = resolve;
            });
          dbControl.writes.push("running");
        },
      }),
    }),
    update: () => ({
      set: (value: { status: string }) => ({
        where: () => {
          dbControl.writes.push(value.status);
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

import { countAliveWorkers, recordHeartbeat, startHeartbeatLoop } from "./heartbeat.js";

describe("worker heartbeat runtime boundary", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    dbControl.releaseInsert = null;
    dbControl.writes.length = 0;
    dbControl.metadata.length = 0;
    dbControl.immediate = false;
  });

  it("rejects malformed inputs before database or timer access", async () => {
    await expect(recordHeartbeat("", {})).rejects.toThrow("worker.id");
    await expect(countAliveWorkers("not-a-date" as never)).rejects.toThrow("worker.now");
    expect(() => startHeartbeatLoop({}, 0)).toThrow("worker.heartbeatIntervalMs");
    expect(() => startHeartbeatLoop({ invalid: undefined })).toThrow("worker.meta");
    const getter = vi.fn(() => ({}));
    const forged = Object.defineProperty({}, "npWorkerSubscription", {
      get: getter,
      enumerable: true,
    });
    await expect(recordHeartbeat("test", forged)).rejects.toThrow("worker.meta");
    expect(() => startHeartbeatLoop(forged)).toThrow("worker.meta");
    expect(getter).not.toHaveBeenCalled();
    await expect(recordHeartbeat("test", Object.create({ inherited: true }))).rejects.toThrow(
      "worker.meta",
    );
  });

  it("waits for an initial heartbeat before recording the final stopped state", async () => {
    const loop = startHeartbeatLoop({}, 60_000);
    const stopping = loop.stop();
    await vi.waitFor(() => expect(dbControl.releaseInsert).not.toBeNull());

    dbControl.releaseInsert?.();
    await stopping;

    expect(dbControl.writes).toEqual(["running", "stopped"]);
  });

  it("strips host and public claims and refreshes only validated owner evidence each beat", async () => {
    vi.useFakeTimers();
    dbControl.immediate = true;
    dbControl.metadata.length = 0;
    const claim = {
      schemaVersion: "np.worker-subscription.v1",
      state: "active",
      registeredAgentQueues: ["agent.runExecute"],
      agentQueues: ["agent.runExecute"],
    };
    await recordHeartbeat("test-worker", { npWorkerSubscription: claim, hostLabel: "kept" });
    expect(dbControl.metadata.at(-1)).toEqual({ hostLabel: "kept" });
    const noSource = startHeartbeatLoop({ npWorkerSubscription: claim }, 1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(dbControl.metadata.at(-1)).toEqual({});
    await noSource.stop();
    const source = vi.fn<() => unknown>().mockReturnValue(claim);
    const loop = startHeartbeatLoop({ npWorkerSubscription: claim }, 1_000, source);
    await vi.advanceTimersByTimeAsync(0);
    expect(dbControl.metadata.at(-1)?.npWorkerSubscription).toEqual(claim);
    source.mockReturnValue({ ...claim, state: "paused", agentQueues: [] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dbControl.metadata.at(-1)?.npWorkerSubscription).toMatchObject({
      state: "paused",
      agentQueues: [],
    });
    source.mockImplementation(() => {
      throw new Error("source unavailable");
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dbControl.metadata.at(-1)).toEqual({});
    await loop.stop();
    const count = dbControl.metadata.length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dbControl.metadata).toHaveLength(count);
    vi.useRealTimers();
  });
});
