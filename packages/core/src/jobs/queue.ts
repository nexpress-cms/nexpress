import {
  type NpJobData,
  type NpJobPayload,
  type NpJobState,
  type NpJobStateCounts,
  type NpJobSummary,
  type NpJobType,
  type NpScheduleSummary,
} from "../jobs-contract/index.js";
import {
  getSiteQuotaJobTypes,
  normalizeRegisteredJobPayload,
  resolveRegisteredJobQuotaSiteId,
} from "./handlers.js";
import { npWithSiteJobEnqueueQuota } from "../sites/quotas.js";

/**
 * Phase 13 — admin-side job introspection. pg-boss tracks jobs
 * across two tables (`pgboss.job` for active/scheduled,
 * `pgboss.archive` for completed/failed); the framework
 * surfaces a unified shape so the admin UI doesn't have to
 * know the storage split.
 */
export interface NpJobListOptions {
  /** Filter to one queue name (e.g. `"media.processImage"`). */
  name?: string;
  /** Filter to one state. Defaults to all. */
  state?: NpJobState;
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
   *   - `"archive"` — rolled terminal rows in `pgboss.archive`.
   *     Failed, cancelled, and expired rows may be re-enqueued as
   *     fresh jobs by the retry API.
   * Default (undefined) keeps the historical UNION behavior.
   */
  source?: "live" | "archive";
}

