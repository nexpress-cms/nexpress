import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAllPluginIds,
  getPluginRegistration,
  getPluginRoutes,
  loadPlugins,
  resetPlugins,
  runHook,
} from "./index.js";
import type { NxPluginConfig } from "../config/types.js";

function legacyPlugin(
  id: string,
  init?: NxPluginConfig["init"],
): NxPluginConfig {
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
    }) => void | Promise<void>>;
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
});
