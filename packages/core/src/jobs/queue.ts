import { type NxJobType } from "../config/types.js";

/**
 * Phase 13 — admin-side job introspection. pg-boss tracks jobs
 * across two tables (`pgboss.job` for active/scheduled,
 * `pgboss.archive` for completed/failed); the framework
 * surfaces a unified shape so the admin UI doesn't have to
 * know the storage split.
 */
export type NxJobState =
  | "created" // queued, not yet started
  | "active" // worker is processing
  | "completed" // succeeded
  | "failed" // hit max retries
  | "retry" // failed once, scheduled to retry
  | "cancelled" // explicitly cancelled
  | "expired"; // exceeded keepUntil

export interface NxJobSummary {
  id: string;
  /** pg-boss queue name (after `:` → `.` translation). */
  name: string;
  state: NxJobState;
  data: unknown;
  /** Number of retries pg-boss has attempted so far. */
  retryCount?: number;
  /** Last failure message, if any. */
  output?: string | null;
  createdOn: string;
  startedOn?: string | null;
  completedOn?: string | null;
  /**
   * Phase 20.4 — which pg-boss table the row was read from.
   * `"live"` = pgboss.job (still pending / active / retry),
   * `"archive"` = pgboss.archive (rolled out by pg-boss after
   * `keepUntil`). The admin Jobs view uses this to split the
   * Failed tab into "live failures" (still actionable via
   * `/api/admin/jobs/{id}/retry`) vs "archived" (kept for
   * forensics; retry would re-create the row in `job`).
   */
  source?: "live" | "archive";
}

export interface NxJobListOptions {
  /** Filter to one queue name (e.g. `"media.processImage"`). */
  name?: string;
  /** Filter to one state. Defaults to all. */
  state?: NxJobState;
  /** Page size. Default 50, capped at 200. */
  limit?: number;
  /** Skip count for pagination. */
  offset?: number;
  /**
   * Phase 13.2 — only include jobs whose `created_on` is at or
   * after this timestamp. Common operational query: "jobs from
   * the last 24 hours" without paging through history.
   */
  since?: Date;
  /**
   * Phase 20.4 — partition the result by pg-boss table:
   *   - `"live"` — pending / active / retry rows still in
   *     `pgboss.job`. Retryable.
   *   - `"archive"` — rolled rows in `pgboss.archive`. Read-only
   *     (pg-boss won't pick them up; retry routes refuse to
   *     touch archive rows).
   * Default (undefined) keeps the historical UNION behavior.
   */
  source?: "live" | "archive";
}

export interface NxJobListResult {
  jobs: NxJobSummary[];
  total: number;
}

/**
 * Phase 23.5 — counts per terminal-and-transient state across the
 * union of `pgboss.job` and `pgboss.archive`. Drives the stuck-job
 * widget in `/admin/jobs` and is the building block plugin authors
 * use to roll their own monitoring without taking a hard dep on
 * pg-boss schema knowledge.
 *
 * Every state key is always present (defaulting to 0) so the
 * caller can index without optional chaining and the UI can render
 * a stable row order.
 */
export interface NxJobStateCounts {
  created: number;
  active: number;
  completed: number;
  failed: number;
  retry: number;
  cancelled: number;
  expired: number;
}

export interface NxJobCountOptions {
  /**
   * Time-bounded query: include only jobs whose `created_on` is at
   * or after this timestamp. Useful for "failures in the last 24
   * hours" without paging through history.
   */
  since?: Date;
}

/**
 * Phase 13.2 — registered cron schedule (one row per
 * `boss.schedule()` call). Surfaces in the admin so
 * operators can confirm `system:revisionPrune` and friends
 * are actually registered, not just declared in code.
 */
export interface NxScheduleSummary {
  /** pg-boss queue name (after `:` → `.` translation). */
  name: string;
  /**
   * Issue #217 — the second half of `pgboss.schedule`'s primary
   * key. Empty string for single-cadence schedules; `"daily"` /
   * `"weekly"` (etc.) for jobs that need multiple cadences under
   * one queue name. The admin UI uses `(name, key)` as a stable
   * React key so duplicate-name rows render cleanly.
   */
  key: string;
  /** Cron expression as registered. */
  cron: string;
  /** Timezone the cron runs in (defaults to UTC in pg-boss). */
  timezone: string | null;
  /** Default payload used when the cron fires. */
  data: unknown;
  createdOn: string;
  updatedOn?: string | null;
}

export interface NxJobQueue {
  enqueue(type: NxJobType, data: unknown): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Phase 13 — admin introspection. Optional on the interface
   * so test stubs / mock queues don't have to implement them;
   * the admin endpoint returns 501 when the active queue
   * doesn't support introspection.
   */
  listJobs?(options: NxJobListOptions): Promise<NxJobListResult>;
  /** Re-enqueue a failed/cancelled job's payload as a new job. Returns the new job id. */
  retryJob?(id: string): Promise<string>;
  /** Cancel a pending job (no-op for already-running / completed jobs). */
  cancelJob?(id: string): Promise<void>;
  /**
   * Phase 13.2 — list every cron schedule registered with the
   * queue. Surfaces in the admin so operators can confirm
   * recurring jobs are actually registered, not just declared
   * in code.
   */
  listSchedules?(): Promise<NxScheduleSummary[]>;
  /**
   * Phase 20.2 — stop the worker from claiming new jobs without
   * tearing down the queue. In-flight jobs run to completion;
   * the producer keeps enqueueing. Optional on the interface
   * because non-pg-boss test stubs don't implement it.
   */
  pauseProcessing?(): Promise<void>;
  /** Phase 20.2 — undo `pauseProcessing()`. Idempotent. */
  resumeProcessing?(): Promise<void>;
  /** Phase 20.2 — `true` when this adapter is currently paused. */
  isProcessingPaused?(): boolean;
  /**
   * Phase 22.4 — readiness probe. Issues a cheap round-trip against
   * the queue backing store and returns `true` when the connection
   * is alive AND the queue's schema is installed. Adapters that
   * can't tell return `true` (a missing answer is not a failure
   * signal). Errors are caught and reported as `false` — the probe
   * caller never sees an exception.
   */
  isHealthy?(): Promise<boolean>;
  /**
   * Phase 23.5 — return job counts grouped by state across both
   * pg-boss tables. Optional on the interface so test stubs that
   * don't model state need not implement it; the admin endpoint
   * omits the stuck-job widget when missing.
   */
  countByState?(options?: NxJobCountOptions): Promise<NxJobStateCounts>;
}

let jobQueue: NxJobQueue | null = null;

export function setJobQueue(queue: NxJobQueue | null): void {
  jobQueue = queue;
}

export function getJobQueue(): NxJobQueue {
  if (!jobQueue) {
    throw new Error("Job queue not initialized. Call setJobQueue() first.");
  }
  return jobQueue;
}

export function getOptionalJobQueue(): NxJobQueue | null {
  return jobQueue;
}

/**
 * Enqueues a job if the queue is wired up; otherwise no-ops so callers
 * (content pipeline, media processing) can run without pg-boss during MVP
 * blog-only workloads. Return value is an empty string in the no-op path.
 */
export async function enqueueJob(type: NxJobType, data: unknown): Promise<string> {
  if (!jobQueue) return "";
  return jobQueue.enqueue(type, data);
}
