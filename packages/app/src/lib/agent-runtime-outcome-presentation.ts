import { npRequireAgentRuntimeOutcomeV1 } from "@nexpress/core/agent-contract";

export const agentRuntimeOutcomeLimits = [
  "Host-wide Runtime Run records across all sites. Recent outcomes include only retained records finished within the displayed 24-hour window; removed history is not counted.",
  "Current unfinished counts are not limited to that window. Deadline elapsed means the stored deadline is at or before this snapshot. Lease elapsed and lease not recorded cover running or verifying records only; these counts can overlap with deadline elapsed.",
  "A Runtime outcome is not a queue-job outcome or proof of external provider effects. Lease and deadline facts do not prove a stuck worker, recovery eligibility or overall readiness.",
  "This read does not activate workers, call providers or recover runs. Refresh Health to collect another snapshot.",
] as const;

export const agentRuntimeOutcomeLinks = [
  { label: "Inspect Runtime activity", href: "/admin/agents/activity?origin=runtime" },
  { label: "Inspect Runtime jobs", href: "/admin/jobs?name=agent.runExecute" },
] as const;
export const agentRuntimeActivityScope =
  "Activity uses the current site and viewer permissions; it may not list every host-wide run.";

const labels = {
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  policy_blocked: "Policy blocked",
  budget_blocked: "Budget blocked",
} as const;

/** Validated aggregate facts shared by the server Health page and Doctor. */
export function buildAgentRuntimeOutcomePresentation(value: unknown) {
  const evidence = npRequireAgentRuntimeOutcomeV1(value);
  const count = (value: number | null) => (value === null ? "Unknown" : value.toString());
  return {
    generatedAt: evidence.generatedAt,
    windowStart: evidence.windowStart,
    state: evidence.state,
    notice:
      evidence.state === "observed"
        ? "Persisted Runtime Run records. Zero means no matching retained records."
        : evidence.state === "unsupported"
          ? "Runtime Run storage is not installed. Outcomes and unfinished counts are unknown."
          : "Runtime outcome observation is unavailable. Outcomes and unfinished counts are unknown.",
    outcomes: evidence.outcomes.map((row) => ({
      label: labels[row.state],
      count: count(row.count),
      lastFinishedAt: row.lastFinishedAt,
      lastFinished:
        row.lastFinishedAt ?? (evidence.state === "observed" ? "No matching records" : "Unknown"),
    })),
    active: [
      { label: "Unfinished runs", value: count(evidence.active.unfinished) },
      { label: "Deadline elapsed", value: count(evidence.active.deadlineElapsed) },
      { label: "Running or verifying", value: count(evidence.active.executing) },
      { label: "Lease elapsed", value: count(evidence.active.leaseElapsed) },
      { label: "Lease not recorded", value: count(evidence.active.leaseMissing) },
    ],
  };
}

export function formatAgentRuntimeOutcomeDetail(value: unknown): string {
  const view = buildAgentRuntimeOutcomePresentation(value);
  return [
    "Agent Runtime outcomes",
    `Snapshot ${view.generatedAt} · observation: ${view.state}`,
    `Retained outcomes from ${view.windowStart} through ${view.generatedAt} (inclusive)`,
    view.notice,
    ...view.outcomes.map(
      (row) => `${row.label}: ${row.count} · last finished: ${row.lastFinished}`,
    ),
    ...view.active.map((row) => `${row.label}: ${row.value}`),
    ...agentRuntimeOutcomeLimits,
    ...agentRuntimeOutcomeLinks.map((link) => `${link.label}: ${link.href}`),
    agentRuntimeActivityScope,
  ].join("\n");
}
