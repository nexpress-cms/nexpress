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
  type NxScheduleSummary,
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
  /**
   * Phase 20.2 — every queue we've called `boss.work()` on, plus
   * the function that re-registers it. We need both because
   * `pauseProcessing()` calls `boss.offWork(name)` (drops the
   * worker) and `resumeProcessing()` has to re-call the original
   * `boss.work(...)` to bring it back. Order is preserved so
   * resume registers in the same order as start did.
   */
  private readonly workRegistrations: Array<{
    queueName: string;
    register: () => Promise<void>;
  }> = [];
  private paused = false;

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
      const register = async () => {
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
      };
      this.workRegistrations.push({ queueName, register });
      await register();
    }

    // Phase 19 — register one queue + worker per plugin schedule.
    // pg-boss enforces a 1:1 mapping between schedule name and
    // queue, so each `definePlugin({ scheduled })` entry needs
    // its own queue. The dispatcher inside the handler delegates
    // to the registered handler via `runPluginScheduledTask`.
    const { getRegisteredPluginSchedules, runPluginScheduledTask } =
      await import("../plugins/host.js");
    for (const schedule of getRegisteredPluginSchedules()) {
      const queueName = `${toQueueName("plugin:scheduledTask")}.${schedule.pluginId}.${schedule.taskId}`;
      await this.boss.createQueue(queueName);
      const register = async () => {
        await this.boss.work(queueName, async (jobs: Job<unknown>[]) => {
          for (const job of jobs) {
            try {
              await runPluginScheduledTask(schedule.pluginId, schedule.taskId);
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              getLogger().error("Plugin scheduled task threw", {
                pluginId: schedule.pluginId,
                taskId: schedule.taskId,
                jobId: job.id,
                error: err.message,
                stack: err.stack,
              });
              void reportError(err, {
                tags: {
                  source: "worker",
                  pluginId: schedule.pluginId,
                  taskId: schedule.taskId,
                },
                extra: { jobId: job.id },
              });
              throw err;
            }
          }
        });
      };
      this.workRegistrations.push({ queueName, register });
      await register();
    }
  }

  /**
   * Phase 20.2 — drop every registered worker so the boss stops
   * claiming new jobs. The pg-boss connection stays open; the
   * producer can keep enqueueing while paused. In-flight jobs
   * picked up before pause finish normally because pg-boss only
   * cancels the polling loop, not the fetch already in flight.
   */
  async pauseProcessing(): Promise<void> {
    if (this.paused) return;
    for (const { queueName } of this.workRegistrations) {
      await this.boss.offWork(queueName);
    }
    this.paused = true;
    getLogger().info("Job processing paused", {
      queues: this.workRegistrations.length,
    });
  }

  /** Phase 20.2 — re-run every captured `boss.work()` registration. Idempotent. */
  async resumeProcessing(): Promise<void> {
    if (!this.paused) return;
    for (const { register } of this.workRegistrations) {
      await register();
    }
    this.paused = false;
    getLogger().info("Job processing resumed", {
      queues: this.workRegistrations.length,
    });
  }

  isProcessingPaused(): boolean {
    return this.paused;
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30000 });
  }

  async scheduleRecurring(): Promise<void> {
    await this.boss.schedule(toQueueName("system:revisionPrune"), "0 3 * * *", {});
    await this.boss.schedule(toQueueName("system:sessionCleanup"), "0 * * * *", {});
    // Phase 16.4 — daily digest at 08:00 UTC, weekly digest Mondays
    // 08:00 UTC. Members opt in via their notification prefs;
    // the handler short-circuits when nobody matches.
    await this.boss.schedule(toQueueName("notifications:sendDigest"), "0 8 * * *", {
      cadence: "daily",
    });
    await this.boss.schedule(toQueueName("notifications:sendDigest"), "0 8 * * 1", {
      cadence: "weekly",
    });
    // Phase 19 — first-class plugin cron schedules. Each entry
    // declared via `definePlugin({ scheduled: [...] })` becomes
    // one row in `pgboss.schedule`. We share the `plugin:scheduledTask`
    // queue and dispatch by `(pluginId, taskId)` in the handler;
    // the schedule's pg-boss `name` is stable per task so a re-
    // boot doesn't accumulate duplicates.
    const { getRegisteredPluginSchedules } = await import("../plugins/host.js");
    for (const schedule of getRegisteredPluginSchedules()) {
      const pgBossName = `${toQueueName("plugin:scheduledTask")}.${schedule.pluginId}.${schedule.taskId}`;
      await this.boss.schedule(pgBossName, schedule.cron, {
        pluginId: schedule.pluginId,
        taskId: schedule.taskId,
      });
    }
  }

  getBoss(): PgBoss {
    return this.boss;
  }

  /**
   * Phase 13 — admin job introspection. Joins pgboss.job
   * (pending / active / retry) and pgboss.archive (completed
   * / failed / expired) into one unified list.
   *
   * Phase 13.2 — `since` filter for time-bounded queries
   * ("last 24 hours") and accurate `total` via a parallel
   * COUNT(*) so the admin pagination shows the right count.
   * The COUNT runs against the same UNION; the per-page
   * SELECT still gets the row data.
   */
  async listJobs(options: NxJobListOptions): Promise<NxJobListResult> {
    const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
    const offset = Math.max(0, options.offset ?? 0);

    const db = (
      this.boss as unknown as {
        db: { executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: PgBossRow[] }> };
      }
    ).db;
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
    if (options.since) {
      params.push(options.since.toISOString());
      where.push(`created_on >= $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Schema name defaults to `pgboss` but can be overridden
    // via constructor options. We didn't pass `schema`, so the
    // default is in effect.
    const listSql = `
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
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `
      SELECT COUNT(*)::bigint AS total
      FROM (
        SELECT id, name, state, data, created_on FROM pgboss.job
        UNION ALL
        SELECT id, name, state, data, created_on FROM pgboss.archive
      ) jobs
      ${whereSql}
    `;
    const [listResult, countResult] = await Promise.all([
      db.executeSql(listSql, params),
      db.executeSql(countSql, params) as unknown as Promise<{
        rows: Array<{ total: string | number }>;
      }>,
    ]);
    const rows = listResult.rows ?? [];
    const totalRaw = countResult.rows?.[0]?.total;
    const total =
      typeof totalRaw === "number"
        ? totalRaw
        : typeof totalRaw === "string"
          ? Number.parseInt(totalRaw, 10)
          : 0;

    return {
      jobs: rows.map(rowToSummary),
      total: Number.isFinite(total) ? total : 0,
    };
  }

  /**
   * Phase 13.2 — list every cron schedule registered in the
   * queue. Reads from `pgboss.schedule`, which is the table
   * pg-boss writes to on each `boss.schedule()` call. Sorted
   * by name for stable display.
   */
  async listSchedules(): Promise<NxScheduleSummary[]> {
    const db = (
      this.boss as unknown as {
        db: {
          executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: PgBossScheduleRow[] }>;
        };
      }
    ).db;
    const result = await db.executeSql(
      `SELECT name, cron, timezone, data, created_on, updated_on
         FROM pgboss.schedule
        ORDER BY name ASC`,
    );
    return (result.rows ?? []).map(scheduleRowToSummary);
  }

  async retryJob(id: string): Promise<string> {
    // Look up the original payload + queue name first so we
    // can re-enqueue with the same shape. Could be in either
    // pgboss.job (still pending/active/retry) or pgboss.archive
    // (already terminal); UNION handles both.
    const db = (
      this.boss as unknown as {
        db: { executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: PgBossRow[] }> };
      }
    ).db;
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
    const db = (
      this.boss as unknown as {
        db: {
          executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: { name: string }[] }>;
        };
      }
    ).db;
    const result = await db.executeSql(`SELECT name FROM pgboss.job WHERE id = $1`, [id]);
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

interface PgBossScheduleRow {
  name: string;
  cron: string;
  timezone?: string | null;
  data?: unknown;
  created_on?: Date | string | null;
  updated_on?: Date | string | null;
}

function scheduleRowToSummary(row: PgBossScheduleRow): NxScheduleSummary {
  return {
    name: row.name,
    cron: row.cron,
    timezone: row.timezone ?? null,
    data: row.data ?? null,
    createdOn: toIso(row.created_on) ?? new Date(0).toISOString(),
    updatedOn: toIso(row.updated_on),
  };
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
