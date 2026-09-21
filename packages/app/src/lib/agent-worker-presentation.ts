import {
  NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT,
  npRequireAgentWorkerHealthV1,
  type NpAgentWorkerHealthV1,
} from "@nexpress/core/agent-contract";

export const agentWorkerLimits = [
  `Evidence covers the ${NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT.toString()} most recent worker heartbeats, or all retained workers when fewer exist. Counts describe only that sample.`,
  "Workers with fresh Agent subscriptions do not prove job progress, provider readiness, authority or coverage of every required queue.",
  "Paused workers have stopped polling registered Agent queues for new jobs; previously fetched jobs may still be in flight. Inactive workers have no confirmed Agent subscription, including producer-only processes.",
  "Stale evidence describes an old heartbeat, not a confirmed stopped process. Changes can remain invisible until the next heartbeat.",
  "Unknown includes legacy or unsupported adapters, invalid evidence and incomplete lifecycle transitions. Unavailable observation is not an empty sample.",
  "Workers marked stopped have a heartbeat lifecycle stop marker. This does not prove all in-flight jobs have drained.",
  "Only aggregate counts are exposed. This evidence does not activate workers or grant authority.",
] as const;

export function buildAgentWorkerPresentation(value: NpAgentWorkerHealthV1) {
  const summary = npRequireAgentWorkerHealthV1(value);
  const count = (value: number | null) => (value === null ? "Unknown" : value.toString());
  return {
    generatedAt: summary.generatedAt,
    rows: [
      { label: "Observation", value: summary.state },
      { label: "Sampled workers", value: count(summary.sampledWorkers) },
      {
        label: "More workers outside sample",
        value: summary.hasMore === null ? "Unknown" : summary.hasMore ? "Yes" : "No",
      },
      { label: "Workers with fresh Agent subscriptions", value: count(summary.subscribedWorkers) },
      { label: "Paused Agent workers", value: count(summary.pausedWorkers) },
      { label: "Inactive workers", value: count(summary.inactiveWorkers) },
      { label: "Stale worker evidence", value: count(summary.staleWorkers) },
      { label: "Workers marked stopped", value: count(summary.stoppedWorkers) },
      { label: "Workers with unknown evidence", value: count(summary.unknownWorkers) },
    ],
  };
}

export function formatAgentWorkerDetail(summary: NpAgentWorkerHealthV1): string {
  const view = buildAgentWorkerPresentation(summary);
  return [
    "Agent worker subscription evidence",
    `Snapshot ${view.generatedAt}`,
    ...view.rows.map((row) => `${row.label}: ${row.value}`),
    ...agentWorkerLimits,
  ].join("\n");
}
