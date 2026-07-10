import type { NpFieldConfig, NpPluginConfig, NpPluginContext } from "../config/types.js";
import { getLogger } from "../observability/logger.js";
import { reportError } from "../observability/error-reporter.js";
import { createPluginRuntimeContext } from "./context.js";
import { isPluginEnabled } from "./enabled-gate.js";
import { checkNexpressCompat, topoSort } from "./compat.js";
import {
  npAnalyzePluginAdminActionContract,
  npValidatePluginActionResult,
  type NpPluginActionKind,
  type NpPluginActionRegistrationConflict,
  type NpPluginAdminActionIssue,
  type NpRegisteredPluginAction,
} from "./admin-action-contract.js";
import {
  npPluginApiRouteKey,
  npValidatePluginApiRouteDefinition,
  npValidatePluginApiRouteResponse,
  type NpPluginApiRouteMethod,
  type NpPluginApiRouteRequest,
  type NpPluginApiRouteResponse,
} from "./api-route-contract.js";
import {
  npCompilePluginPageRoutePattern,
  npValidatePluginPageRouteDefinition,
  type NpPluginPageRouteLocale,
  type NpPluginPageRouteSurface,
} from "./page-route-contract.js";
import {
  npAnalyzePluginScheduledTasks,
  npValidatePluginScheduledTaskResult,
} from "./scheduled-task-contract.js";
import {
  npIsPluginHookName,
  npValidatePluginHookData,
  type NpPluginHookDataMap,
  type NpPluginHookName,
  type NpPluginLifecycleHookName,
  type NpRenderHookData,
} from "./hook-contract.js";

export interface PluginHookHandler {
  pluginId: string;
  /**
   * Returns `void` for fire-and-forget hooks (most of them). Render / extension
   * hooks may return a value; `runHookAndCollect` gathers those, while
   * `runHook` ignores returns.
   */
  handler: (data: unknown) => unknown;
  /**
   * Lower priority runs first. Default `100`, leaving headroom in both
   * directions: a plugin that wants to observe AFTER everyone else picks
   * `200`, one that needs to mutate the payload first picks `0`. Stable
   * ordering: ties keep registration order (which is itself topo-sorted by
   * plugin `requires`).
   */
  priority: number;
  /**
   * Per-handler timeout in milliseconds. When the handler doesn't settle
   * within the budget, `dispatchHookHandler` treats it as a failure —
   * logged and reported the same way a thrown error is. The remaining
   * handlers continue. `undefined` means "no timeout enforced", which is
   * the default for fire-and-forget hooks (`runHook`); render-collecting
   * hooks may want a tighter budget (e.g. 250ms) so a slow plugin can't
   * stall page rendering.
   */
  timeoutMs?: number;
}

export type NpHookResultValidation = { ok: true } | { ok: false; message: string };

export interface NpHookCollectOptions {
  /** Validate each non-null handler return before it enters the collected list. */
  validateResult?: (value: unknown) => NpHookResultValidation;
}

export interface PluginRouteHandler {
  pluginId: string;
  path: string;
  method: NpPluginApiRouteMethod;
  description?: string;
  /** When true, the dispatcher must verify a staff session before
   *  invoking `handler` and pass the resolved user as `req.user`.
   *  When false (default), the route is publicly reachable. */
  auth: boolean;
  handler: (req: PluginRouteRequest) => Promise<PluginRouteResponse>;
}

export type PluginRouteRequest = NpPluginApiRouteRequest;
export type PluginRouteResponse = NpPluginApiRouteResponse;

export interface PluginCapabilityRequirement {
  requirement: string;
  declared: readonly string[];
}

/**
 * Declarative admin extension snapshot stored per registration. Shape mirrors
 * `@nexpress/plugin-sdk`'s `NpAdminExtension` but kept structural here to
 * avoid a plugin-sdk → core cycle. The admin UI reads this via
 * `getPluginAdminExtension(id)` and renders it with its own primitives.
 */
