import type { NpBlockDefinition } from "@nexpress/blocks";
import {
  getAllPluginIds,
  getPluginAdminActionDiagnostics,
  getPluginDiscoveryDiagnostics,
  getPluginPageRoutes,
  getPluginRegistration,
  getPluginRoutes,
  getRegisteredPluginActions,
  getRegisteredPluginStrings,
  getRegisteredPluginTemplates,
  type PluginRouteHandler,
} from "@nexpress/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredBlocks, getRegisteredPatterns } from "@nexpress/blocks";

import { collectRuntimeOpsPluginsStatus } from "./ops-plugins-runtime";

vi.mock("@nexpress/core", () => ({
  getAllPluginIds: vi.fn(),
  getPluginAdminActionDiagnostics: vi.fn(),
  getPluginDiscoveryDiagnostics: vi.fn(),
  getPluginPageRoutes: vi.fn(),
  getPluginRegistration: vi.fn(),
  getPluginRoutes: vi.fn(),
  getRegisteredPluginActions: vi.fn(),
  getRegisteredPluginStrings: vi.fn(),
  getRegisteredPluginTemplates: vi.fn(),
}));

vi.mock("@nexpress/blocks", () => ({
  getRegisteredBlocks: vi.fn(),
  getRegisteredPatterns: vi.fn(),
}));

const mockPluginIds = vi.mocked(getAllPluginIds);
const mockPluginActionDiagnostics = vi.mocked(getPluginAdminActionDiagnostics);
const mockPluginDiscoveryDiagnostics = vi.mocked(getPluginDiscoveryDiagnostics);
const mockPluginRoutes = vi.mocked(getPluginRoutes);
const mockPluginPageRoutes = vi.mocked(getPluginPageRoutes);
const mockPluginRegistration = vi.mocked(getPluginRegistration);
const mockRegisteredPluginActions = vi.mocked(getRegisteredPluginActions);
const mockRegisteredPluginStrings = vi.mocked(getRegisteredPluginStrings);
const mockRegisteredPluginTemplates = vi.mocked(getRegisteredPluginTemplates);
const mockRegisteredBlocks = vi.mocked(getRegisteredBlocks);
const mockRegisteredPatterns = vi.mocked(getRegisteredPatterns);

