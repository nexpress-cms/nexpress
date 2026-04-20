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

export async function enqueueJob(type: NxJobType, data: unknown): Promise<string> {
  return getJobQueue().enqueue(type, data);
}
