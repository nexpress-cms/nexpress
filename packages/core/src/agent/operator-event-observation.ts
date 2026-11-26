import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npSettings, npWorkerHeartbeats } from "../db/schema/system.js";
import { npCollectAgentQueueBacklogV1 } from "../jobs/agent-queue-backlog.js";
import { npRequireJobsPauseState } from "../jobs-contract/contract.js";
import {
  NP_WORKER_SUBSCRIPTION_META_KEY,
  NP_AGENT_WORKER_QUEUE_NAMES,
  npRequireWorkerSubscriptionV1,
} from "../jobs-contract/worker-subscription-contract.js";
import {
  npRequireAgentOperatorMonitorSnapshotV1,
  type NpAgentOperatorMonitorSnapshotV1,
} from "../agent-contract/operator-monitor-contract.js";
export interface NpAgentOperatorEventObservationV1 {
  snapshot: NpAgentOperatorMonitorSnapshotV1;
  failures: Array<{ handlerName: string; jobId: string; completedAt: string }>;
  failuresComplete: boolean;
}
/** Deployment-owned canonical pg-boss and heartbeat reads only. No worker/producer startup. */
export async function npCollectAgentOperatorEventObservationV1(
  options: {
    db?: ReturnType<typeof getDb>;
    afterFailure?: { completedAt: string; jobId: string };
  } = {},
): Promise<NpAgentOperatorEventObservationV1> {
  if (
    options.afterFailure &&
    (!Number.isFinite(Date.parse(options.afterFailure.completedAt)) ||
      new Date(options.afterFailure.completedAt).toISOString() !==
        options.afterFailure.completedAt ||
      !/^[0-9a-f-]{36}$/.test(options.afterFailure.jobId))
  )
    throw new Error("Invalid Operator failure cursor.");
  const db = options.db ?? getDb();
  const clock = new Date().toISOString();
  const unknown: NpAgentOperatorEventObservationV1 = {
    snapshot: {
      schemaVersion: "np.agent-operator-monitor-snapshot.v1",
      observedAt: clock,
      complete: false,
      paused: null,
      queues: [],
      workers: [],
    },
    failures: [],
    failuresComplete: false,
  };
  try {
    const [backlog, pause, observations] = await Promise.all([
      npCollectAgentQueueBacklogV1({ db }),
      db
        .select()
        .from(npSettings)
        .where(and(eq(npSettings.siteId, "_system"), eq(npSettings.key, "jobs.paused")))
        .limit(1),
      db.transaction(
        async (tx) => {
          await tx.execute(sql`select set_config('statement_timeout','500ms',true)`);
          const workers = await tx
            .select()
            .from(npWorkerHeartbeats)
            .orderBy(desc(npWorkerHeartbeats.lastSeenAt), asc(npWorkerHeartbeats.id))
            .limit(101);
          const failures = await tx.execute(
            sql`select id, name, completed_on from pgboss.job where name in (${sql.join(
              NP_AGENT_WORKER_QUEUE_NAMES.map((name) => sql`${name}`),
              sql`, `,
            )}) and state='failed' and ${options.afterFailure ? sql`(date_trunc('milliseconds',completed_on),id) > (${options.afterFailure.completedAt}::timestamptz,${options.afterFailure.jobId}::uuid)` : sql`completed_on >= statement_timestamp()-interval '15 minutes'`} and completed_on < date_trunc('milliseconds',statement_timestamp()) order by date_trunc('milliseconds',completed_on) asc, id asc limit 101`,
          );
          return { workers, failures: failures.rows };
        },
        { accessMode: "read only" },
      ),
    ]);
    let complete = backlog.state === "observed" && observations.workers.length <= 100;
    const workers = observations.workers
      .slice(0, 100)
      .map((worker): NpAgentOperatorMonitorSnapshotV1["workers"][number] => {
        let state: NpAgentOperatorMonitorSnapshotV1["workers"][number]["state"] = "unknown",
          queues: string[] = [];
        try {
          const subscription = npRequireWorkerSubscriptionV1(
            worker.meta[NP_WORKER_SUBSCRIPTION_META_KEY],
          );
          state =
            worker.status === "stopped"
              ? "stopped"
              : subscription.state === "active"
                ? "active"
                : subscription.state === "paused"
                  ? "paused"
                  : "unknown";
          queues =
            subscription.state === "active"
              ? subscription.agentQueues
              : subscription.registeredAgentQueues;
          if (state === "unknown") complete = false;
        } catch {
          complete = false;
        }
        return { id: worker.id, lastHeartbeatAt: worker.lastSeenAt.toISOString(), state, queues };
      });
    return {
      snapshot: npRequireAgentOperatorMonitorSnapshotV1({
        schemaVersion: "np.agent-operator-monitor-snapshot.v1",
        observedAt: new Date().toISOString(),
        complete,
        paused: pause.length === 0 ? false : npRequireJobsPauseState(pause[0].value).paused,
        queues:
          backlog.state === "observed"
            ? backlog.queues.map((q) => ({
                name: q.queue,
                ready: (q.createdReady ?? 0) + (q.retryReady ?? 0),
                active: q.active ?? 0,
                oldestReadyAgeSeconds: q.oldestReadyAgeSeconds,
              }))
            : [],
        workers,
      }),
      failures: observations.failures.slice(0, 100).map((failure) => ({
        handlerName: String(failure.name),
        jobId: String(failure.id),
        completedAt:
          failure.completed_on instanceof Date
            ? failure.completed_on.toISOString()
            : new Date(String(failure.completed_on)).toISOString(),
      })),
      failuresComplete: observations.failures.length <= 100,
    };
  } catch {
    return unknown;
  }
}
