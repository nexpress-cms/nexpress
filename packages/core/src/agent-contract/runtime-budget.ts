import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUtc,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  cloneCanonicalRuntimeInput,
  parseAgentModelPricing,
  parseCanonicalAscii,
} from "./canonical-runtime-primitives.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  npAgentBudgetDimensionKeysV1,
  npRequireAgentBudgetV1,
  type NpAgentBudgetV1,
} from "./wire-contract.js";
import type {
  NpAgentBudgetSnapshotWindowsV1,
  NpAgentContractResult,
  NpAgentModelPricingV1,
} from "./types.js";

export type NpAgentConcreteBudgetV1 = {
  [K in keyof NpAgentBudgetV1]: Exclude<NpAgentBudgetV1[K], null>;
};

export function npAnalyzeAgentBudgetResolutionV1(
  deployment: unknown,
  layers: readonly unknown[] = [],
): NpAgentContractResult<NpAgentConcreteBudgetV1> {
  return analyzeCanonicalBody("agent.budgetResolution", () => {
    const result = npRequireAgentBudgetV1(deployment, {
      requireConcrete: true,
    }) as NpAgentConcreteBudgetV1;
    const layerValues = canonicalBodyArray(layers, "agent.budgetResolution.layers", 16, {
      seen: new WeakSet<object>(),
    });
    for (const value of layerValues) {
      const layer = npRequireAgentBudgetV1(value);
      for (const key of npAgentBudgetDimensionKeysV1) {
        const current = layer[key];
        if (current !== null) {
          // Cooldown is a minimum wait; a longer duration removes permissions.
          result[key] =
            key === "incidentAnalysisCooldownSeconds"
              ? Math.max(result[key], current)
              : Math.min(result[key], current);
        }
      }
      result.warningBasisPoints = Math.min(result.warningBasisPoints, layer.warningBasisPoints);
    }
    return result;
  });
}

export function npResolveAgentBudgetV1(
  deployment: unknown,
  layers: readonly unknown[] = [],
): NpAgentConcreteBudgetV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentBudgetResolutionV1(deployment, layers),
    "Invalid Agent budget resolution",
  );
}

/** Creation/activation rejects an explicit widening; live admission still intersects all ceilings. */
export function npRequireAgentBudgetNarrowingV1(outer: unknown, value: unknown): NpAgentBudgetV1 {
  const ceiling = npResolveAgentBudgetV1(outer);
  const layer = npRequireAgentBudgetV1(value);
  for (const key of npAgentBudgetDimensionKeysV1) {
    const current = layer[key];
    if (
      current !== null &&
      (key === "incidentAnalysisCooldownSeconds" ? current < ceiling[key] : current > ceiling[key])
    ) {
      failCanonicalBody(
        "invalid-field",
        `agent.budget.${key}`,
        "may only narrow the concrete outer budget",
      );
    }
  }
  if (layer.warningBasisPoints > ceiling.warningBasisPoints)
    failCanonicalBody(
      "invalid-field",
      "agent.budget.warningBasisPoints",
      "may not defer the outer warning threshold",
    );
  return layer;
}

export function npAgentBudgetWindowsV1(at: string): NpAgentBudgetSnapshotWindowsV1 {
  const capturedAt = canonicalBodyUtc(at, "agent.budget.at");
  return {
    rollingHourStartedAt: new Date(Date.parse(capturedAt) - 3_600_000).toISOString(),
    utcDay: capturedAt.slice(0, 10),
    utcMonth: capturedAt.slice(0, 7),
  };
}

export interface NpAgentModelCostInputV1 {
  pricing: NpAgentModelPricingV1;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** Exact v1 USD micros: ceil each uncached/cached/output component, then apply the minimum. */
export function npComputeAgentModelCostMicrosV1(input: NpAgentModelCostInputV1): number {
  const keys = ["pricing", "inputTokens", "cachedInputTokens", "outputTokens"];
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(input, "agent.pricing", 16 * 1024),
    "agent.pricing",
    keys,
    keys,
    { seen: new WeakSet<object>() },
  );
  const pricing = parseAgentModelPricing(row.pricing, "agent.pricing", {
    seen: new WeakSet<object>(),
  });
  const count = (value: unknown, path: string) =>
    canonicalBodyInteger(value, path, 0, 2_147_483_647);
  const inputTokens = count(row.inputTokens, "agent.pricing.inputTokens");
  const cachedInputTokens = count(row.cachedInputTokens, "agent.pricing.cachedInputTokens");
  const outputTokens = count(row.outputTokens, "agent.pricing.outputTokens");
  if (cachedInputTokens > inputTokens)
    failCanonicalBody(
      "invalid-field",
      "agent.pricing.cachedInputTokens",
      "cannot exceed total input tokens",
    );
  const unit = BigInt(pricing.unitTokens);
  const one = BigInt(1);
  const component = (tokens: number, price: number) =>
    (BigInt(tokens) * BigInt(price) + unit - one) / unit;
  const components =
    component(inputTokens - cachedInputTokens, pricing.inputMicrosPerUnit) +
    component(cachedInputTokens, pricing.cachedInputMicrosPerUnit) +
    component(outputTokens, pricing.outputMicrosPerUnit);
  const minimum = BigInt(pricing.minimumRequestMicros);
  const result = components > minimum ? components : minimum;
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    failCanonicalBody("limit", "agent.pricing.costMicros", "exceeds exact safe-integer USD micros");
  return Number(result);
}

export function npSelectAgentModelPricingV1(input: {
  catalog: readonly NpAgentModelPricingV1[];
  model: string;
  at: string;
}): NpAgentModelPricingV1 {
  const keys = ["catalog", "model", "at"];
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(input, "agent.pricing.selection", 256 * 1024),
    "agent.pricing.selection",
    keys,
    keys,
    { seen: new WeakSet<object>() },
  );
  const model = parseCanonicalAscii(row.model, "agent.pricing.model", 128);
  const at = canonicalBodyUtc(row.at, "agent.pricing.at");
  const state = { seen: new WeakSet<object>() };
  const catalog = canonicalBodyArray(row.catalog, "agent.pricing.catalog", 256, state).map(
    (entry, index) => parseAgentModelPricing(entry, `agent.pricing.catalog[${index}]`, state),
  );
  const matches = catalog.filter(
    (rule) =>
      rule.modelId === model &&
      rule.effectiveFrom <= at &&
      (rule.effectiveUntil === null || at < rule.effectiveUntil),
  );
  if (matches.length !== 1)
    failCanonicalBody(
      "invalid-field",
      "agent.pricing.catalog",
      "must select exactly one effective rule for the exact model",
    );
  return matches[0];
}
