import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  analyzePlugins,
  buildOpsPluginInspectJson,
  buildOpsPluginsUpgradePlanJson,
  renderBriefOpsPluginsStatus,
} from "./ops-plugins-core.js";

describe("ops plugins core", () => {
  it("reports a clean plugin inventory", () => {
    const report = analyzePlugins([
      {
        manifest: {
          id: "demo",
          name: "Demo",
          version: "1.0.0",
          capabilities: ["blocks"],
        },
        blocks: [{ type: "callout" }],
        routes: [{ method: "GET", path: "/demo" }],
        pageRoutes: [{ pattern: "/demo/:slug" }],
      },
    ]);

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-plugins.v1",
        ok: true,
        status: "ready",
        summary: expect.objectContaining({
          plugins: 1,
          blocks: 1,
          routes: 1,
          pageRoutes: 1,
        }),
      }),
    );
    expect(report.plugins[0]).toEqual(
      expect.objectContaining({
        id: "demo",
        blocks: ["callout"],
        routes: ["GET /demo"],
        pageRoutes: ["/demo/:slug"],
      }),
    );
  });

  it("warns on duplicate plugin-owned contracts", () => {
    const report = analyzePlugins([
      {
        manifest: { id: "one", name: "One" },
        blocks: [{ type: "shared" }],
        routes: [{ method: "POST", path: "/shared" }],
      },
      {
        manifest: { id: "two", name: "Two" },
        blocks: [{ type: "shared" }],
        routes: [{ method: "POST", path: "/shared" }],
      },
    ]);

    expect(report.status).toBe("attention");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugins.block_conflict", state: "warn" }),
        expect.objectContaining({ id: "plugins.route_conflict", state: "warn" }),
      ]),
    );
  });

  it("renders list mode without check noise", () => {
    const report = analyzePlugins([{ manifest: { id: "demo", name: "Demo", version: "1.0.0" } }]);

    expect(renderBriefOpsPluginsStatus(report, "list", { color: false })).toBe(
      [
        "NexPress ops plugins",
        "ready: 1 plugins, 0 blocks, 0 API routes, 0 page routes",
        "- demo@1.0.0: Demo",
      ].join("\n"),
    );
  });

  it("inspects one configured plugin with related checks", () => {
    const report = analyzePlugins([
      {
        manifest: {
          id: "demo",
          name: "Demo",
          version: "1.0.0",
          description: "Demo plugin",
          author: { name: "NexPress" },
          license: "MIT",
          nexpress: { minVersion: "0.1.0" },
          capabilities: ["api:route"],
          allowedHosts: ["api.example.com"],
          requires: ["base"],
          provides: { apiRoutes: ["/demo"], hooks: ["content:afterCreate"] },
          agent: { description: "Agent summary", category: "content", tags: ["demo"] },
          usesTokens: ["demo.token"],
          styleSlots: { badge: "Badge class" },
        },
        routes: [{ method: "GET", path: "/demo" }],
      },
    ]);

    const inspect = buildOpsPluginInspectJson(report, "demo");

    expect(inspect).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-plugins.v1",
        mode: "inspect",
        ok: true,
        pluginId: "demo",
        plugin: expect.objectContaining({
          id: "demo",
          author: "NexPress",
          license: "MIT",
          nexpress: { minVersion: "0.1.0", maxVersion: null },
          allowedHosts: ["api.example.com"],
          requires: ["base"],
          provides: expect.objectContaining({ apiRoutes: ["/demo"] }),
          agent: expect.objectContaining({ category: "content", tags: ["demo"] }),
          usesTokens: ["demo.token"],
          styleSlots: ["badge"],
        }),
      }),
    );
  });

  it("blocks inspect when the plugin id is not configured", () => {
    const report = analyzePlugins([{ manifest: { id: "demo", name: "Demo" } }]);

    const inspect = buildOpsPluginInspectJson(report, "missing");

    expect(inspect.ok).toBe(false);
    expect(inspect.status).toBe("blocked");
    expect(inspect.plugin).toBeNull();
    expect(inspect.nextCommand).toBe("nexpress ops plugins list --json");
    expect(inspect.projectNextCommand).toBe("pnpm --silent run ops:plugins -- list --json");
    expect(inspect.relatedChecks).toEqual([
      expect.objectContaining({ id: "plugins.inspect.not_found", state: "error" }),
    ]);
  });

  it("plans read-only plugin package upgrades from package dependencies", () => {
    const cwd = mkdtempSync(join(tmpdir(), "np-ops-plugins-"));
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: {
          "@nexpress/plugin-reading-time": "^0.2.0",
        },
      }),
    );
    const report = analyzePlugins([
      { manifest: { id: "reading-time", name: "Reading Time", version: "0.2.0" } },
    ]);

    const plan = buildOpsPluginsUpgradePlanJson({
      report,
      cwd,
    });

    expect(plan.status).toBe("ready");
    expect(plan.summary).toEqual(
      expect.objectContaining({
        plugins: 1,
        packages: 1,
        manual: 0,
      }),
    );
    expect(plan.packages[0]).toEqual(
      expect.objectContaining({
        pluginId: "reading-time",
        packageName: "@nexpress/plugin-reading-time",
        currentRange: "^0.2.0",
        dependencyField: "dependencies",
        confidence: "inferred",
      }),
    );
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginId: "reading-time",
          command: "pnpm add @nexpress/plugin-reading-time@latest",
          projectCommand: "pnpm add @nexpress/plugin-reading-time@latest",
          requiresApproval: true,
        }),
      ]),
    );
  });

  it("marks upgrade plans for manually resolved plugin packages", () => {
    const report = analyzePlugins([{ manifest: { id: "custom", name: "Custom" } }]);

    const plan = buildOpsPluginsUpgradePlanJson({ report, cwd: "/does-not-exist" });

    expect(plan.status).toBe("attention");
    expect(plan.summary.manual).toBe(1);
    expect(plan.nextCommand).toBe("nexpress ops plugins inspect custom --json");
    expect(plan.projectNextCommand).toBe("pnpm --silent run ops:plugins -- inspect custom --json");
  });
});