describe("ops plugins runtime", () => {
  beforeEach(() => {
    mockPluginIds.mockReturnValue([]);
    mockPluginActionDiagnostics.mockReturnValue([]);
    mockPluginDiscoveryDiagnostics.mockReturnValue([]);
    mockPluginRoutes.mockReturnValue([]);
    mockPluginPageRoutes.mockReturnValue([]);
    mockPluginRegistration.mockReturnValue(undefined);
    mockRegisteredPluginActions.mockReturnValue([]);
    mockRegisteredPluginStrings.mockReturnValue([]);
    mockRegisteredPluginTemplates.mockReturnValue([]);
    mockRegisteredBlocks.mockReturnValue([]);
    mockRegisteredPatterns.mockReturnValue([]);
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
    mockRegisteredPatterns.mockReturnValue([
      {
        id: "forum.thread-list",
        label: "Thread list",
        source: "plugin:forum",
        blocks: [{ id: "template", type: "discussion-list", props: {} }],
      },
    ]);
    mockRegisteredPluginActions.mockReturnValue([
      { id: "countDiscussions", kind: "metric", source: "definition" },
    ]);
    mockRegisteredPluginTemplates.mockReturnValue([
      {
        pluginId: "forum",
        collection: "pages",
        id: "forum",
        definition: { label: "Forum", component: () => null },
      },
    ]);
    mockRegisteredPluginStrings.mockReturnValue([
      { pluginId: "forum", locale: "en", key: "forum.title", message: "Forum" },
    ]);

    const report = collectRuntimeOpsPluginsStatus();

    expect(report.status).toBe("ready");
    expect(report.summary).toMatchObject({
      plugins: 1,
      blocks: 1,
      patterns: 1,
      templates: 1,
      translations: 1,
      routes: 1,
      pageRoutes: 1,
      scheduled: 1,
      actions: 1,
    });
    expect(report.plugins[0]).toMatchObject({
      id: "forum",
      name: "Forum",
      version: "1.2.3",
      blocks: ["discussion-list"],
      patterns: ["forum.thread-list"],
      templates: ["pages:forum"],
      translations: ["en:forum.title"],
      routes: ["GET /stats"],
      pageRoutes: ["/forum"],
      scheduled: ["digest"],
      actions: [{ id: "countDiscussions", kind: "metric", source: "definition" }],
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
    mockRegisteredPluginTemplates.mockReturnValue([
      { pluginId: "alpha", collection: "pages", id: "shared", definition: {} as never },
      { pluginId: "beta", collection: "pages", id: "shared", definition: {} as never },
    ]);
    mockRegisteredPluginStrings.mockReturnValue([
      { pluginId: "alpha", locale: "en", key: "shared", message: "A" },
      { pluginId: "beta", locale: "en", key: "shared", message: "B" },
    ]);

    const report = collectRuntimeOpsPluginsStatus();

    expect(report.status).toBe("attention");
    expect(report.summary.warnings).toBe(4);
    expect(report.nextCommand).toBe("nexpress ops plugins inspect alpha --json");
    expect(report.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "plugins.runtime_page_route_conflict",
        "plugins.runtime_block_conflict",
        "plugins.runtime_template_conflict",
        "plugins.runtime_translation_conflict",
      ]),
    );
  });

  it("surfaces runtime action contract diagnostics with stable check ids", () => {
    mockPluginIds.mockReturnValue(["analytics"]);
    mockRegisteredPluginActions.mockReturnValue([
      { id: "quota", kind: "status", source: "setup" },
      { id: "orphan", kind: "action", source: "setup" },
    ]);
    mockPluginActionDiagnostics.mockReturnValue([
      {
        code: "kind-mismatch",
        severity: "error",
        actionId: "quota",
        message: 'Action "quota" is registered as status, but declarative admin expects metric.',
        locations: ["admin.widgets.quota"],
        expectedKind: "metric",
        actualKind: "status",
      },
      {
        code: "unused",
        severity: "warning",
        actionId: "orphan",
        message: 'Action "orphan" is not referenced by declarative admin.',
        locations: [],
        actualKind: "action",
      },
    ]);

    const report = collectRuntimeOpsPluginsStatus();

    expect(report.status).toBe("blocked");
    expect(report.summary).toMatchObject({ actions: 2, errors: 1, warnings: 1 });
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugins.action_kind_mismatch",
          state: "error",
          pluginIds: ["analytics"],
        }),
        expect.objectContaining({
          id: "plugins.action_unreferenced",
          state: "warn",
          pluginIds: ["analytics"],
        }),
      ]),
    );
  });

  it("targets runtime next commands at the plugin that owns the diagnostic", () => {
    mockPluginIds.mockReturnValue(["clean", "broken"]);
    mockPluginActionDiagnostics.mockImplementation((pluginId) =>
      pluginId === "broken"
        ? [
            {
              code: "missing",
              severity: "error",
              actionId: "sync",
              message: 'Declarative admin references missing action "sync".',
              locations: ["admin.actions.sync"],
            },
          ]
        : [],
    );

    const report = collectRuntimeOpsPluginsStatus();

    expect(report.nextCommand).toBe("nexpress ops plugins inspect broken --json");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugins.action_missing", pluginIds: ["broken"] }),
      ]),
    );
  });

  it("blocks runtime doctor when public plugin discovery is malformed", () => {
    mockPluginIds.mockReturnValue(["clean", "broken"]);
    mockPluginDiscoveryDiagnostics.mockReturnValue([
      {
        code: "invalid-field",
        path: "$.items.1.agent.configSchema.execute",
        message: "must contain only JSON values.",
      },
    ]);

    const report = collectRuntimeOpsPluginsStatus();

    expect(report.status).toBe("blocked");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugins.discovery_contract",
          state: "error",
          pluginIds: ["broken"],
        }),
      ]),
    );
  });
});

function route(
  pluginId: string,
  method: PluginRouteHandler["method"],
  path: string,
): PluginRouteHandler {
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