export interface PluginAdminExtension {
  settings?: {
    title?: string;
    description?: string;
    fields: NpFieldConfig[];
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

/**
 * Phase 19 — first-class plugin cron schedules. Plugins
 * declare `scheduled: [{ id, cron, handler }]` in their
 * definition; the host stores the list here and pg-boss
 * registers one recurring schedule per entry. The handler
 * runs in the same context shape `setup()` saw, so plugins
 * already familiar with `ctx.content` / `ctx.storage` /
 * `ctx.next` use the same surface from a cron tick.
 */
export interface PluginScheduleHandler {
  pluginId: string;
  taskId: string;
  cron: string;
  description?: string;
  handler: (ctx: Record<string, unknown>) => unknown;
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
  actionMetadata: Map<string, NpRegisteredPluginAction>;
  actionConflicts: NpPluginActionRegistrationConflict[];
  schedules: Map<string, PluginScheduleHandler>;
  /**
   * G.1 — Zod schema describing the plugin's operator-tunable
   * config. Read by `getPluginConfig` (introspection +
   * validation) and the admin auto-form. `unknown` here so the
   * host doesn't pull a hard zod dep into its type surface;
   * narrowed at the call site (same pattern theme uses for
   * `settingsSchema`).
   */
  configSchema?: unknown;
  /** G.1 — schema version (defaults to 1). See plugin-sdk types. */
  configVersion?: number;
  /** G.1 — migration callback for v(N-1) → current. */
  configMigrate?: (old: unknown, fromVersion: number) => unknown;
  /**
   * Plugin-contributed page routes (#623). The canonical
   * contract validates component and metadata functions before
   * the host stores renderer-agnostic values; the route-dispatcher
   * in `@nexpress/next` narrows them at render time. See
   * `docs/design/plugin-routes.md` for precedence + surface
   * semantics.
   */
  pageRoutes: readonly PluginPageRouteEntry[];
}

export interface PluginPageRouteEntry {
  pattern: string;
  component: unknown;
  metadata?: unknown;
  surface: NpPluginPageRouteSurface;
  locale: NpPluginPageRouteLocale;
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
 * Default priority assigned to a hook handler that doesn't pick one. The
 * value matters less than the headroom — a plugin can always go above or
 * below to override, and 100 leaves room for both. Keep in sync with the
 * docstring on `PluginHookHandler.priority`.
 */
const DEFAULT_HOOK_PRIORITY = 100;

/**
 * Normalizes the two valid hook value shapes:
 *   - bare function (the original shape — implicit priority 100, no timeout)
 *   - `{ handler, priority?, timeoutMs? }` object
 *
 * Returns `null` for malformed input so the caller can skip silently —
 * Zod schema on the plugin-sdk side already rejects bad shapes at
 * authoring time, so this is just defense in depth at the host boundary.
 */
function normalizeHookValue(
  value: unknown,
): { handler: ResolvedHookFn; priority: number; timeoutMs?: number } | null {
  if (typeof value === "function") {
    return { handler: value as ResolvedHookFn, priority: DEFAULT_HOOK_PRIORITY };
  }
  if (value && typeof value === "object") {
    const v = value as { handler?: unknown; priority?: unknown; timeoutMs?: unknown };
    if (typeof v.handler !== "function") return null;
    return {
      handler: v.handler as ResolvedHookFn,
      priority: typeof v.priority === "number" ? v.priority : DEFAULT_HOOK_PRIORITY,
      timeoutMs: typeof v.timeoutMs === "number" && v.timeoutMs > 0 ? v.timeoutMs : undefined,
    };
  }
  return null;
}

/**
 * Inserts a handler into the global per-hook list while keeping the array
 * sorted by `(priority asc, registration order)`. Array sort in V8 is
 * stable, so we can append + sort and ties keep insertion order.
 *
 * Sorting at registration time means dispatch is allocation-free — the
 * hot path just iterates the array. Registrations happen at boot (and on
 * a hot reload), so re-sorting on each insert is fine.
 */
function insertSortedByPriority(list: PluginHookHandler[], entry: PluginHookHandler): void {
  list.push(entry);
  list.sort((a, b) => a.priority - b.priority);
}

/**
 * Structural shape for plugins built via `@nexpress/plugin-sdk`'s
 * `definePlugin()`. Matches `NpResolvedPluginLike` in config/types.ts —
 * kept deliberately loose so `loadPlugins` can accept the same array
 * that `NpConfig.plugins` does without narrowing gymnastics.
 */
export interface ResolvedPluginLike {
  manifest: {
    id: string;
    name: string;
    version?: string;
    description?: string;
    capabilities: readonly string[];
    allowedHosts?: readonly string[];
    /**
     * Compatibility range for the framework. The plugin loads only when
     * `nexpress.minVersion <= host <= nexpress.maxVersion?` (inclusive).
     * Optional here so legacy / hand-rolled plugins keep loading; the
     * plugin-sdk schema requires it for new plugins.
     */
    nexpress?: { minVersion?: string; maxVersion?: string };
    /**
     * IDs of other plugins that must load first. The host topo-sorts the
     * load list so this plugin's `setup()` can assume its prerequisites
     * have already registered hooks/actions/blocks.
     */
    requires?: readonly string[];
  };
  hooks?: Record<string, unknown>;
  routes?: ReadonlyArray<{
    path: string;
    method: string;
    handler: unknown;
    description?: string;
    auth?: boolean;
  }>;
  pageRoutes?: ReadonlyArray<{
    pattern: string;
    component: unknown;
    metadata?: unknown;
    surface?: NpPluginPageRouteSurface;
    locale?: NpPluginPageRouteLocale;
  }>;
  scheduled?: ReadonlyArray<{
    id: string;
    cron: string;
    handler: unknown;
    description?: string;
  }>;
  actions?: Readonly<
    Record<
      string,
      {
        kind: NpPluginActionKind;
        handler: unknown;
        description?: string;
      }
    >
  >;
  admin?: PluginAdminExtension;
  /** G.1 — runtime zod schema for plugin config (auto-form). */
  configSchema?: unknown;
  /** G.1 — schema version for the lazy migration pipeline. */
  configVersion?: number;
  /** G.1 — old → current value migrator. */
  configMigrate?: (old: unknown, fromVersion: number) => unknown;
}

type ResolvedHookFn = (ctx: {
  hook: NpPluginHookName;
  data: NpPluginHookDataMap[NpPluginHookName];
  ctx: Record<string, unknown>;
}) => unknown;

type ResolvedRouteFn = (
  req: PluginRouteRequest,
  ctx: Record<string, unknown>,
) => PluginRouteResponse | Promise<PluginRouteResponse>;

interface ValidatedApiRoute {
  method: NpPluginApiRouteMethod;
  path: string;
  handler: ResolvedRouteFn;
  description?: string;
  auth?: boolean;
}

interface ValidatedScheduledTask {
  id: string;
  cron: string;
  handler: (ctx: Record<string, unknown>) => unknown;
  description?: string;
}

function validateApiRouteRegistry(pluginId: string, value: unknown): ValidatedApiRoute[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`[plugin:${pluginId}] routes must be an array.`);
  }

  const routes: ValidatedApiRoute[] = [];
  const routeKeys = new Set<string>();
  for (const rawRoute of value) {
    const routeValidation = npValidatePluginApiRouteDefinition(rawRoute);
    if (!routeValidation.ok) {
      throw new Error(`[plugin:${pluginId}] invalid API route: ${routeValidation.message}`);
    }
    const route = rawRoute as ValidatedApiRoute;
    const routeKey = npPluginApiRouteKey(route);
    if (routeKeys.has(routeKey)) {
      throw new Error(`[plugin:${pluginId}] duplicate API route "${routeKey}".`);
    }
    routeKeys.add(routeKey);
    routes.push(route);
  }
  return routes;
}

function validatePageRouteRegistry(pluginId: string, value: unknown): PluginPageRouteEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`[plugin:${pluginId}] pageRoutes must be an array.`);
  }

  const routes: PluginPageRouteEntry[] = [];
  const patterns = new Set<string>();
  for (const [index, rawRoute] of value.entries()) {
    const validation = npValidatePluginPageRouteDefinition(rawRoute);
    if (!validation.ok) {
      throw new Error(
        `[plugin:${pluginId}] invalid page route at index ${index.toString()}: ${validation.message}`,
      );
    }
    const route = rawRoute as {
      pattern: string;
      component: unknown;
      metadata?: unknown;
      surface?: NpPluginPageRouteSurface;
      locale?: NpPluginPageRouteLocale;
    };
    if (patterns.has(route.pattern)) {
      throw new Error(`[plugin:${pluginId}] duplicate page route "${route.pattern}".`);
    }
    patterns.add(route.pattern);
    npCompilePluginPageRoutePattern(route.pattern);
    routes.push({
      pattern: route.pattern,
      component: route.component,
      metadata: route.metadata,
      surface: route.surface ?? "site",
      locale: route.locale ?? "auto",
    });
  }
  return routes;
}

