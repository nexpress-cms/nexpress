import { describe, expect, it } from "vitest";
import { npRequireAgentBudgetHealthV1 } from "./budget-health-contract.js";
const sample = {
  schemaVersion: "np.agent-budget-health.v1",
  generatedAt: "2026-09-21T00:00:00.000Z",
  state: "observed",
  sampledSites: 3,
  hasMore: false,
  measuredSites: 1,
  unresolvedUsageSites: 1,
  unavailableSites: 1,
};
describe("budget measurement evidence contract", () => {
  it("preserves mixed and empty measurements while unavailable has no numerical claims", () => {
    expect(npRequireAgentBudgetHealthV1(sample)).toEqual(sample);
    expect(
      npRequireAgentBudgetHealthV1({
        ...sample,
        sampledSites: 0,
        measuredSites: 0,
        unresolvedUsageSites: 0,
        unavailableSites: 0,
      }).measuredSites,
    ).toBe(0);
    expect(
      npRequireAgentBudgetHealthV1({
        ...sample,
        state: "unavailable",
        sampledSites: null,
        hasMore: null,
        measuredSites: null,
        unresolvedUsageSites: null,
        unavailableSites: null,
      }).measuredSites,
    ).toBeNull();
  });
  it("rejects contradictory counts, misleading truncation and private fields", () => {
    for (const invalid of [
      { ...sample, measuredSites: 2 },
      { ...sample, state: "unavailable" },
      { ...sample, hasMore: null },
      { ...sample, hasMore: true },
      { ...sample, sampledSites: 26, measuredSites: 24 },
      { ...sample, siteId: "secret-site" },
      { ...sample, generatedAt: "invalid" },
    ])
      expect(() => npRequireAgentBudgetHealthV1(invalid)).toThrow();
    expect(
      npRequireAgentBudgetHealthV1({
        ...sample,
        sampledSites: 25,
        measuredSites: 23,
        hasMore: true,
      }).hasMore,
    ).toBe(true);
  });
});
