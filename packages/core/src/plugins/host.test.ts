import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAllPluginIds,
  getPluginPageRoutes,
  getPluginRegistration,
  getPluginRoutes,
  loadPlugins,
  resetPlugins,
  runHook,
  runHookAndCollect,
} from "./index.js";
import type { NpPluginConfig } from "../config/types.js";
import { resetLogger, setLogger, type NpLogger } from "../observability/logger.js";
import {
  resetEnabledGate,
  setPluginEnabledForTest,
} from "./enabled-gate.js";
import { resetFrameworkVersion, setFrameworkVersionForTest } from "./compat.js";

function legacyPlugin(
  id: string,
  init?: NpPluginConfig["init"],
): NpPluginConfig {
  return { id, name: `${id} plugin`, init };
}

function resolvedPlugin(
  id: string,
  options: {
    capabilities?: readonly string[];
    hooks?: Record<string, (ctx: {
      hook: string;
      data: Record<string, unknown>;
      collection?: string;
    }) => unknown>;
    routes?: Array<{ method: string; path: string; handler: () => Promise<{ status: number }> }>;
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
  };
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
      await runHook("content:afterCreate", { collection: "posts", doc: { id: "1" } });
      expect(handler).toHaveBeenCalledOnce();
    });

    it("skips a legacy hook when the event targets a different collection", async () => {
      const handler = vi.fn();
      await loadPlugins([
        legacyPlugin("legacy-c", (ctx) => {
          ctx.addHook("posts", "afterCreate", handler);
        }),
      ]);

      await runHook("content:afterCreate", { collection: "pages", doc: { id: "1" } });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("loadPlugins — resolved shape with manifest", () => {
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

      await runHook("content:afterCreate", {
        collection: "posts",
        doc: { id: "1" },
      });

      expect(hookHandler).toHaveBeenCalledOnce();
      const ctx = hookHandler.mock.calls[0]?.[0] as { hook: string; collection?: string };
      expect(ctx.hook).toBe("content:afterCreate");
      expect(ctx.collection).toBe("posts");

      const routes = getPluginRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe("POST");
      expect(routes[0]?.path).toBe("/echo");

      const reg = getPluginRegistration("full");
      expect(reg?.capabilities).toEqual(["hooks:content", "api:route"]);
    });

    it("normalizes method case when registering routes", async () => {
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

      expect(getPluginRoutes()[0]?.method).toBe("GET");
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

      await runHook("content:afterCreate", {});
      expect(calls).toEqual(["a", "b"]);
    });

    it("is a no-op for unknown hooks", async () => {
      await expect(runHook("content:neverFires", {})).resolves.toBeUndefined();
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

      const results = await runHookAndCollect<{ head: Array<{ tag: string; attrs: Record<string, string> }> }>(
        "render:beforePage",
        { collection: "posts", slug: "hello", document: {} },
      );

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

      const results = await runHookAndCollect<{ head: unknown[] }>("render:beforePage", {});
      expect(results).toHaveLength(1);
    });

    it("returns [] when no handler is registered", async () => {
      await expect(runHookAndCollect("render:neverFires", {})).resolves.toEqual([]);
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
        {},
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
      await expect(runHook("content:afterCreate", { collection: "posts" })).resolves.toBeUndefined();

      expect(after).toHaveBeenCalledOnce();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toMatch(/Plugin hook handler threw/);
      expect(errors[0]?.context?.pluginId).toBe("first-throws");
      expect(errors[0]?.context?.hook).toBe("content:afterCreate");
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
        } as never,
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

    it("logs the error message + plugin id for each failed plugin", async () => {
      await loadPlugins([
        legacyPlugin("a-fails", () => {
          throw new Error("a-reason");
        }),
        legacyPlugin("b-fails", () => {
          throw new Error("b-reason");
        }),
      ]);

      const failureLogs = errors.filter((e) =>
        e.message.includes("Plugin failed to load"),
      );
      expect(failureLogs).toHaveLength(2);
      expect(failureLogs.map((e) => e.context?.pluginId).sort()).toEqual([
        "a-fails",
        "b-fails",
      ]);
      expect(failureLogs.find((e) => e.context?.pluginId === "a-fails")?.context?.error).toBe("a-reason");
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

      await loadPlugins([
        make("ui", ["theme"]),
        make("theme"),
      ]);

      await runHook("content:afterCreate", { collection: "posts" });
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

      await runHook("content:afterCreate", {});
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

      await runHook("content:afterCreate", {});
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

        await runHook("content:afterCreate", {});

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

      await runHook("content:afterCreate", { collection: "posts" });
      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).toHaveBeenCalledOnce();
      // Only one route registered, not two.
      expect(getPluginRoutes().filter((r) => r.pluginId === "double")).toHaveLength(0);
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

      await runHook("content:afterCreate", { collection: "posts" });

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
        {},
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.head[0]?.attrs.name).toBe("on");
    });
  });

  // ── PRT.1 plugin page routes ──────────────────────────────────

  describe("getPluginPageRoutes (#623)", () => {
    const Component = () => null;

    it("returns an empty array when no plugins declare pageRoutes", async () => {
      await loadPlugins([
        resolvedPlugin("no-routes", { capabilities: ["hooks:content"] }),
      ]);
      expect(getPluginPageRoutes()).toEqual([]);
    });

    it("registers pageRoutes from a resolved plugin", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: [] }),
          pageRoutes: [
            { pattern: "/discussions", component: Component },
            { pattern: "/discussions/:slug", component: Component },
          ],
        } as never,
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
          ...resolvedPlugin("forum", { capabilities: [] }),
          pageRoutes: [
            {
              pattern: "/discussions/new",
              component: Component,
              surface: "member",
              locale: "none",
            },
          ],
        } as never,
      ]);
      const [{ route }] = getPluginPageRoutes();
      expect(route.surface).toBe("member");
      expect(route.locale).toBe("none");
    });

    it("drops malformed entries silently — missing pattern, missing component, wrong shape", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: [] }),
          pageRoutes: [
            { pattern: "/ok", component: Component },           // valid
            { pattern: "", component: Component },              // empty pattern
            { component: Component },                           // no pattern
            { pattern: "/no-component" },                       // no component
            null,                                                // not an object
            "string-not-object",                                 // wrong shape
          ],
        } as never,
      ]);
      const routes = getPluginPageRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].route.pattern).toBe("/ok");
    });

    it("flattens routes from multiple plugins in registration order", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: [] }),
          pageRoutes: [{ pattern: "/discussions", component: Component }],
        } as never,
        {
          ...resolvedPlugin("gallery", { capabilities: [] }),
          pageRoutes: [{ pattern: "/gallery", component: Component }],
        } as never,
      ]);
      const routes = getPluginPageRoutes();
      expect(routes.map((r) => r.pluginId)).toEqual(["forum", "gallery"]);
      expect(routes.map((r) => r.route.pattern)).toEqual([
        "/discussions",
        "/gallery",
      ]);
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
          ...resolvedPlugin("forum", { capabilities: [] }),
          pageRoutes: [{ pattern: "/discussions", component: Component }],
        } as never,
      ]);
      setPluginEnabledForTest("forum", false);
      const routes = getPluginPageRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].pluginId).toBe("forum");
    });

    it("re-registering a plugin replaces its prior pageRoutes", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: [] }),
          pageRoutes: [
            { pattern: "/v1", component: Component },
            { pattern: "/v1/old", component: Component },
          ],
        } as never,
      ]);
      expect(getPluginPageRoutes()).toHaveLength(2);

      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: [] }),
          pageRoutes: [{ pattern: "/v2", component: Component }],
        } as never,
      ]);
      const after = getPluginPageRoutes();
      expect(after).toHaveLength(1);
      expect(after[0].route.pattern).toBe("/v2");
    });

    it("rejects primitive non-component values; accepts memo/forwardRef-shaped objects", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: [] }),
          pageRoutes: [
            { pattern: "/ok", component: Component },
            { pattern: "/string", component: "not-a-component" },
            { pattern: "/number", component: 42 },
            { pattern: "/bool", component: true },
            { pattern: "/null-component", component: null },
            // memo / forwardRef return objects with `$$typeof`.
            { pattern: "/memo-shaped", component: { $$typeof: Symbol("memo") } },
          ],
        } as never,
      ]);
      const patterns = getPluginPageRoutes().map((r) => r.route.pattern).sort();
      expect(patterns).toEqual(["/memo-shaped", "/ok"]);
    });

    it("treats `pageRoutes: []` as a valid empty list", async () => {
      await loadPlugins([
        {
          ...resolvedPlugin("forum", { capabilities: [] }),
          pageRoutes: [],
        } as never,
      ]);
      expect(getPluginPageRoutes()).toEqual([]);
    });
  });
});
