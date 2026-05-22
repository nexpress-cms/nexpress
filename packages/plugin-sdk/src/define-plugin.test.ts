import { describe, expect, it } from "vitest";

import { definePlugin } from "./define-plugin.js";

const baseManifest = {
  id: "test",
  version: "0.1.0",
  name: "Test plugin",
  description: "scaffold",
  author: { name: "test" },
  license: "MIT",
  nexpress: { minVersion: "0.1.0" },
} as const;

describe("definePlugin — capability derivation", () => {
  it("auto-adds api:route when routes are declared", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      routes: [
        {
          method: "GET",
          path: "/ping",
          handler: () => Promise.resolve({ status: 200 }),
        },
      ],
    });
    expect(plugin.manifest.capabilities).toContain("api:route");
  });

  it("auto-adds hooks:<namespace> for every hook namespace", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      hooks: {
        "content:afterCreate": () => undefined,
        "auth:afterLogin": () => undefined,
      },
    });
    expect(plugin.manifest.capabilities.sort()).toEqual(["hooks:auth", "hooks:content"]);
  });

  it("merges author-declared capabilities with derived ones (no duplicates)", () => {
    const plugin = definePlugin({
      manifest: {
        ...baseManifest,
        // Author already listed `storage:kv` (which is NOT auto-derivable
        // because the host can't tell if the route handler will call
        // `ctx.storage.set`). The derivation should preserve it AND add
        // `api:route` from the route surface.
        capabilities: ["storage:kv"],
      },
      routes: [
        {
          method: "POST",
          path: "/x",
          handler: () => Promise.resolve({ status: 200 }),
        },
      ],
    });
    expect(plugin.manifest.capabilities.sort()).toEqual(["api:route", "storage:kv"]);
  });

  it("emits an empty capabilities list for a static block-only plugin", () => {
    // No routes, no hooks → nothing the host requires us to declare.
    const plugin = definePlugin({
      manifest: { ...baseManifest },
    });
    expect(plugin.manifest.capabilities).toEqual([]);
  });

  it("auto-adds site:route when page routes are declared", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      pageRoutes: [{ pattern: "/status", component: () => null }],
    });
    expect(plugin.manifest.capabilities).toContain("site:route");
  });

  it("auto-adds hooks:scheduled when scheduled tasks are declared", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      scheduled: [
        {
          id: "nightly",
          cron: "0 2 * * *",
          handler: () => undefined,
        },
      ],
    });
    expect(plugin.manifest.capabilities).toContain("hooks:scheduled");
  });

  it("auto-adds admin capabilities from the declared admin surface", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      admin: {
        widgets: [{ id: "health", label: "Health", kind: "status", actionId: "health" }],
        collectionTabs: [
          {
            id: "doc",
            label: "Document",
            collections: ["posts"],
            actions: [{ id: "sync", label: "Sync", actionId: "sync" }],
          },
        ],
        dashboardWidgets: [{ id: "metric", label: "Metric", kind: "metric", actionId: "metric" }],
      },
    });

    expect(plugin.manifest.capabilities.sort()).toEqual([
      "admin:collection-tab",
      "admin:dashboard",
      "admin:panel",
    ]);
  });
});

describe("definePlugin — provides derivation (regression)", () => {
  it("derives provides.blocks from the blocks array", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      blocks: [
        {
          type: "callout",
          label: "Callout",
          defaultProps: {},
          propsSchema: [],
          render: () => ({ type: "div", props: {}, key: null }) as never,
        },
      ],
    });
    expect(plugin.manifest.provides.blocks).toContain("callout");
  });

  it("derives page route and scheduled task provides from definition surfaces", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      pageRoutes: [{ pattern: "/events/:slug", component: () => null }],
      scheduled: [{ id: "sync-events", cron: "*/15 * * * *", handler: () => undefined }],
    });

    expect(plugin.manifest.provides.pageRoutes).toEqual(["/events/:slug"]);
    expect(plugin.manifest.provides.scheduledTasks).toEqual(["sync-events"]);
  });

  it("skips malformed scheduled entries while deriving provides", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      scheduled: [
        { id: "valid", cron: "*/15 * * * *", handler: () => undefined },
        { cron: "*/15 * * * *", handler: () => undefined } as never,
      ],
    });

    expect(plugin.manifest.provides.scheduledTasks).toEqual(["valid"]);
  });
});
