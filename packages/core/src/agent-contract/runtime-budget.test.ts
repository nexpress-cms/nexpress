import { describe, expect, it } from "vitest";
import { npCreateInheritedAgentBudgetV1 } from "./runtime-contract.js";
import { npAgentBudgetDimensionKeysV1, type NpAgentBudgetV1 } from "./wire-contract.js";
import {
  npAgentBudgetWindowsV1,
  npAnalyzeAgentBudgetResolutionV1,
  npComputeAgentModelCostMicrosV1,
  npRequireAgentBudgetNarrowingV1,
  npResolveAgentBudgetV1,
  npSelectAgentModelPricingV1,
} from "./runtime-budget.js";
import type { NpAgentModelPricingV1 } from "./types.js";

function budget(): NpAgentBudgetV1 {
  const result = npCreateInheritedAgentBudgetV1();
  for (const key of npAgentBudgetDimensionKeysV1) result[key] = 100;
  return result;
}

function pricing(): NpAgentModelPricingV1 {
  return {
    schemaVersion: "np.agent-model-pricing.v1",
    pricingId: "model-a",
    version: 1,
    fingerprint: `pr1:sha256:${"A".repeat(43)}`,
    modelId: "model-a",
    currency: "USD",
    unitTokens: 1_000_000,
    inputMicrosPerUnit: 3,
    cachedInputMicrosPerUnit: 1,
    outputMicrosPerUnit: 5,
    minimumRequestMicros: 0,
    rounding: "ceil-each-component",
    effectiveFrom: "2026-09-01T00:00:00.000Z",
    effectiveUntil: "2026-10-01T00:00:00.000Z",
  };
}

