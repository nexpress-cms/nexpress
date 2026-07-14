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
 * left to manual smoke tests on `NP_ENABLE_JOBS=1 pnpm run worker`.
 */
describe.skipIf(skipIfNoTestDb())("Phase 19 — plugin scheduled tasks", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
    const { resetPlugins } = await import("@nexpress/core/bootstrap");
    resetPlugins();
  });
  afterAll(async () => {
    const { resetPlugins } = await import("@nexpress/core/bootstrap");
    resetPlugins();
    await closeTestDb();
  });

  it("loadPlugins picks up scheduled[] entries and surfaces them via getRegisteredPluginSchedules", async () => {
    const { definePlugin } = await import("@nexpress/plugin-sdk");
    const { getRegisteredPluginSchedules } = await import("@nexpress/core");
    const { loadPlugins } = await import("@nexpress/core/bootstrap");

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
    const { runPluginScheduledTask } = await import("@nexpress/core");
    const { loadPlugins } = await import("@nexpress/core/bootstrap");

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

  it("invalid scheduled entries fail before registration", async () => {
    const { definePlugin } = await import("@nexpress/plugin-sdk");
    const { getRegisteredPluginSchedules } = await import("@nexpress/core");

    expect(() =>
      definePlugin({
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
            id: "valid",
            cron: "* * * * *",
            handler: () => undefined,
          },
          { id: "no-handler", cron: "* * * * *" } as never,
        ],
      }),
    ).toThrow(/invalid scheduled task at index 1: scheduled task\.handler must be a function/);

    const schedules = getRegisteredPluginSchedules();
    const ids = schedules.filter((s) => s.pluginId === "phase19-c").map((s) => s.taskId);
    expect(ids).toEqual([]);
  });
});
