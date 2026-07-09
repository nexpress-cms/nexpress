import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  analyzePlugins,
  buildOpsPluginInspectJson,
  buildOpsPluginsUpgradePlanJson,
  collectOpsPluginsStatus,
  renderBriefOpsPluginsMutation,
  renderBriefOpsPluginsStatus,
  runOpsPluginsMutation,
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
        nextCommand: null,
        projectNextCommand: null,
        plan: {
          nextCommands: [],
          projectNextCommands: [],
        },
        summary: expect.objectContaining({
          plugins: 1,
          blocks: 1,
          routes: 1,
          pageRoutes: 1,
          actions: 0,
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
    expect(report.nextCommand).toBe("nexpress ops plugins inspect one --json");
    expect(report.projectNextCommand).toBe("pnpm --silent run ops:plugins -- inspect one --json");
    expect(report.plan.nextCommands).toEqual([
      "nexpress ops plugins inspect one --json",
      "nexpress ops plugins inspect two --json",
      "nexpress ops plugins doctor --json",
    ]);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugins.block_conflict",
          state: "warn",
          detail: "shared is claimed by plugins one, two",
          hint: expect.stringMatching(
            /Rename one block type.*pnpm --silent run ops:plugins -- doctor --json/,
          ),
        }),
        expect.objectContaining({
          id: "plugins.route_conflict",
          state: "warn",
          detail: "POST /shared is claimed by plugins one, two",
          hint: expect.stringMatching(
            /Change one method\/path pair.*pnpm --silent run ops:plugins -- doctor --json/,
          ),
        }),
      ]),
    );
  });

  it("renders list mode without check noise", () => {
    const report = analyzePlugins([{ manifest: { id: "demo", name: "Demo", version: "1.0.0" } }]);

    expect(renderBriefOpsPluginsStatus(report, "list", { color: false })).toBe(
      [
        "NexPress ops plugins",
        "ready: 1 plugins, 0 actions, 0 blocks, 0 API routes, 0 page routes",
        "- demo@1.0.0: Demo",
      ].join("\n"),
    );
  });

  it("reports static admin action contract failures with stable check ids", () => {
    const report = analyzePlugins([
      {
        manifest: { id: "admin-demo", name: "Admin demo" },
        actions: {
          quota: { kind: "status", handler: () => Promise.resolve({ ok: true }) },
          shared: { kind: "metric", handler: () => Promise.resolve({ ok: true }) },
          orphan: { kind: "action", handler: () => Promise.resolve({ ok: true }) },
        },
        admin: {
          widgets: [
            { id: "quota", label: "Quota", kind: "metric", actionId: "quota" },
            { id: "missing", label: "Missing", kind: "status", actionId: "missing" },
            { id: "shared-metric", label: "Shared", kind: "metric", actionId: "shared" },
          ],
          dashboardWidgets: [
            { id: "shared-status", label: "Shared", kind: "status", actionId: "shared" },
          ],
        },
      },
    ]);

    expect(report.status).toBe("blocked");
    expect(report.summary.actions).toBe(3);
    expect(report.plugins[0]?.actions).toEqual([
      { id: "orphan", kind: "action", source: "definition", description: undefined },
      { id: "quota", kind: "status", source: "definition", description: undefined },
      { id: "shared", kind: "metric", source: "definition", description: undefined },
    ]);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugins.action_missing", state: "error" }),
        expect.objectContaining({ id: "plugins.action_kind_mismatch", state: "error" }),
        expect.objectContaining({
          id: "plugins.action_conflicting_references",
          state: "error",
        }),
        expect.objectContaining({ id: "plugins.action_unreferenced", state: "warn" }),
      ]),
    );
  });

  it("warns when legacy setup actions cannot be inspected statically", () => {
    const report = analyzePlugins([
      {
        manifest: { id: "legacy", name: "Legacy" },
        admin: {
          widgets: [{ id: "health", label: "Health", kind: "status", actionId: "health" }],
          actions: [{ id: "sync", label: "Sync", actionId: "sync" }],
        },
        setup: () => undefined,
      },
    ]);

    expect(report.status).toBe("attention");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugins.action_untyped",
          state: "warn",
          detail: expect.stringContaining("legacy"),
        }),
      ]),
    );
  });

  it("blocks missing actions when no setup callback can register them", () => {
    const report = analyzePlugins([
      {
        manifest: { id: "broken", name: "Broken" },
        admin: {
          actions: [{ id: "sync", label: "Sync", actionId: "missing" }],
        },
      },
    ]);

    expect(report.status).toBe("blocked");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugins.action_missing",
          state: "error",
          pluginIds: ["broken"],
        }),
      ]),
    );
  });

  it("blocks unsafe dot-segment action ids with a stable doctor check", () => {
    const report = analyzePlugins([
      {
        manifest: { id: "unsafe", name: "Unsafe" },
        actions: {
          "..": { kind: "action", handler: () => Promise.resolve({ ok: true }) },
        },
        admin: {
          actions: [{ id: "sync", label: "Sync", actionId: ".." }],
        },
      },
    ]);

    expect(report.status).toBe("blocked");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugins.action_unsafe_id",
          state: "error",
          pluginIds: ["unsafe"],
        }),
      ]),
    );
  });

  it("supports partial registry migration while marking setup-provided ids untyped", () => {
    const report = analyzePlugins([
      {
        manifest: { id: "mixed", name: "Mixed" },
        actions: {
          quota: { kind: "metric", handler: () => Promise.resolve({ ok: true }) },
        },
        admin: {
          widgets: [
            { id: "quota", label: "Quota", kind: "metric", actionId: "quota" },
            { id: "health", label: "Health", kind: "status", actionId: "health" },
          ],
        },
        setup: () => undefined,
      },
    ]);

    expect(report.status).toBe("attention");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugins.action_untyped",
          state: "warn",
          pluginIds: ["mixed"],
          detail: expect.stringContaining('Action "health"'),
        }),
      ]),
    );
    expect(report.checks).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "plugins.action_missing" })]),
    );
  });

  it("keeps action diagnostics attached to exact plugins and targets the broken plugin", () => {
    const plugins = [
      { manifest: { id: "foo", name: "Foo" } },
      ...Array.from({ length: 6 }, (_, index) => ({
        manifest: {
          id: index === 0 ? "foobar" : `broken-${index.toString()}`,
          name: `Broken ${index.toString()}`,
        },
        admin: {
          actions: [{ id: "sync", label: "Sync", actionId: `missing-${index.toString()}` }],
        },
      })),
    ];
    const report = analyzePlugins(plugins);

    expect(report.nextCommand).toBe("nexpress ops plugins inspect foobar --json");
    expect(buildOpsPluginInspectJson(report, "foo").status).toBe("ready");
    const sixth = buildOpsPluginInspectJson(report, "broken-5");
    expect(sixth.status).toBe("blocked");
    expect(sixth.relatedChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugins.action_missing",
          pluginIds: expect.arrayContaining(["broken-5"]),
          detail: expect.stringContaining("broken-5"),
        }),
      ]),
    );
  });

  it("preserves a structured missing-action check when definePlugin aborts config import", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "np-ops-plugins-action-import-"));
    writeFileSync(
      join(cwd, "nexpress.config.ts"),
      `throw new Error('[plugin:demo] admin.widgets.quota references missing action "quota".');\n`,
    );

    const report = await collectOpsPluginsStatus(cwd);

    expect(report.status).toBe("blocked");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugins.config_file", state: "error" }),
        expect.objectContaining({
          id: "plugins.action_missing",
          state: "error",
          detail: expect.stringContaining("admin.widgets.quota"),
        }),
      ]),
    );
  });

  it("renders doctor hints and ordered next commands", () => {
    const report = analyzePlugins([
      {
        manifest: { id: "one", name: "One" },
        blocks: [{ type: "shared" }],
      },
      {
        manifest: { id: "two", name: "Two" },
        blocks: [{ type: "shared" }],
      },
    ]);

    const brief = renderBriefOpsPluginsStatus(report, "doctor", { color: false });

    expect(brief).toContain("shared is claimed by plugins one, two");
    expect(brief).toContain("hint: Block type names share one registry.");
    expect(brief).toContain("pnpm --silent run ops:plugins -- doctor --json");
    expect(brief).toContain("Next: nexpress ops plugins inspect one --json");
    expect(brief).toContain("  - nexpress ops plugins inspect two --json");
    expect(brief).toContain("Project next: pnpm --silent run ops:plugins -- inspect one --json");
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

  it("dry-runs plugin disable with a mutation audit", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "np-ops-plugins-mutation-"));
    writeFileSync(
      join(cwd, "nexpress.config.ts"),
      `export default { plugins: [{ manifest: { id: "demo", name: "Demo" } }] };\n`,
    );

    const report = await runOpsPluginsMutation({
      action: "disable",
      pluginId: "demo",
      cwd,
      env: {},
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-plugins-mutation.v1",
        action: "disable",
        pluginId: "demo",
        mutation: expect.objectContaining({
          action: "plugins.disable",
          mode: "dry-run",
          applied: false,
        }),
        nextCommand: "nexpress ops plugins disable demo --execute --approve plugin-disable --json",
      }),
    );
    expect(renderBriefOpsPluginsMutation(report, { color: false })).toContain(
      "mutation: plugins.disable applied=false",
    );
  });

  it("requires approval before plugin enable/disable execute mode", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "np-ops-plugins-approval-"));
    writeFileSync(
      join(cwd, "nexpress.config.ts"),
      `export default { plugins: [{ manifest: { id: "demo", name: "Demo" } }] };\n`,
    );

    const report = await runOpsPluginsMutation({
      action: "enable",
      pluginId: "demo",
      execute: true,
      out: join(cwd, "plugin-enable.json"),
      cwd,
      env: { DATABASE_URL: "postgres://nexpress:nexpress@127.0.0.1:55432/ci_unreachable" },
    });

    expect(report.ok).toBe(false);
    expect(report.mutation).toEqual(
      expect.objectContaining({
        action: "plugins.enable",
        mode: "execute",
        applied: false,
        error: "Missing --approve plugin-enable",
      }),
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugins.mutation.approval",
          state: "error",
        }),
      ]),
    );
  });
});
