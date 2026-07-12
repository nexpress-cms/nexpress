import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAllPluginIds,
  getPluginAdminActionDiagnostics,
  getPluginPageRoutes,
  getPluginRegistration,
  getPluginRoutes,
  getRegisteredPluginActions,
  getRegisteredPluginSchedules,
  dispatchPluginAction,
  loadPlugins,
  resetPlugins,
  runHook,
  runHookAndCollect,
  runPluginScheduledTask,
  teardownPlugins,
} from "./index.js";
import { getRegisteredPluginTemplates } from "./templates.js";
import { getRegisteredPluginStrings } from "../i18n/strings.js";
import type { NpPluginConfig } from "../config/types.js";
import { resetLogger, setLogger, type NpLogger } from "../observability/logger.js";
import { resetEnabledGate, setPluginEnabledForTest } from "./enabled-gate.js";
import { resetFrameworkVersion, setFrameworkVersionForTest } from "./compat.js";
import { type NpContentAfterCreateHookData, type NpRenderHookData } from "./hook-contract.js";

function legacyPlugin(id: string, init?: NpPluginConfig["init"]): NpPluginConfig {
  return { id, name: `${id} plugin`, init };
}

function resolvedPlugin(
  id: string,
  options: {
    capabilities?: readonly string[];
    hooks?: Record<string, (ctx: { hook: string; data: Record<string, unknown> }) => unknown>;
    routes?: Array<{ method: string; path: string; handler: unknown }>;
    scheduled?: Array<{
      id: string;
      cron: string;
      handler: (ctx: Record<string, unknown>) => unknown;
      description?: string;
    }>;
  } = {},
): {
  manifest: {
    id: string;
    name: string;
    version: string;
    capabilities: readonly string[];
  };
  hooks?: Record<string, unknown>;
  routes?: ReadonlyArray<{ method: string; path: string; handler: unknown }>;
  scheduled?: ReadonlyArray<{
    id: string;
    cron: string;
    handler: unknown;
    description?: string;
  }>;
} {
  return {
    manifest: {
      id,
      name: `${id} plugin`,
      version: "0.1.0",
      capabilities: options.capabilities ?? [],
    },
    hooks: options.hooks,
    routes: options.routes,
    scheduled: options.scheduled,
  };
}

function afterCreateData(collection = "posts"): NpContentAfterCreateHookData {
  return {
    collection,
    documentId: "doc-1",
    document: { id: "doc-1" },
    originalDocument: null,
    operation: "create",
    source: "request",
    principal: {
      kind: "staff",
      user: {
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
        tokenVersion: 0,
      },
    },
  };
}

function renderData(): NpRenderHookData {
  return { collection: "pages", slug: "hello", document: { id: "page-1" } };
}

