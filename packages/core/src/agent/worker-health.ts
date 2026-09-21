import { asc, desc, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npWorkerHeartbeats } from "../db/schema/system.js";
import { npRequireWorkerHeartbeat } from "../jobs-contract/contract.js";
import {
  NP_WORKER_SUBSCRIPTION_META_KEY,
  npRequireWorkerSubscriptionV1,
} from "../jobs-contract/worker-subscription-contract.js";
import { WORKER_STALE_THRESHOLD_MS } from "../jobs/heartbeat.js";
import {
  NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT,
  npRequireAgentWorkerHealthV1,
  type NpAgentWorkerHealthV1,
} from "../agent-contract/worker-health-contract.js";

type Db = ReturnType<typeof getDb>;
type Category =
  | "subscribedWorkers"
  | "pausedWorkers"
  | "inactiveWorkers"
  | "staleWorkers"
  | "stoppedWorkers"
  | "unknownWorkers";

function category(value: unknown, now: Date): Category {
  try {
    const row = npRequireWorkerHeartbeat(value);
    if (row.lastSeenAt.getTime() > now.getTime()) return "unknownWorkers";
    const evidence = npRequireWorkerSubscriptionV1(row.meta[NP_WORKER_SUBSCRIPTION_META_KEY]);
    // A legacy/unsupported heartbeat alone never asserts an Agent subscription.
    if (row.status === "stopped") return "stoppedWorkers";
    if (["stopped", "transitioning", "unavailable"].includes(evidence.state))
      return "unknownWorkers";
    if (now.getTime() - row.lastSeenAt.getTime() >= WORKER_STALE_THRESHOLD_MS)
      return "staleWorkers";
    if (evidence.state === "active")
      return evidence.agentQueues.length > 0 ? "subscribedWorkers" : "inactiveWorkers";
    if (evidence.state === "paused")
      return evidence.registeredAgentQueues.length > 0 ? "pausedWorkers" : "inactiveWorkers";
    if (evidence.state === "producer") return "inactiveWorkers";
  } catch {
    // Malformed, old or unsupported evidence is unknown, never an empty healthy worker.
  }
  return "unknownWorkers";
}

/**
 * Aggregate-only subscription observations from the most recent bounded heartbeat sample.
 * Use a root DB handle (including Doctor's original Client), not a parent transaction.
 * No queue, worker, provider or runtime initialization occurs here.
 */
export async function npCollectAgentWorkerHealthV1(
  options: { db?: Db; now?: Date } = {},
): Promise<NpAgentWorkerHealthV1> {
  const now = options.now ?? new Date();
  const result: NpAgentWorkerHealthV1 = {
    schemaVersion: "np.agent-worker-health.v1",
    generatedAt: now.toISOString(),
    state: "unavailable",
    sampledWorkers: null,
    hasMore: null,
    subscribedWorkers: null,
    pausedWorkers: null,
    inactiveWorkers: null,
    staleWorkers: null,
    stoppedWorkers: null,
    unknownWorkers: null,
  };
  try {
    const db = options.db ?? getDb();
    const rows = await db.transaction(async (tx) => {
      const timeout = await tx.execute(
        sql`select current_setting('statement_timeout') as original, extract(epoch from current_setting('statement_timeout')::interval)*1000 as milliseconds`,
      );
      const milliseconds = Number(timeout.rows[0]?.milliseconds);
      if (
        typeof timeout.rows[0]?.original !== "string" ||
        !Number.isFinite(milliseconds) ||
        milliseconds < 0
      )
        throw new Error("Invalid query budget");
      await tx.execute(
        sql`select set_config('statement_timeout',${`${Math.min(500, milliseconds || 500)}ms`},true)`,
      );
      const sample = await tx
        .select()
        .from(npWorkerHeartbeats)
        .orderBy(desc(npWorkerHeartbeats.lastSeenAt), asc(npWorkerHeartbeats.id))
        .limit(NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT + 1);
      await tx.execute(
        sql`select set_config('statement_timeout',${timeout.rows[0].original},true)`,
      );
      return sample;
    });
    const sample = rows.slice(0, NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT);
    const counts = {
      subscribedWorkers: 0,
      pausedWorkers: 0,
      inactiveWorkers: 0,
      staleWorkers: 0,
      stoppedWorkers: 0,
      unknownWorkers: 0,
    };
    for (const row of sample) counts[category(row, now)]++;
    Object.assign(result, {
      state: "observed",
      sampledWorkers: sample.length,
      hasMore: rows.length > sample.length,
      ...counts,
    });
  } catch {
    // A failed read is unknown; it is not an observed empty sample.
  }
  return npRequireAgentWorkerHealthV1(result);
}
