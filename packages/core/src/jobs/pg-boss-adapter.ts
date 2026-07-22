import { PgBoss, type ConstructorOptions, type Job } from "pg-boss";
import {
  NP_JOB_STATES,
  npNormalizeJobData,
  npNormalizeJobPayload,
  npBuiltinJobTypeForQueueName,
  npPluginScheduledTaskQueueName,
  npRequireJobId,
  npRequireJobQueueName,
  npRequireJobStateCounts,
  npRequireJobSummary,
  npRequireScheduleSummary,
  type NpJobData,
  type NpJobPayload,
  type NpJobType,
  type NpSearchReindexJobData,
} from "../jobs-contract/index.js";
import { NpConflictError } from "../errors.js";
import { getLogger } from "../observability/logger.js";
import { reportError } from "../observability/error-reporter.js";
import { npValidatePluginCronExpression } from "../plugins/scheduled-task-contract.js";
import { getAllJobHandlers, normalizeRegisteredJobPayload } from "./handlers.js";
import { recordJobLog, runInJobContext } from "./job-log.js";
import {
  type NpJobCountOptions,
  type NpJobListOptions,
  type NpJobListResult,
  type NpJobQueue,
  type NpJobStateCounts,
  type NpJobSummary,
  type NpPluginScheduleStats,
  type NpReconcileSchedulesResult,
  type NpScheduleSummary,
} from "./queue.js";

/**
 * pg-boss 12+ rejects queue names containing `:`, but NexPress job types use
 * `:` as a namespace separator (e.g. "content:afterSave"). Translate here so
 * the external API keeps its readable form while pg-boss sees an allowed
 * name.
 */
function toQueueName(type: NpJobType): string {
  return type.replace(/:/g, ".");
}

const SEARCH_REINDEX_QUEUE_CREATE_OPTIONS = {
  policy: "stately",
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 6 * 60 * 60,
} as const;

const SEARCH_REINDEX_QUEUE_UPDATE_OPTIONS = {
  retryLimit: SEARCH_REINDEX_QUEUE_CREATE_OPTIONS.retryLimit,
  retryDelay: SEARCH_REINDEX_QUEUE_CREATE_OPTIONS.retryDelay,
  retryBackoff: SEARCH_REINDEX_QUEUE_CREATE_OPTIONS.retryBackoff,
  expireInSeconds: SEARCH_REINDEX_QUEUE_CREATE_OPTIONS.expireInSeconds,
} as const;

export class PgBossAdapter implements NpJobQueue {
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
  /**
   * Flips `true` after `start()` runs (full worker mode). `startProducer()`
   * doesn't set it. Used by `reconcilePluginSchedules()` to tell admins
   * whether this process owns the `boss.work()` loops for plugin schedules
   * — the same boss instance can act as producer-only in the web server
   * and full worker in the worker process.
   */
  private workerStarted = false;

  constructor(connectionString: string, options?: ConstructorOptions) {
    const schema = options?.schema ?? "pgboss";
    if (schema !== "pgboss") {
      throw new Error('NexPress jobs require the canonical pg-boss schema "pgboss".');
    }
    this.boss = new PgBoss({ connectionString, ...options, schema });
  }

