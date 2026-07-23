import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NpScheduleSummary } from "./queue.js";
import { registerBuiltinHandlers } from "./builtin-handlers.js";
import { PgBossAdapter } from "./pg-boss-adapter.js";
import { getRegisteredPluginSchedules, loadPlugins, resetPlugins } from "../plugins/index.js";
import { npPluginScheduledTaskQueueName } from "../jobs-contract/index.js";

describe("PgBossAdapter plugin schedule reconcile", () => {
  beforeEach(() => {
    resetPlugins();
  });

  afterEach(() => {
    resetPlugins();
  });

  it("adds, updates, and removes only plugin schedule rows", async () => {
    await loadPlugins([
      scheduledPlugin("analytics-lite", [
        { id: "daily-rollup", cron: "5 0 * * *" },
        { id: "weekly-rollup", cron: "10 0 * * 1" },
      ]),
    ]);

    expect(
      getRegisteredPluginSchedules()
        .map((schedule) => schedule.taskId)
        .sort(),
    ).toEqual(["daily-rollup", "weekly-rollup"]);

    const schedule = vi.fn(() => Promise.resolve());
    const unschedule = vi.fn(() => Promise.resolve());
    const adapter = new PgBossAdapter("postgres://nexpress:nexpress@localhost:5433/nexpress");
    Object.defineProperty(adapter, "boss", {
      value: { schedule, unschedule },
    });
    Object.defineProperty(adapter, "listSchedules", {
      value: () =>
        Promise.resolve([
          scheduleRow(
            npPluginScheduledTaskQueueName("analytics-lite", "daily-rollup"),
            "0 0 * * *",
            { pluginId: "analytics-lite", taskId: "daily-rollup" },
          ),
          scheduleRow(npPluginScheduledTaskQueueName("removed", "stale-task"), "*/15 * * * *", {
            pluginId: "removed",
            taskId: "stale-task",
          }),
          scheduleRow("system.revisionPrune", "0 3 * * *"),
        ]),
    });

    const result = await adapter.reconcilePluginSchedules();

    expect(result).toEqual({
      added: 1,
      updated: 1,
      removed: 1,
      workerOwnsRegistrations: false,
    });
    expect(schedule).toHaveBeenCalledWith(
      npPluginScheduledTaskQueueName("analytics-lite", "daily-rollup"),
      "5 0 * * *",
      { pluginId: "analytics-lite", taskId: "daily-rollup" },
    );
    expect(schedule).toHaveBeenCalledWith(
      npPluginScheduledTaskQueueName("analytics-lite", "weekly-rollup"),
      "10 0 * * 1",
      { pluginId: "analytics-lite", taskId: "weekly-rollup" },
    );
    expect(unschedule).toHaveBeenCalledWith(
      npPluginScheduledTaskQueueName("analytics-lite", "daily-rollup"),
    );
    expect(unschedule).toHaveBeenCalledWith(
      npPluginScheduledTaskQueueName("removed", "stale-task"),
    );
    expect(unschedule).not.toHaveBeenCalledWith("system.revisionPrune");
  });
});

