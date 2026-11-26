import { sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npRequireAgentQueueBacklogV1,
  type NpAgentQueueBacklogV1,
  type NpAgentQueueBacklogRowV1,
} from "../jobs-contract/agent-queue-backlog-contract.js";
import { NP_AGENT_WORKER_QUEUE_NAMES } from "../jobs-contract/worker-subscription-contract.js";

type Db = ReturnType<typeof getDb>;

/**
 * Read persisted canonical pg-boss storage using the host's existing DB handle.
 * This does not observe custom adapters or initialize pg-boss/producer/worker.
 * Pass a root handle, including Doctor's original Client, not a parent transaction.
 */
export async function npCollectAgentQueueBacklogV1(
  options: { db?: Db } = {},
): Promise<NpAgentQueueBacklogV1> {
  const result: NpAgentQueueBacklogV1 = {
    schemaVersion: "np.agent-queue-backlog.v1",
    source: "pg-boss",
    generatedAt: new Date().toISOString(),
    state: "unavailable",
    queues: NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
      queue,
      createdReady: null,
      createdScheduled: null,
      retryReady: null,
      retryScheduled: null,
      active: null,
      oldestReadyAgeSeconds: null,
      oldestActiveAgeSeconds: null,
    })),
  };
  try {
    const db = options.db ?? getDb();
    return await db.transaction(
      async (tx) => {
        const settings =
          await tx.execute(sql`select current_setting('statement_timeout') as original,
        extract(epoch from current_setting('statement_timeout')::interval)*1000 as milliseconds`);
        const original = settings.rows[0]?.original;
        const milliseconds = Number(settings.rows[0]?.milliseconds);
        if (typeof original !== "string" || !Number.isFinite(milliseconds) || milliseconds < 0)
          throw new Error("Invalid query budget");
        await tx.execute(
          sql`select set_config('statement_timeout', ${`${Math.min(500, milliseconds || 500)}ms`}, true)`,
        );
        const storage = await tx.execute(sql`select to_regclass('pgboss.job')::text as relation,
        statement_timestamp() as observed_at`);
        const observedAt = storage.rows[0]?.observed_at;
        const generatedAt =
          observedAt instanceof Date
            ? observedAt.toISOString()
            : typeof observedAt === "string"
              ? new Date(observedAt).toISOString()
              : null;
        if (!generatedAt) throw new Error("Invalid observation clock");
        if (storage.rows[0]?.relation === null) {
          await tx.execute(sql`select set_config('statement_timeout', ${original}, true)`);
          return npRequireAgentQueueBacklogV1({ ...result, generatedAt, state: "unsupported" });
        }
        const facts = await tx.execute(sql`
        with facts as (select name,
          count(*) filter (where state = 'created' and start_after <= statement_timestamp()) as created_ready,
          count(*) filter (where state = 'created' and start_after > statement_timestamp()) as created_scheduled,
          count(*) filter (where state = 'retry' and start_after <= statement_timestamp()) as retry_ready,
          count(*) filter (where state = 'retry' and start_after > statement_timestamp()) as retry_scheduled,
          count(*) filter (where state = 'active') as active,
          floor(extract(epoch from statement_timestamp() - min(start_after)
            filter (where state in ('created', 'retry') and start_after <= statement_timestamp()))) as ready_age,
          floor(extract(epoch from statement_timestamp() - min(started_on)
            filter (where state = 'active'))) as active_age,
          count(*) filter (where start_after is null or not isfinite(start_after) or
            (state = 'active' and (started_on is null or not isfinite(started_on) or started_on > statement_timestamp()))) as invalid
        from pgboss.job
        where name in (${sql.join(
          NP_AGENT_WORKER_QUEUE_NAMES.map((name) => sql`${name}`),
          sql`, `,
        )})
          and state in ('created', 'retry', 'active')
        group by name)
        select statement_timestamp() as observed_at, facts.*
        from (values (1)) as observation(n) left join facts on true`);
        const factClock = facts.rows[0]?.observed_at;
        const factGeneratedAt =
          factClock instanceof Date
            ? factClock.toISOString()
            : typeof factClock === "string"
              ? new Date(factClock).toISOString()
              : null;
        if (!factGeneratedAt) throw new Error("Invalid observation clock");
        const byQueue = new Map(facts.rows.map((row) => [row.name, row]));
        const queues = NP_AGENT_WORKER_QUEUE_NAMES.map((queue): NpAgentQueueBacklogRowV1 => {
          const row = byQueue.get(queue);
          if (row && Number(row.invalid) !== 0) throw new Error("Invalid retained job timestamps");
          const count = (key: string) => (row ? Number(row[key]) : 0);
          const age = (key: string) => (!row || row[key] === null ? null : Number(row[key]));
          return {
            queue,
            createdReady: count("created_ready"),
            createdScheduled: count("created_scheduled"),
            retryReady: count("retry_ready"),
            retryScheduled: count("retry_scheduled"),
            active: count("active"),
            oldestReadyAgeSeconds: age("ready_age"),
            oldestActiveAgeSeconds: age("active_age"),
          };
        });
        const observed = npRequireAgentQueueBacklogV1({
          ...result,
          generatedAt: factGeneratedAt,
          state: "observed",
          queues,
        });
        await tx.execute(sql`select set_config('statement_timeout', ${original}, true)`);
        return observed;
      },
      { accessMode: "read only" },
    );
  } catch {
    // Missing columns/permissions, malformed facts and timeouts are unavailable, never zero.
    return npRequireAgentQueueBacklogV1(result);
  }
}
