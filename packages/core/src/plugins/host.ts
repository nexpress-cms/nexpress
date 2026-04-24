import { eq } from "drizzle-orm";

import type { NxPluginConfig, NxPluginContext } from "../config/types.js";
import { nxPlugins } from "../db/schema/system.js";
import { getDb } from "../collections/pipeline.js";
import { createPluginRuntimeContext } from "./context.js";

export interface PluginHookHandler {
  pluginId: string;
  handler: (data: Record<string, unknown>) => void | Promise<void>;
}

export interface PluginRouteHandler {
  pluginId: string;
  path: string;
  method: string;
  handler: (req: PluginRouteRequest) => Promise<PluginRouteResponse>;
}

export interface PluginRouteRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  user?: { id: string; email: string; role: string };
}

export interface PluginRouteResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface PluginCapabilityRequirement {
  requirement: string;
  declared: readonly string[];
}

interface PluginRegistration {
  id: string;
  name: string;
  version?: string;
  description?: string;
  capabilities: readonly string[];
  allowedHosts: readonly string[];
  hooks: Map<string, PluginHookHandler[]>;
  routes: PluginRouteHandler[];
  actions: Map<string, (data: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>>;
}

/**
 * Hook names start with a namespace — "content:afterCreate",
 * "auth:afterLogin", "render:beforePage", etc. The plugin must declare the
 * matching "hooks:<namespace>" capability to register a handler. This is the
 * v1 runtime enforcement: coarse, easy to reason about, and deliberately
 * additive — plugins without any capabilities can still do nothing.
 */
function hookCapabilityFor(hookName: string): string | null {
  const namespace = hookName.split(":")[0];
  if (!namespace) return null;
  return `hooks:${namespace}`;
}

function assertCapability(
  pluginId: string,
  requirement: string,
  declared: readonly string[],
): void {
  if (declared.includes(requirement)) return;

  throw new Error(
    `[plugin:${pluginId}] declares capabilities ${JSON.stringify(declared)} ` +
      `but is registering something that requires "${requirement}". ` +
      `Add "${requirement}" to the plugin manifest's capabilities array.`,
  );
}

const pluginRegistry = new Map<string, PluginRegistration>();
const globalHooks = new Map<string, PluginHookHandler[]>();
const globalRoutes: PluginRouteHandler[] = [];

/**
 * Structural shape for plugins built via `@nexpress/plugin-sdk`'s
 * `definePlugin()`. Matches `NxResolvedPluginLike` in config/types.ts —
 * kept deliberately loose so `loadPlugins` can accept the same array
 * that `NxConfig.plugins` does without narrowing gymnastics.
 */
export interface ResolvedPluginLike {
  manifest: {
    id: string;
    name: string;
    version?: string;
    description?: string;
    capabilities: readonly string[];
    allowedHosts?: readonly string[];
  };
  hooks?: Record<string, unknown>;
  routes?: ReadonlyArray<{
    path: string;
    method: string;
    handler: unknown;
    description?: string;
    auth?: boolean;
  }>;
}

type ResolvedHookFn = (ctx: {
  hook: string;
  data: Record<string, unknown>;
  collection?: string;
  ctx: Record<string, unknown>;
}) => void | Promise<void>;

type ResolvedRouteFn = (
  req: PluginRouteRequest,
  ctx: Record<string, unknown>,
) => Promise<PluginRouteResponse>;

async function loadPluginConfig(pluginId: string): Promise<Record<string, unknown>> {
  try {
    const db = getDb();
    const rows = await db
      .select({ config: nxPlugins.config })
      .from(nxPlugins)
      .where(eq(nxPlugins.id, pluginId))
      .limit(1);
    const row = rows[0] as { config?: unknown } | undefined;
    if (row && row.config && typeof row.config === "object" && !Array.isArray(row.config)) {
      return row.config as Record<string, unknown>;
    }
  } catch {
    // DB not ready or row missing — fall through to empty config.
  }
  return {};
}

async function buildCtxFor(pluginId: string): Promise<Record<string, unknown>> {
  const registration = pluginRegistry.get(pluginId);
  if (!registration) {
    throw new Error(`[plugin:${pluginId}] attempted to build ctx before registration.`);
  }
  const config = await loadPluginConfig(pluginId);
  return createPluginRuntimeContext({
    pluginId,
    capabilities: registration.capabilities,
    allowedHosts: registration.allowedHosts,
    config,
    registration,
    lookupRegistration: (id) => pluginRegistry.get(id),
  });
}

function isResolvedPlugin(value: unknown): value is ResolvedPluginLike {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { manifest?: unknown };
  if (!candidate.manifest || typeof candidate.manifest !== "object") return false;
  const manifest = candidate.manifest as { id?: unknown; capabilities?: unknown };
  return typeof manifest.id === "string" && Array.isArray(manifest.capabilities);
}

function registerHookHandler(
  registration: PluginRegistration,
  hookName: string,
  handler: PluginHookHandler,
): void {
  if (!registration.hooks.has(hookName)) {
    registration.hooks.set(hookName, []);
  }
  registration.hooks.get(hookName)!.push(handler);

  if (!globalHooks.has(hookName)) {
    globalHooks.set(hookName, []);
  }
  globalHooks.get(hookName)!.push(handler);
}

function createPluginContext(pluginId: string, registration: PluginRegistration): NxPluginContext {
  return {
    addCollection: () => {
      throw new Error(`[plugin:${pluginId}] Runtime collection registration not supported in v1. Add collections to nexpress.config.ts.`);
    },
    addBlock: () => {
      throw new Error(`[plugin:${pluginId}] Runtime block registration not supported in v1. Add blocks to nexpress.config.ts.`);
    },
    addHook: (collection: string, event: string, hook) => {
      // Legacy API: collection is the docs' collection ("posts"), event is the
      // lifecycle step ("afterCreate"). The pipeline emits canonical hook names
      // under the "content:" namespace (e.g. `content:afterCreate`), so
      // register there and filter by collection at dispatch time. This keeps
      // legacy hooks firing on the same stream as resolved-plugin hooks.
      const hookName = `content:${event}`;
      const requirement = hookCapabilityFor(hookName);
      if (requirement) {
        assertCapability(pluginId, requirement, registration.capabilities);
      }

      registerHookHandler(registration, hookName, {
        pluginId,
        handler: async (data) => {
          if (typeof data.collection === "string" && data.collection !== collection) {
            return;
          }
          await hook({ data, collection } as never);
        },
      });
    },
  };
}

async function loadResolvedPlugin(plugin: ResolvedPluginLike): Promise<void> {
  const { manifest } = plugin;
  const registration: PluginRegistration = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    capabilities: [...manifest.capabilities],
    allowedHosts: [...(manifest.allowedHosts ?? [])],
    hooks: new Map(),
    routes: [],
    actions: new Map(),
  };

