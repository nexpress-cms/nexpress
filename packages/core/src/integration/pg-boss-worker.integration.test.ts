import { sql } from "drizzle-orm";
import { PgBossAdapter } from "../jobs/pg-boss-adapter.js";
import { registerBuiltinHandlers } from "../jobs/builtin-handlers.js";
import { npAuditEvents } from "../db/schema/community.js";
import { withCurrentSite } from "../sites/context.js";
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
  getTestDb,
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

  it("projects retained pg-boss 12 history and charges Runtime receipts once", async () => {
    const url = getTestDatabaseUrl();
    if (!url) throw new Error("TEST_DATABASE_URL not set");
    const db = await getTestDb();
    registerBuiltinHandlers();
    registerJobHandler("agent:runExecute", () => Promise.resolve(), {
      resolveSiteId: (data: { siteId: string }) => data.siteId,
    });
    const adapter = new PgBossAdapter(url);
    try {
      await adapter.start();
      await adapter.pauseProcessing();
      await adapter.scheduleRecurring();
      expect(
        (await adapter.listSchedules()).some((row) => row.name === "system.revisionPrune"),
      ).toBe(true);
      const payload = { siteId: "retained-a", pluginId: "analytics", taskId: "daily" };
      const first = await adapter.enqueue("plugin:scheduledTask", payload);
      const second = await adapter.enqueue("plugin:scheduledTask", payload);
      await db.execute(
        sql`update pgboss.job set state='completed', completed_on=now() where id=${first}::uuid`,
      );
      expect(
        await adapter.listJobs({ name: "plugin.scheduledTask", source: "archive" }),
      ).toMatchObject({ total: 1, jobs: [{ id: first, source: "archive", state: "completed" }] });
      expect(
        await adapter.listJobs({ name: "plugin.scheduledTask", source: "live" }),
      ).toMatchObject({ total: 1, jobs: [{ id: second, source: "live", state: "created" }] });
      expect((await adapter.countByState()).completed).toBeGreaterThanOrEqual(1);
      expect(
        await withCurrentSite("retained-a", () => adapter.getPluginScheduleStats("analytics")),
      ).toMatchObject([{ taskId: "daily", completedCount: 1 }]);
      const runId = randomUUID();
      await adapter.enqueue("agent:runExecute", { siteId: "retained-a", runId });
      await adapter.enqueue("agent:runExecute", { siteId: "retained-a", runId });
      await db.insert(npAuditEvents).values({
        actorKind: "system",
        siteId: "retained-a",
        action: "agent.runtime.job_admitted",
        targetType: "agent-run",
        targetId: runId,
        payload: {},
      });
      const since = new Date(Date.now() - 60_000);
      expect(
        await adapter.countSiteEnqueues("retained-a", since, [
          "plugin:scheduledTask",
          "agent:runExecute",
        ]),
      ).toBe(3);
      expect(
        await adapter.countSiteEnqueues("retained-b", since, [
          "plugin:scheduledTask",
          "agent:runExecute",
        ]),
      ).toBe(0);
      await adapter.cancelJob(second);
      expect(
        await adapter.listJobs({ name: "plugin.scheduledTask", source: "archive" }),
      ).toMatchObject({ total: 2 });
      const retried = await adapter.retryJob(second);
      expect(retried).not.toBe(second);
      expect(
        await adapter.listJobs({ name: "plugin.scheduledTask", source: "live" }),
      ).toMatchObject({ total: 1 });
    } finally {
      await adapter.stop();
    }
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
