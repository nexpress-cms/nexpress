import { getDb } from "../db/runtime.js";
import { getJobHandler } from "../jobs/handlers.js";
import { getOptionalJobQueue } from "../jobs/queue.js";
import { listWorkerHealth } from "../jobs/heartbeat.js";
import { npRequireJobListWire } from "../jobs-contract/contract.js";
import type { NpAgentDiagnosticsQueryClientV1 } from "./contract-diagnostics.js";
import {
  NP_AGENT_MAINTENANCE_RECEIPT_KEY,
  npRequireAgentMaintenanceHealthV1,
  npRequireAgentMaintenanceReceiptV1,
  type NpAgentMaintenanceHealthV1,
} from "../agent-contract/maintenance-evidence-contract.js";

/** Read-only, host-wide and aggregate-only. No worker/queue/provider initialization. */
export async function npCollectAgentMaintenanceHealthV1(
  options: {
    client?: NpAgentDiagnosticsQueryClientV1;
    runtime?: boolean;
    now?: Date;
  } = {},
): Promise<NpAgentMaintenanceHealthV1> {
  const now = options.now ?? new Date();
  const result: NpAgentMaintenanceHealthV1 = {
    schemaVersion: "np.agent-maintenance-health.v1",
    generatedAt: now.toISOString(),
    registration: "unknown",
    workers: { state: "unavailable", aliveCount: null, totalCount: null, newestHeartbeat: null },
    queue: { state: "unavailable", retainedFailures: null },
    receipts: {
      state: "unavailable",
      sampledSites: null,
      hasMore: false,
      completedSweepSites: null,
      latestBatch: null,
      latestSweepAt: null,
    },
  };
  try {
    const client =
      options.client ??
      (getDb() as unknown as { $client: NpAgentDiagnosticsQueryClientV1 }).$client;
    const { rows } = await client.query<{ value: unknown }>(
      "select value from public.np_settings where key=$1 order by site_id limit 101",
      [NP_AGENT_MAINTENANCE_RECEIPT_KEY],
    );
    const receipts = rows.slice(0, 100).map((row) => npRequireAgentMaintenanceReceiptV1(row.value));
    if (receipts.some((row) => row.lastBatch.completedAt > result.generatedAt))
      throw new Error("Invalid evidence clock");
    const completed = receipts
      .flatMap((row) => (row.lastCompletedSweepAt ? [row.lastCompletedSweepAt] : []))
      .sort();
    result.receipts = {
      state: receipts.length ? "observed" : "never-recorded",
      sampledSites: receipts.length,
      hasMore: rows.length > 100,
      completedSweepSites: completed.length,
      latestBatch:
        receipts
          .map((row) => row.lastBatch)
          .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0] ?? null,
      latestSweepAt: completed.at(-1) ?? null,
    };
  } catch {
    /* An unreadable/invalid receipt must not become an empty successful batch. */
  }
  if (options.runtime ?? !options.client) {
    result.registration = getJobHandler("agent:retentionPrune") ? "registered" : "not-registered";
    try {
      const workers = await listWorkerHealth(now);
      const projected = {
        state: "observed" as const,
        aliveCount: workers.aliveCount,
        totalCount: workers.totalCount,
        newestHeartbeat: workers.newestHeartbeat,
      };
      npRequireAgentMaintenanceHealthV1({ ...result, workers: projected });
      result.workers = projected;
    } catch {
      /* Current worker evidence is unavailable; do not invent zero workers. */
    }
    try {
      const queue = getOptionalJobQueue();
      result.queue = { state: "unsupported", retainedFailures: null };
      if (queue?.listJobs) {
        let retainedFailures = 0;
        for (const state of ["failed", "retry", "expired"] as const) {
          const response = await queue.listJobs({ name: "agent:retentionPrune", state, limit: 1 });
          const checked = npRequireJobListWire({ supported: true, ...response });
          if (
            !checked.supported ||
            checked.jobs.some((job) => job.name !== "agent:retentionPrune" || job.state !== state)
          )
            throw new Error("Invalid queue evidence");
          retainedFailures += checked.total;
        }
        const projected = { state: "supported" as const, retainedFailures };
        npRequireAgentMaintenanceHealthV1({ ...result, queue: projected });
        result.queue = projected;
      }
    } catch {
      result.queue = { state: "unavailable", retainedFailures: null };
    }
  }
  return npRequireAgentMaintenanceHealthV1(result);
}
