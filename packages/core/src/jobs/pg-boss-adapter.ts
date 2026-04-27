import { PgBoss, type ConstructorOptions, type Job } from "pg-boss";
import { type NxJobType } from "../config/types.js";
import { getLogger } from "../observability/logger.js";
import { reportError } from "../observability/error-reporter.js";
import { getAllJobHandlers } from "./handlers.js";
import {
  type NxJobListOptions,
  type NxJobListResult,
  type NxJobQueue,
  type NxJobState,
  type NxJobSummary,
} from "./queue.js";

/**
 * pg-boss 12+ rejects queue names containing `:`, but NexPress job types use
 * `:` as a namespace separator (e.g. "content:afterSave"). Translate here so
 * the external API keeps its readable form while pg-boss sees an allowed
 * name.
 */
function toQueueName(type: NxJobType): string {
  return type.replace(/:/g, ".");
}

export class PgBossAdapter implements NxJobQueue {
  private readonly boss: PgBoss;

  constructor(connectionString: string, options?: ConstructorOptions) {
    this.boss = new PgBoss({ connectionString, ...options });
  }

  async enqueue(type: NxJobType, data: unknown): Promise<string> {
    const jobId = await this.boss.send(toQueueName(type), asJobPayload(data));

    if (!jobId) {
      throw new Error(`Failed to enqueue job: ${type}`);
    }

    return jobId;
  }

  /**
   * Opens the pg-boss connection and runs its migrations. Safe to call from a
   * non-worker process (e.g. the Next.js server) so it can enqueue jobs.
   */
  async startProducer(): Promise<void> {
    await this.boss.start();
  }

  /**
   * Full start: opens the connection (idempotent with startProducer) and
   * registers `boss.work()` loops for every handler in the registry. Call
   * this from the dedicated worker process.
   */
  async start(): Promise<void> {
    await this.boss.start();

    for (const [type, handler] of getAllJobHandlers()) {
      const queueName = toQueueName(type);
      await this.boss.createQueue(queueName);
      await this.boss.work(queueName, async (jobs: Job<unknown>[]) => {
        for (const job of jobs) {
          try {
            await handler(job.data);
          } catch (error) {
            // Surface job failures to logs + the configured error reporter.
            // Re-throw so pg-boss applies its retry/dead-letter policy.
            const err = error instanceof Error ? error : new Error(String(error));
            getLogger().error("Job handler threw", {
              type,
              jobId: job.id,
              error: err.message,
              stack: err.stack,
            });
            void reportError(err, {
              tags: { source: "worker", jobType: type },
              extra: { jobId: job.id },
            });
            throw err;
          }
        }
      });
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30000 });
  }

  async scheduleRecurring(): Promise<void> {
    await this.boss.schedule(toQueueName("system:revisionPrune"), "0 3 * * *", {});
    await this.boss.schedule(toQueueName("system:sessionCleanup"), "0 * * * *", {});
  }

  getBoss(): PgBoss {
    return this.boss;
  }

  /**
   * Phase 13 — admin job introspection. Joins pgboss.job
   * (pending / active / retry) and pgboss.archive (completed
   * / failed / expired) into one unified list. Pagination
   * happens client-side after the merge to keep state-filter
   * semantics straightforward (the alternative is two
   * paginated queries the caller has to interleave).
   */
  async listJobs(options: NxJobListOptions): Promise<NxJobListResult> {
    const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
    const offset = Math.max(0, options.offset ?? 0);

    const db = (this.boss as unknown as { db: { executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: PgBossRow[] }> } }).db;
    const params: unknown[] = [];
    const where: string[] = [];
    if (options.name) {
      params.push(options.name);
      where.push(`name = $${params.length}`);
    }
    if (options.state) {
      params.push(options.state);
      where.push(`state = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Schema name defaults to `pgboss` but can be overridden
    // via constructor options. We didn't pass `schema`, so the
    // default is in effect.
    const sql = `
      SELECT id, name, state::text AS state, data, retry_count,
             output, created_on, started_on, completed_on
      FROM (
        SELECT id, name, state, data, retry_count,
               output::text AS output, created_on, started_on, completed_on
          FROM pgboss.job
        UNION ALL
        SELECT id, name, state, data, retry_count,
               output::text AS output, created_on, started_on, completed_on
          FROM pgboss.archive
      ) jobs
      ${whereSql}
      ORDER BY created_on DESC
      LIMIT ${limit + 1} OFFSET ${offset}
    `;
    const result = await db.executeSql(sql, params);
    const rows = result.rows ?? [];

    // Total count — `LIMIT n+1` lets us tell whether there's
    // a "next page" without a second COUNT(*) round-trip.
    // Total accuracy across both tables is tricky; we report
    // the in-page total + a `hasMore` fallback by trimming
    // the extra row.
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const total = offset + rows.length; // approximate; a real total would COUNT(*)

    return {
      jobs: slice.map(rowToSummary),
      total,
    };
  }

  async retryJob(id: string): Promise<string> {
    // Look up the original payload + queue name first so we
    // can re-enqueue with the same shape. Could be in either
    // pgboss.job (still pending/active/retry) or pgboss.archive
    // (already terminal); UNION handles both.
    const db = (this.boss as unknown as { db: { executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: PgBossRow[] }> } }).db;
    const result = await db.executeSql(
      `SELECT id, name, state::text AS state, data, retry_count,
              output::text AS output, created_on, started_on, completed_on
       FROM pgboss.job WHERE id = $1
       UNION ALL
       SELECT id, name, state, data, retry_count,
              output::text AS output, created_on, started_on, completed_on
       FROM pgboss.archive WHERE id = $1
       LIMIT 1`,
      [id],
    );
    const row = result.rows?.[0];
    if (!row) {
      throw new Error(`Job ${id} not found`);
    }
    const newId = await this.boss.send(row.name, row.data ?? {});
    if (!newId) {
      throw new Error(`Failed to re-enqueue ${row.name}`);
    }
    return newId;
  }

  async cancelJob(id: string): Promise<void> {
    // pg-boss's cancel API requires the queue name; look it up
    // from pgboss.job. Already-archived (terminal) jobs can't
    // be cancelled, which matches user intuition.
    const db = (this.boss as unknown as { db: { executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: { name: string }[] }> } }).db;
    const result = await db.executeSql(
      `SELECT name FROM pgboss.job WHERE id = $1`,
      [id],
    );
    const row = result.rows?.[0];
    if (!row) {
      throw new Error(`Job ${id} not found or already terminal`);
    }
    await this.boss.cancel(row.name, id);
  }
}

interface PgBossRow {
  id: string;
  name: string;
  state: string;
  data: unknown;
  retry_count?: number;
  output?: string | null;
  created_on?: Date | string | null;
  started_on?: Date | string | null;
  completed_on?: Date | string | null;
}

function rowToSummary(row: PgBossRow): NxJobSummary {
  return {
    id: row.id,
    name: row.name,
    state: row.state as NxJobState,
    data: row.data,
    retryCount: typeof row.retry_count === "number" ? row.retry_count : undefined,
    output: row.output ?? null,
    createdOn: toIso(row.created_on) ?? new Date(0).toISOString(),
    startedOn: toIso(row.started_on),
    completedOn: toIso(row.completed_on),
  };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asJobPayload(data: unknown): object {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { payload: data };
  }

  return data;
}
