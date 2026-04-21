import { type NxJobType } from "../config/types.js";

export interface NxJobQueue {
  enqueue(type: NxJobType, data: unknown): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

let jobQueue: NxJobQueue | null = null;

export function setJobQueue(queue: NxJobQueue): void {
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
