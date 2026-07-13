import { beforeEach, describe, expect, it, vi } from "vitest";

const dbControl = vi.hoisted(() => ({
  releaseInsert: null as (() => void) | null,
  writes: [] as string[],
}));

vi.mock("../db/runtime.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => {
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
  beforeEach(() => {
    dbControl.releaseInsert = null;
    dbControl.writes.length = 0;
  });

  it("rejects malformed inputs before database or timer access", async () => {
    await expect(recordHeartbeat("", {})).rejects.toThrow("worker.id");
    await expect(countAliveWorkers("not-a-date" as never)).rejects.toThrow("worker.now");
    expect(() => startHeartbeatLoop({}, 0)).toThrow("worker.heartbeatIntervalMs");
    expect(() => startHeartbeatLoop({ invalid: undefined })).toThrow("worker.meta");
  });

  it("waits for an initial heartbeat before recording the final stopped state", async () => {
    const loop = startHeartbeatLoop({}, 60_000);
    const stopping = loop.stop();
    await vi.waitFor(() => expect(dbControl.releaseInsert).not.toBeNull());

    dbControl.releaseInsert?.();
    await stopping;

    expect(dbControl.writes).toEqual(["running", "stopped"]);
  });
});
