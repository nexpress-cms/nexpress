import {
  NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT,
  npRequireAgentWorkerHealthV1,
  npRequireAgentWorkerHealthV2,
  type NpAgentWorkerHealthV1,
  type NpAgentWorkerHealthV2,
} from "@nexpress/core/agent-contract";

export const agentWorkerLimits = [
  `Evidence covers the ${NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT.toString()} most recent worker heartbeats, or all retained workers when fewer exist. Counts describe only that sample.`,
  "Workers with fresh Agent subscriptions do not prove job progress, provider readiness, authority or coverage of every required queue.",
  "Paused workers have stopped polling registered Agent queues for new jobs; previously fetched jobs may still be in flight. Inactive workers have no confirmed Agent subscription, including producer-only processes.",
  "Stale evidence describes an old heartbeat, not a confirmed stopped process. Changes can remain invisible until the next heartbeat.",
  "Unknown includes legacy or unsupported adapters, invalid evidence and incomplete lifecycle transitions. Unavailable observation is not an empty sample.",
  "Workers marked stopped have a heartbeat lifecycle stop marker. This does not prove all in-flight jobs have drained.",
  "Queue counts describe the same sample and can overlap across queues. Zero means no matching observation in this sample; unknown workers and workers outside the sample cannot be assigned to individual queues.",
  "Paused, stale and stopped queue counts describe registrations, not current subscriptions. Unknown evidence may conceal queue registrations.",
  "Only aggregate counts are exposed. This evidence does not activate workers or grant authority.",
] as const;

export type AgentWorkerHealthEvidence = NpAgentWorkerHealthV1 | NpAgentWorkerHealthV2;

export function buildAgentWorkerPresentation(value: AgentWorkerHealthEvidence) {
  const evidence =
    value.schemaVersion === "np.agent-worker-health.v2"
      ? npRequireAgentWorkerHealthV2(value)
      : npRequireAgentWorkerHealthV1(value);
  const summary = "summary" in evidence ? evidence.summary : evidence;
  const count = (value: number | null) => (value === null ? "Unknown" : value.toString());
  return {
    generatedAt: summary.generatedAt,
    queueNotice:
      "queues" in evidence
        ? summary.state === "unavailable"
          ? "Queue observation is unavailable; counts are unknown."
          : "Observed worker counts per queue within this heartbeat sample."
        : "Queue details are unavailable in this legacy aggregate snapshot.",
    queues:
      "queues" in evidence
        ? evidence.queues.map((queue) => ({
            queue: queue.queue,
            rows: [
              { label: "Fresh subscriptions", value: count(queue.subscribedWorkers) },
              { label: "Paused registrations", value: count(queue.pausedRegisteredWorkers) },
              { label: "Stale registrations", value: count(queue.staleRegisteredWorkers) },
              { label: "Stopped registrations", value: count(queue.stoppedRegisteredWorkers) },
            ],
          }))
        : [],
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

export function formatAgentWorkerDetail(summary: AgentWorkerHealthEvidence): string {
  const view = buildAgentWorkerPresentation(summary);
  return [
    "Agent worker subscription evidence",
    `Snapshot ${view.generatedAt}`,
    ...view.rows.map((row) => `${row.label}: ${row.value}`),
    view.queueNotice,
    ...view.queues.map(
      (queue) =>
        `${queue.queue}: ${queue.rows.map((row) => `${row.label}: ${row.value}`).join("; ")}`,
    ),
    ...agentWorkerLimits,
  ].join("\n");
}
