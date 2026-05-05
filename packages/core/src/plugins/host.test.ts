import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAllPluginIds,
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
      await expect(
        loadPlugins([
          resolvedPlugin("no-capability", {
            capabilities: [],
            hooks: {
              "content:afterCreate": () => undefined,
            },
          }),
        ]),
      ).rejects.toThrow(/hooks:content/);
    });

    it("rejects a route registration when api:route is not declared", async () => {
      await expect(
        loadPlugins([
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
        ]),
      ).rejects.toThrow(/api:route/);
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
});
