import { describe, expect, it } from "vitest";

import { analyzePlugins, renderBriefOpsPluginsStatus } from "./ops-plugins-core.js";

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
});
