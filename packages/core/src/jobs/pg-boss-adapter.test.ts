import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NpScheduleSummary } from "./queue.js";
import { PgBossAdapter } from "./pg-boss-adapter.js";
import { getRegisteredPluginSchedules, loadPlugins, resetPlugins } from "../plugins/index.js";

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
          scheduleRow("plugin.scheduledTask.analytics-lite.daily-rollup", "0 0 * * *"),
          scheduleRow("plugin.scheduledTask.removed.stale-task", "*/15 * * * *"),
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
      "plugin.scheduledTask.analytics-lite.daily-rollup",
      "5 0 * * *",
      { pluginId: "analytics-lite", taskId: "daily-rollup" },
    );
    expect(schedule).toHaveBeenCalledWith(
      "plugin.scheduledTask.analytics-lite.weekly-rollup",
      "10 0 * * 1",
      { pluginId: "analytics-lite", taskId: "weekly-rollup" },
    );
    expect(unschedule).toHaveBeenCalledWith("plugin.scheduledTask.analytics-lite.daily-rollup");
    expect(unschedule).toHaveBeenCalledWith("plugin.scheduledTask.removed.stale-task");
    expect(unschedule).not.toHaveBeenCalledWith("system.revisionPrune");
  });
});

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

function scheduleRow(name: string, cron: string): NpScheduleSummary {
  return {
    name,
    key: "",
    cron,
    timezone: "UTC",
    data: {},
    createdOn: "2026-07-01T00:00:00.000Z",
    updatedOn: null,
  };
}
