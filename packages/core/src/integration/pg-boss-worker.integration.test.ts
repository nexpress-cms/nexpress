import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type NpJobType } from "../config/types.js";
import { getCurrentJobId } from "../jobs/job-log.js";
import { registerJobHandler } from "../jobs/handlers.js";
import { enqueueJob, setJobQueue } from "../jobs/queue.js";
import { startWorker, stopWorker } from "../jobs/worker.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  skipIfNoTestDb,
  truncateAll,
} from "./setup.js";

const TEST_JOB_TYPE = "test:workerPickup" as NpJobType;

interface ObservedJob {
  token: string;
  currentJobId: string | null;
}

describe.skipIf(skipIfNoTestDb())("pg-boss worker integration", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateAll();
    setJobQueue(null);
  });

  afterEach(async () => {
    await stopWorker();
    setJobQueue(null);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("picks up an enqueued job and runs the registered handler", async () => {
    const token = randomUUID();
    const observed = deferred<ObservedJob>();

    registerJobHandler(TEST_JOB_TYPE, async (data) => {
      if (isRecord(data) && typeof data.token === "string" && data.token === token) {
        observed.resolve({
          token: data.token,
          currentJobId: getCurrentJobId(),
        });
      }
    });

    const url = getTestDatabaseUrl();
    if (!url) throw new Error("TEST_DATABASE_URL not set");

    await startWorker(url, {
      heartbeat: false,
      installSignalHandlers: false,
    });

    const jobId = await enqueueJob(TEST_JOB_TYPE, { token });
    const result = await withTimeout(
      observed.promise,
      10_000,
      "Timed out waiting for pg-boss to run the test handler.",
    );

    expect(jobId).not.toBe("");
    expect(result).toEqual({
      token,
      currentJobId: jobId,
    });
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
