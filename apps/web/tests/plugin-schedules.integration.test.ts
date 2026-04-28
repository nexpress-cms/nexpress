import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 19 — `definePlugin({ scheduled: [...] })` first-class
 * surface (#7 from the audit).
 *
 * Tests pin the registration + dispatch contract; the actual
 * pg-boss cron firing is exercised by the worker process and
 * left to manual smoke tests on `pnpm worker`.
 */
describe.skipIf(skipIfNoTestDb())("Phase 19 — plugin scheduled tasks", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
    const { resetPlugins } = await import("@nexpress/core");
    resetPlugins();
  });
  afterAll(async () => {
    const { resetPlugins } = await import("@nexpress/core");
    resetPlugins();
    await closeTestDb();
  });

  it("loadPlugins picks up scheduled[] entries and surfaces them via getRegisteredPluginSchedules", async () => {
    const { definePlugin } = await import("@nexpress/plugin-sdk");
    const { loadPlugins, getRegisteredPluginSchedules } = await import("@nexpress/core");

    let calls = 0;
    const plugin = definePlugin({
      manifest: {
        id: "phase19-a",
        name: "Phase 19 test plugin A",
        description: "Phase 19 test fixture",
        version: "0.0.1",
        author: { name: "Test" },
        license: "MIT",
        nexpress: { minVersion: "0.1.0" },
        capabilities: ["content:read"],
        allowedHosts: [],
        provides: {
          blocks: [],
          fields: [],
          collections: [],
          adminExtensions: [],
          apiRoutes: [],
          hooks: [],
        },
        agent: { description: "test", category: "content", tags: [] },
        usesTokens: [],
        styleSlots: {},
      },
      scheduled: [
        {
          id: "tick",
          cron: "0 3 * * *",
          handler: () => {
            calls += 1;
          },
          description: "Daily 03:00 tick",
        },
      ],
    });
    await loadPlugins([plugin]);

    const schedules = getRegisteredPluginSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.pluginId).toBe("phase19-a");
    expect(schedules[0]?.taskId).toBe("tick");
    expect(schedules[0]?.cron).toBe("0 3 * * *");
    expect(schedules[0]?.description).toBe("Daily 03:00 tick");
    // Reference `calls` so the linter is happy that the
    // handler-mutation closure isn't dead. The handler runs
    // through `runPluginScheduledTask` in the next test.
    expect(calls).toBe(0);
  });

  it("runPluginScheduledTask dispatches to the registered handler with the plugin context", async () => {
    const { definePlugin } = await import("@nexpress/plugin-sdk");
    const { loadPlugins, runPluginScheduledTask } = await import("@nexpress/core");

    let lastCtx: { pluginId?: string } | null = null;
    const plugin = definePlugin({
      manifest: {
        id: "phase19-b",
        name: "Phase 19 test plugin B",
        description: "Phase 19 test fixture",
        version: "0.0.1",
        author: { name: "Test" },
        license: "MIT",
        nexpress: { minVersion: "0.1.0" },
        capabilities: ["content:read"],
        allowedHosts: [],
        provides: {
          blocks: [],
          fields: [],
          collections: [],
          adminExtensions: [],
          apiRoutes: [],
          hooks: [],
        },
        agent: { description: "test", category: "content", tags: [] },
        usesTokens: [],
        styleSlots: {},
      },
      scheduled: [
        {
          id: "noop",
          cron: "* * * * *",
          handler: (ctx) => {
            lastCtx = ctx as { pluginId?: string };
          },
        },
      ],
    });
    await loadPlugins([plugin]);

    await runPluginScheduledTask("phase19-b", "noop");
    expect(lastCtx).not.toBeNull();
    expect(lastCtx?.pluginId).toBe("phase19-b");
  });

  it("runPluginScheduledTask throws when the plugin or task is unregistered", async () => {
    const { runPluginScheduledTask } = await import("@nexpress/core");
    await expect(runPluginScheduledTask("unknown", "noop")).rejects.toThrow(/not registered/);
  });

  it("invalid scheduled entries are silently skipped", async () => {
    const { definePlugin } = await import("@nexpress/plugin-sdk");
    const { loadPlugins, getRegisteredPluginSchedules } = await import("@nexpress/core");

    const plugin = definePlugin({
      manifest: {
        id: "phase19-c",
        name: "Phase 19 test plugin C",
        description: "Phase 19 test fixture",
        version: "0.0.1",
        author: { name: "Test" },
        license: "MIT",
        nexpress: { minVersion: "0.1.0" },
        capabilities: ["content:read"],
        allowedHosts: [],
        provides: {
          blocks: [],
          fields: [],
          collections: [],
          adminExtensions: [],
          apiRoutes: [],
          hooks: [],
        },
        agent: { description: "test", category: "content", tags: [] },
        usesTokens: [],
        styleSlots: {},
      },
      // One valid + several malformed entries — host should
      // store only the valid one.
      scheduled: [
        {
          id: "valid",
          cron: "* * * * *",
          handler: () => undefined,
        },
        // Missing handler.
        { id: "no-handler", cron: "* * * * *" } as never,
        // Missing cron.
        { id: "no-cron", handler: () => undefined } as never,
        // Missing id.
        { cron: "* * * * *", handler: () => undefined } as never,
      ],
    });
    await loadPlugins([plugin]);

    const schedules = getRegisteredPluginSchedules();
    const ids = schedules.filter((s) => s.pluginId === "phase19-c").map((s) => s.taskId);
    expect(ids).toEqual(["valid"]);
  });
});