describe("Runtime budget inheritance and exact pricing", () => {
  it("requires concrete deployment ceilings, inherits nulls and never widens a dimension", () => {
    expect(npAnalyzeAgentBudgetResolutionV1(npCreateInheritedAgentBudgetV1()).ok).toBe(false);
    const deployment = budget();
    const site = npCreateInheritedAgentBudgetV1();
    site.maxConcurrentRuns = 5;
    site.incidentAnalysisCooldownSeconds = 300;
    site.warningBasisPoints = 7_000;
    const agent = npCreateInheritedAgentBudgetV1();
    agent.maxConcurrentRuns = 20;
    agent.providerCallsPerRun = 0;
    agent.incidentAnalysisCooldownSeconds = 200;
    agent.warningBasisPoints = 9_000;
    const result = npResolveAgentBudgetV1(deployment, [site, agent]);
    expect(result).toMatchObject({
      maxConcurrentRuns: 5,
      providerCallsPerRun: 0,
      incidentAnalysisCooldownSeconds: 300,
      warningBasisPoints: 7_000,
      inputTokensPerMonth: 100,
    });
    expect(npResolveAgentBudgetV1(deployment, [agent, site])).toEqual(result);
    expect(deployment.maxConcurrentRuns).toBe(100);
    expect(npAgentBudgetDimensionKeysV1).toHaveLength(19);
    expect(Object.keys(result).sort()).toEqual(
      [
        "schemaVersion",
        "costCurrency",
        ...npAgentBudgetDimensionKeysV1,
        "warningBasisPoints",
      ].sort(),
    );
  });

  it("rejects explicit creation-time widening, including shortened cooldown and deferred warnings", () => {
    const outer = budget();
    const inherited = npCreateInheritedAgentBudgetV1();
    expect(npRequireAgentBudgetNarrowingV1(outer, inherited)).toEqual(inherited);
    expect(() =>
      npRequireAgentBudgetNarrowingV1(outer, { ...inherited, maxConcurrentRuns: 101 }),
    ).toThrow();
    expect(() =>
      npRequireAgentBudgetNarrowingV1(outer, { ...inherited, incidentAnalysisCooldownSeconds: 99 }),
    ).toThrow();
    expect(() =>
      npRequireAgentBudgetNarrowingV1(outer, { ...inherited, warningBasisPoints: 8_001 }),
    ).toThrow();
    expect(
      npRequireAgentBudgetNarrowingV1(outer, {
        ...inherited,
        maxConcurrentRuns: 0,
        incidentAnalysisCooldownSeconds: 300,
      }).maxConcurrentRuns,
    ).toBe(0);
  });

  it("uses rolling hours and UTC calendar windows across month/year/leap boundaries", () => {
    expect(npAgentBudgetWindowsV1("2026-01-01T00:00:00.000Z")).toEqual({
      rollingHourStartedAt: "2025-12-31T23:00:00.000Z",
      utcDay: "2026-01-01",
      utcMonth: "2026-01",
    });
    expect(npAgentBudgetWindowsV1("2024-03-01T00:30:00.000Z").rollingHourStartedAt).toBe(
      "2024-02-29T23:30:00.000Z",
    );
    expect(() => npAgentBudgetWindowsV1("2026-09-11T09:00:00+09:00")).toThrow();
  });

  it("rounds components independently, accounts for cached input, and applies minimum charge", () => {
    expect(
      npComputeAgentModelCostMicrosV1({
        pricing: pricing(),
        inputTokens: 2,
        cachedInputTokens: 1,
        outputTokens: 1,
      }),
    ).toBe(3);
    expect(
      npComputeAgentModelCostMicrosV1({
        pricing: pricing(),
        inputTokens: 2_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(9);
    expect(
      npComputeAgentModelCostMicrosV1({
        pricing: { ...pricing(), minimumRequestMicros: 10 },
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(10);
    expect(
      npComputeAgentModelCostMicrosV1({
        pricing: { ...pricing(), inputMicrosPerUnit: Number.MAX_SAFE_INTEGER },
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(9_007_199_255);
  });

  it("fails closed on overflow, negative/fractional usage, invalid cache and currency", () => {
    const wrongCurrency = pricing();
    Object.defineProperty(wrongCurrency, "currency", { enumerable: true, value: "EUR" });
    expect(() =>
      npComputeAgentModelCostMicrosV1({
        pricing: wrongCurrency,
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toThrow();
    expect(() =>
      npComputeAgentModelCostMicrosV1({
        pricing: { ...pricing(), inputMicrosPerUnit: Number.MAX_SAFE_INTEGER },
        inputTokens: 2_147_483_647,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toThrow();
    for (const inputTokens of [-1, 0.5, 2_147_483_648])
      expect(() =>
        npComputeAgentModelCostMicrosV1({
          pricing: pricing(),
          inputTokens,
          cachedInputTokens: 0,
          outputTokens: 0,
        }),
      ).toThrow();
    expect(() =>
      npComputeAgentModelCostMicrosV1({
        pricing: pricing(),
        inputTokens: 1,
        cachedInputTokens: 2,
        outputTokens: 0,
      }),
    ).toThrow();
    expect(() =>
      npComputeAgentModelCostMicrosV1({
        pricing: { ...pricing(), cachedInputMicrosPerUnit: 4 },
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toThrow();
  });

  it("selects one exact model rule at half-open effective boundaries", () => {
    const rule = pricing();
    expect(
      npSelectAgentModelPricingV1({ catalog: [rule], model: "model-a", at: rule.effectiveFrom }),
    ).toEqual(rule);
    expect(() =>
      npSelectAgentModelPricingV1({
        catalog: [rule],
        model: "model-a",
        at: "2026-10-01T00:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      npSelectAgentModelPricingV1({ catalog: [rule], model: "model-b", at: rule.effectiveFrom }),
    ).toThrow();
    expect(() =>
      npSelectAgentModelPricingV1({
        catalog: [rule, { ...rule, pricingId: "overlap" }],
        model: "model-a",
        at: rule.effectiveFrom,
      }),
    ).toThrow();
    const next = {
      ...rule,
      version: 2,
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      effectiveUntil: null,
    };
    expect(
      npSelectAgentModelPricingV1({
        catalog: [rule, next],
        model: "model-a",
        at: next.effectiveFrom,
      }).version,
    ).toBe(2);
  });

  it("does not evaluate hostile getters in budget layers or pricing inputs", () => {
    let reads = 0;
    const layers = [budget()];
    Object.defineProperty(layers, "0", {
      enumerable: true,
      get() {
        reads += 1;
        return budget();
      },
    });
    expect(npAnalyzeAgentBudgetResolutionV1(budget(), layers).ok).toBe(false);
    const input = { pricing: pricing(), inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 };
    Object.defineProperty(input, "pricing", {
      enumerable: true,
      get() {
        reads += 1;
        return pricing();
      },
    });
    expect(() => npComputeAgentModelCostMicrosV1(input)).toThrow();
    expect(reads).toBe(0);
  });
});
