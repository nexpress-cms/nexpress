import { isIP } from "node:net";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import {
  guardianAcceptanceCount,
  guardianAcceptanceTimeoutMs,
  guardianNetwork,
  guardianParallel,
  guardianQuantiles,
  guardianRequestBudgetV1,
  guardianRequestInputs,
} from "./agent-guardian-acceptance-fixture.js";

vi.mock("./harness.js", () => ({
  skipIfNoTestDb: () => true,
  getTestDb: () => Promise.reject(new Error("Fixture units cannot connect to a database")),
  seedUser: () => Promise.reject(new Error("Fixture units cannot seed a database")),
}));

describe("Guardian acceptance fixture cardinality and timing integrity (no source execution)", () => {
  it("constructs exactly10000 unique source identities across2000 five-observation actors", () => {
    const input = guardianRequestInputs("fixture", "2026-10-18T00:00:01.000Z");
    expect(input).toHaveLength(guardianAcceptanceCount);
    expect(new Set(input.map((item) => item.observationId)).size).toBe(10_000);
    const groups = new Map<string, number>();
    for (const item of input) {
      expect(isIP(item.networkAddress)).toBe(6);
      groups.set(item.networkAddress, (groups.get(item.networkAddress) ?? 0) + 1);
    }
    expect(groups.size).toBe(2000);
    expect([...groups.values()].every((count) => count === 5)).toBe(true);
  });
  it("keeps high-salt warmup/cap requests valid instead of silently bypassing source capture", () => {
    for (const salt of [0, 65_534, 65_535, 90_000, 100_000, 104_999])
      expect(isIP(guardianNetwork(salt))).toBe(6);
    const addresses = Array.from({ length: 10_000 }, (_, index) =>
      guardianNetwork(100_000 + index),
    );
    expect(new Set(addresses).size).toBe(10_000);
    expect(addresses.every((address) => isIP(address) === 6)).toBe(true);
  });
  for (const concurrency of [4, 64])
    it(`visits all10000 utility inputs exactly once with caller concurrency${concurrency}`, async () => {
      const values = Array.from({ length: 10_000 }, (_, index) => index);
      const seen = new Set<number>();
      let active = 0,
        peak = 0;
      await guardianParallel(values, concurrency, async (value) => {
        peak = Math.max(peak, ++active);
        if (seen.has(value)) throw new Error("Duplicate utility input");
        seen.add(value);
        await setImmediate();
        active--;
      });
      expect(seen.size).toBe(10_000);
      expect(peak).toBe(concurrency);
      expect(active).toBe(0);
    });
  it("uses an explicit nearest-rank p95 and rejects empty timing cohorts", () => {
    expect(() => guardianQuantiles([])).toThrow("empty");
    expect(guardianQuantiles(Array.from({ length: 1000 }, (_, index) => 1000 - index))).toEqual({
      samples: 1000,
      p50Ms: 500,
      p95Ms: 950,
      maxMs: 1000,
    });
  });
  it("freezes the declared budget, full workload and generous timeout before measured results", () => {
    expect(Object.isFrozen(guardianRequestBudgetV1)).toBe(true);
    expect(guardianRequestBudgetV1).toEqual({ absoluteMs: 5, baselineFraction: 0.05 });
    expect(guardianAcceptanceCount).toBe(10_000);
    expect(guardianAcceptanceTimeoutMs).toBe(600_000);
  });
});