  async enqueue<TType extends NpJobType>(type: TType, data: NpJobPayload<TType>): Promise<string> {
    // `enqueueJob()` owns application/parser validation. The adapter repeats
    // only the framework JSON + built-in contract so a custom parser runs
    // exactly once before persistence and once again before dispatch.
    const normalized = npNormalizeJobPayload(type, data);
    const jobId = await this.boss.send(
      toQueueName(type),
      normalized,
      type === "search:reindex"
        ? { singletonKey: (normalized as NpSearchReindexJobData).collection }
        : undefined,
    );

    if (!jobId) {
      if (type === "search:reindex") {
        throw new NpConflictError(
          `Search reindex for collection "${(normalized as NpSearchReindexJobData).collection}" is already queued or active.`,
        );
      }
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
    await this.ensureSearchReindexQueue();
  }

  /**
   * Full start: opens the connection (idempotent with startProducer) and
   * registers `boss.work()` loops for every handler in the registry. Call
   * this from the dedicated worker process.
   */
  async start(): Promise<void> {
    await this.boss.start();

    const registerHandlerQueue = async (
      type: NpJobType,
      queueName: string,
      handler: (data: NpJobData) => Promise<void>,
    ): Promise<void> => {
      if (type === "search:reindex") {
        await this.ensureSearchReindexQueue();
      } else {
        await this.boss.createQueue(queueName);
      }
      const register = async () => {
        await this.boss.work(queueName, async (jobs: Job<unknown>[]) => {
          for (const job of jobs) {
            // Phase 20.3 — every handler invocation runs inside an
            // AsyncLocalStorage context keyed on the pg-boss job id
            // so `recordJobLog()` calls (from the framework or
            // plugin code) get stamped automatically.
            await runInJobContext(job.id, async () => {
              try {
                await handler(npNormalizeJobData(job.data));
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
                // Phase 20.3 — capture the failure on the job's
                // own log stream too. Operator opens the row in
                // the admin → sees the error message inline.
                await recordJobLog("error", `Job handler threw: ${err.message}`, {
                  type,
                  ...(err.stack ? { stack: err.stack } : {}),
                });
                void reportError(err, {
                  tags: { source: "worker", jobType: type },
                  extra: { jobId: job.id },
                });
                throw err;
              }
            });
          }
        });
      };
      this.workRegistrations.push({ queueName, register });
      await register();
    };

    const handlers = getAllJobHandlers();
    for (const [type, handler] of handlers) {
      await registerHandlerQueue(type, toQueueName(type), handler);
    }

    // Phase 19 — register one queue + worker per plugin schedule.
    // pg-boss enforces a 1:1 mapping between schedule name and
    // queue, so each `definePlugin({ scheduled })` entry needs
    // its own queue. The dispatcher inside the handler delegates
    // to the registered handler via `runPluginScheduledTask`.
    const { getRegisteredPluginSchedules, runPluginScheduledTask } =
      await import("../plugins/host.js");
    for (const schedule of getRegisteredPluginSchedules()) {
      const queueName = npPluginScheduledTaskQueueName(schedule.pluginId, schedule.taskId);
      await this.boss.createQueue(queueName);
      const register = async () => {
        await this.boss.work(queueName, async (jobs: Job<unknown>[]) => {
          for (const job of jobs) {
            await runInJobContext(job.id, async () => {
              try {
                const payload = normalizeRegisteredJobPayload("plugin:scheduledTask", job.data);
                if (payload.pluginId !== schedule.pluginId || payload.taskId !== schedule.taskId) {
                  throw new Error(
                    `Plugin schedule payload does not match queue ${schedule.pluginId}:${schedule.taskId}.`,
                  );
                }
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
                await recordJobLog("error", `Plugin scheduled task threw: ${err.message}`, {
                  pluginId: schedule.pluginId,
                  taskId: schedule.taskId,
                  ...(err.stack ? { stack: err.stack } : {}),
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
            });
          }
        });
      };
      this.workRegistrations.push({ queueName, register });
      await register();
    }
    this.workerStarted = true;
  }

  private async ensureSearchReindexQueue(): Promise<void> {
    const queueName = toQueueName("search:reindex");
    await this.boss.createQueue(queueName, SEARCH_REINDEX_QUEUE_CREATE_OPTIONS);
    const queue = await this.boss.getQueue(queueName);
    if (queue?.policy !== SEARCH_REINDEX_QUEUE_CREATE_OPTIONS.policy) {
      throw new Error(
        `Job queue "${queueName}" must use the stately policy; pg-boss policies cannot be changed after queue creation. Drain and recreate this queue before startup.`,
      );
    }
    // `createQueue()` deliberately leaves an existing row unchanged. Force
    // the mutable retry and long-running expiry settings as well. Queue policy
    // is immutable in pg-boss, so it is verified separately above.
    await this.boss.updateQueue(queueName, SEARCH_REINDEX_QUEUE_UPDATE_OPTIONS);
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

  /**
   * Phase 22.4 — readiness probe round-trip. `boss.isInstalled()`
   * issues a single SELECT against `pgboss.version`, so a true
   * answer proves both that the DB connection is alive AND that
   * pg-boss's schema migrations have applied. Any throw — pool
   * dead, schema missing, permissions revoked — is caught and
   * reported as `false`; the readiness probe never sees an
   * exception bubble out of the queue check.
   */
  async isHealthy(): Promise<boolean> {
    try {
      return await this.boss.isInstalled();
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30000 });
  }

  async scheduleRecurring(): Promise<void> {
    await this.boss.schedule(toQueueName("system:revisionPrune"), "0 3 * * *", {});
    await this.boss.schedule(toQueueName("system:sessionCleanup"), "0 * * * *", {});
    // Phase 20.3 — daily np_job_logs retention sweep at 03:30 UTC.
    // Offset 30 min from revisionPrune so the two cleanup jobs
    // don't pile DB load on the same minute.
    await this.boss.schedule(toQueueName("system:jobLogPrune"), "30 3 * * *", {});
    // Phase 16.4 — daily digest at 08:00 UTC, weekly digest Mondays
    // 08:00 UTC. Members opt in via their notification prefs;
    // the handler short-circuits when nobody matches.
    //
    // pg-boss 12 keys schedules by `(name, key)`. The explicit keys let both
    // cadences coexist while dispatching through the same logical handler.
    const digestQueue = toQueueName("notifications:sendDigest");
    await this.boss.unschedule(digestQueue).catch(() => {
      // Remove the empty-key row written by releases before keyed schedules.
    });
    await this.boss.schedule(digestQueue, "0 8 * * *", { cadence: "daily" }, { key: "daily" });
    await this.boss.schedule(digestQueue, "0 8 * * 1", { cadence: "weekly" }, { key: "weekly" });
    // Phase 19 — first-class plugin cron schedules. Each entry
    // declared via `definePlugin({ scheduled: [...] })` becomes
    // one row in `pgboss.schedule`. Each schedule uses its own physical
    // queue and dispatches by `(pluginId, taskId)` in the handler;
    // the schedule's pg-boss `name` is stable per task so a re-
    // boot doesn't accumulate duplicates.
    const { getRegisteredPluginSchedules } = await import("../plugins/host.js");
    for (const schedule of getRegisteredPluginSchedules()) {
      const pgBossName = npPluginScheduledTaskQueueName(schedule.pluginId, schedule.taskId);
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
  async listJobs(options: NpJobListOptions): Promise<NpJobListResult> {
    requireExactOptions(options, "jobs", ["name", "state", "limit", "offset", "since", "source"]);
    const limit = requireBoundedInteger(options.limit, "jobs.limit", 50, 1, 200);
    const offset = requireBoundedInteger(options.offset, "jobs.offset", 0, 0, 100_000);
    const name =
      options.name === undefined ? undefined : npRequireJobQueueName(options.name, "jobs.name");
    if (
      options.state !== undefined &&
      !(NP_JOB_STATES as readonly string[]).includes(options.state)
    ) {
      throw new Error(`Unsupported job state "${options.state}".`);
    }
    const source: unknown = options.source;
    if (source !== undefined && source !== "live" && source !== "archive") {
      throw new Error("Unsupported job source.");
    }
    if (
      options.since !== undefined &&
      (!(options.since instanceof Date) || Number.isNaN(options.since.getTime()))
    ) {
      throw new Error("jobs.since must be a valid Date.");
    }

    const db = (
      this.boss as unknown as {
        db: { executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: PgBossRow[] }> };
      }
    ).db;
    const params: unknown[] = [];
    const where: string[] = [];
    if (name) {
      params.push(name);
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

    // NexPress pins the canonical `pgboss` schema in the constructor so
    // runtime writes and every Admin/ops diagnostic query share one store.
    //
    // Phase 20.4 — when `options.source` is set we narrow the
    // UNION to that single table; otherwise we keep the
    // historical "show everything" union. The `source` column on
    // each row is what the admin uses to split live vs archive
    // visually without an extra round trip.
    const liveSelect = `
      SELECT id, name, state, data, retry_count,
             output::text AS output, created_on, started_on, completed_on,
             'live' AS source
        FROM pgboss.job`;
    const archiveSelect = `
      SELECT id, name, state, data, retry_count,
             output::text AS output, created_on, started_on, completed_on,
             'archive' AS source
        FROM pgboss.archive`;
    const innerUnion =
      options.source === "live"
        ? liveSelect
        : options.source === "archive"
          ? archiveSelect
          : `${liveSelect}\n        UNION ALL${archiveSelect}`;
    const listSql = `
      SELECT id, name, state::text AS state, data, retry_count,
             output, created_on, started_on, completed_on, source
      FROM (
        ${innerUnion}
      ) jobs
      ${whereSql}
      ORDER BY created_on DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const liveCount = `SELECT id, name, state, data, created_on, 'live' AS source FROM pgboss.job`;
    const archiveCount = `SELECT id, name, state, data, created_on, 'archive' AS source FROM pgboss.archive`;
    const countUnion =
      options.source === "live"
        ? liveCount
        : options.source === "archive"
          ? archiveCount
          : `${liveCount} UNION ALL ${archiveCount}`;
    const countSql = `
      SELECT COUNT(*)::bigint AS total
      FROM (
        ${countUnion}
      ) jobs
      ${whereSql}
    `;
    const [listResult, countResult] = await Promise.all([
      db.executeSql(listSql, params),
      db.executeSql(countSql, params) as unknown as Promise<{
        rows: Array<{ total: string | number }>;
      }>,
    ]);
    const rows = listResult.rows;
    const totalRaw = countResult.rows[0]?.total;
    if (totalRaw === undefined) throw new Error("jobs.total is missing.");

    return {
      jobs: rows.map(rowToSummary),
      total: requireCount(totalRaw, "jobs.total"),
    };
  }

  /**
   * Phase 13.2 — list every cron schedule registered in the
   * queue. Reads from `pgboss.schedule`, which is the table
   * pg-boss writes to on each `boss.schedule()` call. Sorted
   * by name for stable display.
   */
  async listSchedules(): Promise<NpScheduleSummary[]> {
    const db = (
      this.boss as unknown as {
        db: {
          executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: PgBossScheduleRow[] }>;
        };
      }
    ).db;
    const result = await db.executeSql(
      `SELECT name, key, cron, timezone, data, created_on, updated_on
         FROM pgboss.schedule
        ORDER BY name ASC, key ASC`,
    );
    return result.rows.map(scheduleRowToSummary);
  }

  /**
   * Phase 4.2 — pulls per-(pluginId, taskId) execution stats from the
   * union of `pgboss.job` (in-flight + recently-completed) and
   * `pgboss.archive` (rolled-over history). One row per taskId so the
   * caller can index without a second pass.
   *
   * The window default is 7 days because longer windows force the
   * archive table into the hot path and admins typically want recent
   * health, not lifetime totals. Increase via `windowDays` if surfacing
   * a "30-day reliability" widget.
   */
  async getPluginScheduleStats(
    pluginId: string,
    options?: { windowDays?: number },
  ): Promise<NpPluginScheduleStats[]> {
    requireExactOptions(options, "pluginSchedule", ["windowDays"]);
    const windowDays = requireBoundedInteger(
      options?.windowDays,
      "pluginSchedule.windowDays",
      7,
      1,
      365,
    );
    const canonicalPluginId = npNormalizeJobPayload("plugin:scheduledTask", {
      pluginId,
      taskId: "contract-probe",
    }).pluginId;
    const db = (
      this.boss as unknown as {
        db: {
          executeSql: (
            sql: string,
            params?: unknown[],
          ) => Promise<{
            rows: Array<{
              task_id: string | null;
              last_run: Date | string | null;
              last_success: Date | string | null;
              last_failure: Date | string | null;
              completed_count: string | number;
              failed_count: string | number;
            }>;
          }>;
        };
      }
    ).db;

    // Plugin schedule jobs land in pg-boss under two name shapes:
    //   - `plugin.scheduledTask`                       — `schedulePluginTask()` enqueues
    //     here for one-shot "Run now" invocations (handlePluginScheduledTask
    //     dispatches by `(pluginId, taskId)` from the payload).
    //   - `plugin.scheduledTask.<hex(pluginId)>.<hex(taskId)>` — cron schedules. Each entry
    //     declared via `definePlugin({ scheduled: [...] })` gets its own queue +
    //     row in `pgboss.schedule` (Phase 19).
    // Both share the `(pluginId, taskId)` payload shape, so we filter by name
    // prefix and join on `data->>'pluginId'` to collect either source. The
    // earlier `name = 'plugin.scheduledTask'` filter only matched the first
    // shape, leaving cron-scheduled stats permanently at zero.
    const result = await db.executeSql(
      `WITH plugin_jobs AS (
         SELECT state, completed_on, data
           FROM pgboss.job
          WHERE (name = 'plugin.scheduledTask' OR name LIKE 'plugin.scheduledTask.%')
            AND data->>'pluginId' = $1
            AND completed_on > NOW() - ($2 || ' days')::interval
         UNION ALL
         SELECT state, completed_on, data
           FROM pgboss.archive
          WHERE (name = 'plugin.scheduledTask' OR name LIKE 'plugin.scheduledTask.%')
            AND data->>'pluginId' = $1
            AND completed_on > NOW() - ($2 || ' days')::interval
       )
       SELECT data->>'taskId' AS task_id,
              MAX(completed_on) AS last_run,
              MAX(CASE WHEN state = 'completed' THEN completed_on END) AS last_success,
              MAX(CASE WHEN state = 'failed' THEN completed_on END) AS last_failure,
              SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS completed_count,
              SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed_count
         FROM plugin_jobs
        WHERE data->>'taskId' IS NOT NULL
        GROUP BY data->>'taskId'`,
      [canonicalPluginId, String(windowDays)],
    );

    return result.rows.map((row, index) => {
      const payload = npNormalizeJobPayload("plugin:scheduledTask", {
        pluginId: canonicalPluginId,
        taskId: row.task_id,
      });
      return {
        taskId: payload.taskId,
        lastRunAt: nullableIso(row.last_run, "pluginSchedule.lastRunAt"),
        lastSuccessAt: nullableIso(row.last_success, "pluginSchedule.lastSuccessAt"),
        lastFailureAt: nullableIso(row.last_failure, "pluginSchedule.lastFailureAt"),
        completedCount: requireCount(
          row.completed_count,
          `pluginSchedule[${index.toString()}].completedCount`,
        ),
        failedCount: requireCount(
          row.failed_count,
          `pluginSchedule[${index.toString()}].failedCount`,
        ),
        windowDays,
      };
    });
  }

  /**
   * Issue #461 — diff the in-memory plugin schedule registry against the
   * `pgboss.schedule` rows whose name starts with `plugin.scheduledTask.*`
   * and bring pg-boss in line. Without this, `reloadPlugins()` only
   * rebuilt the in-process registry and pg-boss kept firing the old set
   * of crons until the worker process restarted — the admin "Reload all"
   * toast was promising behavior the system didn't deliver.
   *
   * Worker `boss.work()` registrations stay untouched. In production the
   * worker is a separate process with its own boss instance; the web
   * process can't add or drop work loops there. We surface that via
   * `workerOwnsRegistrations` so the admin UI can warn the operator.
   */
  async reconcilePluginSchedules(): Promise<NpReconcileSchedulesResult> {
    // Pull the current registry inline — same dynamic-import pattern
    // `start()` uses to dodge a core ↔ jobs cycle.
    const { getRegisteredPluginSchedules } = await import("../plugins/host.js");
    const wantedList = getRegisteredPluginSchedules();
    const wantedByName = new Map<string, { pluginId: string; taskId: string; cron: string }>();
    for (const schedule of wantedList) {
      const name = npPluginScheduledTaskQueueName(schedule.pluginId, schedule.taskId);
      wantedByName.set(name, {
        pluginId: schedule.pluginId,
        taskId: schedule.taskId,
        cron: schedule.cron,
      });
    }

    // Existing schedule rows for the plugin namespace only — the framework
    // owns its built-in schedules (`system.revisionPrune` etc.) elsewhere
    // and we mustn't touch them here.
    const existingAll = await this.listSchedules();
    const existingByName = new Map<string, NpScheduleSummary>();
    for (const entry of existingAll) {
      if (entry.name.startsWith("plugin.scheduledTask.")) {
        existingByName.set(entry.name, entry);
      }
    }

    let added = 0;
    let updated = 0;
    let removed = 0;

    // Add or update.
    for (const [name, want] of wantedByName) {
      const existing = existingByName.get(name);
      if (!existing) {
        await this.boss.schedule(name, want.cron, {
          pluginId: want.pluginId,
          taskId: want.taskId,
        });
        added++;
        continue;
      }
      if (existing.cron !== want.cron) {
        await this.boss.unschedule(name).catch(() => {
          // Race: another reconcile call could have removed the row in
          // parallel. Either way, the next `schedule()` below installs
          // the new cron from a clean slate.
        });
        await this.boss.schedule(name, want.cron, {
          pluginId: want.pluginId,
          taskId: want.taskId,
        });
        updated++;
      }
    }

    // Remove stale rows.
    for (const [name] of existingByName) {
      if (!wantedByName.has(name)) {
        await this.boss.unschedule(name).catch(() => {
          // Concurrent removal — fine; the row is gone either way.
        });
        removed++;
      }
    }

    return {
      added,
      updated,
      removed,
      workerOwnsRegistrations: this.workerStarted,
    };
  }

  /**
   * Phase 23.5 — `GROUP BY state` across the union of pgboss.job
   * (live) and pgboss.archive (rolled). Returns a fully-populated
   * record so callers can index without optional chaining.
   *
   * Uses `created_on` for the optional `since` filter. Both tables
   * carry the same column, so the union pre-filter is a single
   * predicate.
   */
  async countByState(options?: NpJobCountOptions): Promise<NpJobStateCounts> {
    requireExactOptions(options, "jobs.counts", ["since"]);
    const db = (
      this.boss as unknown as {
        db: {
          executeSql: (
            sql: string,
            params?: unknown[],
          ) => Promise<{ rows: Array<{ state: string; count: string | number }> }>;
        };
      }
    ).db;
    const params: unknown[] = [];
    let whereSql = "";
    if (options?.since !== undefined) {
      if (!(options.since instanceof Date) || Number.isNaN(options.since.getTime())) {
        throw new Error("jobs.counts.since must be a valid Date.");
      }
      params.push(options.since.toISOString());
      whereSql = `WHERE created_on >= $${params.length}`;
    }
    const result = await db.executeSql(
      `SELECT state::text AS state, COUNT(*)::bigint AS count
         FROM (
           SELECT state, created_on FROM pgboss.job
           UNION ALL
           SELECT state, created_on FROM pgboss.archive
         ) jobs
         ${whereSql}
        GROUP BY state`,
      params,
    );
    const rawCounts: Record<string, number> = {
      created: 0,
      active: 0,
      completed: 0,
      failed: 0,
      retry: 0,
      cancelled: 0,
      expired: 0,
    };
    for (const row of result.rows) {
      if (!(NP_JOB_STATES as readonly string[]).includes(row.state)) {
        throw new Error(`Unsupported pg-boss job state "${row.state}".`);
      }
      rawCounts[row.state] = requireCount(row.count, `job.counts.${row.state}`);
    }
    return npRequireJobStateCounts(rawCounts);
  }

  async retryJob(id: string): Promise<string> {
    const canonicalId = npRequireJobId(id);
    // Look up the original payload + queue name first so we
    // can re-enqueue with the same shape. Could be in either
    // pgboss.job (still pending/active/retry) or pgboss.archive
    // (already terminal); UNION handles both.
    const db = (
      this.boss as unknown as {
        db: {
          executeSql: (sql: string, params?: unknown[]) => Promise<{ rows: PgBossRetryRow[] }>;
        };
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
      [canonicalId],
    );
    const row = result.rows?.[0];
    if (!row) {
      throw new Error(`Job ${id} not found`);
    }
    if (npRequireJobId(row.id, "job.retry.id") !== canonicalId) {
      throw new Error("job.retry.id does not match the requested job");
    }
    const queueName = npRequireJobQueueName(row.name, "job.retry.name");
    if (row.state !== "failed" && row.state !== "cancelled" && row.state !== "expired") {
      throw new Error(`Job ${canonicalId} is not retryable from state "${row.state}".`);
    }
    const registeredType = findRegisteredTypeForQueueName(queueName);
    if (!registeredType) {
      throw new Error(`Job queue "${queueName}" has no registered handler contract.`);
    }
    const payload = normalizeRegisteredJobPayload(registeredType, row.data);
    const newId = await this.boss.send(
      queueName,
      payload,
      registeredType === "search:reindex"
        ? { singletonKey: (payload as NpSearchReindexJobData).collection }
        : undefined,
    );
    if (!newId) {
      if (registeredType === "search:reindex") {
        throw new NpConflictError(
          `Search reindex for collection "${(payload as NpSearchReindexJobData).collection}" is already queued or active.`,
        );
      }
      throw new Error(`Failed to re-enqueue ${queueName}`);
    }
    return newId;
  }

  async cancelJob(id: string): Promise<void> {
    const canonicalId = npRequireJobId(id);
    // pg-boss's cancel API requires the queue name; look it up
    // from pgboss.job. Already-archived (terminal) jobs can't
    // be cancelled, which matches user intuition.
    const db = (
      this.boss as unknown as {
        db: {
          executeSql: (
            sql: string,
            params?: unknown[],
          ) => Promise<{ rows: Array<{ name: string; state: string }> }>;
        };
      }
    ).db;
    const result = await db.executeSql(
      `SELECT name, state::text AS state FROM pgboss.job WHERE id = $1`,
      [canonicalId],
    );
    const row = result.rows?.[0];
    if (!row) {
      throw new Error(`Job ${id} not found or already terminal`);
    }
    const queueName = npRequireJobQueueName(row.name, "job.cancel.name");
    if (row.state !== "created" && row.state !== "retry") {
      throw new Error(`Job ${canonicalId} cannot be cancelled from state "${row.state}".`);
    }
    await this.boss.cancel(queueName, canonicalId);
  }
}

interface PgBossRow {
  id: string;
  name: string;
  state: string;
  data: unknown;
  retry_count: number;
  output: string | null;
  created_on: Date | string;
  started_on: Date | string | null;
  completed_on: Date | string | null;
  /** Phase 20.4 — `live` (pgboss.job) or `archive` (pgboss.archive). */
  source: string;
}

interface PgBossRetryRow {
  id: string;
  name: string;
  state: string;
  data: unknown;
}

interface PgBossScheduleRow {
  name: string;
  key: string;
  cron: string;
  timezone: string | null;
  data: unknown;
  created_on: Date | string;
  updated_on: Date | string | null;
}

function scheduleRowToSummary(row: PgBossScheduleRow): NpScheduleSummary {
  const cron = npValidatePluginCronExpression(row.cron);
  if (!cron.ok) throw new Error(cron.message);
  return npRequireScheduleSummary({
    name: row.name,
    key: row.key,
    cron: row.cron,
    timezone: row.timezone ?? null,
    data: row.data,
    createdOn: requireIso(row.created_on, "schedule.createdOn"),
    updatedOn: nullableIso(row.updated_on, "schedule.updatedOn"),
  });
}

function rowToSummary(row: PgBossRow): NpJobSummary {
  const registeredType = findRegisteredTypeForQueueName(row.name);
  return npRequireJobSummary({
    id: row.id,
    name: row.name,
    state: row.state,
    data: registeredType
      ? normalizeRegisteredJobPayload(registeredType, row.data)
      : npNormalizeJobData(row.data),
    retryCount: row.retry_count,
    output: row.output,
    createdOn: requireIso(row.created_on, "job.createdOn"),
    startedOn: nullableIso(row.started_on, "job.startedOn"),
    completedOn: nullableIso(row.completed_on, "job.completedOn"),
    source: row.source,
  });
}

function nullableIso(value: Date | string | null, path: string): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${path} is invalid.`);
  return parsed.toISOString();
}

function requireIso(value: Date | string, path: string): string {
  const result = nullableIso(value, path);
  if (!result) throw new Error(`${path} is missing or invalid.`);
  return result;
}

function requireCount(value: string | number, path: string): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${path} exceeds the safe integer range.`);
  return parsed;
}

function requireBoundedInteger(
  value: number | undefined,
  path: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${path} must be an integer between ${min.toString()} and ${max.toString()}.`);
  }
  return value;
}

function findRegisteredTypeForQueueName(queueName: string): NpJobType | null {
  const builtin = npBuiltinJobTypeForQueueName(queueName);
  if (builtin) return builtin;
  for (const type of getAllJobHandlers().keys()) {
    if (toQueueName(type) === queueName) return type;
  }
  if (queueName.startsWith(`${toQueueName("plugin:scheduledTask")}.`)) {
    return "plugin:scheduledTask";
  }
  return null;
}

function requireExactOptions(value: unknown, path: string, allowedKeys: readonly string[]): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} options must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} options must be a plain object.`);
  }
  const allowed = new Set(allowedKeys);
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new Error(`${path} options contain a symbol property.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(`${path}.${key} must be an enumerable plain data property.`);
    }
    keys.push(key);
  }
  const unsupported = keys.find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`${path}.${unsupported} is not supported.`);
}
