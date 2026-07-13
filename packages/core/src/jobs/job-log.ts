import { AsyncLocalStorage } from "node:async_hooks";

import { and, asc, desc, eq, gte, lt } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npJobLogs } from "../db/schema/system.js";
import {
  npRequireJobId,
  npRequireJobLogEntry,
  npRequireJobLogInput,
  type NpJobLogEntry,
} from "../jobs-contract/index.js";
import { type NpLogLevel, getLogger } from "../observability/logger.js";
import { npReadJobDurationMs } from "./runtime-config.js";

/**
 * Phase 20.3 — per-job log capture.
 *
 * Each handler invocation runs inside an AsyncLocalStorage context
 * keyed on the pg-boss job id. While inside the context,
 * `recordJobLog()` writes to `np_job_logs` stamped with that id;
 * outside the context it no-ops, so the helper is safe to import
 * from non-handler code (and from plugins that don't know whether
 * they're inside a handler).
 *
 * The framework's pg-boss adapter sets the context automatically
 * (see `pg-boss-adapter.ts` — every `boss.work()` callback is
 * wrapped in `runInJobContext`). Handlers don't have to do
 * anything to opt in — calls to `recordJobLog()` just work.
 */

interface JobLogContext {
  jobId: string;
}

const jobLogStorage = new AsyncLocalStorage<JobLogContext>();

export function runInJobContext<T>(jobId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return jobLogStorage.run({ jobId: npRequireJobId(jobId) }, fn);
}

export function getCurrentJobId(): string | null {
  const store = jobLogStorage.getStore();
  return store?.jobId ?? null;
}

/**
 * Record one log entry for the currently-running job. Async because
 * it writes to Postgres; callers can `void` the promise if they
 * don't need to wait. No-ops outside a job context (returns
 * immediately without touching the DB).
 *
 * Errors writing to the log table are swallowed via the framework
 * logger at `warn` — a logging failure must never cascade into a
 * job failure or shutdown loop.
 */
export async function recordJobLog(
  level: NpLogLevel,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const jobId = getCurrentJobId();
  if (!jobId) return;

  try {
    const db = getDb();
    const normalized = npRequireJobLogInput({
      level,
      message,
      context: context ?? null,
    });
    await db.insert(npJobLogs).values({
      jobId,
      level: normalized.level,
      message: normalized.message,
      context: normalized.context,
    });
  } catch (err) {
    // Don't throw from a logging path — just surface to whatever
    // sink the framework logger is wired to.
    getLogger().warn("recordJobLog failed", {
      jobId,
      level,
      message,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface ListJobLogsOptions {
  /** Cap on rows returned. Default 200, max 1000 to keep the admin UI snappy. */
  limit?: number;
  /** Skip this many rows for pagination. */
  offset?: number;
  /** Sort direction. Default chronological (`asc`) for the admin log stream. */
  order?: "asc" | "desc";
}

/**
 * Fetch log entries for one job in chronological order. Paged so
 * a runaway handler doesn't blow up the admin UI.
 */
export async function listJobLogs(
  jobId: string,
  options: ListJobLogsOptions = {},
): Promise<NpJobLogEntry[]> {
  requireExactLogOptions(options);
  const canonicalId = npRequireJobId(jobId);
  const limit = requireBoundedInteger(options.limit, "job.logs.limit", 200, 1, 1_000);
  const offset = requireBoundedInteger(options.offset, "job.logs.offset", 0, 0, 100_000);
  if (options.order !== undefined && options.order !== "asc" && options.order !== "desc") {
    throw new Error("job.logs.order must be asc or desc");
  }
  const orderBy = options.order === "desc" ? desc(npJobLogs.createdAt) : asc(npJobLogs.createdAt);
  const db = getDb();

  const rows = (await db
    .select()
    .from(npJobLogs)
    .where(eq(npJobLogs.jobId, canonicalId))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)) as Array<{
    id: string;
    jobId: string;
    level: string;
    message: string;
    context: Record<string, unknown> | null;
    createdAt: Date;
  }>;

  return rows.map((row) => npRequireJobLogEntry(row));
}

export type { NpJobLogEntry } from "../jobs-contract/index.js";

/**
 * How long per-job log rows survive before the cleanup handler
 * deletes them. Compliance regimes (GDPR, SOX) frequently dictate
 * a specific window — override via `NP_JOB_LOG_RETENTION_DAYS`.
 */
export const DEFAULT_JOB_LOG_RETENTION_MS = npReadJobDurationMs(
  "NP_JOB_LOG_RETENTION_DAYS",
  14,
  24 * 60 * 60 * 1_000,
);

/**
 * Delete log rows older than the cutoff. Safe to call from a
 * scheduled handler — does not touch logs for active or recent
 * jobs unless they pre-date the cutoff.
 *
 * Returns the row count deleted so the cron handler can log a
 * useful retention summary.
 */
export async function pruneJobLogsOlderThan(cutoff: Date): Promise<number> {
  if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) {
    throw new Error("job.logs.cutoff must be a valid Date");
  }
  const db = getDb();
  const deleted = (await db
    .delete(npJobLogs)
    .where(lt(npJobLogs.createdAt, cutoff))
    .returning({ id: npJobLogs.id })) as Array<{ id: string }>;
  return deleted.length;
}

/**
 * Count entries for a job — drives the admin badge "37 log lines"
 * without paying for the page payload until the operator expands.
 */
export async function countJobLogs(jobId: string, sinceCreatedAt?: Date): Promise<number> {
  const canonicalId = npRequireJobId(jobId);
  if (
    sinceCreatedAt !== undefined &&
    (!(sinceCreatedAt instanceof Date) || Number.isNaN(sinceCreatedAt.getTime()))
  ) {
    throw new Error("job.logs.sinceCreatedAt must be a valid Date");
  }
  const db = getDb();
  const where = sinceCreatedAt
    ? and(eq(npJobLogs.jobId, canonicalId), gte(npJobLogs.createdAt, sinceCreatedAt))
    : eq(npJobLogs.jobId, canonicalId);
  const rows = (await db.select({ id: npJobLogs.id }).from(npJobLogs).where(where)) as Array<{
    id: string;
  }>;
  return rows.length;
}

function requireExactLogOptions(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("job.logs options must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("job.logs options must be a plain object");
  }
  const allowed = new Set(["limit", "offset", "order"]);
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error("job.logs options must not contain symbol properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(`job.logs.${key} must be an enumerable plain data property`);
    }
    keys.push(key);
  }
  const unsupported = keys.find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`job.logs.${unsupported} is not supported`);
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
    throw new Error(`${path} must be an integer between ${min.toString()} and ${max.toString()}`);
  }
  return value;
}
