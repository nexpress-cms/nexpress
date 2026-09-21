import {
  NP_AGENT_BUDGET_HEALTH_SAMPLE_LIMIT,
  npRequireAgentBudgetHealthV1,
  type NpAgentBudgetHealthV1,
} from "@nexpress/core/agent-contract";

export const agentBudgetLimits = [
  `Evidence covers the first ${NP_AGENT_BUDGET_HEALTH_SAMPLE_LIMIT.toString()} configured sites in stable order, or all configured sites when fewer exist. Counts describe only that sample.`,
  "Measured sites confirmed known usage and completed budget measurement under the existing quota and control locks. This does not establish remaining capacity or admission readiness.",
  "Unresolved usage means usage is not yet known. Unavailable means the measurement could not be completed; neither is a zero-usage result.",
  "These are site counts, not token usage, spend or remaining budget. No site identities or per-site amounts are exposed.",
  "This evidence does not authorize activation or change budget policy.",
] as const;

export function buildAgentBudgetPresentation(value: NpAgentBudgetHealthV1) {
  const summary = npRequireAgentBudgetHealthV1(value);
  const count = (value: number | null) => (value === null ? "Unknown" : value.toString());
  return {
    generatedAt: summary.generatedAt,
    rows: [
      { label: "Observation", value: summary.state },
      { label: "Sampled configured sites", value: count(summary.sampledSites) },
      {
        label: "More configured sites outside sample",
        value: summary.hasMore === null ? "Unknown" : summary.hasMore ? "Yes" : "No",
      },
      { label: "Successfully measured sites", value: count(summary.measuredSites) },
      { label: "Sites with unresolved usage", value: count(summary.unresolvedUsageSites) },
      { label: "Sites with unavailable measurement", value: count(summary.unavailableSites) },
    ],
  };
}

export function formatAgentBudgetDetail(summary: NpAgentBudgetHealthV1): string {
  const view = buildAgentBudgetPresentation(summary);
  return [
    "Agent budget measurement evidence",
    `Snapshot ${view.generatedAt}`,
    ...view.rows.map((row) => `${row.label}: ${row.value}`),
    ...agentBudgetLimits,
  ].join("\n");
}
