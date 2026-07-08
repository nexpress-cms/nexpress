import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { toProjectCommand } from "./ops-command-format.js";
import { messageForConnectionError } from "./setup-server-errors.js";
import type { CheckResult } from "./doctor-readiness.js";
import {
  buildMigrationStatus,
  readAppliedMigrations,
  readLocalMigrationEntries,
} from "./migration-status.js";
import { checkMigrationStatusReadiness } from "./doctor-readiness.js";
import type * as OpsJobsCore from "./ops-jobs-core.js";

type OpsEnv = Record<string, string | undefined>;

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

export interface OpsStatusSummary {
  total: number;
  errors: number;
  warnings: number;
}

export interface OpsStatusJson {
  schemaVersion: "np.ops.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  summary: OpsStatusSummary;
  nextCommand: string | null;
  projectNextCommand: string | null;
  checks: CheckResult[];
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

export function summarizeOpsChecks(checks: CheckResult[]): OpsStatusSummary {
  return {
    total: checks.length,
    errors: checks.filter((check) => check.state === "error").length,
    warnings: checks.filter((check) => check.state === "warn").length,
  };
}

export function buildOpsStatusJson(checks: CheckResult[]): OpsStatusJson {
  const summary = summarizeOpsChecks(checks);
  const status = summary.errors > 0 ? "blocked" : summary.warnings > 0 ? "attention" : "ready";
  const nextCommand =
    status === "ready" ? null : (commandFromChecks(checks) ?? "pnpm run doctor -- --fix-plan");
  return {
    schemaVersion: "np.ops.v1",
    ok: summary.errors === 0,
    status,
    summary,
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    checks,
  };
}

function commandFromChecks(checks: CheckResult[]): string | null {
  const errors = checks.filter((check) => check.state === "error");
  const actionable = errors.find((check) => extractCommand(check.hint));
  if (actionable) return extractCommand(actionable.hint);
  if (errors.length > 0) return null;
  const warning = checks.find((check) => check.state === "warn" && extractCommand(check.hint));
  return warning ? extractCommand(warning.hint) : null;
}

function extractCommand(hint: string | undefined): string | null {
  if (!hint) return null;
  const match = hint.match(/`([^`]+)`/);
  if (match?.[1]) return match[1];
  const trimmed = hint.trim();
  return /^(nexpress|pnpm|npm|yarn)\s/.test(trimmed) ? trimmed : null;
}

function formatBriefState(state: CheckResult["state"], color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  if (state === "ok") return `${c.green}[ok]${c.reset}`;
  if (state === "warn") return `${c.yellow}[warn]${c.reset}`;
  return `${c.red}[error]${c.reset}`;
}

export function renderBriefOpsStatus(
  report: OpsStatusJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const lines = [
    `${c.dim}NexPress ops status${c.reset}`,
    `${report.status}: ${report.summary.errors.toString()} errors, ${report.summary.warnings.toString()} warnings.`,
  ];
  for (const check of report.checks) {
    const parts = [formatBriefState(check.state, options.color), check.id, check.label];
    if (check.detail) parts.push(`- ${check.detail.replace(/\s+/g, " ")}`);
    lines.push(parts.join(" "));
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}

export async function collectOpsStatusChecks(env: OpsEnv = process.env): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  checks.push(checkNodeVersion());
  checks.push(await checkEnvFile());
  checks.push(checkRequiredEnv("DATABASE_URL", /^postgres(?:ql)?:\/\//, env));
  checks.push(checkRequiredEnv("NP_SECRET", null, env, 32));
  checks.push(checkRequiredEnv("SITE_URL", /^https?:\/\//, env));
  checks.push(checkSiteUrl(env));
  checks.push(checkJobs(env));
  checks.push(await checkWorkerHeartbeat(env));
  checks.push(await checkStorage(env));
  checks.push(await checkDatabase(env));
  checks.push(await checkMigrations(env));
  return checks;
}

function checkNodeVersion(): CheckResult {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (Number.isNaN(major) || major < 20) {
    return {
      id: "runtime.node",
      state: "error",
      label: "Node.js >= 20",
      detail: `running ${process.versions.node}`,
      hint: "NexPress requires Node 20+.",
    };
  }
  return { id: "runtime.node", state: "ok", label: "Node.js >= 20", detail: process.versions.node };
}

async function checkEnvFile(): Promise<CheckResult> {
  try {
    await access(
      /* turbopackIgnore: true */ resolve(/* turbopackIgnore: true */ process.cwd(), ".env"),
    );
    return { id: "env.file", state: "ok", label: ".env file present" };
  } catch {
    return {
      id: "env.file",
      state: "error",
      label: ".env file present",
      hint: "Run `pnpm run setup` or copy .env.example to .env.",
    };
  }
}

function checkRequiredEnv(
  name: "DATABASE_URL" | "NP_SECRET" | "SITE_URL",
  pattern: RegExp | null,
  env: OpsEnv,
  minLength?: number,
): CheckResult {
  const value = env[name] ?? "";
  if (!value) {
    return {
      id: `env.${name.toLowerCase()}`,
      state: "error",
      label: name,
      detail: "not set",
      hint: "Run `pnpm run setup` to write required environment variables.",
    };
  }
  if (pattern && !pattern.test(value)) {
    return {
      id: `env.${name.toLowerCase()}`,
      state: "error",
      label: name,
      detail: "set but does not match expected shape",
      hint: "Run `pnpm run setup` and review the generated .env.",
    };
  }
  if (minLength && value.length < minLength) {
    return {
      id: `env.${name.toLowerCase()}`,
      state: "warn",
      label: name,
      detail: `set but only ${value.length.toString()} chars`,
      hint: "Use a 32+ character random secret.",
    };
  }
  return { id: `env.${name.toLowerCase()}`, state: "ok", label: name };
}

function checkSiteUrl(env: OpsEnv): CheckResult {
  const url = env.SITE_URL ?? "";
  if (!url) {
    return {
      id: "site.url",
      state: "error",
      label: "SITE_URL",
      detail: "not set",
      hint: "Set SITE_URL to the public origin.",
    };
  }
  try {
    const parsed = new URL(url);
    return {
      id: "site.url",
      state: "ok",
      label: "SITE_URL",
      detail: parsed.origin,
    };
  } catch {
    return {
      id: "site.url",
      state: "error",
      label: "SITE_URL",
      detail: "not a valid URL",
      hint: "Set SITE_URL to a full origin such as http://localhost:3000.",
    };
  }
}

function checkJobs(env: OpsEnv): CheckResult {
  const enabled = env.NP_ENABLE_JOBS === "1" || env.NP_ENABLE_JOBS === "true";
  if (enabled) {
    return { id: "jobs.enabled", state: "ok", label: "Jobs enabled", detail: "NP_ENABLE_JOBS=1" };
  }
  return {
    id: "jobs.enabled",
    state: "warn",
    label: "Jobs enabled",
    detail: "NP_ENABLE_JOBS not set",
    hint: "Set NP_ENABLE_JOBS=1 and run `pnpm run worker` when scheduled publishing or async jobs matter.",
  };
}

async function checkWorkerHeartbeat(env: OpsEnv): Promise<CheckResult> {
  const enabled = env.NP_ENABLE_JOBS === "1" || env.NP_ENABLE_JOBS === "true";
  if (!enabled) {
    return {
      id: "jobs.worker",
      state: "ok",
      label: "Worker heartbeat",
      detail: "skipped (jobs disabled)",
    };
  }
  const jobsCore = await loadJobsCore();
  const report = await jobsCore.collectOpsJobsStatus(env);
  if (report.status === "ready") {
    return {
      id: "jobs.worker",
      state: "ok",
      label: "Worker heartbeat",
      detail: `${report.summary.workersAlive.toString()}/${report.summary.workersTotal.toString()} workers alive`,
    };
  }
  if (report.status === "blocked") {
    if (report.pause.paused) {
      return {
        id: "jobs.paused",
        state: "error",
        label: "Jobs paused",
        detail: report.pause.reason ?? "paused",
        hint: report.nextCommand ?? "Resume job processing.",
      };
    }
    return {
      id: "jobs.worker_stale",
      state: "error",
      label: "Worker heartbeat",
      detail: `${report.summary.workersAlive.toString()}/${report.summary.workersTotal.toString()} workers alive`,
      hint: report.nextCommand ?? "Start or resume the worker process.",
    };
  }
  if (report.summary.workersAlive === 0) {
    return {
      id: "jobs.worker_stale",
      state: "warn",
      label: "Worker heartbeat",
      detail: `${report.summary.workersAlive.toString()}/${report.summary.workersTotal.toString()} workers alive`,
      hint: report.nextCommand ?? "Run `nexpress ops jobs status --json` for details.",
    };
  }
  if (report.summary.failed > 0) {
    const latest = report.recentFailures[0];
    return {
      id: "jobs.failed_recent",
      state: "warn",
      label: "Recent failed jobs",
      detail: latest
        ? `${report.summary.failed.toString()} failed/expired; latest ${latest.state} ${latest.name}`
        : `${report.summary.failed.toString()} failed/expired`,
      hint: latest
        ? `${latest.lastLog?.message ?? latest.output ?? "Review the recent failure."} Run \`${report.nextCommand ?? "nexpress ops jobs status --json"}\`.`
        : (report.nextCommand ?? "Run `nexpress ops jobs status --json` for details."),
    };
  }
  if (report.summary.retry > 0) {
    return {
      id: "jobs.queue_retry",
      state: "warn",
      label: "Retrying jobs",
      detail: `${report.summary.retry.toString()} jobs scheduled to retry`,
      hint: report.nextCommand ?? "Run `nexpress ops jobs drain --json` for details.",
    };
  }
  return {
    id: "jobs.worker_stale",
    state: "warn",
    label: "Worker heartbeat",
    detail: `${report.summary.workersAlive.toString()}/${report.summary.workersTotal.toString()} workers alive`,
    hint: report.nextCommand ?? "Run `nexpress ops jobs status --json` for details.",
  };
}

