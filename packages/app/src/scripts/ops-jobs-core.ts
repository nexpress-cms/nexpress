import { PgBossAdapter } from "@nexpress/core/jobs";
import {
  NP_JOB_STATES,
  npRequireJobId,
  npRequireJobStateCounts,
  npRequireJobQueueName,
  npRequireJobsHealthWire,
  npRequireJobsEnabledFlag,
  npRequireJobsPauseState,
  npRequireRecentJobFailure,
  npRequireWorkerHeartbeat,
  npSerializeWorkerHealthEntry,
  type NpJobStateCounts,
  type NpJobsPauseState,
  type NpRecentJobFailure,
  type NpWorkerHealthWireEntry,
} from "@nexpress/core/jobs-contract";
import pg from "pg";

import { toProjectCommand } from "./ops-command-format.js";

export type OpsJobsWorker = NpWorkerHealthWireEntry;
export type OpsJobsCounts = NpJobStateCounts;
export type OpsJobsPauseState = NpJobsPauseState;
export type OpsJobsRecentFailure = NpRecentJobFailure;

export interface OpsJobsJson {
  schemaVersion: "np.ops-jobs.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked" | "disabled";
  enabled: boolean;
  diagnosticError: string | null;
  mutation?: {
    action: "pause" | "resume" | "retry-all" | "drain";
    applied: boolean;
    mode?: "dry-run" | "execute";
    reason: string | null;
    error: string | null;
    target?: Record<string, string | number | null>;
    result?: Record<string, string | number | boolean | null>;
  } | null;
  summary: {
    workersAlive: number;
    workersTotal: number;
    failed: number;
    retry: number;
    created: number;
    active: number;
  };
  nextCommand: string | null;
  projectNextCommand: string | null;
  pause: OpsJobsPauseState;
  counts: OpsJobsCounts;
  workers: OpsJobsWorker[];
  recentFailures: OpsJobsRecentFailure[];
}

type OpsJobsEnv = Record<string, string | undefined>;

interface PgClientLike {
  connect(): Promise<void>;
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface PgModuleLike {
  default: {
    Client: new (config: {
      connectionString: string;
      connectionTimeoutMillis?: number;
    }) => PgClientLike;
  };
}

interface WorkerRow {
  id: string;
  status: string;
  started_at: Date | string;
  last_seen_at: Date | string;
  meta: unknown;
}

interface PauseRow {
  value: unknown;
}

interface CountRow {
  state: string;
  count: string | number;
}

interface RetryableJobRow {
  id: string;
  name: string;
  state: string;
}

interface RecentFailureRow {
  id: string;
  name: string;
  state: string;
  source: string;
  retry_count: number | string;
  output: string | null;
  created_on: Date | string;
  started_on: Date | string | null;
  completed_on: Date | string | null;
  log_count: string | number;
  last_log: unknown;
}

interface RenderOptions {
  color: boolean;
}

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const EMPTY_ANSI = {
  green: "",
  yellow: "",
  red: "",
  dim: "",
  reset: "",
};
const START_WORKER_COMMAND = "NP_ENABLE_JOBS=1 pnpm run worker";
const JOBS_STATUS_COMMAND = "nexpress ops jobs status --json";
const JOBS_RETRY_ALL_COMMAND = "nexpress ops jobs retry-all --json";

const DEFAULT_PAUSE: OpsJobsPauseState = {
  paused: false,
  changedAt: new Date(0).toISOString(),
  changedByUserId: null,
  reason: null,
};

const EMPTY_COUNTS: OpsJobsCounts = {
  created: 0,
  active: 0,
  completed: 0,
  failed: 0,
  retry: 0,
  cancelled: 0,
  expired: 0,
};

export function jobsEnabled(env: OpsJobsEnv = process.env): boolean {
  return npRequireJobsEnabledFlag(env.NP_ENABLE_JOBS);
}

export function workerStaleThresholdMs(env: OpsJobsEnv = process.env): number {
  const value = env.NP_WORKER_STALE_THRESHOLD_SECONDS;
  if (value === undefined || value === "") return 90_000;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error("NP_WORKER_STALE_THRESHOLD_SECONDS must be a positive integer");
  }
  const seconds = Number(value);
  const milliseconds = seconds * 1_000;
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(milliseconds)) {
    throw new Error("NP_WORKER_STALE_THRESHOLD_SECONDS exceeds the safe integer range");
  }
  return milliseconds;
}

