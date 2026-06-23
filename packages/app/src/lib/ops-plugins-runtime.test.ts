import type { NpBlockDefinition } from "@nexpress/blocks";
import {
  getAllPluginIds,
  getPluginPageRoutes,
  getPluginRegistration,
  getPluginRoutes,
  type PluginRouteHandler,
} from "@nexpress/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredBlocks } from "@nexpress/blocks";

import { collectRuntimeOpsPluginsStatus } from "./ops-plugins-runtime";

vi.mock("@nexpress/core", () => ({
  getAllPluginIds: vi.fn(),
  getPluginPageRoutes: vi.fn(),
  getPluginRegistration: vi.fn(),
  getPluginRoutes: vi.fn(),
}));

vi.mock("@nexpress/blocks", () => ({
  getRegisteredBlocks: vi.fn(),
}));

const mockPluginIds = vi.mocked(getAllPluginIds);
const mockPluginRoutes = vi.mocked(getPluginRoutes);
const mockPluginPageRoutes = vi.mocked(getPluginPageRoutes);
const mockPluginRegistration = vi.mocked(getPluginRegistration);
const mockRegisteredBlocks = vi.mocked(getRegisteredBlocks);

describe("ops plugins runtime", () => {
  beforeEach(() => {
    mockPluginIds.mockReturnValue([]);
    mockPluginRoutes.mockReturnValue([]);
    mockPluginPageRoutes.mockReturnValue([]);
    mockPluginRegistration.mockReturnValue(undefined);
    mockRegisteredBlocks.mockReturnValue([]);
  });

  it("reports an empty runtime registry as ready", () => {
    const report = collectRuntimeOpsPluginsStatus();

    expect(report.status).toBe("ready");
    expect(report.summary.plugins).toBe(0);
    expect(report.nextCommand).toBeNull();
    expect(report.checks.find((check) => check.id === "plugins.runtime_registry")).toMatchObject({
      state: "ok",
      detail: "0 loaded plugins",
    });
  });

  it("serializes loaded plugin runtime surfaces", () => {
    mockPluginIds.mockReturnValue(["forum"]);
    mockPluginRegistration.mockReturnValue({
      name: "Forum",
      version: "1.2.3",
      description: "Discussions",
      capabilities: ["site:route"],
      allowedHosts: ["example.com"],
      schedules: new Map([["digest", scheduledTask("forum", "digest")]]),
    } as never);
    mockPluginRoutes.mockReturnValue([route("forum", "GET", "/stats")]);
    mockPluginPageRoutes.mockReturnValue([
      {
        pluginId: "forum",
        route: { pattern: "/forum", component: () => null, surface: "site", locale: "auto" },
      },
    ]);
    mockRegisteredBlocks.mockReturnValue([block("discussion-list", "plugin:forum")]);

    const report = collectRuntimeOpsPluginsStatus();

    expect(report.status).toBe("ready");
    expect(report.summary).toMatchObject({
      plugins: 1,
      blocks: 1,
      routes: 1,
      pageRoutes: 1,
      scheduled: 1,
    });
    expect(report.plugins[0]).toMatchObject({
      id: "forum",
      name: "Forum",
      version: "1.2.3",
      blocks: ["discussion-list"],
      routes: ["GET /stats"],
      pageRoutes: ["/forum"],
      scheduled: ["digest"],
    });
  });

  it("surfaces runtime ownership conflicts", () => {
    mockPluginIds.mockReturnValue(["alpha", "beta"]);
    mockPluginRoutes.mockReturnValue([
      route("alpha", "GET", "/same"),
      route("beta", "GET", "/same"),
    ]);
    mockPluginPageRoutes.mockReturnValue([
      {
        pluginId: "alpha",
        route: { pattern: "/same", component: () => null, surface: "site", locale: "auto" },
      },
      {
        pluginId: "beta",
        route: { pattern: "/same", component: () => null, surface: "site", locale: "auto" },
      },
    ]);
    mockRegisteredBlocks.mockReturnValue([
      block("shared-card", "plugin:alpha"),
      block("shared-card", "plugin:beta"),
    ]);

    const report = collectRuntimeOpsPluginsStatus();

    expect(report.status).toBe("attention");
    expect(report.summary.warnings).toBe(2);
    expect(report.nextCommand).toBe("nexpress ops plugins inspect alpha --json");
    expect(report.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "plugins.runtime_page_route_conflict",
        "plugins.runtime_block_conflict",
      ]),
    );
  });
});

function route(pluginId: string, method: string, path: string): PluginRouteHandler {
  return {
    pluginId,
    method,
    path,
    auth: false,
    handler: () => Promise.resolve({ status: 200 }),
  };
}

function scheduledTask(pluginId: string, taskId: string) {
  return {
    pluginId,
    taskId,
    cron: "* * * * *",
    handler: () => undefined,
  };
}

function block(type: string, source: string): NpBlockDefinition {
  return {
    type,
    label: type,
    defaultProps: {},
    propsSchema: [],
    render: () => ({ type: "div", props: {}, key: null }) as never,
    source,
  };
}
