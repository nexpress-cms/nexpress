import { createRequire } from "node:module";
import { resolve } from "node:path";

import { PgBossAdapter } from "@nexpress/core/jobs";

import { toProjectCommand } from "./ops-command-format.js";

export interface OpsJobsWorker {
  id: string;
  status: string;
  startedAt: string;
  lastSeenAt: string;
  lastSeenAgoMs: number;
  alive: boolean;
  meta: Record<string, unknown>;
}

export interface OpsJobsCounts {
  created: number;
  active: number;
  completed: number;
  failed: number;
  retry: number;
  cancelled: number;
  expired: number;
}

export interface OpsJobsPauseState {
  paused: boolean;
  changedAt: string;
  changedByUserId: string | null;
  reason: string | null;
}

export interface OpsJobsJson {
  schemaVersion: "np.ops-jobs.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked" | "disabled";
  enabled: boolean;
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
  meta: Record<string, unknown> | null;
}

interface PauseRow {
  value: Partial<OpsJobsPauseState> | null;
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
  return env.NP_ENABLE_JOBS === "1" || env.NP_ENABLE_JOBS === "true";
}

export function workerStaleThresholdMs(env: OpsJobsEnv = process.env): number {
  const raw = Number.parseInt(env.NP_WORKER_STALE_THRESHOLD_SECONDS ?? "90", 10);
  return (Number.isFinite(raw) && raw > 0 ? raw : 90) * 1_000;
}

async function loadPg(): Promise<PgModuleLike> {
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const resolved = require.resolve("pg");
  return import(resolved) as Promise<PgModuleLike>;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function readCount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePause(value: Partial<OpsJobsPauseState> | null | undefined): OpsJobsPauseState {
  if (!value || typeof value.paused !== "boolean") return DEFAULT_PAUSE;
  return {
    paused: value.paused,
    changedAt: typeof value.changedAt === "string" ? value.changedAt : DEFAULT_PAUSE.changedAt,
    changedByUserId: typeof value.changedByUserId === "string" ? value.changedByUserId : null,
    reason: typeof value.reason === "string" ? value.reason : null,
  };
}

export function buildOpsJobsJson(args: {
  enabled: boolean;
  pause: OpsJobsPauseState;
  counts: OpsJobsCounts;
  workers: OpsJobsWorker[];
  mutation?: OpsJobsJson["mutation"];
}): OpsJobsJson {
  const workersAlive = args.workers.filter((worker) => worker.alive).length;
  const workersTotal = args.workers.length;
  const hasFailures = args.counts.failed > 0 || args.counts.expired > 0;
  const hasRetry = args.counts.retry > 0;
  const hasBacklog = args.counts.created > 0 && workersAlive === 0;
  const blocked = args.enabled && (args.pause.paused || hasBacklog);
  const attention = args.enabled && !blocked && (workersAlive === 0 || hasFailures || hasRetry);
  const status: OpsJobsJson["status"] = !args.enabled
    ? "disabled"
    : blocked
      ? "blocked"
      : attention
        ? "attention"
        : "ready";
  const nextCommand =
    status === "blocked"
      ? args.pause.paused
        ? "nexpress ops jobs resume --json"
        : "pnpm worker"
      : status === "attention"
        ? hasFailures
          ? "nexpress ops jobs retry-all --state failed --json"
          : workersAlive === 0
            ? "pnpm worker"
            : hasRetry
              ? "nexpress ops jobs drain --json"
              : "nexpress ops jobs status --json"
        : null;

  return {
    schemaVersion: "np.ops-jobs.v1",
    ok: status === "ready" || status === "disabled" || status === "attention",
    status,
    enabled: args.enabled,
    mutation: args.mutation ?? null,
    summary: {
      workersAlive,
      workersTotal,
      failed: args.counts.failed + args.counts.expired,
      retry: args.counts.retry,
      created: args.counts.created,
      active: args.counts.active,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    pause: args.pause,
    counts: args.counts,
    workers: args.workers,
  };
}

export async function collectOpsJobsStatus(
  env: OpsJobsEnv = process.env,
  now: Date = new Date(),
): Promise<OpsJobsJson> {
  const enabled = jobsEnabled(env);
  const url = env.DATABASE_URL;
  if (!url) {
    return buildOpsJobsJson({
      enabled,
      pause: DEFAULT_PAUSE,
      counts: EMPTY_COUNTS,
      workers: [],
    });
  }

  let pg: PgModuleLike;
  try {
    pg = await loadPg();
  } catch {
    return buildOpsJobsJson({
      enabled,
      pause: DEFAULT_PAUSE,
      counts: EMPTY_COUNTS,
      workers: [],
    });
  }

  const threshold = workerStaleThresholdMs(env);
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
    await client.end();

    const workers = workerRows.rows.map((row) => {
      const lastSeenAt = toIso(row.last_seen_at);
      const lastSeenMs = new Date(lastSeenAt).getTime();
      const lastSeenAgoMs = Number.isFinite(lastSeenMs)
        ? Math.max(0, now.getTime() - lastSeenMs)
        : Number.MAX_SAFE_INTEGER;
      return {
        id: row.id,
        status: row.status,
        startedAt: toIso(row.started_at),
        lastSeenAt,
        lastSeenAgoMs,
        alive: row.status === "running" && lastSeenAgoMs < threshold,
        meta: row.meta ?? {},
      };
    });
    const counts: OpsJobsCounts = { ...EMPTY_COUNTS };
    for (const row of countRows.rows) {
      const key = row.state as keyof OpsJobsCounts;
      if (key in counts) counts[key] = readCount(row.count);
    }

    return buildOpsJobsJson({
      enabled,
      pause: normalizePause(pauseRows.rows[0]?.value),
      counts,
      workers,
    });
  } catch {
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
    });
  }
}

