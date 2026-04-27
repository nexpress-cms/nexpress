import { eq } from "drizzle-orm";

import type { NxFieldConfig, NxPluginConfig, NxPluginContext } from "../config/types.js";
import { nxPlugins } from "../db/schema/system.js";
import { getDb } from "../collections/pipeline.js";
import { createPluginRuntimeContext } from "./context.js";

export interface PluginHookHandler {
  pluginId: string;
  /**
   * Returns `void` for fire-and-forget hooks (most of them). Render / extension
   * hooks may return a value; `runHookAndCollect` gathers those, while
   * `runHook` ignores returns.
   */
  handler: (data: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface PluginRouteHandler {
  pluginId: string;
  path: string;
  method: string;
  /** When true, the dispatcher must verify a staff session before
   *  invoking `handler` and pass the resolved user as `req.user`.
   *  When false (default), the route is publicly reachable. */
  auth: boolean;
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

/**
 * Declarative admin extension snapshot stored per registration. Shape mirrors
 * `@nexpress/plugin-sdk`'s `NxAdminExtension` but kept structural here to
 * avoid a plugin-sdk → core cycle. The admin UI reads this via
 * `getPluginAdminExtension(id)` and renders it with its own primitives.
 */
export interface PluginAdminExtension {
  settings?: {
    title?: string;
    description?: string;
    fields: NxFieldConfig[];
  };
  widgets?: Array<{
    id: string;
    label: string;
    kind: "metric" | "status";
    actionId: string;
    description?: string;
  }>;
  actions?: Array<{
    id: string;
    label: string;
    actionId: string;
    confirm?: string;
    description?: string;
  }>;
  tables?: Array<{
    id: string;
    label: string;
    columns: Array<{ name: string; label: string }>;
    rowsActionId: string;
    emptyMessage?: string;
  }>;
  collectionTabs?: Array<{
    id: string;
    label: string;
    collections: string[] | "*";
    widgets?: Array<{
      id: string;
      label: string;
      kind: "metric" | "status";
      actionId: string;
      description?: string;
    }>;
    actions?: Array<{
      id: string;
      label: string;
      actionId: string;
      confirm?: string;
      description?: string;
    }>;
    description?: string;
  }>;
  dashboardWidgets?: Array<{
    id: string;
    label: string;
    kind: "metric" | "status";
    actionId: string;
    description?: string;
    priority?: number;
  }>;
}

interface PluginRegistration {
  id: string;
  name: string;
  version?: string;
  description?: string;
  capabilities: readonly string[];
  allowedHosts: readonly string[];
  admin?: PluginAdminExtension;
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
  admin?: PluginAdminExtension;
}

type ResolvedHookFn = (ctx: {
  hook: string;
  data: Record<string, unknown>;
  collection?: string;
  ctx: Record<string, unknown>;
}) => unknown | Promise<unknown>;

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
    admin: plugin.admin,
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
        return await handler({ hook: hookName, data, collection, ctx });
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
      auth: route.auth === true,
      handler: wrapped,
    };
    registration.routes.push(entry);
    globalRoutes.push(entry);
  }

