import { NP_AGENT_WORKER_QUEUE_NAMES } from "../jobs-contract/worker-subscription-contract.js";
import { describe, expect, it } from "vitest";
import {
  npRequireAgentWorkerHealthV1,
  npRequireAgentWorkerHealthV2,
} from "./worker-health-contract.js";
const sample = {
  schemaVersion: "np.agent-worker-health.v1",
  generatedAt: "2026-09-21T00:00:00.000Z",
  state: "observed",
  sampledWorkers: 6,
  hasMore: false,
  subscribedWorkers: 1,
  pausedWorkers: 1,
  inactiveWorkers: 1,
  staleWorkers: 1,
  stoppedWorkers: 1,
  unknownWorkers: 1,
};
const counts = [
  "sampledWorkers",
  "subscribedWorkers",
  "pausedWorkers",
  "inactiveWorkers",
  "staleWorkers",
  "stoppedWorkers",
  "unknownWorkers",
] as const;
describe("Agent worker aggregate contract", () => {
  it("preserves exclusive counts, observed empty samples and unavailable nulls", () => {
    expect(npRequireAgentWorkerHealthV1(sample)).toEqual(sample);
    const empty = { ...sample, ...Object.fromEntries(counts.map((key) => [key, 0])) };
    expect(npRequireAgentWorkerHealthV1(empty).sampledWorkers).toBe(0);
    const unavailable = {
      ...sample,
      state: "unavailable",
      hasMore: null,
      ...Object.fromEntries(counts.map((key) => [key, null])),
    };
    expect(npRequireAgentWorkerHealthV1(unavailable).sampledWorkers).toBeNull();
  });
  it("rejects contradictory totals, excess observations, malformed versions and private fields", () => {
    for (const invalid of [
      { ...sample, subscribedWorkers: 2 },
      { ...sample, state: "unavailable" },
      { ...sample, hasMore: null },
      { ...sample, hasMore: true },
      { ...sample, sampledWorkers: 101, unknownWorkers: 96 },
      { ...sample, workerId: "private-host" },
      { ...sample, schemaVersion: "np.agent-worker-health.v2" },
      { ...sample, generatedAt: "invalid" },
      { ...sample, pausedWorkers: -1 },
    ])
      expect(() => npRequireAgentWorkerHealthV1(invalid)).toThrow();
    expect(
      npRequireAgentWorkerHealthV1({
        ...sample,
        sampledWorkers: 100,
        unknownWorkers: 95,
        hasMore: true,
      }).hasMore,
    ).toBe(true);
  });
});

describe("Agent queue observation contract", () => {
  const queues = NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
    queue,
    subscribedWorkers: 1,
    pausedRegisteredWorkers: 1,
    staleRegisteredWorkers: 1,
    stoppedRegisteredWorkers: 1,
  }));
  const value = { schemaVersion: "np.agent-worker-health.v2", summary: sample, queues };
  it("accepts overlapping bounded per-queue counts while preserving the exact v1 summary", () => {
    const result = npRequireAgentWorkerHealthV2(value);
    expect(result).toEqual(value);
    expect(npRequireAgentWorkerHealthV1(result.summary)).toEqual(sample);
    expect(() => npRequireAgentWorkerHealthV1(result)).toThrow();
    const unavailable = {
      ...sample,
      state: "unavailable",
      hasMore: null,
      ...Object.fromEntries(counts.map((key) => [key, null])),
    };
    const unknownQueues = queues.map((queue) => ({
      ...queue,
      subscribedWorkers: null,
      pausedRegisteredWorkers: null,
      staleRegisteredWorkers: null,
      stoppedRegisteredWorkers: null,
    }));
    expect(
      npRequireAgentWorkerHealthV2({ ...value, summary: unavailable, queues: unknownQueues })
        .queues[0].subscribedWorkers,
    ).toBeNull();
    expect(() => npRequireAgentWorkerHealthV2({ ...value, summary: unavailable })).toThrow();
  });
  it("rejects missing, duplicated, unbounded, inconsistent and private queue evidence", () => {
    for (const invalid of [
      { ...value, workerId: "private-host" },
      { ...value, schemaVersion: "np.agent-worker-health.v3" },
      { ...value, queues: queues.slice(1) },
      { ...value, queues: [...queues].reverse() },
      { ...value, queues: queues.map(() => queues[0]) },
      { ...value, queues: queues.map((row) => ({ ...row, queue: "mail.send" })) },
      ...[null, -1, 1.5, 2, 101].map((count) => ({
        ...value,
        queues: queues.map((row) => ({ ...row, subscribedWorkers: count })),
      })),
      { ...value, queues: queues.map((row) => ({ ...row, subscribedWorkers: 0 })) },
      { ...value, queues: queues.map((row) => ({ ...row, pausedRegisteredWorkers: 0 })) },
      { ...value, queues: queues.map((row) => ({ ...row, payload: "private-payload" })) },
      { ...value, summary: { ...sample, unknownWorkers: 0 } },
    ])
      expect(() => npRequireAgentWorkerHealthV2(invalid)).toThrow();
  });
});