async function writePauseState(
  client: PgClientLike,
  paused: boolean,
  reason: string | null,
): Promise<OpsJobsPauseState> {
  const next: OpsJobsPauseState = {
    paused,
    changedAt: new Date().toISOString(),
    changedByUserId: null,
    reason,
  };
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
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
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
  return {
    jobs: jobs.rows,
    total: readCount(total.rows[0]?.count ?? 0),
  };
}

export async function applyOpsJobsPauseMutation(args: {
  action: "pause" | "resume";
  reason?: string | null;
  env?: OpsJobsEnv;
  now?: Date;
}): Promise<OpsJobsJson> {
  const env = args.env ?? process.env;
  const url = env.DATABASE_URL;
  const fallback = await collectOpsJobsStatus(env, args.now ?? new Date());
  if (!url) {
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: "Set DATABASE_URL and rerun nexpress ops jobs status --json",
      projectNextCommand: "Set DATABASE_URL and rerun nexpress ops jobs status --json",
      mutation: {
        action: args.action,
        applied: false,
        reason: args.reason ?? null,
        error: "DATABASE_URL is not set",
      },
    };
  }

  let pg: PgModuleLike;
  try {
    pg = await loadPg();
  } catch (error) {
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: "Install pg and rerun nexpress ops jobs status --json",
      projectNextCommand: "Install pg and rerun nexpress ops jobs status --json",
      mutation: {
        action: args.action,
        applied: false,
        reason: args.reason ?? null,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await writePauseState(client, args.action === "pause", args.reason ?? null);
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
      nextCommand: "Check DATABASE_URL and rerun nexpress ops jobs status --json",
      projectNextCommand: "Check DATABASE_URL and rerun nexpress ops jobs status --json",
      mutation: {
        action: args.action,
        applied: false,
        reason: args.reason ?? null,
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
      reason: args.reason ?? null,
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
  const env = args.env ?? process.env;
  const state = args.state ?? "failed";
  const limit = parsePositiveInt(args.limit, 200, 500);
  const mode = args.execute ? "execute" : "dry-run";
  const reason = `state=${state}${args.name ? ` name=${args.name}` : ""}`;
  const fallback = await collectOpsJobsStatus(env, args.now ?? new Date());
  const url = env.DATABASE_URL;
  const target = { state, name: args.name ?? null, limit };

  if (!url) {
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: "Set DATABASE_URL and rerun nexpress ops jobs retry-all --json",
      projectNextCommand: "Set DATABASE_URL and rerun nexpress ops jobs retry-all --json",
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
    pg = await loadPg();
  } catch (error) {
    return {
      ...fallback,
      ok: false,
      status: "blocked",
      nextCommand: "Install pg and rerun nexpress ops jobs retry-all --json",
      projectNextCommand: "Install pg and rerun nexpress ops jobs retry-all --json",
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
    const listed = await listRetryableJobs(client, { state, name: args.name, limit });
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

    const adapter = new PgBossAdapter(url, { schema: "public" });
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
      nextCommand: "Check DATABASE_URL and rerun nexpress ops jobs retry-all --json",
      projectNextCommand: "Check DATABASE_URL and rerun nexpress ops jobs retry-all --json",
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
        reason: args.reason ?? "drain",
        error: null,
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
        reason: args.reason ?? "drain",
        error: "Missing --approve drain",
      },
    };
  }

  const report = await applyOpsJobsPauseMutation({
    action: "pause",
    reason: args.reason ?? "drain",
    env: args.env,
    now: args.now,
  });
  const nextCommand =
    report.counts.active > 0 || report.counts.created > 0 || report.counts.retry > 0
      ? "nexpress ops jobs status --json"
      : report.nextCommand;
  return {
    ...report,
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    mutation: {
      action: "drain",
      applied: report.mutation?.applied ?? false,
      mode: "execute",
      reason: args.reason ?? "drain",
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
  if (report.pause.paused) lines.push(`paused: ${report.pause.reason ?? "yes"}`);
  if (report.mutation) {
    lines.push(
      `mutation: ${report.mutation.action} applied=${String(report.mutation.applied)}${report.mutation.error ? ` error=${report.mutation.error}` : ""}`,
    );
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
