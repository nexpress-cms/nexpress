import {
  npRequireAgentHealthSummaryV1,
  type NpAgentHealthSummaryV1,
} from "@nexpress/core/agent-contract";

export const agentHealthLimits = [
  "Worker heartbeat and queue consumer liveness are not measured by this snapshot.",
  "Usage record counts do not measure token usage, spend or remaining budget.",
  "Retention readiness and last maintenance completion are not measured by this snapshot.",
  "Record age is measured at snapshot generation; it is not a stale threshold or time in the current state.",
] as const;

export function agentHealthAge(seconds: number | null, empty = false): string {
  return empty ? "No records" : seconds === null ? "Unknown" : `${seconds.toString()} s`;
}

/** One validated, aggregate-only presentation for the Health page and Doctor. */
export function buildAgentHealthPresentation(value: NpAgentHealthSummaryV1) {
  const summary = npRequireAgentHealthSummaryV1(value);
  return {
    generatedAt: summary.generatedAt,
    state: summary.state,
    issueCount: summary.issueCount,
    readiness: [
      { label: "Providers", ...summary.readiness.providers },
      { label: "Vault", ...summary.readiness.vault },
    ],
    issues: summary.issues,
    states: summary.states,
  };
}

export function formatAgentHealthDetail(summary: NpAgentHealthSummaryV1): string {
  const view = buildAgentHealthPresentation(summary);
  return [
    `Snapshot ${view.generatedAt} · ${view.issueCount.toString()} blocking issue(s)`,
    ...view.readiness.map(
      (row) =>
        `${row.label}: ${row.state} · required ${row.requiredCount.toString()} · available ${row.availableCount.toString()}`,
    ),
    ...(view.issues.length
      ? view.issues.map(
          (row) =>
            `${row.code}: ${row.count.toString()} · oldest ${agentHealthAge(row.oldestAgeSeconds)}`,
        )
      : ["No blocking issues reported."]),
    ...(view.states.length
      ? view.states.map(
          (row) =>
            `${row.entity} / ${row.state}: ${row.count.toString()} · oldest ${agentHealthAge(row.oldestAgeSeconds, row.count === 0)}`,
        )
      : ["No state counts returned. This does not establish runtime availability."]),
    ...agentHealthLimits,
  ].join("\n");
}