describe("plugin host", () => {
  beforeEach(() => {
    resetPlugins();
    resetEnabledGate();
  });

  describe("loadPlugins — legacy init() shape", () => {
    it("registers the plugin id", async () => {
      await loadPlugins([legacyPlugin("legacy-a")]);
      expect(getAllPluginIds()).toEqual(["legacy-a"]);
    });

    it("lets init() register hooks via addHook that fire on content events", async () => {
      const handler = vi.fn();
      await loadPlugins([
        legacyPlugin("legacy-b", (ctx) => {
          ctx.addHook("posts", "afterCreate", handler);
        }),
      ]);

      // Pipeline dispatches `content:afterCreate` with the collection name in
      // the payload; the legacy wrapper filters by collection internally.
      await runHook("content:afterCreate", afterCreateData("posts"));
      expect(handler).toHaveBeenCalledOnce();
    });

    it("skips a legacy hook when the event targets a different collection", async () => {
      const handler = vi.fn();
      await loadPlugins([
        legacyPlugin("legacy-c", (ctx) => {
          ctx.addHook("posts", "afterCreate", handler);
        }),
      ]);

      await runHook("content:afterCreate", afterCreateData("pages"));
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects unknown legacy content hook events", async () => {
      await loadPlugins([
        legacyPlugin("legacy-unknown", (ctx) => {
          ctx.addHook("posts", "afterSave", () => ({}));
        }),
      ]);

      expect(getAllPluginIds()).not.toContain("legacy-unknown");
    });
  });

  describe("loadPlugins — resolved shape with manifest", () => {
    it("rejects unsupported hook names even when definePlugin was bypassed", async () => {
      await loadPlugins([
        resolvedPlugin("unknown-hook", {
          capabilities: ["hooks:content"],
          hooks: {
            "content:afterSave": () => undefined,
          },
        }),
      ]);

      expect(getAllPluginIds()).not.toContain("unknown-hook");
    });

    it("rejects a content hook when hooks:content is not declared", async () => {
      // Per #620 (load-time error isolation), a capability
      // mis-declaration no longer crashes the host — it's logged
      // and the misbehaving plugin is dropped from the registry.
      // Other plugins continue to load. The contract is now:
      // loadPlugins() resolves; the failing plugin is absent from
      // getAllPluginIds().
      await loadPlugins([
        resolvedPlugin("no-capability", {
          capabilities: [],
          hooks: {
            "content:afterCreate": () => undefined,
          },
        }),
      ]);
      expect(getAllPluginIds()).not.toContain("no-capability");
    });

    it("rejects a route registration when api:route is not declared", async () => {
      // Same isolation contract as above. The plugin is logged +
      // dropped; other plugins keep loading.
      await loadPlugins([
        resolvedPlugin("no-route-cap", {
          capabilities: ["hooks:content"],
          routes: [
            {
              method: "GET",
              path: "/hi",
              handler: () => Promise.resolve({ status: 200 }),
            },
          ],
        }),
      ]);
      expect(getAllPluginIds()).not.toContain("no-route-cap");
    });

    it("registers hooks and routes when capabilities cover them", async () => {
      const hookHandler = vi.fn();

      await loadPlugins([
        resolvedPlugin("full", {
          capabilities: ["hooks:content", "api:route"],
          hooks: {
            "content:afterCreate": hookHandler,
          },
          routes: [
            {
              method: "POST",
              path: "/echo",
              handler: () => Promise.resolve({ status: 201 }),
            },
          ],
        }),
      ]);

      await runHook("content:afterCreate", afterCreateData("posts"));

      expect(hookHandler).toHaveBeenCalledOnce();
      const ctx = hookHandler.mock.calls[0]?.[0] as {
        hook: string;
        data: NpContentAfterCreateHookData;
      };
      expect(ctx.hook).toBe("content:afterCreate");
      expect(ctx.data.collection).toBe("posts");

      const routes = getPluginRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe("POST");
      expect(routes[0]?.path).toBe("/echo");

      const reg = getPluginRegistration("full");
      expect(reg?.capabilities).toEqual(["hooks:content", "api:route"]);
    });

    it("registers and dispatches definition-level actions with kind metadata", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("definition-actions"),
          actions: {
            quota: {
              kind: "metric",
              handler: (_data: unknown, ctx: { pluginId: string }) =>
                Promise.resolve({ ok: true, data: { value: ctx.pluginId } }),
            },
          },
          admin: {
            widgets: [
              {
                id: "quota",
                label: "Quota",
                kind: "metric",
                actionId: "quota",
              },
            ],
          },
        },
      ]);

      expect(getRegisteredPluginActions("definition-actions")).toEqual([
        {
          id: "quota",
          kind: "metric",
          source: "definition",
          description: undefined,
        },
      ]);
      expect(getPluginAdminActionDiagnostics("definition-actions")).toEqual([]);
      await expect(dispatchPluginAction("definition-actions", "quota")).resolves.toEqual({
        ok: true,
        data: { value: "definition-actions" },
      });
    });

    it("builds a fresh config context for every definition-action dispatch", async () => {
      const configModule = await import("./config.js");
      let currentConfig: Record<string, unknown> = { label: "first" };
      const configSpy = vi
        .spyOn(configModule, "getPluginConfig")
        .mockImplementation(() => Promise.resolve(currentConfig));

      try {
        await loadPlugins([
          {
            ...resolvedPlugin("fresh-action-config"),
            actions: {
              readConfig: {
                kind: "action",
                handler: (_data: unknown, ctx: { config: Record<string, unknown> }) =>
                  Promise.resolve({ ok: true, data: ctx.config.label }),
              },
            },
          } as never,
        ]);

        await expect(dispatchPluginAction("fresh-action-config", "readConfig")).resolves.toEqual({
          ok: true,
          data: "first",
        });
        currentConfig = { label: "second" };
        await expect(dispatchPluginAction("fresh-action-config", "readConfig")).resolves.toEqual({
          ok: true,
          data: "second",
        });
      } finally {
        configSpy.mockRestore();
      }
    });

    it("diagnoses setup-only kind mismatches without dropping the plugin", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("legacy-actions"),
          admin: {
            widgets: [
              {
                id: "quota",
                label: "Quota",
                kind: "metric",
                actionId: "quota",
              },
            ],
          },
          setup: (ctx: {
            actions: {
              registerStatus(
                id: string,
                handler: () => Promise<{
                  ok: boolean;
                  data: { level: string; message: string };
                }>,
              ): void;
            };
          }) => {
            ctx.actions.registerStatus("quota", () =>
              Promise.resolve({ ok: true, data: { level: "ok", message: "ok" } }),
            );
          },
        },
      ]);

      expect(getAllPluginIds()).toContain("legacy-actions");
      expect(getPluginAdminActionDiagnostics("legacy-actions")).toEqual([
        expect.objectContaining({
          code: "kind-mismatch",
          severity: "error",
          actionId: "quota",
          expectedKind: "metric",
          actualKind: "status",
        }),
      ]);
    });

    it("keeps setup override compatibility and diagnoses definition collisions", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("action-collision"),
          actions: {
            shared: {
              kind: "metric",
              handler: () => Promise.resolve({ ok: true, data: { value: 1 } }),
            },
          },
          admin: {
            widgets: [
              {
                id: "shared",
                label: "Shared",
                kind: "metric",
                actionId: "shared",
              },
            ],
          },
          setup: (ctx: {
            actions: {
              registerStatus(
                id: string,
                handler: () => Promise<{
                  ok: boolean;
                  data: { level: string; message: string };
                }>,
              ): void;
            };
          }) => {
            ctx.actions.registerStatus("shared", () =>
              Promise.resolve({ ok: true, data: { level: "ok", message: "override" } }),
            );
          },
        },
      ]);

      expect(getAllPluginIds()).toContain("action-collision");
      expect(getPluginAdminActionDiagnostics("action-collision")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "duplicate", actionId: "shared" }),
          expect.objectContaining({
            code: "kind-mismatch",
            actionId: "shared",
            expectedKind: "metric",
            actualKind: "status",
          }),
        ]),
      );
    });

    it("rejects scheduled tasks when hooks:scheduled is not declared", async () => {
      await loadPlugins([
        resolvedPlugin("no-scheduled-cap", {
          scheduled: [
            {
              id: "nightly",
              cron: "0 2 * * *",
              handler: () => undefined,
            },
          ],
        }),
      ]);

      expect(getAllPluginIds()).not.toContain("no-scheduled-cap");
      expect(getRegisteredPluginSchedules()).toEqual([]);
    });

    it("registers scheduled tasks and dispatches them when capabilities cover them", async () => {
      const handler = vi.fn();

      await loadPlugins([
        resolvedPlugin("scheduled-ok", {
          capabilities: ["hooks:scheduled"],
          scheduled: [
            {
              id: "daily-rollup",
              cron: "5 0 * * *",
              description: "Roll up yesterday's events.",
              handler,
            },
          ],
        }),
      ]);

      expect(getRegisteredPluginSchedules()).toEqual([
        expect.objectContaining({
          pluginId: "scheduled-ok",
          taskId: "daily-rollup",
          cron: "5 0 * * *",
          description: "Roll up yesterday's events.",
        }),
      ]);

      await runPluginScheduledTask("scheduled-ok", "daily-rollup");
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ pluginId: "scheduled-ok" }),
      );
    });

    it("rejects malformed and duplicate scheduled tasks when definePlugin was bypassed", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("bad-schedule", { capabilities: ["hooks:scheduled"] }),
          scheduled: [{ id: "nightly", cron: "0 2 * *", handler: () => undefined }],
        },
        {
          ...resolvedPlugin("duplicate-schedule", { capabilities: ["hooks:scheduled"] }),
          scheduled: [
            { id: "nightly", cron: "0 2 * * *", handler: () => undefined },
            { id: "nightly", cron: "0 3 * * *", handler: () => undefined },
          ],
        },
      ]);

      expect(getAllPluginIds()).not.toContain("bad-schedule");
      expect(getAllPluginIds()).not.toContain("duplicate-schedule");
      expect(getRegisteredPluginSchedules()).toEqual([]);
    });

    it("removes a previous schedule before rejecting an invalid replacement", async () => {
      await loadPlugins([
        resolvedPlugin("schedule-replacement", {
          capabilities: ["hooks:scheduled"],
          scheduled: [{ id: "nightly", cron: "0 2 * * *", handler: () => undefined }],
        }),
      ]);
      expect(getRegisteredPluginSchedules()).toHaveLength(1);

      await loadPlugins([
        {
          ...resolvedPlugin("schedule-replacement", { capabilities: ["hooks:scheduled"] }),
          scheduled: [{ id: "nightly", cron: "0 2 * *", handler: () => undefined }],
        },
      ]);

      expect(getAllPluginIds()).not.toContain("schedule-replacement");
      expect(getRegisteredPluginSchedules()).toEqual([]);
    });

    it("rejects non-void scheduled task results at dispatch", async () => {
      await loadPlugins([
        resolvedPlugin("scheduled-result", {
          capabilities: ["hooks:scheduled"],
          scheduled: [
            {
              id: "nightly",
              cron: "0 2 * * *",
              handler: () => ({ ok: true }),
            },
          ],
        }),
      ]);

      await expect(runPluginScheduledTask("scheduled-result", "nightly")).rejects.toThrow(
        '[plugin:scheduled-result] scheduled task "nightly": scheduled task handlers must return void.',
      );
    });

    it("rejects lowercase methods when definePlugin was bypassed", async () => {
      await loadPlugins([
        resolvedPlugin("case", {
          capabilities: ["api:route"],
          routes: [
            {
              method: "get",
              path: "/ok",
              handler: () => Promise.resolve({ status: 200 }),
            },
          ],
        }),
      ]);

      expect(getAllPluginIds()).not.toContain("case");
      expect(getPluginRoutes()).toHaveLength(0);
    });

    it("rejects malformed and duplicate API route definitions", async () => {
      await loadPlugins([
        resolvedPlugin("bad-path", {
          capabilities: ["api:route"],
          routes: [
            {
              method: "GET",
              path: "/users/:id",
              handler: () => ({ status: 200 }),
            },
          ],
        }),
        resolvedPlugin("duplicate-route", {
          capabilities: ["api:route"],
          routes: [
            { method: "GET", path: "/health", handler: () => ({ status: 200 }) },
            { method: "GET", path: "/health", handler: () => ({ status: 204 }) },
          ],
        }),
      ]);

      expect(getAllPluginIds()).not.toContain("bad-path");
      expect(getAllPluginIds()).not.toContain("duplicate-route");
      expect(getPluginRoutes()).toHaveLength(0);
    });

    it("removes a previous route before rejecting an invalid replacement", async () => {
      await loadPlugins([
        resolvedPlugin("replacement", {
          capabilities: ["api:route"],
          routes: [{ method: "GET", path: "/health", handler: () => ({ status: 200 }) }],
        }),
      ]);
      expect(getPluginRoutes()).toHaveLength(1);

      await loadPlugins([
        resolvedPlugin("replacement", {
          capabilities: ["api:route"],
          routes: [{ method: "GET", path: "/users/:id", handler: () => ({ status: 200 }) }],
        }),
      ]);

      expect(getAllPluginIds()).not.toContain("replacement");
      expect(getPluginRoutes()).toHaveLength(0);
    });

    it("accepts synchronous handlers and validates their response at dispatch", async () => {
      await loadPlugins([
        resolvedPlugin("sync-route", {
          capabilities: ["api:route"],
          routes: [
            {
              method: "GET",
              path: "/health",
              handler: () => ({ status: 200, body: { ok: true } }),
            },
          ],
        }),
      ]);

      const route = getPluginRoutes()[0];
      await expect(
        route?.handler({
          method: "GET",
          path: "/health",
          params: { pluginId: "sync-route" },
          query: {},
          body: undefined,
          headers: {},
        }),
      ).resolves.toEqual({ status: 200, body: { ok: true } });
    });

    it("rejects malformed handler responses with plugin and route context", async () => {
      await loadPlugins([
        resolvedPlugin("invalid-response", {
          capabilities: ["api:route"],
          routes: [
            {
              method: "GET",
              path: "/health",
              handler: () => ({ status: 204, body: { impossible: true } }),
            },
          ],
        }),
      ]);

      const route = getPluginRoutes()[0];
      await expect(
        route?.handler({
          method: "GET",
          path: "/health",
          params: { pluginId: "invalid-response" },
          query: {},
          body: undefined,
          headers: {},
        }),
      ).rejects.toThrow(
        '[plugin:invalid-response] API route "GET /health" returned an invalid response',
      );
    });
  });

  describe("runHook", () => {
    it("fans out to every registered handler in order", async () => {
      const calls: string[] = [];

      await loadPlugins([
        resolvedPlugin("a", {
          capabilities: ["hooks:content"],
          hooks: {
            "content:afterCreate": () => {
              calls.push("a");
            },
          },
        }),
        resolvedPlugin("b", {
          capabilities: ["hooks:content"],
          hooks: {
            "content:afterCreate": () => {
              calls.push("b");
            },
          },
        }),
      ]);

      await runHook("content:afterCreate", afterCreateData());
      expect(calls).toEqual(["a", "b"]);
    });

    it("is a no-op when the canonical hook has no handlers", async () => {
      await expect(
        runHook("auth:afterLogin", {
          user: { id: "user-1", email: "admin@example.com", role: "admin" },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("runHookAndCollect", () => {
    it("collects non-null return values from every handler", async () => {
      await loadPlugins([
        resolvedPlugin("a", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => ({ head: [{ tag: "meta", attrs: { name: "a" } }] }),
          },
        }),
        resolvedPlugin("b", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => ({ head: [{ tag: "meta", attrs: { name: "b" } }] }),
          },
        }),
      ]);

      const results = await runHookAndCollect<{
        head: Array<{ tag: string; attrs: Record<string, string> }>;
      }>("render:beforePage", { collection: "posts", slug: "hello", document: {} });

      expect(results).toHaveLength(2);
      expect(results.flatMap((r) => r.head.map((h) => h.attrs.name))).toEqual(["a", "b"]);
    });

    it("skips handlers that return undefined or null", async () => {
      await loadPlugins([
        resolvedPlugin("contributes", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => ({ head: [{ tag: "meta", attrs: { name: "x" } }] }),
          },
        }),
        resolvedPlugin("opts-out", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => undefined,
          },
        }),
        resolvedPlugin("returns-null", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => null,
          },
        }),
      ]);

      const results = await runHookAndCollect<{ head: unknown[] }>(
        "render:beforePage",
        renderData(),
      );
      expect(results).toHaveLength(1);
    });

    it("skips a collected result that fails the caller's runtime contract", async () => {
      await loadPlugins([
        resolvedPlugin("invalid", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => ({ footer: [{ tag: "script" }] }),
          },
        }),
        resolvedPlugin("valid", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => ({ bodyEnd: [{ tag: "script", children: "ok" }] }),
          },
        }),
      ]);

      const results = await runHookAndCollect<{ bodyEnd: unknown[] }>(
        "render:beforePage",
        renderData(),
        {
          validateResult: (value) =>
            value && typeof value === "object" && "bodyEnd" in value
              ? { ok: true }
              : { ok: false, message: "bodyEnd is required" },
        },
      );

      expect(results).toEqual([{ bodyEnd: [{ tag: "script", children: "ok" }] }]);
    });

    it("returns [] when no handler is registered", async () => {
      await expect(runHookAndCollect("render:beforePage", renderData())).resolves.toEqual([]);
    });

    it("isolates handler errors and skips the failed return value", async () => {
      await loadPlugins([
        resolvedPlugin("boom", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => {
              throw new Error("broken plugin");
            },
          },
        }),
        resolvedPlugin("ok", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => ({ head: [{ tag: "meta", attrs: { name: "ok" } }] }),
          },
        }),
      ]);

      // A throwing plugin must NOT take down the page render. The error is
      // logged + reported (verified separately), and the remaining plugin
      // still contributes its output.
      const results = await runHookAndCollect<{ head: Array<{ attrs: { name: string } }> }>(
        "render:beforePage",
        renderData(),
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.head[0]?.attrs.name).toBe("ok");
    });
  });

  describe("error isolation", () => {
    let errors: Array<{ message: string; context?: Record<string, unknown> }>;

    beforeEach(() => {
      errors = [];
      const captureLogger: NpLogger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (message, context) => {
          errors.push({ message, context });
        },
      };
      setLogger(captureLogger);
    });

    afterEach(() => {
      resetLogger();
    });

    it("logs the failing plugin id and continues to the next handler in runHook", async () => {
      const after = vi.fn();
      await loadPlugins([
        resolvedPlugin("first-throws", {
          capabilities: ["hooks:content"],
          hooks: {
            "content:afterCreate": () => {
              throw new Error("first failed");
            },
          },
        }),
        resolvedPlugin("second-runs", {
          capabilities: ["hooks:content"],
          hooks: { "content:afterCreate": after },
        }),
      ]);

      // Must not throw despite first plugin's failure.
      await expect(
        runHook("content:afterCreate", afterCreateData("posts")),
      ).resolves.toBeUndefined();

      expect(after).toHaveBeenCalledOnce();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toMatch(/Plugin hook handler threw/);
      expect(errors[0]?.context?.pluginId).toBe("first-throws");
      expect(errors[0]?.context?.hook).toBe("content:afterCreate");
    });

    it("diagnoses values returned from fire-and-forget lifecycle hooks", async () => {
      await loadPlugins([
        resolvedPlugin("returns-a-value", {
          capabilities: ["hooks:content"],
          hooks: {
            "content:afterCreate": () => ({ ignored: true }),
          },
        }),
      ]);

      await expect(runHook("content:afterCreate", afterCreateData())).resolves.toBeUndefined();

      expect(errors).toContainEqual({
        message: "Plugin lifecycle hook returned an invalid result",
        context: {
          pluginId: "returns-a-value",
          hook: "content:afterCreate",
        },
      });
    });

    it("shallow-freezes canonical payload metadata between handlers", async () => {
      const observedCollections: unknown[] = [];
      await loadPlugins([
        resolvedPlugin("mutates-metadata", {
          capabilities: ["hooks:content"],
          hooks: {
            "content:afterCreate": ({ data }) => {
              data.collection = "changed";
            },
          },
        }),
        resolvedPlugin("observes-metadata", {
          capabilities: ["hooks:content"],
          hooks: {
            "content:afterCreate": ({ data }) => {
              observedCollections.push(data.collection);
            },
          },
        }),
      ]);

      await expect(
        runHook("content:afterCreate", afterCreateData("posts")),
      ).resolves.toBeUndefined();

      expect(observedCollections).toEqual(["posts"]);
      expect(errors.some((entry) => entry.context?.pluginId === "mutates-metadata")).toBe(true);
    });
  });

  describe("loadPlugins — load-time error isolation", () => {
    let errors: Array<{ message: string; context?: Record<string, unknown> }>;

    beforeEach(() => {
      errors = [];
      setLogger({
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (message, context) => {
          errors.push({ message, context });
        },
      });
    });

    afterEach(() => {
      resetLogger();
    });

    it("isolates a throwing legacy init() — other plugins still load", async () => {
      const otherInit = vi.fn();
      await loadPlugins([
        legacyPlugin("first-throws", () => {
          throw new Error("init blew up");
        }),
        legacyPlugin("second-runs", otherInit),
      ]);

      // Throwing plugin gets its registration scrubbed; surviving
      // plugin is fully loaded.
      const ids = getAllPluginIds();
      expect(ids).not.toContain("first-throws");
      expect(ids).toContain("second-runs");
      expect(otherInit).toHaveBeenCalledOnce();

      expect(errors.some((e) => e.message.includes("Plugin failed to load"))).toBe(true);
      expect(errors[0]?.context?.pluginId).toBe("first-throws");
    });

    it("isolates a throwing setup() in a resolved plugin", async () => {
      const setup = vi.fn(() => {
        throw new Error("setup config required");
      });
      await loadPlugins([
        {
          ...resolvedPlugin("setup-throws", { capabilities: ["hooks:content"] }),
          setup,
        },
        resolvedPlugin("survives", {
          capabilities: ["hooks:content"],
          hooks: { "content:afterCreate": () => undefined },
        }),
      ]);

      const ids = getAllPluginIds();
      expect(ids).not.toContain("setup-throws");
      expect(ids).toContain("survives");

      // Hooks from the failed plugin should NOT remain in the
      // registry — `setup-throws` was scrubbed.
      expect(getPluginRegistration("setup-throws")).toBeUndefined();
      expect(setup).toHaveBeenCalledOnce();
    });

    it("rejects non-void setup results and scrubs every partial contribution", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("setup-result"),
          templates: {
            pages: { demo: { label: "Demo", component: () => null } },
          },
          i18n: { en: { "setup-result.label": "Demo" } },
          setup: () => "unexpected",
        },
      ]);

      expect(getPluginRegistration("setup-result")).toBeUndefined();
      expect(getRegisteredPluginTemplates()).toEqual([]);
      expect(getRegisteredPluginStrings()).toEqual([]);
    });

    it("runs teardown in reverse load order", async () => {
      const calls: string[] = [];
      await loadPlugins([
        {
          ...resolvedPlugin("first"),
          teardown: () => {
            calls.push("first");
          },
        },
        {
          ...resolvedPlugin("second"),
          teardown: () => {
            calls.push("second");
          },
        },
      ]);

      await teardownPlugins();
      expect(calls).toEqual(["second", "first"]);
    });

    it("logs the error message + plugin id for each failed plugin", async () => {
      await loadPlugins([
        legacyPlugin("a-fails", () => {
          throw new Error("a-reason");
        }),
        legacyPlugin("b-fails", () => {
          throw new Error("b-reason");
        }),
      ]);

      const failureLogs = errors.filter((e) => e.message.includes("Plugin failed to load"));
      expect(failureLogs).toHaveLength(2);
      expect(failureLogs.map((e) => e.context?.pluginId).sort()).toEqual(["a-fails", "b-fails"]);
      expect(failureLogs.find((e) => e.context?.pluginId === "a-fails")?.context?.error).toBe(
        "a-reason",
      );
    });
  });

  describe("loadPlugins — compatibility & ordering", () => {
    let warnings: Array<{ message: string; context?: Record<string, unknown> }>;

    beforeEach(() => {
      warnings = [];
      const captureLogger: NpLogger = {
        debug: () => undefined,
        info: () => undefined,
        warn: (message, context) => {
          warnings.push({ message, context });
        },
        error: () => undefined,
      };
      setLogger(captureLogger);
    });

    afterEach(() => {
      resetLogger();
      resetFrameworkVersion();
    });

    it("skips a plugin whose nexpress.minVersion is above the host", async () => {
      setFrameworkVersionForTest("0.1.0");

      await loadPlugins([
        {
          manifest: {
            id: "future",
            name: "Future Plugin",
            version: "1.0.0",
            capabilities: [],
            nexpress: { minVersion: "9.0.0" },
          },
        },
      ]);

      expect(getAllPluginIds()).toEqual([]);
      expect(warnings.find((w) => w.context?.pluginId === "future")?.message).toMatch(
        /incompatible/,
      );
    });

    it("loads a plugin whose nexpress range covers the host", async () => {
      setFrameworkVersionForTest("0.5.0");

      await loadPlugins([
        {
          manifest: {
            id: "fits",
            name: "Fits Plugin",
            version: "1.0.0",
            capabilities: [],
            nexpress: { minVersion: "0.1.0", maxVersion: "1.0.0" },
          },
        },
      ]);

      expect(getAllPluginIds()).toEqual(["fits"]);
    });

    it("orders plugins so requires are loaded before dependents", async () => {
      const order: string[] = [];
      const make = (id: string, requires: readonly string[] = []) => ({
        manifest: {
          id,
          name: `${id}-plugin`,
          version: "1.0.0",
          capabilities: ["hooks:content"],
          requires,
        },
        hooks: {
          "content:afterCreate": () => {
            order.push(id);
          },
        },
      });

      await loadPlugins([make("ui", ["theme"]), make("theme")]);

      await runHook("content:afterCreate", afterCreateData("posts"));
      expect(order).toEqual(["theme", "ui"]);
    });

    it("skips a plugin with a missing dependency", async () => {
      await loadPlugins([
        {
          manifest: {
            id: "lonely",
            name: "Lonely",
            version: "1.0.0",
            capabilities: [],
            requires: ["ghost"],
          },
        },
      ]);

      expect(getAllPluginIds()).toEqual([]);
      expect(warnings.find((w) => w.context?.pluginId === "lonely")?.message).toMatch(
        /unsatisfied dependency/,
      );
    });

    it("loads a resolved plugin whose legacy dependency loaded first", async () => {
      await loadPlugins([
        legacyPlugin("legacy-base"),
        {
          manifest: {
            id: "modern-dependent",
            name: "Modern dependent",
            version: "1.0.0",
            capabilities: [],
            requires: ["legacy-base"],
          },
        },
      ]);

      expect(getAllPluginIds()).toEqual(["legacy-base", "modern-dependent"]);
    });

    it("skips a resolved plugin when its legacy dependency fails to load", async () => {
      await loadPlugins([
        legacyPlugin("broken-legacy", () => {
          throw new Error("legacy setup failed");
        }),
        {
          manifest: {
            id: "legacy-dependent",
            name: "Legacy dependent",
            version: "1.0.0",
            capabilities: [],
            requires: ["broken-legacy"],
          },
        },
      ]);

      expect(getAllPluginIds()).toEqual([]);
      expect(
        warnings.find((warning) => warning.context?.pluginId === "legacy-dependent")?.message,
      ).toMatch(/unsatisfied dependency/);
    });

    it("skips dependents when a resolved prerequisite fails setup", async () => {
      await loadPlugins([
        {
          manifest: {
            id: "broken-base",
            name: "Broken base",
            version: "1.0.0",
            capabilities: [],
          },
          setup: () => {
            throw new Error("setup failed");
          },
        },
        {
          manifest: {
            id: "modern-child",
            name: "Modern child",
            version: "1.0.0",
            capabilities: [],
            requires: ["broken-base"],
          },
        },
      ]);

      expect(getAllPluginIds()).toEqual([]);
      expect(
        warnings.find((warning) => warning.context?.pluginId === "modern-child")?.context,
      ).toEqual(expect.objectContaining({ reason: expect.stringMatching(/failed to load/) }));
    });
  });

  describe("hook priority + timeout", () => {
    it("runs handlers in priority asc order, ties keep registration order", async () => {
      const order: string[] = [];

      await loadPlugins([
        {
          manifest: {
            id: "first-registered",
            name: "First",
            version: "1.0.0",
            capabilities: ["hooks:content"],
          },
          hooks: {
            "content:afterCreate": {
              priority: 50,
              handler: () => {
                order.push("first");
              },
            },
          },
        },
        {
          manifest: {
            id: "high-priority",
            name: "High",
            version: "1.0.0",
            capabilities: ["hooks:content"],
          },
          hooks: {
            "content:afterCreate": {
              priority: 10,
              handler: () => {
                order.push("high");
              },
            },
          },
        },
        {
          manifest: {
            id: "tied-with-first",
            name: "Tied",
            version: "1.0.0",
            capabilities: ["hooks:content"],
          },
          hooks: {
            "content:afterCreate": {
              priority: 50,
              handler: () => {
                order.push("tied");
              },
            },
          },
        },
      ]);

      await runHook("content:afterCreate", afterCreateData());
      // priority 10 runs before priority 50; the two priority-50 plugins
      // keep their registration order (first registered, then tied).
      expect(order).toEqual(["high", "first", "tied"]);
    });

    it("default priority 100 places plain-function handlers after explicit priorities below 100", async () => {
      const order: string[] = [];

      await loadPlugins([
        {
          manifest: {
            id: "plain",
            name: "Plain",
            version: "1.0.0",
            capabilities: ["hooks:content"],
          },
          hooks: {
            "content:afterCreate": () => {
              order.push("plain");
            },
          },
        },
        {
          manifest: {
            id: "explicit",
            name: "Explicit",
            version: "1.0.0",
            capabilities: ["hooks:content"],
          },
          hooks: {
            "content:afterCreate": {
              priority: 5,
              handler: () => {
                order.push("explicit");
              },
            },
          },
        },
      ]);

      await runHook("content:afterCreate", afterCreateData());
      expect(order).toEqual(["explicit", "plain"]);
    });

    it("treats a handler that exceeds timeoutMs as a failure and isolates it", async () => {
      const errors: Array<{ message: string; context?: Record<string, unknown> }> = [];
      setLogger({
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (message, context) => {
          errors.push({ message, context });
        },
      });

      try {
        const fast = vi.fn();
        await loadPlugins([
          {
            manifest: {
              id: "slow",
              name: "Slow",
              version: "1.0.0",
              capabilities: ["hooks:content"],
            },
            hooks: {
              "content:afterCreate": {
                priority: 10,
                timeoutMs: 20,
                handler: () => new Promise(() => undefined), // never resolves
              },
            },
          },
          {
            manifest: {
              id: "fast",
              name: "Fast",
              version: "1.0.0",
              capabilities: ["hooks:content"],
            },
            hooks: { "content:afterCreate": fast },
          },
        ]);

        await runHook("content:afterCreate", afterCreateData());

        // Slow plugin's hang must not block the dispatch chain — fast still runs.
        expect(fast).toHaveBeenCalledOnce();
        const slowError = errors.find((e) => e.context?.pluginId === "slow");
        expect(slowError).toBeDefined();
        expect(slowError?.context?.timeoutMs).toBe(20);
      } finally {
        resetLogger();
      }
    });
  });

  describe("loadResolvedPlugin re-registration", () => {
    it("scrubs old hooks + routes when the same id is re-loaded", async () => {
      // The documented reload path (`reloadPlugins()`) always calls
      // `resetPlugins()` first, but a stray double-load — e.g. a custom
      // bootstrap that re-runs a subset of plugins — would otherwise leave
      // both registrations dispatching. Defense in depth: the host strips
      // the previous entry's handlers from the global maps before
      // overwriting.
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();

      await loadPlugins([
        {
          manifest: {
            id: "double",
            name: "Double",
            version: "1.0.0",
            capabilities: ["hooks:content"],
          },
          hooks: { "content:afterCreate": firstHandler },
        },
      ]);

      // Re-register with the same id, different handler. Without dedupe
      // both handlers would be in `globalHooks` after this.
      await loadPlugins([
        {
          manifest: {
            id: "double",
            name: "Double",
            version: "1.0.0",
            capabilities: ["hooks:content"],
          },
          hooks: { "content:afterCreate": secondHandler },
        },
      ]);

      await runHook("content:afterCreate", afterCreateData("posts"));
      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).toHaveBeenCalledOnce();
      // Only one route registered, not two.
      expect(getPluginRoutes().filter((r) => r.pluginId === "double")).toHaveLength(0);
    });

    it("tears down the previous instance before replacing it", async () => {
      const teardown = vi.fn();
      await loadPlugins([{ ...resolvedPlugin("replace"), teardown }]);
      await loadPlugins([resolvedPlugin("replace")]);
      expect(teardown).toHaveBeenCalledOnce();
    });
  });

  describe("enabled gate", () => {
    it("skips hook handlers belonging to a disabled plugin", async () => {
      const enabledHandler = vi.fn();
      const disabledHandler = vi.fn();

      await loadPlugins([
        resolvedPlugin("on", {
          capabilities: ["hooks:content"],
          hooks: { "content:afterCreate": enabledHandler },
        }),
        resolvedPlugin("off", {
          capabilities: ["hooks:content"],
          hooks: { "content:afterCreate": disabledHandler },
        }),
      ]);

      setPluginEnabledForTest("on", true);
      setPluginEnabledForTest("off", false);

      await runHook("content:afterCreate", afterCreateData("posts"));

      expect(enabledHandler).toHaveBeenCalledOnce();
      expect(disabledHandler).not.toHaveBeenCalled();
    });

    it("excludes disabled plugins from runHookAndCollect results", async () => {
      await loadPlugins([
        resolvedPlugin("on", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => ({ head: [{ tag: "meta", attrs: { name: "on" } }] }),
          },
        }),
        resolvedPlugin("off", {
          capabilities: ["hooks:render"],
          hooks: {
            "render:beforePage": () => ({ head: [{ tag: "meta", attrs: { name: "off" } }] }),
          },
        }),
      ]);

      setPluginEnabledForTest("on", true);
      setPluginEnabledForTest("off", false);

      const results = await runHookAndCollect<{ head: Array<{ attrs: { name: string } }> }>(
        "render:beforePage",
        renderData(),
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.head[0]?.attrs.name).toBe("on");
    });
  });

  // ── PRT.1 plugin page routes ──────────────────────────────────

  describe("getPluginPageRoutes (#623)", () => {
    const Component = () => null;

    it("returns an empty array when no plugins declare pageRoutes", async () => {
      await loadPlugins([resolvedPlugin("no-routes", { capabilities: ["hooks:content"] })]);
      expect(getPluginPageRoutes()).toEqual([]);
    });

    it("registers pageRoutes from a resolved plugin", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: ["site:route"] }),
          pageRoutes: [
            { pattern: "/discussions", component: Component },
            { pattern: "/discussions/:slug", component: Component },
          ],
        },
      ]);
      const routes = getPluginPageRoutes();
      expect(routes).toHaveLength(2);
      expect(routes[0].pluginId).toBe("forum");
      expect(routes[0].route.pattern).toBe("/discussions");
      // Defaults applied: surface "site", locale "auto".
      expect(routes[0].route.surface).toBe("site");
      expect(routes[0].route.locale).toBe("auto");
    });

    it("preserves explicit surface=member and locale=none", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: ["site:route"] }),
          pageRoutes: [
            {
              pattern: "/discussions/new",
              component: Component,
              surface: "member",
              locale: "none",
            },
          ],
        },
      ]);
      const [{ route }] = getPluginPageRoutes();
      expect(route.surface).toBe("member");
      expect(route.locale).toBe("none");
    });

    it("rejects malformed and duplicate page route definitions", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("bad-pattern", { capabilities: ["site:route"] }),
          pageRoutes: [{ pattern: "/events/:year([)", component: Component }],
        },
        {
          ...resolvedPlugin("bad-component", { capabilities: ["site:route"] }),
          pageRoutes: [{ pattern: "/events", component: { $$typeof: Symbol("memo") } }],
        },
        {
          ...resolvedPlugin("duplicate-page-route", { capabilities: ["site:route"] }),
          pageRoutes: [
            { pattern: "/events", component: Component },
            { pattern: "/events", component: Component, locale: "none" },
          ],
        },
      ]);

      expect(getAllPluginIds()).not.toContain("bad-pattern");
      expect(getAllPluginIds()).not.toContain("bad-component");
      expect(getAllPluginIds()).not.toContain("duplicate-page-route");
      expect(getPluginPageRoutes()).toEqual([]);
    });

    it("requires site:route when definePlugin capability derivation was bypassed", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("missing-capability", { capabilities: [] }),
          pageRoutes: [{ pattern: "/events", component: Component }],
        },
      ]);

      expect(getAllPluginIds()).not.toContain("missing-capability");
      expect(getPluginPageRoutes()).toEqual([]);
    });

    it("flattens routes from multiple plugins in registration order", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: ["site:route"] }),
          pageRoutes: [{ pattern: "/discussions", component: Component }],
        },
        {
          ...resolvedPlugin("gallery", { capabilities: ["site:route"] }),
          pageRoutes: [{ pattern: "/gallery", component: Component }],
        },
      ]);
      const routes = getPluginPageRoutes();
      expect(routes.map((r) => r.pluginId)).toEqual(["forum", "gallery"]);
      expect(routes.map((r) => r.route.pattern)).toEqual(["/discussions", "/gallery"]);
    });

    it("legacy init-shape plugins register zero routes", async () => {
      const init = vi.fn();
      await loadPlugins([legacyPlugin("legacy", init)]);
      expect(init).toHaveBeenCalledOnce();
      expect(getPluginPageRoutes()).toEqual([]);
    });

    it("returns disabled plugin's routes too — gating is the dispatcher's job", async () => {
      // Pins the design rationale (§ getPluginPageRoutes doc):
      // gating lives at the call site so unit tests can assert
      // the registered shape without mocking the enabled
      // singleton. Disabling a plugin must NOT remove its
      // entries from this getter.
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: ["site:route"] }),
          pageRoutes: [{ pattern: "/discussions", component: Component }],
        },
      ]);
      setPluginEnabledForTest("forum", false);
      const routes = getPluginPageRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].pluginId).toBe("forum");
    });

    it("re-registering a plugin replaces its prior pageRoutes", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: ["site:route"] }),
          pageRoutes: [
            { pattern: "/v1", component: Component },
            { pattern: "/v1/old", component: Component },
          ],
        },
      ]);
      expect(getPluginPageRoutes()).toHaveLength(2);

      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: ["site:route"] }),
          pageRoutes: [{ pattern: "/v2", component: Component }],
        },
      ]);
      const after = getPluginPageRoutes();
      expect(after).toHaveLength(1);
      expect(after[0].route.pattern).toBe("/v2");
    });

    it("removes previous page routes before rejecting an invalid replacement", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: ["site:route"] }),
          pageRoutes: [{ pattern: "/ok", component: Component }],
        },
      ]);
      expect(getPluginPageRoutes()).toHaveLength(1);

      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: ["site:route"] }),
          pageRoutes: [{ pattern: "/broken/:id([)", component: Component }],
        },
      ]);

      expect(getAllPluginIds()).not.toContain("forum");
      expect(getPluginPageRoutes()).toEqual([]);
    });

    it("treats `pageRoutes: []` as a valid empty list", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: ["site:route"] }),
          pageRoutes: [],
        },
      ]);
      expect(getPluginPageRoutes()).toEqual([]);
    });
  });
});
