import { AsyncLocalStorage } from "node:async_hooks";

import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { readEnvPositiveInt } from "../config/env.js";
import { npJobLogs } from "../db/schema/system.js";
import { type NpLogLevel, getLogger } from "../observability/logger.js";

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
  return jobLogStorage.run({ jobId }, fn);
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
    await db.insert(npJobLogs).values({
      jobId,
      level,
      message,
      context: context ?? null,
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

export interface NpJobLogEntry {
  id: string;
  jobId: string;
  level: NpLogLevel;
  message: string;
  context: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ListJobLogsOptions {
  /** Cap on rows returned. Default 200, max 1000 to keep the admin UI snappy. */
  limit?: number;
  /** Skip this many rows for pagination. */
  offset?: number;
}

/**
 * Fetch log entries for one job in chronological order. Paged so
 * a runaway handler doesn't blow up the admin UI.
 */
export async function listJobLogs(
  jobId: string,
  options: ListJobLogsOptions = {},
): Promise<NpJobLogEntry[]> {
  const limit = Math.min(Math.max(1, options.limit ?? 200), 1000);
  const offset = Math.max(0, options.offset ?? 0);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;

  const rows = (await db
    .select()
    .from(npJobLogs)
    .where(eq(npJobLogs.jobId, jobId))
    .orderBy(asc(npJobLogs.createdAt))
    .limit(limit)
    .offset(offset)) as Array<{
    id: string;
    jobId: string;
    level: string;
    message: string;
    context: Record<string, unknown> | null;
    createdAt: Date;
  }>;

  return rows.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    level: row.level as NpLogLevel,
    message: row.message,
    context: row.context,
    createdAt: row.createdAt,
  }));
}

/**
 * How long per-job log rows survive before the cleanup handler
 * deletes them. Compliance regimes (GDPR, SOX) frequently dictate
 * a specific window — override via `NP_JOB_LOG_RETENTION_DAYS`.
 */
export const DEFAULT_JOB_LOG_RETENTION_MS =
  readEnvPositiveInt("NP_JOB_LOG_RETENTION_DAYS", 14) * 24 * 60 * 60 * 1000;

/**
 * Delete log rows older than the cutoff. Safe to call from a
 * scheduled handler — does not touch logs for active or recent
 * jobs unless they pre-date the cutoff.
 *
 * Returns the row count deleted so the cron handler can log a
 * useful retention summary.
 */
export async function pruneJobLogsOlderThan(cutoff: Date): Promise<number> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const where = sinceCreatedAt
    ? and(eq(npJobLogs.jobId, jobId), gte(npJobLogs.createdAt, sinceCreatedAt))
    : eq(npJobLogs.jobId, jobId);
  const rows = (await db.select({ id: npJobLogs.id }).from(npJobLogs).where(where)) as Array<{
    id: string;
  }>;
  return rows.length;
}