function loadPg(): PgModuleLike {
  return { default: pg as unknown as PgModuleLike["default"] };
}

function toDate(value: unknown, path: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${path} must be a valid timestamp`);
    return value;
  }
  if (typeof value !== "string") throw new Error(`${path} must be a valid timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${path} must be a valid timestamp`);
  return parsed;
}

function readCount(value: string | number, path: string): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${path} exceeds the safe integer range`);
  return parsed;
}

export function buildOpsJobsJson(args: {
  enabled: boolean;
  pause: OpsJobsPauseState;
  counts: OpsJobsCounts;
  workers: OpsJobsWorker[];
  recentFailures?: OpsJobsRecentFailure[];
  diagnosticError?: string | null;
  mutation?: OpsJobsJson["mutation"];
}): OpsJobsJson {
  const pause = npRequireJobsPauseState(args.pause);
  const counts = npRequireJobStateCounts(args.counts);
  const workersAlive = args.workers.filter((worker) => worker.alive).length;
  const health = npRequireJobsHealthWire({
    workers: args.workers,
    aliveCount: workersAlive,
    totalCount: args.workers.length,
    newestHeartbeat: args.workers[0]?.lastSeenAt ?? null,
    pause,
    stuck: null,
    recentFailures: args.recentFailures ?? [],
  });
  const workersTotal = health.workers.length;
  const hasFailed = counts.failed > 0;
  const hasExpired = counts.expired > 0;
  const hasFailures = hasFailed || hasExpired;
  const hasRetry = counts.retry > 0;
  const hasBacklog = counts.created > 0 && workersAlive === 0;
  const blocked = Boolean(args.diagnosticError) || (args.enabled && (pause.paused || hasBacklog));
  const attention = args.enabled && !blocked && (workersAlive === 0 || hasFailures || hasRetry);
  const status: OpsJobsJson["status"] = blocked
    ? "blocked"
    : !args.enabled
      ? "disabled"
      : attention
        ? "attention"
        : "ready";
  const nextCommand =
    status === "blocked"
      ? args.diagnosticError
        ? JOBS_STATUS_COMMAND
        : pause.paused
          ? "nexpress ops jobs resume --json"
          : START_WORKER_COMMAND
      : status === "attention"
        ? hasFailures
          ? `nexpress ops jobs retry-all --state ${hasFailed ? "failed" : "expired"} --json`
          : workersAlive === 0
            ? START_WORKER_COMMAND
            : hasRetry
              ? "nexpress ops jobs drain --json"
              : JOBS_STATUS_COMMAND
        : null;

  return {
    schemaVersion: "np.ops-jobs.v1",
    ok: status === "ready" || status === "disabled" || status === "attention",
    status,
    enabled: args.enabled,
    diagnosticError: args.diagnosticError ?? null,
    mutation: args.mutation ?? null,
    summary: {
      workersAlive,
      workersTotal,
      failed: counts.failed + counts.expired,
      retry: counts.retry,
      created: counts.created,
      active: counts.active,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    pause,
    counts,
    workers: health.workers,
    recentFailures: health.recentFailures,
  };
}

export async function collectOpsJobsStatus(
  env: OpsJobsEnv = process.env,
  now: Date = new Date(),
): Promise<OpsJobsJson> {
  let enabled: boolean;
  try {
    enabled = jobsEnabled(env);
  } catch (error) {
    return buildOpsJobsJson({
      enabled: false,
      pause: DEFAULT_PAUSE,
      counts: EMPTY_COUNTS,
      workers: [],
      diagnosticError: error instanceof Error ? error.message : String(error),
    });
  }
  const url = env.DATABASE_URL;
  if (!url) {
    return buildOpsJobsJson({
      enabled,
      pause: DEFAULT_PAUSE,
      counts: EMPTY_COUNTS,
      workers: [],
      diagnosticError: enabled ? "DATABASE_URL is not set" : null,
    });
  }

  let pg: PgModuleLike;
  try {
    pg = loadPg();
  } catch (error) {
    return buildOpsJobsJson({
      enabled,
      pause: DEFAULT_PAUSE,
      counts: EMPTY_COUNTS,
      workers: [],
      diagnosticError: error instanceof Error ? error.message : String(error),
    });
  }

  let threshold: number;
  try {
    threshold = workerStaleThresholdMs(env);
  } catch (error) {
    return buildOpsJobsJson({
      enabled,
      pause: DEFAULT_PAUSE,
      counts: EMPTY_COUNTS,
      workers: [],
      diagnosticError: error instanceof Error ? error.message : String(error),
    });
  }
  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const workerRows = await client.query<WorkerRow>(
      `select id, status, started_at, last_seen_at, meta
           from np_worker_heartbeats
          order by last_seen_at desc`,
    );
    const pauseRows = await client.query<PauseRow>(
      `select value
           from np_settings
          where site_id = '_system' and key = 'jobs.paused'
          limit 1`,
    );
    const countRows = await client.query<CountRow>(
      `select state::text as state, count(*)::bigint as count
           from (
             select state, created_on from pgboss.job
             union all
             select state, created_on from pgboss.archive
           ) jobs
          group by state`,
    );
    const recentFailures = await listRecentFailures(client);
    await client.end();

    const workers = workerRows.rows.map((row, index) =>
      npSerializeWorkerHealthEntry(
        npRequireWorkerHeartbeat({
          id: row.id,
          status: row.status,
          startedAt: toDate(row.started_at, `workers[${index.toString()}].startedAt`),
          lastSeenAt: toDate(row.last_seen_at, `workers[${index.toString()}].lastSeenAt`),
          meta: row.meta,
        }),
        now,
        threshold,
      ),
    );
    const counts: OpsJobsCounts = { ...EMPTY_COUNTS };
    for (const row of countRows.rows) {
      if (!(NP_JOB_STATES as readonly string[]).includes(row.state)) {
        throw new Error(`jobs.counts contains unsupported state ${row.state}`);
      }
      const key = row.state as keyof OpsJobsCounts;
      counts[key] = readCount(row.count, `jobs.counts.${row.state}`);
    }

    return buildOpsJobsJson({
      enabled,
      pause:
        pauseRows.rows.length === 0
          ? DEFAULT_PAUSE
          : npRequireJobsPauseState(pauseRows.rows[0]?.value),
      counts,
      workers,
      recentFailures,
    });
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return buildOpsJobsJson({
      enabled,
      pause: DEFAULT_PAUSE,
      counts: EMPTY_COUNTS,
      workers: [],
      diagnosticError: error instanceof Error ? error.message : String(error),
    });
  }
}

