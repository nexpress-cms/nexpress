import { npRequireAgentQueueBacklogV1 } from "@nexpress/core/jobs-contract";

export const agentQueueBacklogLimits = [
  "Host-wide retained live pg-boss jobs only; these counts are not tenant-specific and exclude archived or removed jobs.",
  "Due means the stored start-after time is at or before this database snapshot. Scheduled means it is strictly after the snapshot, including delayed retries; scheduled work is not overdue work. Due-time alone does not account for dependencies, priority, concurrency or queue policies.",
  "Oldest due age measures time since the earliest due start-after time across created and retry jobs. Oldest active age measures time since the earliest active start time. Ages do not prove progress or a stuck job.",
  "Persisted pg-boss observations do not confirm the current adapter, worker subscriptions, provider readiness or authority. Unsupported or unavailable observation is not an empty queue.",
  "Only aggregate counts and ages are exposed. Refresh requests another snapshot; it does not activate workers or execute jobs.",
] as const;

export function buildAgentQueueBacklogPresentation(value: unknown) {
  const evidence = npRequireAgentQueueBacklogV1(value);
  const count = (value: number | null) => (value === null ? "Unknown" : value.toString());
  const age = (value: number | null) =>
    value === null
      ? evidence.state === "observed"
        ? "No matching jobs"
        : "Unknown"
      : `${value.toString()} s`;
  return {
    generatedAt: evidence.generatedAt,
    state: evidence.state,
    notice:
      evidence.state === "observed"
        ? "Persisted pg-boss queue counts at this snapshot. Zero means no matching retained live jobs."
        : evidence.state === "unsupported"
          ? "The pg-boss jobs table is not installed. Counts and ages are unknown."
          : "Queue backlog observation is unavailable. Counts and ages are unknown.",
    queues: evidence.queues.map((queue) => ({
      queue: queue.queue,
      rows: [
        { label: "Created due", value: count(queue.createdReady) },
        { label: "Created scheduled", value: count(queue.createdScheduled) },
        { label: "Retry due", value: count(queue.retryReady) },
        { label: "Retry scheduled", value: count(queue.retryScheduled) },
        { label: "Active", value: count(queue.active) },
        { label: "Oldest due age", value: age(queue.oldestReadyAgeSeconds) },
        { label: "Oldest active age", value: age(queue.oldestActiveAgeSeconds) },
      ],
    })),
  };
}

export function formatAgentQueueBacklogDetail(value: unknown): string {
  const view = buildAgentQueueBacklogPresentation(value);
  return [
    "Agent queue backlog observations",
    `Snapshot ${view.generatedAt}`,
    `Observation: ${view.state}`,
    view.notice,
    ...view.queues.map(
      (queue) =>
        `${queue.queue}: ${queue.rows.map((row) => `${row.label}: ${row.value}`).join("; ")}`,
    ),
    ...agentQueueBacklogLimits,
  ].join("\n");
}
