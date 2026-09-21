import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyUtc,
  canonicalBodyInteger,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

export const NP_AGENT_BUDGET_HEALTH_SAMPLE_LIMIT = 25;

/** Aggregate measurement observations, never an admission or remaining-capacity decision. */
export interface NpAgentBudgetHealthV1 {
  schemaVersion: "np.agent-budget-health.v1";
  generatedAt: string;
  state: "observed" | "unavailable";
  sampledSites: number | null;
  hasMore: boolean | null;
  measuredSites: number | null;
  unresolvedUsageSites: number | null;
  unavailableSites: number | null;
}

export function npRequireAgentBudgetHealthV1(value: unknown): NpAgentBudgetHealthV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.budget.health", () => {
      const path = "agent.budget.health";
      const keys = [
        "schemaVersion",
        "generatedAt",
        "state",
        "sampledSites",
        "hasMore",
        "measuredSites",
        "unresolvedUsageSites",
        "unavailableSites",
      ];
      const row = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(value, path, 2048),
        path,
        keys,
        keys,
        { seen: new WeakSet() },
      );
      const invalid = (): never =>
        failCanonicalBody("invalid-field", path, "invalid budget measurement evidence");
      if (
        row.schemaVersion !== "np.agent-budget-health.v1" ||
        (row.state !== "observed" && row.state !== "unavailable")
      )
        return invalid();
      const count = (v: unknown) =>
        v === null ? null : canonicalBodyInteger(v, path, 0, NP_AGENT_BUDGET_HEALTH_SAMPLE_LIMIT);
      const result: NpAgentBudgetHealthV1 = {
        schemaVersion: "np.agent-budget-health.v1",
        generatedAt: canonicalBodyUtc(row.generatedAt, `${path}.generatedAt`),
        state: row.state,
        sampledSites: count(row.sampledSites),
        hasMore:
          row.hasMore === null ? null : typeof row.hasMore === "boolean" ? row.hasMore : invalid(),
        measuredSites: count(row.measuredSites),
        unresolvedUsageSites: count(row.unresolvedUsageSites),
        unavailableSites: count(row.unavailableSites),
      };
      const { sampledSites, measuredSites, unresolvedUsageSites, unavailableSites, hasMore } =
        result;
      if (result.state === "unavailable") {
        if (
          [sampledSites, measuredSites, unresolvedUsageSites, unavailableSites, hasMore].some(
            (v) => v !== null,
          )
        )
          invalid();
      } else if (
        sampledSites === null ||
        measuredSites === null ||
        unresolvedUsageSites === null ||
        unavailableSites === null ||
        hasMore === null ||
        measuredSites + unresolvedUsageSites + unavailableSites !== sampledSites ||
        (hasMore && sampledSites !== NP_AGENT_BUDGET_HEALTH_SAMPLE_LIMIT)
      )
        invalid();
      return result;
    }),
    "Invalid Agent budget measurement evidence",
  );
}
