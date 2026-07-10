import { describe, expect, expectTypeOf, it } from "vitest";
import { npPluginApiRouteMethods } from "@nexpress/core";

import { definePlugin } from "./define-plugin.js";
import {
  npRouteMethods,
  type NpPluginDefinition,
  type NpPatternDefinition,
  type NpPluginPageRouteProps,
  type NpReadonlyPluginDocument,
  type NpRenderContribution,
  type NpRouteRequest,
  type NpRouteResponse,
} from "./types.js";

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
  it("keeps the SDK API method inventory aligned with core", () => {
    expect(npRouteMethods).toEqual(npPluginApiRouteMethods);
  });

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

  it("contextually types API route requests and accepts synchronous responses", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      routes: [
        {
          method: "GET",
          path: "/health",
          handler: (request) => {
            expectTypeOf(request).toEqualTypeOf<NpRouteRequest>();
            expectTypeOf(request.method).toEqualTypeOf<
              "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE"
            >();
            return { status: 204 } satisfies NpRouteResponse;
          },
        },
      ],
    });

    expect(plugin.manifest.provides.apiRoutes).toContain("GET /health");
  });

  it.each([
    [
      [{ method: "get", path: "/health", handler: () => ({ status: 200 }) }],
      /method must be one of/,
    ],
    [[{ method: "GET", path: "health", handler: () => ({ status: 200 }) }], /path must start with/],
    [
      [{ method: "GET", path: "/users/:id", handler: () => ({ status: 200 }) }],
      /unsupported segment/,
    ],
    [[{ method: "GET", path: "/health", handler: "./handler.js" }], /needs a handler/],
    [
      [{ method: "GET", path: "/health", handler: () => ({ status: 200 }), auth: "yes" }],
      /auth must be boolean/,
    ],
  ])("rejects malformed API route definitions during evaluation", (routes, message) => {
    const definition = { manifest: { ...baseManifest }, routes } as unknown as NpPluginDefinition;
    expect(() => definePlugin(definition)).toThrow(message);
  });

  it("rejects duplicate method/path pairs within one plugin", () => {
    const definition = {
      manifest: { ...baseManifest },
      routes: [
        { method: "GET", path: "/health", handler: () => ({ status: 200 }) },
        { method: "GET", path: "/health", handler: () => ({ status: 204 }) },
      ],
    } as unknown as NpPluginDefinition;

    expect(() => definePlugin(definition)).toThrow(/duplicate API route "GET \/health"/);
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

  it("types render hook data and contributions through the single canonical hook", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      hooks: {
        "render:beforePage": ({ hook, data }) => {
          expectTypeOf(hook).toEqualTypeOf<"render:beforePage">();
          expectTypeOf(data.collection).toEqualTypeOf<string>();
          expectTypeOf(data.document).toEqualTypeOf<NpReadonlyPluginDocument>();
          return {
            bodyEnd: [{ tag: "script", children: "window.test = true;" }],
          } satisfies NpRenderContribution;
        },
      },
    });

    expect(plugin.manifest.capabilities).toContain("hooks:render");
    expect(plugin.manifest.provides.hooks).toEqual(["render:beforePage"]);
  });

  it("rejects removed or unknown hook names during definition evaluation", () => {
    const definition = {
      manifest: { ...baseManifest },
      hooks: {
        "render:afterPage": () => ({ bodyEnd: [] }),
      },
    } as unknown as NpPluginDefinition;

    expect(() => definePlugin(definition)).toThrow(/unsupported hook "render:afterPage"/);
  });

  it("rejects malformed hook descriptors during definition evaluation", () => {
    const definition = {
      manifest: { ...baseManifest },
      hooks: {
        "render:beforePage": { handler: "./render-handler.js", timeoutMs: 0 },
      },
    } as unknown as NpPluginDefinition;

    expect(() => definePlugin(definition)).toThrow(
      /hook "render:beforePage" descriptor requires a handler/,
    );
  });

  it("rejects invalid hook descriptor controls during definition evaluation", () => {
    const definition = {
      manifest: { ...baseManifest },
      hooks: {
        "render:beforePage": { handler: () => undefined, timeoutMs: 0 },
      },
    } as unknown as NpPluginDefinition;

    expect(() => definePlugin(definition)).toThrow(/timeoutMs must be greater than 0/);
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
      pageRoutes: [
        {
          pattern: "/status/:id",
          component: (props) => {
            expectTypeOf(props).toEqualTypeOf<NpPluginPageRouteProps>();
            expectTypeOf(props.params.id).toEqualTypeOf<string>();
            return null;
          },
          metadata: (props) => ({ title: props.params.id }),
        },
      ],
    });
    expect(plugin.manifest.capabilities).toContain("site:route");
  });

  it.each([
    [[{ pattern: "status", component: (): null => null }], /pattern must start with/],
    [[{ pattern: "/status/:id([)", component: (): null => null }], /invalid regular expression/],
    [[{ pattern: "/status", component: "./page.js" }], /component must be a function/],
    [[{ pattern: "/status", component: (): null => null, metadata: {} }], /metadata/],
    [[{ pattern: "/status", component: (): null => null, locale: "inherit" }], /locale/],
    [[{ pattern: "/status", component: (): null => null, surface: "admin" }], /surface/],
  ])("rejects malformed page routes during evaluation", (pageRoutes, message) => {
    const definition = {
      manifest: { ...baseManifest },
      pageRoutes,
    } as unknown as NpPluginDefinition;
    expect(() => definePlugin(definition)).toThrow(message);
  });

  it("rejects duplicate page route patterns within one plugin", () => {
    const definition = {
      manifest: { ...baseManifest },
      pageRoutes: [
        { pattern: "/status", component: () => null },
        { pattern: "/status", component: () => null, locale: "none" },
      ],
    } as unknown as NpPluginDefinition;

    expect(() => definePlugin(definition)).toThrow(/duplicate page route "\/status"/);
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

  it.each([
    [{}, /scheduled must be an array/],
    [
      [{ id: "nightly", cron: "0 2 * *", handler: () => undefined }],
      /cron must use exactly five fields/,
    ],
    [[{ id: "nightly", cron: "0 2 * * *", handler: "./handler.js" }], /handler must be a function/],
  ])("rejects malformed scheduled task registries during evaluation", (scheduled, message) => {
    const definition = {
      manifest: { ...baseManifest },
      scheduled,
    } as unknown as NpPluginDefinition;
    expect(() => definePlugin(definition)).toThrow(message);
  });

  it("rejects duplicate scheduled task ids within one plugin", () => {
    const definition = {
      manifest: { ...baseManifest },
      scheduled: [
        { id: "nightly", cron: "0 2 * * *", handler: () => undefined },
        { id: "nightly", cron: "0 3 * * *", handler: () => undefined },
      ],
    } as unknown as NpPluginDefinition;

    expect(() => definePlugin(definition)).toThrow(/duplicate scheduled task id "nightly"/);
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
      setup: () => undefined,
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

  it.each([
    [{}, /blocks must be an array/],
    [[{ type: "callout" }], /invalid block at index 0/],
    [
      [
        {
          type: "callout",
          label: "Callout",
          defaultProps: {},
          propsSchema: [{ name: "tone", label: "Tone", type: "select" }],
          render: () => null,
        },
      ],
      /at least one option/,
    ],
  ])("rejects malformed block registries during evaluation", (blocks, message) => {
    const definition = {
      manifest: { ...baseManifest },
      blocks,
    } as unknown as NpPluginDefinition;
    expect(() => definePlugin(definition)).toThrow(message);
  });

  it("rejects duplicate block types within one plugin", () => {
    const block = {
      type: "callout",
      label: "Callout",
      defaultProps: {},
      propsSchema: [],
      render: () => null,
    };
    const definition = {
      manifest: { ...baseManifest },
      blocks: [block, { ...block }],
    } as unknown as NpPluginDefinition;

    expect(() => definePlugin(definition)).toThrow(/duplicate block type "callout"/);
  });

  it("validates source-less pattern contributions and derives provides.patterns", () => {
    const patterns = [
      {
        id: "test.callout-stack",
        label: "Callout stack",
        blocks: [{ id: "template-callout", type: "callout", props: { tone: "info" } }],
      },
    ] satisfies NpPatternDefinition[];
    const plugin = definePlugin({ manifest: { ...baseManifest }, patterns });

    expect(plugin.patterns).toEqual(patterns);
    expect(plugin.manifest.provides.patterns).toEqual(["test.callout-stack"]);
  });

  it.each([
    [{}, /patterns must be an array/],
    [[{ id: "test.empty", label: "Empty", blocks: [] }], /at least one block instance/],
  ])("rejects malformed pattern registries during evaluation", (patterns, message) => {
    const definition = {
      manifest: { ...baseManifest },
      patterns,
    } as unknown as NpPluginDefinition;
    expect(() => definePlugin(definition)).toThrow(message);
  });

  it("rejects duplicate pattern ids within one plugin", () => {
    const pattern = {
      id: "test.hero",
      label: "Hero",
      blocks: [{ id: "template-hero", type: "hero", props: {} }],
    };
    const definition = {
      manifest: { ...baseManifest },
      patterns: [pattern, { ...pattern }],
    } as NpPluginDefinition;

    expect(() => definePlugin(definition)).toThrow(/duplicate pattern id "test\.hero"/);
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

  it("derives provides.actions from the definition-level registry", () => {
    const plugin = definePlugin({
      manifest: { ...baseManifest },
      actions: {
        refresh: {
          kind: "action",
          handler: () => Promise.resolve({ ok: true }),
        },
      },
    });

    expect(plugin.manifest.provides.actions).toEqual(["refresh"]);
  });

  it("rejects malformed scheduled entries before deriving provides", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        scheduled: [
          { id: "valid", cron: "*/15 * * * *", handler: () => undefined },
          { cron: "*/15 * * * *", handler: () => undefined } as never,
        ],
      }),
    ).toThrow(/invalid scheduled task at index 1/);
  });
});