  pluginRegistry.set(manifest.id, registration);

  for (const [hookName, rawHandler] of Object.entries(plugin.hooks ?? {})) {
    if (typeof rawHandler !== "function") continue;

    const requirement = hookCapabilityFor(hookName);
    if (requirement) {
      assertCapability(manifest.id, requirement, registration.capabilities);
    }

    const handler = rawHandler as ResolvedHookFn;
    registerHookHandler(registration, hookName, {
      pluginId: manifest.id,
      handler: async (data) => {
        const collection = typeof data.collection === "string" ? data.collection : undefined;
        const ctx = await buildCtxFor(manifest.id);
        await handler({ hook: hookName, data, collection, ctx });
      },
    });
  }

  for (const route of plugin.routes ?? []) {
    if (typeof route.handler !== "function") continue;

    assertCapability(manifest.id, "api:route", registration.capabilities);

    const userHandler = route.handler as ResolvedRouteFn;
    const wrapped: (req: PluginRouteRequest) => Promise<PluginRouteResponse> = async (req) => {
      const ctx = await buildCtxFor(manifest.id);
      return userHandler(req, ctx);
    };

    const entry: PluginRouteHandler = {
      pluginId: manifest.id,
      path: route.path,
      method: route.method.toUpperCase(),
      handler: wrapped,
    };
    registration.routes.push(entry);
    globalRoutes.push(entry);
  }

  // Invoke optional setup() after hooks + routes are registered so setup can
  // call ctx.actions.register(…) and have it visible to subsequent dispatches.
  const setup = (plugin as { setup?: (ctx: Record<string, unknown>) => void | Promise<void> }).setup;
  if (typeof setup === "function") {
    const ctx = await buildCtxFor(manifest.id);
    await setup(ctx);
  }
}

async function loadLegacyPlugin(plugin: NxPluginConfig): Promise<void> {
  const registration: PluginRegistration = {
    id: plugin.id,
    name: plugin.name,
    capabilities: ["hooks:content"],
    allowedHosts: [],
    hooks: new Map(),
    routes: [],
    actions: new Map(),
  };

  pluginRegistry.set(plugin.id, registration);

  if (plugin.init) {
    const ctx = createPluginContext(plugin.id, registration);
    await plugin.init(ctx);
  }
}

export async function loadPlugins(
  plugins: Array<NxPluginConfig | ResolvedPluginLike>,
): Promise<void> {
  for (const plugin of plugins) {
    if (isResolvedPlugin(plugin)) {
      await loadResolvedPlugin(plugin);
    } else {
      await loadLegacyPlugin(plugin);
    }
  }
}

export async function runHook(hookName: string, data: Record<string, unknown>): Promise<void> {
  const handlers = globalHooks.get(hookName);
  if (!handlers || handlers.length === 0) return;

  for (const handler of handlers) {
    await handler.handler(data);
  }
}

export function getPluginRoutes(): PluginRouteHandler[] {
  return globalRoutes;
}

export function getPluginRegistration(pluginId: string): PluginRegistration | undefined {
  return pluginRegistry.get(pluginId);
}

export function getAllPluginIds(): string[] {
  return [...pluginRegistry.keys()];
}

export async function schedulePluginTask(pluginId: string, taskId: string): Promise<void> {
  const { enqueueJob } = await import("../jobs/queue.js");
  await enqueueJob("plugin:scheduledTask", { pluginId, taskId });
}

export function resetPlugins(): void {
  pluginRegistry.clear();
  globalHooks.clear();
  globalRoutes.length = 0;
}