async function listRecentFailures(client: PgClientLike): Promise<OpsJobsRecentFailure[]> {
  const rows = await client.query<RecentFailureRow>(
    `select id, name, state::text as state, data, retry_count,
              output::text as output, created_on, started_on, completed_on, source,
              (
                select count(*)::bigint
                  from np_job_logs logs
                 where logs.job_id = jobs.id::text
              ) as log_count,
              (
                select jsonb_build_object(
                         'id', logs.id::text,
                         'level', logs.level,
                         'message', logs.message,
                         'context', logs.context,
                         'createdAt', logs.created_at
                       )
                  from np_job_logs logs
                 where logs.job_id = jobs.id::text
                 order by logs.created_at desc
                 limit 1
              ) as last_log
         from (
           select id, name, state, data, retry_count,
                  output, created_on, started_on, completed_on, 'live' as source
             from pgboss.job
           union all
           select id, name, state, data, retry_count,
                  output, created_on, started_on, completed_on, 'archive' as source
             from pgboss.archive
         ) jobs
        where state::text in ('failed', 'expired', 'retry')
        order by coalesce(completed_on, started_on, created_on) desc
        limit 5`,
  );
  return rows.rows.map(normalizeRecentFailure);
}

function normalizeRecentFailure(row: RecentFailureRow): OpsJobsRecentFailure {
  return npRequireRecentJobFailure({
    id: row.id,
    name: row.name,
    state: row.state,
    source: row.source,
    retryCount: readCount(row.retry_count, "job.failure.retryCount"),
    output: row.output,
    createdOn: toDate(row.created_on, "job.failure.createdOn").toISOString(),
    startedOn: toNullableIso(row.started_on, "job.failure.startedOn"),
    completedOn: toNullableIso(row.completed_on, "job.failure.completedOn"),
    logCount: readCount(row.log_count, "job.failure.logCount"),
    lastLog: normalizeRecentFailureLog(row.last_log),
  });
}