describe("definePlugin — admin action contract", () => {
  it("links metric, status, and table references to compatible handlers", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        actions: {
          quota: {
            kind: "metric",
            handler: () => Promise.resolve({ ok: true, data: { value: 42 } }),
          },
          health: {
            kind: "status",
            handler: () => Promise.resolve({ ok: true, data: { level: "ok", message: "Healthy" } }),
          },
          rows: {
            kind: "table",
            handler: () => Promise.resolve({ ok: true, data: { rows: [], total: 0 } }),
          },
        },
        admin: {
          widgets: [
            { id: "quota", label: "Quota", kind: "metric", actionId: "quota" },
            { id: "health", label: "Health", kind: "status", actionId: "health" },
          ],
          tables: [
            {
              id: "rows",
              label: "Rows",
              columns: [{ name: "id", label: "ID" }],
              rowsActionId: "rows",
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("allows a typed handler to be shared with a general admin button", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        actions: {
          health: {
            kind: "status",
            handler: () => Promise.resolve({ ok: true, data: { level: "ok", message: "Healthy" } }),
          },
        },
        admin: {
          widgets: [{ id: "health", label: "Health", kind: "status", actionId: "health" }],
          actions: [{ id: "refresh", label: "Refresh", actionId: "health" }],
        },
      }),
    ).not.toThrow();
  });

  it("rejects a missing action as soon as the registry is declared", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        actions: {},
        admin: {
          widgets: [{ id: "quota", label: "Quota", kind: "metric", actionId: "missing" }],
        },
      }),
    ).toThrow(/admin\.widgets\.quota references missing action "missing"/);
  });

  it.each([
    ["metric", "status"],
    ["status", "metric"],
  ] as const)("rejects a %s widget backed by a %s handler", (widgetKind, actionKind) => {
    const incompatible =
      actionKind === "metric"
        ? {
            kind: "metric" as const,
            handler: () => Promise.resolve({ ok: true, data: { value: 1 } }),
          }
        : {
            kind: "status" as const,
            handler: () =>
              Promise.resolve({ ok: true, data: { level: "ok" as const, message: "ok" } }),
          };
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        actions: {
          incompatible,
        },
        admin: {
          widgets: [{ id: "bad", label: "Bad", kind: widgetKind, actionId: "incompatible" }],
        },
      }),
    ).toThrow(new RegExp(`expects a ${widgetKind} action.*registered as ${actionKind}`));
  });

  it("rejects a table backed by a non-table handler", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        actions: {
          rows: {
            kind: "action",
            handler: () => Promise.resolve({ ok: true }),
          },
        },
        admin: {
          tables: [
            {
              id: "rows",
              label: "Rows",
              columns: [{ name: "id", label: "ID" }],
              rowsActionId: "rows",
            },
          ],
        },
      }),
    ).toThrow(/expects a table action.*registered as action/);
  });

  it("keeps setup-only action registration compatible", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        admin: {
          widgets: [{ id: "legacy", label: "Legacy", kind: "metric", actionId: "setupOnly" }],
        },
        setup: (ctx) => {
          ctx.actions.register("setupOnly", () =>
            Promise.resolve({ ok: true, data: { value: 1 } }),
          );
        },
      }),
    ).not.toThrow();
  });

  it("supports gradual migration with definition and setup actions together", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        actions: {
          quota: {
            kind: "metric",
            handler: () => Promise.resolve({ ok: true, data: { value: 1 } }),
          },
        },
        admin: {
          widgets: [
            { id: "quota", label: "Quota", kind: "metric", actionId: "quota" },
            { id: "health", label: "Health", kind: "status", actionId: "health" },
          ],
        },
        setup: (ctx) => {
          ctx.actions.registerStatus("health", () =>
            Promise.resolve({ ok: true, data: { level: "ok", message: "Healthy" } }),
          );
        },
      }),
    ).not.toThrow();
  });

  it("rejects an admin reference when neither a registry nor setup can provide it", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        admin: {
          actions: [{ id: "sync", label: "Sync", actionId: "missing" }],
        },
      }),
    ).toThrow(/admin\.actions\.sync references missing action "missing"/);
  });

  it("does not treat inherited object properties as registered action ids", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        actions: {},
        admin: {
          actions: [{ id: "sync", label: "Sync", actionId: "toString" }],
        },
      }),
    ).toThrow(/admin\.actions\.sync references missing action "toString"/);
  });

  it("rejects dot-segment action ids on admin surfaces", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        actions: {
          ".": { kind: "action", handler: () => Promise.resolve({ ok: true }) },
        },
        admin: {
          actions: [{ id: "sync", label: "Sync", actionId: "." }],
        },
      }),
    ).toThrow(/admin\.actions\.sync uses unsafe action id "\."/);
  });

  it("rejects dot-segment admin references on the setup-only compatibility path", () => {
    expect(() =>
      definePlugin({
        manifest: { ...baseManifest },
        admin: {
          actions: [{ id: "sync", label: "Sync", actionId: ".." }],
        },
        setup: (ctx) => {
          ctx.actions.register("..", () => Promise.resolve({ ok: true }));
        },
      }),
    ).toThrow(/admin\.actions\.sync uses unsafe action id "\.\."/);
  });
});
