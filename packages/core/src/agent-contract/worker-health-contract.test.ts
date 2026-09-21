import { describe, expect, it } from "vitest";
import { npRequireAgentWorkerHealthV1 } from "./worker-health-contract.js";
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