async function loadJobsCore(): Promise<typeof OpsJobsCore> {
  return import("./ops-jobs-core.js");
}

async function checkStorage(env: OpsEnv): Promise<CheckResult> {
  const adapter = (env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
  if (adapter === "s3") {
    const missing = ["NP_S3_BUCKET", "NP_S3_REGION"].filter((name) => !env[name]);
    if (missing.length > 0) {
      return {
        id: "storage.adapter",
        state: "error",
        label: "Storage adapter",
        detail: `s3 missing ${missing.join(", ")}`,
        hint: "Set NP_S3_BUCKET and NP_S3_REGION, plus NP_S3_ENDPOINT for R2/MinIO.",
      };
    }
    return { id: "storage.adapter", state: "ok", label: "Storage adapter", detail: "s3" };
  }

  const dir = env.NP_STORAGE_DIR ?? "./public/media";
  try {
    const stats = await stat(
      /* turbopackIgnore: true */ resolve(/* turbopackIgnore: true */ process.cwd(), dir),
    );
    if (!stats.isDirectory()) {
      return {
        id: "storage.adapter",
        state: "error",
        label: "Storage adapter",
        detail: `${dir} is not a directory`,
        hint: "Move the file aside or set NP_STORAGE_DIR to a directory.",
      };
    }
    return { id: "storage.adapter", state: "ok", label: "Storage adapter", detail: `local ${dir}` };
  } catch {
    return {
      id: "storage.adapter",
      state: "warn",
      label: "Storage adapter",
      detail: `local ${dir} not created yet`,
      hint: "The directory is created on first upload; create it manually in read-only environments.",
    };
  }
}

async function loadPg(): Promise<unknown> {
  return import("pg");
}

async function checkDatabase(env: OpsEnv): Promise<CheckResult> {
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "database.reachable",
      state: "error",
      label: "Postgres reachable",
      detail: "DATABASE_URL not set",
      hint: "Set DATABASE_URL first.",
    };
  }

  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "database.reachable",
      state: "warn",
      label: "Postgres reachable",
      detail: "`pg` not installed",
      hint: "Run `pnpm install` first.",
    };
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const result = await client.query<{ version: string }>("select version()");
    await client.end();
    const version = result.rows[0]?.version?.split(" ").slice(0, 2).join(" ") ?? "Postgres";
    return { id: "database.reachable", state: "ok", label: "Postgres reachable", detail: version };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "database.reachable",
      state: "error",
      label: "Postgres reachable",
      detail: messageForConnectionError(url, error),
    };
  }
}

async function checkMigrations(env: OpsEnv): Promise<CheckResult> {
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: "skipped (no DATABASE_URL)",
    };
  }

  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: "skipped (no `pg`)",
    };
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const local = readLocalMigrationEntries("./drizzle");
    const applied = await readAppliedMigrations(client);
    const result = checkMigrationStatusReadiness(false, buildMigrationStatus(local, applied));
    await client.end();
    return result;
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: `status unavailable: ${error instanceof Error ? error.message : String(error)}`,
      hint: "Run `pnpm db:migrate -- --status` for the dedicated migration report.",
    };
  }
}