describe("PgBossAdapter persisted job contracts", () => {
  it("rejects a schema that would diverge from Admin and ops queries", () => {
    expect(
      () =>
        new PgBossAdapter("postgres://nexpress:nexpress@localhost:5433/nexpress", {
          schema: "public",
        }),
    ).toThrow('canonical pg-boss schema "pgboss"');
  });

  it("rejects malformed query bounds before reading pg-boss", async () => {
    const adapter = adapterWithSql(vi.fn());
    await expect(adapter.listJobs({ limit: 201 })).rejects.toThrow(/jobs\.limit/u);
    await expect(adapter.listJobs({ since: new Date("invalid") })).rejects.toThrow(/jobs\.since/u);
  });

  it("pins durable search reindex work to a collection-keyed stately queue", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce("reindex-job")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("reindex-retry")
      .mockResolvedValueOnce(null);
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const getQueue = vi.fn().mockResolvedValue({ policy: "stately" });
    const updateQueue = vi.fn().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockResolvedValue(undefined);
    const adapter = adapterWithBoss(
      vi.fn().mockResolvedValue({
        rows: [
          {
            id: "failed-reindex",
            name: "search.reindex",
            state: "failed",
            data: { collection: "posts" },
          },
        ],
      }),
      { send, createQueue, getQueue, updateQueue, work, start },
    );

    await expect(adapter.enqueue("search:reindex", { collection: "posts" })).resolves.toBe(
      "reindex-job",
    );
    expect(send).toHaveBeenCalledWith(
      "search.reindex",
      { collection: "posts" },
      { singletonKey: "posts" },
    );
    await expect(adapter.enqueue("search:reindex", { collection: "posts" })).rejects.toThrow(
      'Search reindex for collection "posts" is already queued or active.',
    );

    const createOptions = {
      policy: "stately",
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 21_600,
    };
    const updateOptions = {
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 21_600,
    };
    await adapter.startProducer();
    expect(start).toHaveBeenCalledOnce();
    expect(createQueue).toHaveBeenCalledWith("search.reindex", createOptions);
    expect(getQueue).toHaveBeenCalledWith("search.reindex");
    expect(updateQueue).toHaveBeenCalledWith("search.reindex", updateOptions);

    createQueue.mockClear();
    updateQueue.mockClear();
    registerBuiltinHandlers();
    await adapter.start();
    expect(createQueue).toHaveBeenCalledWith("search.reindex", createOptions);
    expect(getQueue).toHaveBeenCalledWith("search.reindex");
    expect(updateQueue).toHaveBeenCalledWith("search.reindex", updateOptions);

    await expect(adapter.retryJob("failed-reindex")).resolves.toBe("reindex-retry");
    expect(send).toHaveBeenLastCalledWith(
      "search.reindex",
      { collection: "posts" },
      { singletonKey: "posts" },
    );
    await expect(adapter.retryJob("failed-reindex")).rejects.toThrow(
      'Search reindex for collection "posts" is already queued or active.',
    );
  });

  it("fails startup when an existing search reindex queue has the wrong immutable policy", async () => {
    const adapter = adapterWithBoss(vi.fn(), {
      start: vi.fn().mockResolvedValue(undefined),
      createQueue: vi.fn().mockResolvedValue(undefined),
      getQueue: vi.fn().mockResolvedValue({ policy: "standard" }),
      updateQueue: vi.fn().mockResolvedValue(undefined),
    });

    await expect(adapter.startProducer()).rejects.toThrow(
      'Job queue "search.reindex" must use the stately policy',
    );
  });

  it("rejects malformed rows and aggregate counts instead of substituting defaults", async () => {
    const row = {
      id: "job-1",
      name: "media.processImage",
      state: "failed",
      data: {
        siteId: "default",
        mediaId: "bd134b0f-b9ea-4ff4-81ef-606e42e27703",
      },
      retry_count: 1,
      output: "failed",
      created_on: new Date("2026-07-01T00:00:00.000Z"),
      started_on: null,
      completed_on: null,
      source: "archive",
    };
    const invalidCount = adapterWithSql(
      vi.fn((sql: string) =>
        Promise.resolve(
          sql.includes("COUNT(*)") ? { rows: [{ total: "1oops" }] } : { rows: [row] },
        ),
      ),
    );
    await expect(invalidCount.listJobs({})).rejects.toThrow(/jobs\.total/u);

    const invalidRow = adapterWithSql(
      vi.fn((sql: string) =>
        Promise.resolve(
          sql.includes("COUNT(*)")
            ? { rows: [{ total: "1" }] }
            : { rows: [{ ...row, retry_count: undefined }] },
        ),
      ),
    );
    await expect(invalidRow.listJobs({})).rejects.toThrow(/job\.retryCount/u);

    const invalidBuiltinPayload = adapterWithSql(
      vi.fn((sql: string) =>
        Promise.resolve(
          sql.includes("COUNT(*)")
            ? { rows: [{ total: "1" }] }
            : {
                rows: [{ ...row, data: { siteId: "default", mediaId: "not-a-uuid" } }],
              },
        ),
      ),
    );
    await expect(invalidBuiltinPayload.listJobs({})).rejects.toThrow(
      /job\.data\(media:processImage\)\.mediaId/u,
    );
  });

  it("preserves pg-boss 12 schedule keys for multiple digest cadences", async () => {
    const executeSql = vi.fn().mockResolvedValue({
      rows: [
        {
          name: "notifications.sendDigest",
          key: "daily",
          cron: "0 8 * * *",
          timezone: "UTC",
          data: { cadence: "daily" },
          created_on: new Date("2026-07-01T00:00:00.000Z"),
          updated_on: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    });
    const schedule = vi.fn().mockResolvedValue(undefined);
    const unschedule = vi.fn().mockResolvedValue(undefined);
    const adapter = adapterWithBoss(executeSql, { schedule, unschedule });

    await expect(adapter.listSchedules()).resolves.toEqual([
      {
        name: "notifications.sendDigest",
        key: "daily",
        cron: "0 8 * * *",
        timezone: "UTC",
        data: { cadence: "daily" },
        createdOn: "2026-07-01T00:00:00.000Z",
        updatedOn: "2026-07-01T00:00:00.000Z",
      },
    ]);
    expect(executeSql.mock.calls[0]?.[0]).toContain("name, key, cron");

    await adapter.scheduleRecurring();
    expect(unschedule).toHaveBeenCalledWith("notifications.sendDigest");
    expect(schedule).toHaveBeenCalledWith("media.cleanup", "15 3 * * *", {});
    expect(schedule).toHaveBeenCalledWith(
      "notifications.sendDigest",
      "0 8 * * *",
      { cadence: "daily" },
      { key: "daily" },
    );
    expect(schedule).toHaveBeenCalledWith(
      "notifications.sendDigest",
      "0 8 * * 1",
      { cadence: "weekly" },
      { key: "weekly" },
    );
  });

  it("counts exact site quota enqueue history across live and archive rows", async () => {
    const executeSql = vi.fn().mockResolvedValue({ rows: [{ total: "7" }] });
    const adapter = adapterWithSql(executeSql);
    const since = new Date("2026-07-22T00:00:00.000Z");

    await expect(
      adapter.countSiteEnqueues("tenant-a", since, ["plugin:scheduledTask"]),
    ).resolves.toBe(7);
    expect(executeSql).toHaveBeenCalledWith(expect.stringContaining("data->>'siteId' = $1"), [
      "tenant-a",
      since.toISOString(),
      ["plugin.scheduledTask"],
    ]);
    await expect(
      adapter.countSiteEnqueues("Tenant A", since, ["plugin:scheduledTask"]),
    ).rejects.toThrow("siteId must be canonical");
  });

  it("rejects retrying non-terminal and handlerless jobs before enqueue", async () => {
    const send = vi.fn().mockResolvedValue("new-job");
    const completed = adapterWithBoss(
      vi.fn().mockResolvedValue({
        rows: [
          {
            id: "job-1",
            name: "media.processImage",
            state: "completed",
            data: {
              siteId: "default",
              mediaId: "bd134b0f-b9ea-4ff4-81ef-606e42e27703",
            },
          },
        ],
      }),
      { send },
    );
    await expect(completed.retryJob("job-1")).rejects.toThrow("is not retryable");

    const unknown = adapterWithBoss(
      vi.fn().mockResolvedValue({
        rows: [{ id: "job-2", name: "unknown.queue", state: "failed", data: {} }],
      }),
      { send },
    );
    await expect(unknown.retryJob("job-2")).rejects.toThrow("no registered handler contract");
    expect(send).not.toHaveBeenCalled();
  });
});

function adapterWithSql(executeSql: ReturnType<typeof vi.fn>): PgBossAdapter {
  return adapterWithBoss(executeSql);
}

function adapterWithBoss(
  executeSql: ReturnType<typeof vi.fn>,
  methods: Record<string, unknown> = {},
): PgBossAdapter {
  const adapter = new PgBossAdapter("postgres://nexpress:nexpress@localhost:5433/nexpress");
  Object.defineProperty(adapter, "boss", { value: { db: { executeSql }, ...methods } });
  return adapter;
}

function scheduledPlugin(
  id: string,
  tasks: Array<{ id: string; cron: string }>,
): {
  manifest: { id: string; name: string; capabilities: string[] };
  scheduled: Array<{
    id: string;
    cron: string;
    handler: () => void;
  }>;
} {
  return {
    manifest: {
      id,
      name: `${id} plugin`,
      capabilities: ["hooks:scheduled"],
    },
    scheduled: tasks.map((task) => ({
      ...task,
      handler: () => undefined,
    })),
  };
}

function scheduleRow(
  name: string,
  cron: string,
  data: NpScheduleSummary["data"] = {},
): NpScheduleSummary {
  return {
    name,
    key: "",
    cron,
    timezone: "UTC",
    data,
    createdOn: "2026-07-01T00:00:00.000Z",
    updatedOn: null,
  };
}
