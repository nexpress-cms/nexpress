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
}

export interface NxJobListResult {
  jobs: NxJobSummary[];
  total: number;
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