function validateScheduledTaskRegistry(pluginId: string, value: unknown): ValidatedScheduledTask[] {
  if (value === undefined) return [];
  const issue = npAnalyzePluginScheduledTasks(value)[0];
  if (issue) throw new Error(`[plugin:${pluginId}] ${issue.message}`);
  return value as ValidatedScheduledTask[];
}

/**
 * G.1 — read a plugin's persisted config from `np_settings`.
 *
 * Internal helper for the runtime context builder; external callers
 * import `getPluginConfig` from `./config.js` directly. We avoid a
 * cross-module call here so `host.ts` doesn't import from `config.ts`
 * (one-way: config.ts imports from host.ts via `getPluginRegistration`).
 */
async function loadPluginConfig(pluginId: string): Promise<Record<string, unknown>> {
  const { getPluginConfig } = await import("./config.js");
  const value = await getPluginConfig(pluginId);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
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

function analyzeRegistrationActions(registration: PluginRegistration): NpPluginAdminActionIssue[] {
  return npAnalyzePluginAdminActionContract(
    registration.admin,
    registration.actionMetadata.values(),
    registration.actionConflicts,
  );
}

function logPluginAdminActionContract(registration: PluginRegistration): void {
  for (const issue of analyzeRegistrationActions(registration)) {
    // Unreferenced actions may intentionally exist for inter-plugin dispatch.
    // Keep them in doctor output without making every such action noisy at boot.
    if (issue.code === "unused") continue;
    const context = {
      pluginId: registration.id,
      actionId: issue.actionId,
      code: issue.code,
      detail: issue.message,
      locations: issue.locations,
    };
    if (issue.severity === "error") {
      getLogger().error("Plugin admin action contract is invalid", context);
    } else {
      getLogger().warn("Plugin admin action contract needs attention", context);
    }
  }
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
  insertSortedByPriority(registration.hooks.get(hookName)!, handler);

  if (!globalHooks.has(hookName)) {
    globalHooks.set(hookName, []);
  }
  insertSortedByPriority(globalHooks.get(hookName)!, handler);
}

function createPluginContext(pluginId: string, registration: PluginRegistration): NpPluginContext {
  return {
    addCollection: () => {
      throw new Error(
        `[plugin:${pluginId}] Runtime collection registration not supported in v1. Add collections to nexpress.config.ts.`,
      );
    },
    addBlock: () => {
      throw new Error(
        `[plugin:${pluginId}] Runtime block registration not supported in v1. Add blocks to nexpress.config.ts.`,
      );
    },
    addHook: (collection: string, event: string, hook) => {
      // Legacy API: collection is the docs' collection ("posts"), event is the
      // lifecycle step ("afterCreate"). The pipeline emits canonical hook names
      // under the "content:" namespace (e.g. `content:afterCreate`), so
      // register there and filter by collection at dispatch time. This keeps
      // legacy hooks firing on the same stream as resolved-plugin hooks.
      const hookName = `content:${event}`;
      if (!npIsPluginHookName(hookName) || !hookName.startsWith("content:")) {
        throw new Error(`[plugin:${pluginId}] unsupported content hook "${hookName}".`);
      }
      const requirement = hookCapabilityFor(hookName);
      if (requirement) {
        assertCapability(pluginId, requirement, registration.capabilities);
      }

      registerHookHandler(registration, hookName, {
        pluginId,
        priority: DEFAULT_HOOK_PRIORITY,
        handler: async (data) => {
          const payload = data as Record<string, unknown>;
          if (typeof payload.collection === "string" && payload.collection !== collection) {
            return;
          }
          await hook({ data: payload, collection } as never);
        },
      });
    },
  };
}

async function loadResolvedPlugin(plugin: ResolvedPluginLike): Promise<void> {
  const { manifest } = plugin;

  // Defense in depth: if this id was already registered, scrub the old
  // entry's hooks + routes from the global maps before overwriting. The
  // documented reload flow (`reloadPlugins()`) always calls `resetPlugins()`
  // first, so we shouldn't normally hit this — but a stray double-load
  // would otherwise leave both registrations dispatching, which is much
  // harder to diagnose than a clean re-register.
  const previous = pluginRegistry.get(manifest.id);
  if (previous) {
    for (const [hookName, list] of previous.hooks) {
      const global = globalHooks.get(hookName);
      if (!global) continue;
      const filtered = global.filter((h) => !list.includes(h));
      if (filtered.length === 0) globalHooks.delete(hookName);
      else globalHooks.set(hookName, filtered);
    }
    for (const route of previous.routes) {
      const idx = globalRoutes.indexOf(route);
      if (idx !== -1) globalRoutes.splice(idx, 1);
    }
    pluginRegistry.delete(manifest.id);
  }

  const validatedApiRoutes = validateApiRouteRegistry(
    manifest.id,
    (plugin as { routes?: unknown }).routes,
  );
  if (validatedApiRoutes.length > 0) {
    assertCapability(manifest.id, "api:route", manifest.capabilities);
  }
  const validatedPageRoutes = validatePageRouteRegistry(
    manifest.id,
    (plugin as { pageRoutes?: unknown }).pageRoutes,
  );
  if (validatedPageRoutes.length > 0) {
    assertCapability(manifest.id, "site:route", manifest.capabilities);
  }
  const validatedScheduledTasks = validateScheduledTaskRegistry(
    manifest.id,
    (plugin as { scheduled?: unknown }).scheduled,
  );
  if (validatedScheduledTasks.length > 0) {
    assertCapability(manifest.id, "hooks:scheduled", manifest.capabilities);
  }

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
    actionMetadata: new Map(),
    actionConflicts: [],
    schedules: new Map(),
    configSchema: plugin.configSchema,
    configVersion: plugin.configVersion,
    configMigrate: plugin.configMigrate,
    pageRoutes: validatedPageRoutes,
  };

  pluginRegistry.set(manifest.id, registration);

  // Definition-level actions are the statically inspectable contract used by
  // definePlugin and plugin doctor. Register them before setup so the plugin's
  // own setup callback (and dependent plugins loaded later) can dispatch them.
  for (const [actionId, rawAction] of Object.entries(plugin.actions ?? {})) {
    if (!rawAction || typeof rawAction !== "object") continue;
    if (
      rawAction.kind !== "action" &&
      rawAction.kind !== "metric" &&
      rawAction.kind !== "status" &&
      rawAction.kind !== "table"
    ) {
      getLogger().error("Plugin action has an unsupported kind", {
        pluginId: manifest.id,
        actionId,
        kind: String(rawAction.kind),
      });
      continue;
    }
    if (typeof rawAction.handler !== "function") {
      getLogger().error("Plugin action is missing a handler", {
        pluginId: manifest.id,
        actionId,
      });
      continue;
    }
    const kind = rawAction.kind;
    const handler = rawAction.handler as (
      data: unknown,
      ctx: Record<string, unknown>,
    ) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    registration.actionMetadata.set(actionId, {
      id: actionId,
      kind,
      source: "definition",
      description: rawAction.description,
    });
    registration.actions.set(actionId, async (data) => {
      // Build the context at dispatch time so config changes made after boot
      // are visible to definition-level handlers.
      const ctx = await buildCtxFor(manifest.id);
      return npValidatePluginActionResult(manifest.id, actionId, kind, await handler(data, ctx));
    });
  }

  // G.1 — declaring BOTH `configSchema` (auto-form) and
  // `admin.settings.fields` (legacy declarative form) is a sign
  // the plugin is mid-migration. The auto-form wins (per design
  // doc § 5.1.1); warn so the operator/author notices the
  // ignored field list. Migrating PRs should remove
  // `admin.settings.fields` in the same diff that adds
  // `configSchema`.
  if (
    registration.configSchema !== undefined &&
    plugin.admin?.settings?.fields &&
    plugin.admin.settings.fields.length > 0
  ) {
    getLogger().warn("Plugin declares both configSchema and admin.settings.fields", {
      pluginId: manifest.id,
      note: "Auto-form wins; admin.settings.fields is ignored at render time. Remove admin.settings.fields when migrating to configSchema.",
    });
  }

  // Phase 19 — first-class cron schedules. Definition validation above
  // guarantees every entry maps to exactly one namespaced pg-boss row.
  for (const task of validatedScheduledTasks) {
    registration.schedules.set(task.id, {
      pluginId: manifest.id,
      taskId: task.id,
      cron: task.cron,
      description: task.description,
      handler: task.handler,
    });
  }

  for (const [hookName, rawValue] of Object.entries(plugin.hooks ?? {})) {
    if (!npIsPluginHookName(hookName)) {
      throw new Error(`[plugin:${manifest.id}] unsupported hook "${hookName}".`);
    }
    const normalized = normalizeHookValue(rawValue);
    if (!normalized) continue;

    const requirement = hookCapabilityFor(hookName);
    if (requirement) {
      assertCapability(manifest.id, requirement, registration.capabilities);
    }

    const userHandler = normalized.handler;
    registerHookHandler(registration, hookName, {
      pluginId: manifest.id,
      priority: normalized.priority,
      timeoutMs: normalized.timeoutMs,
      handler: async (data) => {
        const ctx = await buildCtxFor(manifest.id);
        return await userHandler({
          hook: hookName,
          data: data as NpPluginHookDataMap[NpPluginHookName],
          ctx,
        });
      },
    });
  }

  for (const route of validatedApiRoutes) {
    const routeKey = npPluginApiRouteKey(route);

    const userHandler = route.handler;
    const wrapped: (req: PluginRouteRequest) => Promise<PluginRouteResponse> = async (req) => {
      const ctx = await buildCtxFor(manifest.id);
      const result = await userHandler(req, ctx);
      const responseValidation = npValidatePluginApiRouteResponse(result);
      if (!responseValidation.ok) {
        throw new Error(
          `[plugin:${manifest.id}] API route "${routeKey}" returned an invalid response: ${responseValidation.message}`,
        );
      }
      return result;
    };

    const auth = route.auth === true;
    const method = route.method;

    // #316 — public plugin routes carry the framework's least-
    // protected default rate limit (proxy.ts caps the catch-all at
    // 30 req/min/IP) and run *plugin-supplied* code without staff
    // session checks. Mutating ones double the surface area: an
    // attacker that finds the route can hit the handler at the IP
    // ceiling. Plugins that legitimately need a public mutating
    // endpoint (webhooks, callback URLs) own the auth themselves —
    // log a warning at load time so this is at least visible in
    // boot logs and a tracker can grep for it.
    if (!auth && method !== "GET") {
      getLogger().warn("Plugin registered a public mutating route", {
        pluginId: manifest.id,
        path: route.path,
        method,
        note:
          "Plugins are responsible for their own auth on `auth: false` " +
          "routes. The framework rate-limits the plugin catch-all to " +
          "30 req/min/IP; verify the handler enforces signature / token " +
          "checks before mutating state.",
      });
    }

    const entry: PluginRouteHandler = {
      pluginId: manifest.id,
      path: route.path,
      method,
      description: route.description,
      auth,
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
  const i18nBundles = (plugin as { i18n?: Record<string, Record<string, string>> }).i18n;
  if (i18nBundles && typeof i18nBundles === "object") {
    const { addStrings } = await import("../i18n/strings.js");
    for (const [locale, bundle] of Object.entries(i18nBundles)) {
      if (bundle && typeof bundle === "object") {
        addStrings(locale, bundle);
      }
    }
  }

  // Phase 14.5 — merge any page templates the plugin
  // contributes. Theme templates win on id collision (handled
  // downstream in `getThemeTemplateSummaries`), so plugin
  // authors don't need to coordinate id namespaces with the
  // active theme — the theme just stays authoritative. Re-
  // registering the same plugin overwrites its previous
  // entries (idempotent across hot reloads).
  const pluginTemplates = (plugin as { templates?: Record<string, Record<string, unknown>> })
    .templates;
  if (pluginTemplates && typeof pluginTemplates === "object") {
    const { registerPluginTemplates } = await import("./templates.js");
    registerPluginTemplates(manifest.id, pluginTemplates);
  }

  // Invoke optional setup() after hooks, routes, and definition actions are
  // registered. The compatible ctx.actions.register* API can add or replace
  // handlers before subsequent plugins begin loading.
  const setup = (plugin as { setup?: (ctx: Record<string, unknown>) => void | Promise<void> })
    .setup;
  if (typeof setup === "function") {
    const ctx = await buildCtxFor(manifest.id);
    await setup(ctx);
  }

  logPluginAdminActionContract(registration);
}

async function loadLegacyPlugin(plugin: NpPluginConfig): Promise<void> {
  const registration: PluginRegistration = {
    id: plugin.id,
    name: plugin.name,
    capabilities: ["hooks:content"],
    allowedHosts: [],
    hooks: new Map(),
    routes: [],
    actions: new Map(),
    actionMetadata: new Map(),
    actionConflicts: [],
    schedules: new Map(),
    // Legacy `init()` plugins predate the page-routes contract;
    // they always register zero routes. Kept as a literal `[]` so
    // the registration shape is consistent across the two paths
    // and `getPluginPageRoutes()` doesn't need to special-case
    // legacy entries.
    pageRoutes: [],
  };

  pluginRegistry.set(plugin.id, registration);

  if (plugin.init) {
    const ctx = createPluginContext(plugin.id, registration);
    await plugin.init(ctx);
  }
}

export async function loadPlugins(
  plugins: Array<NpPluginConfig | ResolvedPluginLike>,
): Promise<void> {
  // Pass 1 — drop plugins whose declared `nexpress` range excludes the
  // running framework version. We warn instead of throwing so a host that
  // ships with eight plugins doesn't refuse to boot when one is stale.
  const filtered: Array<NpPluginConfig | ResolvedPluginLike> = [];
  for (const plugin of plugins) {
    if (isResolvedPlugin(plugin)) {
      const compat = checkNexpressCompat(plugin.manifest);
      if (!compat.compatible) {
        getLogger().warn("Skipping incompatible plugin", {
          pluginId: plugin.manifest.id,
          reason: compat.reason,
        });
        continue;
      }
    }
    filtered.push(plugin);
  }

  // Pass 2 — order resolved plugins by their `requires` graph. Legacy
  // (init()-shape) plugins have no manifest so they ride at the front in
  // their original order; they predate the dependency model and never
  // declare requirements.
  const legacy: NpPluginConfig[] = [];
  const resolved: ResolvedPluginLike[] = [];
  for (const plugin of filtered) {
    if (isResolvedPlugin(plugin)) {
      resolved.push(plugin);
    } else {
      legacy.push(plugin);
    }
  }

  const sortInput = resolved.map((plugin) => ({
    id: plugin.manifest.id,
    requires: plugin.manifest.requires ?? [],
    plugin,
  }));
  const { ordered, skipped } = topoSort(sortInput);
  for (const entry of skipped) {
    getLogger().warn("Skipping plugin with unsatisfied dependency", {
      pluginId: entry.id,
      reason: entry.reason,
    });
  }

  // Pass 3 — actually load. Legacy first, then resolved in topo order.
  // Each load is wrapped in error isolation: a throwing plugin (most
  // commonly a buggy `setup()` callback or a missing required config)
  // is logged and skipped, so one broken plugin can't take down the
  // whole boot. Partial state from a half-loaded plugin (hooks/routes
  // registered before `setup` threw) is scrubbed via
  // `pluginRegistry.delete(id)` so callers don't see an inconsistent
  // shell registration. Plugins that depend on the failed one will
  // either fail their own require check (handled cleanly) or fail at
  // dispatch time (also caught at the dispatch layer).
  for (const plugin of legacy) {
    try {
      await loadLegacyPlugin(plugin);
    } catch (err) {
      pluginRegistry.delete(plugin.id);
      getLogger().error("Plugin failed to load — skipped", {
        pluginId: plugin.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  for (const entry of ordered) {
    try {
      await loadResolvedPlugin(entry.plugin);
    } catch (err) {
      const pluginId = entry.plugin.manifest.id;
      pluginRegistry.delete(pluginId);
      getLogger().error("Plugin failed to load — skipped", {
        pluginId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Invokes one plugin hook handler with error isolation: a thrown handler
 * is logged, reported, and swallowed so a single broken plugin can't take
 * down the rest of the dispatch chain (or the caller — pipeline write,
 * page render, etc.).
 *
 * Returns `{ ok: true, value }` on success and `{ ok: false }` on failure.
 * Callers that aggregate return values (`runHookAndCollect`) skip failed
 * handlers; fire-and-forget callers (`runHook`) ignore the value entirely.
 */
async function dispatchHookHandler(
  hookName: string,
  handler: PluginHookHandler,
  data: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const result = handler.handler(data);
    // Fast path: handler returned a non-Promise. Skip the timer +
    // Promise.race overhead for the common synchronous case.
    if (handler.timeoutMs === undefined || !(result instanceof Promise)) {
      const value = await result;
      return { ok: true, value };
    }
    // Slow path: race the handler against a timeout. We allocate the
    // timer here (not in the resolved Promise.then) so a fast-resolving
    // handler still pays only the timer-creation cost; the timer is
    // cleared in `finally`.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Plugin hook handler timed out after ${handler.timeoutMs}ms`));
      }, handler.timeoutMs);
    });
    try {
      const value = await Promise.race([result, timeoutPromise]);
      return { ok: true, value };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    getLogger().error("Plugin hook handler threw", {
      pluginId: handler.pluginId,
      hook: hookName,
      timeoutMs: handler.timeoutMs,
      message: err.message,
      stack: err.stack,
    });
    void reportError(err, {
      tags: { source: "plugin-hook", pluginId: handler.pluginId, hook: hookName },
    });
    return { ok: false };
  }
}

export async function runHook<TName extends NpPluginLifecycleHookName>(
  hookName: TName,
  data: NpPluginHookDataMap[TName],
): Promise<void> {
  const validation = npValidatePluginHookData(hookName, data);
  if (!validation.ok) {
    throw new Error(`Invalid plugin hook dispatch for "${hookName}": ${validation.message}`);
  }
  Object.freeze(data);

  const handlers = globalHooks.get(hookName);
  if (!handlers || handlers.length === 0) return;

  for (const handler of handlers) {
    if (!(await isPluginEnabled(handler.pluginId))) continue;
    const outcome = await dispatchHookHandler(hookName, handler, data);
    if (outcome.ok && outcome.value !== undefined) {
      const error = new Error(
        `[plugin:${handler.pluginId}] hook "${hookName}" returned a value, but lifecycle hooks must return void.`,
      );
      getLogger().error("Plugin lifecycle hook returned an invalid result", {
        pluginId: handler.pluginId,
        hook: hookName,
      });
      void reportError(error, {
        tags: { source: "plugin-hook", pluginId: handler.pluginId, hook: hookName },
      });
    }
  }
}

/**
 * Like `runHook`, but collects every non-null/undefined return value from
 * registered handlers. Used by the `render:beforePage` extension point where
 * each plugin contributes structured data — head tags and body-end scripts —
 * that the renderer aggregates into a single output.
 *
 * Handlers that throw are isolated (logged + reported, then skipped). A
 * broken plugin contributing meta tags is allowed to fail silently so the
 * page itself still ships — incomplete SEO output beats a 500.
 */
export async function runHookAndCollect<T>(
  hookName: "render:beforePage",
  data: NpRenderHookData,
  options?: NpHookCollectOptions,
): Promise<T[]> {
  const dataValidation = npValidatePluginHookData(hookName, data);
  if (!dataValidation.ok) {
    throw new Error(`Invalid plugin hook dispatch for "${hookName}": ${dataValidation.message}`);
  }
  Object.freeze(data);

  const handlers = globalHooks.get(hookName);
  if (!handlers || handlers.length === 0) return [];

  const results: T[] = [];
  for (const handler of handlers) {
    if (!(await isPluginEnabled(handler.pluginId))) continue;
    const outcome = await dispatchHookHandler(hookName, handler, data);
    if (outcome.ok && outcome.value !== undefined && outcome.value !== null) {
      const validation = options?.validateResult?.(outcome.value);
      if (validation && !validation.ok) {
        const error = new Error(
          `[plugin:${handler.pluginId}] hook "${hookName}" returned an invalid result: ${validation.message}`,
        );
        getLogger().error("Plugin hook returned an invalid result", {
          pluginId: handler.pluginId,
          hook: hookName,
          detail: validation.message,
        });
        void reportError(error, {
          tags: { source: "plugin-hook", pluginId: handler.pluginId, hook: hookName },
        });
        continue;
      }
      results.push(outcome.value as T);
    }
  }
  return results;
}

export function getPluginRoutes(): PluginRouteHandler[] {
  return globalRoutes;
}

/**
 * Plugin page routes (#623). Returns the flat list of registered
 * routes from EVERY loaded plugin in registration order, regardless
 * of enabled state — call sites that care about enabled gating
 * (e.g. the route dispatcher) walk the list and re-check via
 * `isPluginEnabled(pluginId)`. Keeping the gate at the call site
 * means tests can assert the registered shape without mocking the
 * enabled-state singleton.
 */
export function getPluginPageRoutes(): Array<{
  pluginId: string;
  route: PluginPageRouteEntry;
}> {
  const out: Array<{ pluginId: string; route: PluginPageRouteEntry }> = [];
  for (const [pluginId, registration] of pluginRegistry) {
    for (const route of registration.pageRoutes) {
      out.push({ pluginId, route });
    }
  }
  return out;
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

/** Returns the runtime id/kind/source inventory used by plugin doctor. */
export function getRegisteredPluginActions(pluginId: string): NpRegisteredPluginAction[] {
  return [...(pluginRegistry.get(pluginId)?.actionMetadata.values() ?? [])].map((action) => ({
    ...action,
  }));
}

/**
 * Reports missing, mismatched, duplicate, untyped, and admin-unreferenced
 * actions after the plugin's setup callback has completed.
 */
export function getPluginAdminActionDiagnostics(pluginId: string): NpPluginAdminActionIssue[] {
  const registration = pluginRegistry.get(pluginId);
  return registration ? analyzeRegistrationActions(registration) : [];
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
 * Dispatches a named definition-level or setup-registered plugin action.
 * Admin widgets / actions / tables call this via
 * POST /api/plugins/:id/actions/:actionId. Typed results are validated by the
 * registration wrapper before they reach the caller.
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
  if (!(await isPluginEnabled(pluginId))) {
    return { ok: false, error: `Plugin "${pluginId}" is disabled` };
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

/**
 * Phase 19 — return every registered schedule across loaded
 * plugins. The pg-boss adapter calls this from
 * `scheduleRecurring()` so each `definePlugin({ scheduled })`
 * entry becomes a real cron in `pgboss.schedule`.
 */
export function getRegisteredPluginSchedules(): PluginScheduleHandler[] {
  const out: PluginScheduleHandler[] = [];
  for (const reg of pluginRegistry.values()) {
    for (const schedule of reg.schedules.values()) {
      out.push(schedule);
    }
  }
  return out;
}

/**
 * Phase 19 — runs the handler for one plugin's scheduled task.
 * Called from the `plugin:scheduledTask` job handler when a
 * tick fires. Builds the same plugin context the `setup()`
 * call sees so handlers reuse `ctx.content` / `ctx.storage` /
 * etc. Throws when the plugin or task isn't registered so the
 * worker's retry policy surfaces the misconfiguration.
 */
export async function runPluginScheduledTask(pluginId: string, taskId: string): Promise<void> {
  const registration = pluginRegistry.get(pluginId);
  if (!registration) {
    throw new Error(`Plugin "${pluginId}" is not registered`);
  }
  if (!(await isPluginEnabled(pluginId))) {
    // pg-boss keeps firing the cron entry even when disabled; bail quietly so
    // the queue records a successful tick instead of a retry-storm.
    getLogger().debug("Skipping plugin scheduled task — plugin disabled", {
      pluginId,
      taskId,
    });
    return;
  }
  const entry = registration.schedules.get(taskId);
  if (!entry) {
    throw new Error(`Plugin "${pluginId}" has no scheduled task with id "${taskId}"`);
  }
  const ctx = await buildCtxFor(pluginId);
  const resultValidation = npValidatePluginScheduledTaskResult(await entry.handler(ctx));
  if (!resultValidation.ok) {
    throw new Error(`[plugin:${pluginId}] scheduled task "${taskId}": ${resultValidation.message}`);
  }
}

export function resetPlugins(): void {
  pluginRegistry.clear();
  globalHooks.clear();
  globalRoutes.length = 0;
}

export { isPluginEnabled, invalidatePluginEnabled } from "./enabled-gate.js";