function normalizeRecentFailureLog(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("job.failure.lastLog must be an object or null");
  }
  const log = value as Record<string, unknown>;
  return {
    ...log,
    createdAt: toDate(log.createdAt, "job.failure.lastLog.createdAt").toISOString(),
  };
}

function toNullableIso(value: Date | string | null, path: string): string | null {
  return value === null ? null : toDate(value, path).toISOString();
}

async function writePauseState(
  client: PgClientLike,
  paused: boolean,
  reason: string | null,
): Promise<OpsJobsPauseState> {
  const next = npRequireJobsPauseState({
    paused,
    changedAt: new Date().toISOString(),
    changedByUserId: null,
    reason,
  });
  await client.query(
    `insert into np_settings (site_id, key, value, updated_at)
          values ('_system', 'jobs.paused', $1::jsonb, now())
          on conflict (site_id, key)
          do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}

function parsePositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new Error(`limit must be an integer between 1 and ${max.toString()}`);
  }
  return value;
}

async function listRetryableJobs(
  client: PgClientLike,
  args: { state: "failed" | "cancelled" | "expired"; name?: string | null; limit: number },
): Promise<{ jobs: RetryableJobRow[]; total: number }> {
  const values: unknown[] = [args.state];
  const clauses = ["state::text = $1"];
  if (args.name) {
    values.push(args.name);
    clauses.push(`name = $${values.length.toString()}`);
  }
  const where = clauses.join(" and ");
  const total = await client.query<{ count: string | number }>(
    `select count(*)::bigint as count
       from (
         select id, name, state, created_on, completed_on from pgboss.job
         union all
         select id, name, state, created_on, completed_on from pgboss.archive
       ) jobs
      where ${where}`,
    values,
  );
  values.push(args.limit);
  const jobs = await client.query<RetryableJobRow>(
    `select id, name, state::text as state
       from (
         select id, name, state, created_on, completed_on from pgboss.job
         union all
         select id, name, state, created_on, completed_on from pgboss.archive
       ) jobs
      where ${where}
      order by completed_on desc nulls last, created_on desc
      limit $${values.length.toString()}`,
    values,
  );
  const totalRow = total.rows[0];
  if (!totalRow) throw new Error("jobs.retryAll.total is missing");
  const normalizedJobs = jobs.rows.map((row, index) => {
    const state = row.state;
    if (state !== args.state) {
      throw new Error(`jobs.retryAll.jobs[${index.toString()}].state does not match the filter`);
    }
    return {
      id: npRequireJobId(row.id, `jobs.retryAll.jobs[${index.toString()}].id`),
      name: npRequireJobQueueName(row.name, `jobs.retryAll.jobs[${index.toString()}].name`),
      state,
    };
  });
  if (new Set(normalizedJobs.map((job) => job.id)).size !== normalizedJobs.length) {
    throw new Error("jobs.retryAll.jobs must not contain duplicate ids");
  }
  const totalCount = readCount(totalRow.count, "jobs.retryAll.total");
  if (totalCount < normalizedJobs.length) {
    throw new Error("jobs.retryAll.total must cover every selected job");
  }
  return {
    jobs: normalizedJobs,
    total: totalCount,
  };
}

export async function applyOpsJobsPauseMutation(args: {
  action: "pause" | "resume";
  reason?: string | null;
  env?: OpsJobsEnv;
  now?: Date;
}): Promise<OpsJobsJson> {
  if (args.action !== "pause" && args.action !== "resume") {
    throw new Error("action must be pause or resume");
  }
  const reason = requireOpsReason(args.reason, null);
  const env = args.env ?? process.env;
  const url = env.DATABASE_URL;
  const fallback = await collectOpsJobsStatus(env, args.now ?? new Date());
  if (args.action === "resume" && fallback.diagnosticError) {
    return {
      ...fallback,
      mutation: {
        action: args.action,
        applied: false,
        reason,
        error: fallback.diagnosticError,
      },
    };
  }
  if (!url) {
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: JOBS_STATUS_COMMAND,
      projectNextCommand: toProjectCommand(JOBS_STATUS_COMMAND),
      mutation: {
        action: args.action,
        applied: false,
        reason,
        error: "DATABASE_URL is not set",
      },
    };
  }

  let pg: PgModuleLike;
  try {
    pg = loadPg();
  } catch (error) {
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: JOBS_STATUS_COMMAND,
      projectNextCommand: toProjectCommand(JOBS_STATUS_COMMAND),
      mutation: {
        action: args.action,
        applied: false,
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await writePauseState(client, args.action === "pause", reason);
    await client.end();
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: JOBS_STATUS_COMMAND,
      projectNextCommand: toProjectCommand(JOBS_STATUS_COMMAND),
      mutation: {
        action: args.action,
        applied: false,
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const report = await collectOpsJobsStatus(env, args.now ?? new Date());
  return {
    ...report,
    mutation: {
      action: args.action,
      applied: true,
      reason,
      error: null,
    },
  };
}

export async function applyOpsJobsRetryAllMutation(args: {
  state?: "failed" | "cancelled" | "expired";
  name?: string | null;
  limit?: number;
  execute?: boolean;
  approve?: string | null;
  env?: OpsJobsEnv;
  now?: Date;
}): Promise<OpsJobsJson> {
  if (args.execute !== undefined && typeof args.execute !== "boolean") {
    throw new Error("execute must be boolean");
  }
  if (args.approve !== undefined && args.approve !== null && typeof args.approve !== "string") {
    throw new Error("approve must be text or null");
  }
  const env = args.env ?? process.env;
  const state = args.state ?? "failed";
  if (state !== "failed" && state !== "cancelled" && state !== "expired") {
    throw new Error("state must be failed, cancelled, or expired");
  }
  const limit = parsePositiveInt(args.limit, 200, 500);
  const name =
    args.name === undefined || args.name === null
      ? null
      : npRequireJobQueueName(args.name, "jobs.retryAll.name");
  const mode = args.execute ? "execute" : "dry-run";
  const reason = `state=${state}${name ? ` name=${name}` : ""}`;
  const fallback = await collectOpsJobsStatus(env, args.now ?? new Date());
  const url = env.DATABASE_URL;
  const target = { state, name, limit };

  if (fallback.diagnosticError) {
    return {
      ...fallback,
      mutation: {
        action: "retry-all",
        applied: false,
        mode,
        reason,
        error: fallback.diagnosticError,
        target,
      },
    };
  }

  if (!url) {
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: JOBS_RETRY_ALL_COMMAND,
      projectNextCommand: toProjectCommand(JOBS_RETRY_ALL_COMMAND),
      mutation: {
        action: "retry-all",
        applied: false,
        mode,
        reason,
        error: "DATABASE_URL is not set",
        target,
      },
    };
  }

  let pg: PgModuleLike;
  try {
    pg = loadPg();
  } catch (error) {
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: JOBS_RETRY_ALL_COMMAND,
      projectNextCommand: toProjectCommand(JOBS_RETRY_ALL_COMMAND),
      mutation: {
        action: "retry-all",
        applied: false,
        mode,
        reason,
        error: error instanceof Error ? error.message : String(error),
        target,
      },
    };
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const listed = await listRetryableJobs(client, { state, name, limit });
    await client.end();

    if (!args.execute) {
      const nextCommand =
        listed.jobs.length > 0
          ? `nexpress ops jobs retry-all --state ${state} --execute --approve retry-all --json`
          : fallback.nextCommand;
      return {
        ...fallback,
        nextCommand,
        projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
        mutation: {
          action: "retry-all",
          applied: false,
          mode,
          reason,
          error: null,
          target,
          result: {
            matched: listed.total,
            planned: listed.jobs.length,
            remaining: Math.max(0, listed.total - listed.jobs.length),
          },
        },
      };
    }

    if (args.approve !== "retry-all") {
      return {
        ...fallback,
        ok: false,
        status: "blocked",
        nextCommand: `nexpress ops jobs retry-all --state ${state} --execute --approve retry-all --json`,
        projectNextCommand: toProjectCommand(
          `nexpress ops jobs retry-all --state ${state} --execute --approve retry-all --json`,
        ),
        mutation: {
          action: "retry-all",
          applied: false,
          mode,
          reason,
          error: "Missing --approve retry-all",
          target,
          result: { matched: listed.total, planned: listed.jobs.length },
        },
      };
    }

    const adapter = new PgBossAdapter(url, { schema: "pgboss" });
    let retried = 0;
    let failed = 0;
    try {
      await adapter.startProducer();
      for (const job of listed.jobs) {
        try {
          await adapter.retryJob(job.id);
          retried += 1;
        } catch {
          failed += 1;
        }
      }
    } finally {
      await adapter.stop().catch(() => {
        /* swallow */
      });
    }

    const report = await collectOpsJobsStatus(env, args.now ?? new Date());
    return {
      ...report,
      mutation: {
        action: "retry-all",
        applied: failed === 0,
        mode,
        reason,
        error: failed > 0 ? `${failed.toString()} jobs failed to retry` : null,
        target,
        result: {
          matched: listed.total,
          retried,
          failed,
          remaining: Math.max(0, listed.total - retried),
        },
      },
    };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: JOBS_RETRY_ALL_COMMAND,
      projectNextCommand: toProjectCommand(JOBS_RETRY_ALL_COMMAND),
      mutation: {
        action: "retry-all",
        applied: false,
        mode,
        reason,
        error: error instanceof Error ? error.message : String(error),
        target,
      },
    };
  }
}

export async function applyOpsJobsDrainMutation(args: {
  execute?: boolean;
  approve?: string | null;
  reason?: string | null;
  env?: OpsJobsEnv;
  now?: Date;
}): Promise<OpsJobsJson> {
  if (args.execute !== undefined && typeof args.execute !== "boolean") {
    throw new Error("execute must be boolean");
  }
  if (args.approve !== undefined && args.approve !== null && typeof args.approve !== "string") {
    throw new Error("approve must be text or null");
  }
  const reason = requireOpsReason(args.reason, "drain");
  if (!args.execute) {
    const report = await collectOpsJobsStatus(args.env, args.now ?? new Date());
    return {
      ...report,
      nextCommand: "nexpress ops jobs drain --execute --approve drain --json",
      projectNextCommand: toProjectCommand(
        "nexpress ops jobs drain --execute --approve drain --json",
      ),
      mutation: {
        action: "drain",
        applied: false,
        mode: "dry-run",
        reason,
        error: report.diagnosticError,
        result: {
          active: report.counts.active,
          created: report.counts.created,
          retry: report.counts.retry,
          paused: report.pause.paused,
        },
      },
    };
  }

  if (args.approve !== "drain") {
    const report = await collectOpsJobsStatus(args.env, args.now ?? new Date());
    return {
      ...report,
      ok: false,
      status: "blocked",
      nextCommand: "nexpress ops jobs drain --execute --approve drain --json",
      projectNextCommand: toProjectCommand(
        "nexpress ops jobs drain --execute --approve drain --json",
      ),
      mutation: {
        action: "drain",
        applied: false,
        mode: "execute",
        reason,
        error: "Missing --approve drain",
      },
    };
  }

  const report = await applyOpsJobsPauseMutation({
    action: "pause",
    reason,
    env: args.env,
    now: args.now,
  });
  const nextCommand =
    report.counts.active > 0 || report.counts.created > 0 || report.counts.retry > 0
      ? JOBS_STATUS_COMMAND
      : report.nextCommand;
  return {
    ...report,
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    mutation: {
      action: "drain",
      applied: report.mutation?.applied ?? false,
      mode: "execute",
      reason,
      error: report.mutation?.error ?? null,
      result: {
        active: report.counts.active,
        created: report.counts.created,
        retry: report.counts.retry,
        paused: report.pause.paused,
      },
    },
  };
}

function requireOpsReason(value: unknown, fallback: string | null): string | null {
  const reason = value === undefined ? fallback : value;
  return npRequireJobsPauseState({
    paused: false,
    changedAt: new Date(0).toISOString(),
    changedByUserId: null,
    reason,
  }).reason;
}

export function renderBriefOpsJobsStatus(
  report: OpsJobsJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const state =
    report.status === "ready"
      ? `${c.green}ready${c.reset}`
      : report.status === "disabled"
        ? `${c.dim}disabled${c.reset}`
        : report.status === "attention"
          ? `${c.yellow}attention${c.reset}`
          : `${c.red}blocked${c.reset}`;
  const lines = [
    `${c.dim}NexPress ops jobs${c.reset}`,
    `${state}: ${report.enabled ? "enabled" : "disabled"}`,
    `workers: ${report.summary.workersAlive.toString()}/${report.summary.workersTotal.toString()} alive`,
    `jobs: ${report.summary.created.toString()} created, ${report.summary.active.toString()} active, ${report.summary.retry.toString()} retry, ${report.summary.failed.toString()} failed/expired`,
  ];
  if (report.diagnosticError) lines.push(`diagnostic error: ${report.diagnosticError}`);
  if (report.pause.paused) lines.push(`paused: ${report.pause.reason ?? "yes"}`);
  if (report.mutation) {
    lines.push(
      `mutation: ${report.mutation.action} applied=${String(report.mutation.applied)}${report.mutation.error ? ` error=${report.mutation.error}` : ""}`,
    );
  }
  if (report.recentFailures.length > 0) {
    lines.push("recent failures:");
    for (const failure of report.recentFailures.slice(0, 3)) {
      lines.push(`- ${failure.state} ${failure.name} ${failure.id}: ${failureSummary(failure)}`);
    }
  }
  for (const worker of report.workers.slice(0, 5)) {
    lines.push(
      `${worker.alive ? "[alive]" : "[stale]"} ${worker.id} - last seen ${worker.lastSeenAgoMs.toString()}ms ago`,
    );
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}

function failureSummary(failure: OpsJobsRecentFailure): string {
  return failure.lastLog?.message ?? failure.output ?? "no job log captured";
}
