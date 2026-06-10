import { createRequire } from "node:module";
import { resolve } from "node:path";

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
    action: "pause" | "resume";
    applied: boolean;
    reason: string | null;
    error: string | null;
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
    nextCommand:
      status === "blocked"
        ? args.pause.paused
          ? "nexpress ops jobs status --json"
          : "pnpm worker"
        : status === "attention"
          ? "pnpm worker"
          : null,
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
  return lines.join("\n");
}
