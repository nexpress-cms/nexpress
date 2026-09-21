import {
  npRequireAgentMaintenanceHealthV1,
  type NpAgentMaintenanceHealthV1,
} from "@nexpress/core/agent-contract";

export const agentMaintenanceLimits = [
  "Registration describes retentionPrune in this process only. Generic worker heartbeats do not confirm an Agent handler is running.",
  "Queue failures are host-wide retained failed, retry or expired retentionPrune jobs. Zero does not prove that no failures occurred.",
  "Receipts describe at most 100 sampled sites; timestamps and counts apply only to that sample.",
  "A completed sweep records cursor traversal, not deletion of all eligible data. Active work and required evidence remain protected.",
  "This evidence does not authorize activation or establish maintenance readiness.",
] as const;

const known = (value: number | string | null) => (value === null ? "Unknown" : String(value));

/** Shared validated facts, without row ids, cursors or inferred readiness. */
export function buildAgentMaintenancePresentation(value: NpAgentMaintenanceHealthV1) {
  const summary = npRequireAgentMaintenanceHealthV1(value);
  const { workers, queue, receipts } = summary;
  return {
    generatedAt: summary.generatedAt,
    groups: [
      {
        title: "Process registration",
        rows: [{ label: "retentionPrune", value: summary.registration }],
      },
      {
        title: "Generic worker heartbeat",
        rows: [
          { label: "Observation", value: workers.state },
          { label: "Alive workers", value: known(workers.aliveCount) },
          { label: "Recorded workers", value: known(workers.totalCount) },
          { label: "Newest heartbeat", value: known(workers.newestHeartbeat) },
        ],
      },
      {
        title: "Retained queue failures",
        rows: [
          { label: "Observation", value: queue.state },
          { label: "Host-wide retentionPrune failures", value: known(queue.retainedFailures) },
        ],
      },
      {
        title: "Committed retention receipts",
        rows: [
          { label: "Observation", value: receipts.state },
          { label: "Sampled sites", value: known(receipts.sampledSites) },
          {
            label: "More receipts outside sample",
            value: receipts.state === "unavailable" ? "Unknown" : receipts.hasMore ? "Yes" : "No",
          },
          {
            label: "Sampled sites with a completed sweep",
            value: known(receipts.completedSweepSites),
          },
          { label: "Latest sampled sweep completion", value: known(receipts.latestSweepAt) },
          {
            label: "Latest sampled batch started",
            value: known(receipts.latestBatch?.startedAt ?? null),
          },
          {
            label: "Latest sampled batch completed",
            value: known(receipts.latestBatch?.completedAt ?? null),
          },
          {
            label: "Latest sampled batch examined",
            value: known(receipts.latestBatch?.examined ?? null),
          },
          {
            label: "Latest sampled batch pruned",
            value: known(receipts.latestBatch?.pruned ?? null),
          },
        ],
      },
    ],
  };
}

export function formatAgentMaintenanceDetail(summary: NpAgentMaintenanceHealthV1): string {
  const view = buildAgentMaintenancePresentation(summary);
  return [
    "Agent maintenance evidence",
    `Snapshot ${view.generatedAt}`,
    ...view.groups.flatMap((group) => [
      group.title,
      ...group.rows.map((row) => `${row.label}: ${row.value}`),
    ]),
    ...agentMaintenanceLimits,
  ].join("\n");
}