  // Phase 12.5 — merge any UI-string bundles the plugin
  // ships into the global registry. Bundles are scoped per
  // locale; later plugins overwrite earlier ones on key
  // collision so plugin-order in the config drives override
  // priority. Plugin authors typically namespace their keys
  // (e.g. `forum.replyButton`) to avoid collisions across
  // unrelated plugins.
  const i18nBundles = (plugin as { i18n?: Record<string, Record<string, string>> })
    .i18n;
  if (i18nBundles && typeof i18nBundles === "object") {
    const { addStrings } = await import("../i18n/strings.js");
    for (const [locale, bundle] of Object.entries(i18nBundles)) {
      if (bundle && typeof bundle === "object") {
        addStrings(locale, bundle);
      }
    }
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

/**
 * Like `runHook`, but collects every non-null/undefined return value from
 * registered handlers. Used by render extension points (`render:beforePage`,
 * etc.) where each plugin contributes structured data — head tags, scripts —
 * that the renderer aggregates into a single output.
 *
 * Handlers that throw propagate the error: a broken plugin taking down the
 * page is preferable to a silent miss for SEO/analytics output. Catch at the
 * call site if a specific hook should be tolerant.
 */
export async function runHookAndCollect<T>(
  hookName: string,
  data: Record<string, unknown>,
): Promise<T[]> {
  const handlers = globalHooks.get(hookName);
  if (!handlers || handlers.length === 0) return [];

  const results: T[] = [];
  for (const handler of handlers) {
    const value = await handler.handler(data);
    if (value !== undefined && value !== null) {
      results.push(value as T);
    }
  }
  return results;
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

export function getPluginAdminExtension(pluginId: string): PluginAdminExtension | undefined {
  return pluginRegistry.get(pluginId)?.admin;
}

/**
 * Resolved collection-tab descriptor for the admin collection edit view.
 * Each entry carries pluginId + pluginName so the client component can
 * dispatch actions and label cards per-plugin.
 */
export interface ResolvedCollectionTab {
  pluginId: string;
  pluginName: string;
  id: string;
  label: string;
  widgets?: NonNullable<PluginAdminExtension["collectionTabs"]>[number]["widgets"];
  actions?: NonNullable<PluginAdminExtension["collectionTabs"]>[number]["actions"];
  description?: string;
}

/**
 * Collects all `collectionTabs` entries declared by loaded plugins whose
 * `collections` filter matches the given slug (either `"*"` or includes it).
 * The returned array is already flattened and annotated with the source
 * plugin, ready to pass into the admin edit view.
 */
export function getCollectionTabsForSlug(collectionSlug: string): ResolvedCollectionTab[] {
  const result: ResolvedCollectionTab[] = [];
  for (const registration of pluginRegistry.values()) {
    const tabs = registration.admin?.collectionTabs;
    if (!tabs || tabs.length === 0) continue;
    for (const tab of tabs) {
      const matches =
        tab.collections === "*" ||
        (Array.isArray(tab.collections) && tab.collections.includes(collectionSlug));
      if (!matches) continue;
      result.push({
        pluginId: registration.id,
        pluginName: registration.name,
        id: tab.id,
        label: tab.label,
        widgets: tab.widgets,
        actions: tab.actions,
        description: tab.description,
      });
    }
  }
  return result;
}

/**
 * Dashboard widget descriptor annotated with its source plugin. The admin
 * dashboard dispatches the widget's action with an empty payload — dashboard
 * widgets are global, not per-document.
 */
export interface ResolvedDashboardWidget {
  pluginId: string;
  pluginName: string;
  id: string;
  label: string;
  kind: "metric" | "status";
  actionId: string;
  description?: string;
  priority?: number;
}

/**
 * Collects `dashboardWidgets` declared by every loaded plugin and returns
 * them in render order: `priority` asc (missing priority = Infinity, i.e.
 * rendered last), ties broken by plugin registration order.
 */
export function getDashboardWidgetsFromPlugins(): ResolvedDashboardWidget[] {
  const result: ResolvedDashboardWidget[] = [];
  for (const registration of pluginRegistry.values()) {
    const widgets = registration.admin?.dashboardWidgets;
    if (!widgets || widgets.length === 0) continue;
    for (const widget of widgets) {
      result.push({
        pluginId: registration.id,
        pluginName: registration.name,
        id: widget.id,
        label: widget.label,
        kind: widget.kind,
        actionId: widget.actionId,
        description: widget.description,
        priority: widget.priority,
      });
    }
  }
  // Stable sort: items keep registration order when priorities tie.
  return result
    .map((widget, index) => ({ widget, index }))
    .sort((a, b) => {
      const ap = a.widget.priority ?? Number.POSITIVE_INFINITY;
      const bp = b.widget.priority ?? Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
      return a.index - b.index;
    })
    .map(({ widget }) => widget);
}

/**
 * Dispatches a named action registered by the plugin via
 * `ctx.actions.register(actionId, handler)`. Admin widgets / actions / tables
 * call this via POST /api/plugins/:id/actions/:actionId — the handler is
 * responsible for returning `{ ok, data?, error? }`.
 */
export async function dispatchPluginAction(
  pluginId: string,
  actionId: string,
  data?: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const registration = pluginRegistry.get(pluginId);
  if (!registration) {
    return { ok: false, error: `Plugin "${pluginId}" is not registered` };
  }
  const handler = registration.actions.get(actionId);
  if (!handler) {
    return { ok: false, error: `Action "${actionId}" not found on plugin "${pluginId}"` };
  }
  return handler(data);
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