export interface NpJobListResult {
  jobs: NpJobSummary[];
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
export interface NpJobCountOptions {
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
export interface NpJobQueue {
  enqueue<TType extends NpJobType>(type: TType, data: NpJobPayload<TType>): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Phase 13 — admin introspection. Optional on the interface
   * so test stubs / mock queues don't have to implement them;
   * the admin endpoint returns 501 when the active queue
   * doesn't support introspection.
   */
  listJobs?(options: NpJobListOptions): Promise<NpJobListResult>;
  /** Re-enqueue a failed/cancelled/expired job's payload as a new job. Returns the new job id. */
  retryJob?(id: string): Promise<string>;
  /** Cancel a created/retry job; other states fail explicitly. */
  cancelJob?(id: string): Promise<void>;
  /**
   * Phase 13.2 — list every cron schedule registered with the
   * queue. Surfaces in the admin so operators can confirm
   * recurring jobs are actually registered, not just declared
   * in code.
   */
  listSchedules?(): Promise<NpScheduleSummary[]>;
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
  countByState?(options?: NpJobCountOptions): Promise<NpJobStateCounts>;
  /**
   * Exact persisted enqueue count used by site quotas. Implementations must
   * count both active and archived rows created since `since` for the given
   * quota-participating logical job types.
   */
  countSiteEnqueues?(siteId: string, since: Date, types: readonly NpJobType[]): Promise<number>;
  /**
   * Phase 4.2 — per-plugin schedule observability. Returns one row per
   * `(pluginId, taskId)` aggregated over the plugin's history in
   * `pgboss.job` + `pgboss.archive`: last completion, last failure, and
   * counts split by state over the last `windowDays` (default 7). The
   * registry-side cron / description is overlaid on top by the caller.
   *
   * Optional so test stubs that don't model job history can omit it; the
   * admin surface degrades to "registered schedules only" without it.
   */
  getPluginScheduleStats?(
    pluginId: string,
    options?: { windowDays?: number },
  ): Promise<NpPluginScheduleStats[]>;
  /**
   * Issue #461 — bring the queue's `pgboss.schedule` rows in sync with
   * what `getRegisteredPluginSchedules()` reports today. Bootstrap
   * registers schedules once at worker startup; without this method,
   * `reloadPlugins()` could only update the in-memory registry, leaving
   * pg-boss firing the *old* set of crons until the worker restarted.
   *
   * Behavior:
   *   - schedule entry in registry but missing from pg-boss → added
   *   - schedule entry in pg-boss but missing from registry → removed
   *   - same name + different cron expression → re-added (unschedule
   *     then schedule, since pg-boss has no in-place cron update)
   *
   * `boss.work()` registration is NOT touched: in production deploys
   * the worker lives in a separate process from the admin web server,
   * so the web process can't install / drop work loops on its boss
   * instance for the worker process to pick up. Operators see their
   * cron rows updated immediately; jobs that fire for newly-added
   * schedules will still need a worker restart to be processed.
   * Documented in the admin reload toast.
   *
   * Optional on the interface so test stubs / non-pg-boss adapters
   * skip cleanly.
   */
  reconcilePluginSchedules?(): Promise<NpReconcileSchedulesResult>;
}

export interface NpReconcileSchedulesResult {
  /** New schedule rows written to `pgboss.schedule`. */
  added: number;
  /** Existing rows whose cron expression changed (unschedule → reschedule). */
  updated: number;
  /** Stale rows removed (plugin was uninstalled / disabled / renamed). */
  removed: number;
  /**
   * `true` when this process holds the worker `boss.work()` registrations
   * for the affected schedules. When false, operators should restart the
   * worker to pick up newly-added schedules. Adapters that can't tell
   * (in-memory test queue, future adapters) return `null`.
   */
  workerOwnsRegistrations: boolean | null;
}

export interface NpPluginScheduleStats {
  taskId: string;
  /** Most recent run, regardless of state. ISO timestamp or null. */
  lastRunAt: string | null;
  /** Most recent successful run. ISO timestamp or null. */
  lastSuccessAt: string | null;
  /** Most recent failed run. ISO timestamp or null. */
  lastFailureAt: string | null;
  /** Count of successful runs inside the window. */
  completedCount: number;
  /** Count of failed runs inside the window. */
  failedCount: number;
  /** The window the counts cover, in days. Echoed for UI labels. */
  windowDays: number;
}

let jobQueue: NpJobQueue | null = null;

export class NpJobPayloadValidationError extends Error {
  override readonly name = "NpJobPayloadValidationError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export interface NpEnqueuedJob<TType extends NpJobType = NpJobType> {
  id: string;
  type: TType;
  data: NpJobPayload<TType> & NpJobData;
}

export function setJobQueue(queue: NpJobQueue | null): void {
  jobQueue = queue;
}

export function getJobQueue(): NpJobQueue {
  if (!jobQueue) {
    throw new Error("Job queue not initialized. Call setJobQueue() first.");
  }
  return jobQueue;
}

export function getOptionalJobQueue(): NpJobQueue | null {
  return jobQueue;
}

/**
 * Enqueues a job if the queue is wired up; otherwise no-ops so callers
 * (content pipeline, media processing) can run without pg-boss during MVP
 * blog-only workloads. Return value is an empty string in the no-op path.
 */
export async function enqueueJob<TType extends NpJobType>(
  type: TType,
  data: NpJobPayload<TType>,
): Promise<string> {
  const normalized = normalizeRegisteredJobPayload(type, data);
  const quotaSiteId = resolveRegisteredJobQuotaSiteId(type, normalized);
  return enqueueNormalizedJob(type, normalized, quotaSiteId);
}

/** Enqueue once and return the exact payload produced by the registered parser. */
export async function enqueueJobWithResult<TType extends NpJobType>(
  type: TType,
  data: NpJobPayload<TType>,
): Promise<NpEnqueuedJob<TType>> {
  let normalized: NpJobPayload<TType> & NpJobData;
  let quotaSiteId: string | null;
  try {
    normalized = normalizeRegisteredJobPayload(type, data);
    quotaSiteId = resolveRegisteredJobQuotaSiteId(type, normalized);
  } catch (error) {
    throw new NpJobPayloadValidationError(
      error instanceof Error ? error.message : "Job payload does not match its handler contract.",
      { cause: error },
    );
  }
  const id = await enqueueNormalizedJob(type, normalized, quotaSiteId);
  return { id, type, data: normalized };
}

async function enqueueNormalizedJob<TType extends NpJobType>(
  type: TType,
  normalized: NpJobPayload<TType> & NpJobData,
  quotaSiteId: string | null,
): Promise<string> {
  if (!jobQueue) return "";
  const queue = jobQueue;
  if (quotaSiteId === null) return queue.enqueue(type, normalized);
  const quotaTypes = getSiteQuotaJobTypes();
  const countSiteEnqueues = queue.countSiteEnqueues?.bind(queue);
  return npWithSiteJobEnqueueQuota(
    quotaSiteId,
    countSiteEnqueues ? (siteId, since) => countSiteEnqueues(siteId, since, quotaTypes) : undefined,
    () => queue.enqueue(type, normalized),
  );
}

export type {
  NpJobPayload,
  NpJobState,
  NpJobStateCounts,
  NpJobSummary,
  NpJobType,
  NpScheduleSummary,
} from "../jobs-contract/index.js";
