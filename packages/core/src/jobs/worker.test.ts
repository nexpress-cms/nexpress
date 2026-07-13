import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapterControl = vi.hoisted(() => ({
  startProducerError: null as Error | null,
  stopError: null as Error | null,
  instances: [] as unknown[],
}));

const pauseControl = vi.hoisted(() => ({
  error: null as Error | null,
}));

vi.mock("./pg-boss-adapter.js", () => {
  class MockPgBossAdapter {
    constructor() {
      adapterControl.instances.push(this);
    }

    startProducer(): Promise<void> {
      return adapterControl.startProducerError
        ? Promise.reject(adapterControl.startProducerError)
        : Promise.resolve();
    }

    start(): Promise<void> {
      return Promise.resolve();
    }

    scheduleRecurring(): Promise<void> {
      return Promise.resolve();
    }

    pauseProcessing(): Promise<void> {
      return Promise.resolve();
    }

    stop(): Promise<void> {
      return adapterControl.stopError
        ? Promise.reject(adapterControl.stopError)
        : Promise.resolve();
    }
  }

  return { PgBossAdapter: MockPgBossAdapter };
});

vi.mock("./pause-state.js", () => ({
  getJobsPauseState: () =>
    pauseControl.error
      ? Promise.reject(pauseControl.error)
      : Promise.resolve({
          paused: false,
          changedAt: new Date(0).toISOString(),
          changedByUserId: null,
          reason: null,
        }),
  startPauseSyncLoop: () => ({ stop: () => undefined }),
}));

import { getOptionalJobQueue, setJobQueue } from "./queue.js";
import { startProducer, startWorker, stopProducer, stopWorker } from "./worker.js";

describe("job worker and producer lifecycle", () => {
  beforeEach(() => {
    adapterControl.startProducerError = null;
    adapterControl.stopError = null;
    adapterControl.instances.length = 0;
    pauseControl.error = null;
    setJobQueue(null);
  });

  afterEach(async () => {
    adapterControl.stopError = null;
    await stopWorker();
    await stopProducer();
    setJobQueue(null);
  });

  it("rolls back a partial producer start so the next attempt can retry", async () => {
    adapterControl.startProducerError = new Error("database unavailable");
    await expect(startProducer("postgres://example.test/nexpress")).rejects.toThrow(
      "database unavailable",
    );
    expect(getOptionalJobQueue()).toBeNull();

    adapterControl.startProducerError = null;
    await startProducer("postgres://example.test/nexpress");
    expect(getOptionalJobQueue()).toBe(adapterControl.instances.at(-1));
    expect(adapterControl.instances).toHaveLength(2);
  });

  it("clears the singleton even when producer shutdown fails", async () => {
    await startProducer("postgres://example.test/nexpress");
    adapterControl.stopError = new Error("shutdown failed");

    await expect(stopProducer()).rejects.toThrow("shutdown failed");
    expect(getOptionalJobQueue()).toBeNull();

    adapterControl.stopError = null;
    await startProducer("postgres://example.test/nexpress");
    expect(adapterControl.instances).toHaveLength(2);
  });

  it("fails closed and unwinds startup when persisted pause state cannot be read", async () => {
    pauseControl.error = new Error("invalid persisted pause state");

    await expect(
      startWorker("postgres://example.test/nexpress", {
        heartbeat: false,
        installSignalHandlers: false,
      }),
    ).rejects.toThrow("invalid persisted pause state");
    expect(getOptionalJobQueue()).toBeNull();

    pauseControl.error = null;
    await startWorker("postgres://example.test/nexpress", {
      heartbeat: false,
      installSignalHandlers: false,
    });
    expect(getOptionalJobQueue()).toBe(adapterControl.instances.at(-1));
  });
});
