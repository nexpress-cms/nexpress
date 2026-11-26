import { describe, expect, it, vi } from "vitest";
import {
  npRequireAgentQueueBacklogV1,
  type NpAgentQueueBacklogV1,
} from "./agent-queue-backlog-contract.js";
import { NP_AGENT_WORKER_QUEUE_NAMES } from "./worker-subscription-contract.js";

function snapshot(): NpAgentQueueBacklogV1 {
  return {
    schemaVersion: "np.agent-queue-backlog.v1",
    source: "pg-boss",
    state: "observed",
    generatedAt: "2026-09-23T00:00:00.000Z",
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
}

describe("Agent retained queue backlog contract", () => {
  it("preserves empty versus unavailable and validates count/age evidence without sharing inputs", () => {
    const input = snapshot();
    input.queues[0] = {
      ...input.queues[0],
      createdReady: 2,
      retryReady: 1,
      active: 3,
      oldestReadyAgeSeconds: 60,
      oldestActiveAgeSeconds: 0,
    };
    const output = npRequireAgentQueueBacklogV1(input);
    expect(output).toEqual(input);
    expect(output.queues[0]).not.toBe(input.queues[0]);
    for (const state of ["unsupported", "unavailable"] as const) {
      const unknown = {
        ...snapshot(),
        state,
        queues: snapshot().queues.map((q) => ({
          queue: q.queue,
          createdReady: null,
          createdScheduled: null,
          retryReady: null,
          retryScheduled: null,
          active: null,
          oldestReadyAgeSeconds: null,
          oldestActiveAgeSeconds: null,
        })),
      };
      expect(npRequireAgentQueueBacklogV1(unknown)).toEqual(unknown);
      expect(() => npRequireAgentQueueBacklogV1({ ...input, state })).toThrow();
    }
    for (const row of [
      { ...input.queues[0], active: null },
      { ...input.queues[0], active: -1 },
      { ...input.queues[0], retryReady: 0.5 },
      { ...input.queues[0], active: Number.MAX_SAFE_INTEGER + 1 },
      { ...input.queues[0], oldestReadyAgeSeconds: null },
      { ...input.queues[0], oldestActiveAgeSeconds: null },
      { ...snapshot().queues[0], oldestReadyAgeSeconds: 0 },
      { ...snapshot().queues[0], oldestActiveAgeSeconds: 0 },
    ])
      expect(() =>
        npRequireAgentQueueBacklogV1({ ...input, queues: [row, ...input.queues.slice(1)] }),
      ).toThrow();
  });

  it("rejects private fields, ambiguous queues, unsupported versions and hostile objects", () => {
    const input = snapshot();
    const getter = vi.fn(() => input.state);
    const accessor = { ...input };
    Object.defineProperty(accessor, "state", { get: getter, enumerable: true });
    for (const invalid of [
      accessor,
      { ...input, schemaVersion: "np.agent-queue-backlog.v2" },
      { ...input, source: "custom" },
      { ...input, state: "healthy" },
      { ...input, state: ["observed"] },
      { ...input, generatedAt: "2026-02-30T00:00:00.000Z" },
      { ...input, payload: "private" },
      { ...input, queues: input.queues.slice(1) },
      { ...input, queues: [...input.queues].reverse() },
      { ...input, queues: [{ ...input.queues[0], jobId: "private" }, ...input.queues.slice(1)] },
      {
        ...input,
        queues: [{ ...input.queues[0], queue: "agent.custom" }, ...input.queues.slice(1)],
      },
      { ...input, queues: [input.queues[1], ...input.queues.slice(1)] },
      Object.assign(Object.create({ inherited: true }), input),
      { ...input, [Symbol("extra")]: true },
    ])
      expect(() => npRequireAgentQueueBacklogV1(invalid)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
