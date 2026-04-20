import type { NxPluginConfig, NxPluginContext } from "../config/types.js";

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

interface PluginRegistration {
  id: string;
  name: string;
  hooks: Map<string, PluginHookHandler[]>;
  routes: PluginRouteHandler[];
  actions: Map<string, (data: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>>;
}

const pluginRegistry = new Map<string, PluginRegistration>();
const globalHooks = new Map<string, PluginHookHandler[]>();
const globalRoutes: PluginRouteHandler[] = [];

function createPluginContext(pluginId: string, registration: PluginRegistration): NxPluginContext {
  return {
    addCollection: () => {
      throw new Error(`[plugin:${pluginId}] Runtime collection registration not supported in v1. Add collections to nexpress.config.ts.`);
    },
    addBlock: () => {
      throw new Error(`[plugin:${pluginId}] Runtime block registration not supported in v1. Add blocks to nexpress.config.ts.`);
    },
    addHook: (collection: string, event: string, hook) => {
      const hookName = `${collection}:${event}`;
      const handler: PluginHookHandler = {
        pluginId,
        handler: async (data) => { await hook({ data, collection } as never); },
      };
      if (!registration.hooks.has(hookName)) {
        registration.hooks.set(hookName, []);
      }
      registration.hooks.get(hookName)!.push(handler);

      if (!globalHooks.has(hookName)) {
        globalHooks.set(hookName, []);
      }
      globalHooks.get(hookName)!.push(handler);
    },
  };
}

export async function loadPlugins(plugins: NxPluginConfig[]): Promise<void> {
  for (const plugin of plugins) {
    const registration: PluginRegistration = {
      id: plugin.id,
      name: plugin.name,
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
