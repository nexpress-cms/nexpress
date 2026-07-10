import { npValidatePluginPageRouteDefinition } from "@nexpress/core";
import { npAnalyzeBlockDefinitions } from "@nexpress/blocks/contracts";

import { npAdminExtensionSchema, npPluginManifestSchema } from "./manifest.js";
import {
  npHookNames,
  npRouteMethods,
  type NpAdminExtension,
  type NpPluginActionKind,
  type NpPluginActionRegistry,
  type NpPluginCapability,
  type NpPluginDefinition,
  type NpResolvedPlugin,
} from "./types.js";

const supportedHookNames = new Set<string>(npHookNames);
const supportedRouteMethods = new Set<string>(npRouteMethods);
const hookDescriptorKeys = new Set(["handler", "priority", "timeoutMs"]);
const routeDefinitionKeys = new Set(["method", "path", "handler", "description", "auth"]);
const routeSegmentPattern = /^[A-Za-z0-9._~-]+$/;

function validateBlockRegistry(pluginId: string, blocks: unknown): void {
  if (blocks === undefined) return;
  const issue = npAnalyzeBlockDefinitions(blocks)[0];
  if (issue) throw new Error(`[plugin:${pluginId}] ${issue.message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function validateHookRegistry(pluginId: string, hooks: unknown): void {
  if (hooks === undefined) return;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error(`[plugin:${pluginId}] hooks must be an object.`);
  }

  for (const [hookName, registration] of Object.entries(hooks)) {
    if (!supportedHookNames.has(hookName)) {
      throw new Error(`[plugin:${pluginId}] unsupported hook "${hookName}".`);
    }
    if (typeof registration === "function") continue;
    if (!registration || typeof registration !== "object" || Array.isArray(registration)) {
      throw new Error(
        `[plugin:${pluginId}] hook "${hookName}" must be a function or registration descriptor.`,
      );
    }

    const descriptor = registration as Record<string, unknown>;
    const unsupportedKey = Object.keys(descriptor).find((key) => !hookDescriptorKeys.has(key));
    if (unsupportedKey) {
      throw new Error(
        `[plugin:${pluginId}] hook "${hookName}" descriptor has unsupported field "${unsupportedKey}".`,
      );
    }
    if (typeof descriptor.handler !== "function") {
      throw new Error(`[plugin:${pluginId}] hook "${hookName}" descriptor requires a handler.`);
    }
    if (
      descriptor.priority !== undefined &&
      (typeof descriptor.priority !== "number" || !Number.isFinite(descriptor.priority))
    ) {
      throw new Error(`[plugin:${pluginId}] hook "${hookName}" priority must be a finite number.`);
    }
    if (
      descriptor.timeoutMs !== undefined &&
      (typeof descriptor.timeoutMs !== "number" ||
        !Number.isFinite(descriptor.timeoutMs) ||
        descriptor.timeoutMs <= 0)
    ) {
      throw new Error(`[plugin:${pluginId}] hook "${hookName}" timeoutMs must be greater than 0.`);
    }
  }
}

function validateRoutePath(pluginId: string, path: unknown): asserts path is string {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`[plugin:${pluginId}] API route path must be a non-empty string.`);
  }
  if (path.length > 256) {
    throw new Error(`[plugin:${pluginId}] API route path must be 256 characters or fewer.`);
  }
  if (!path.startsWith("/") || path === "/") {
    throw new Error(
      `[plugin:${pluginId}] API route path must start with "/" and contain at least one segment.`,
    );
  }
  if (path.endsWith("/") || path.includes("//")) {
    throw new Error(
      `[plugin:${pluginId}] API route path must not contain empty or trailing segments.`,
    );
  }
  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`[plugin:${pluginId}] API route path must not contain dot segments.`);
  }
  if (segments.some((segment) => !routeSegmentPattern.test(segment))) {
    throw new Error(`[plugin:${pluginId}] API route path contains unsupported segment characters.`);
  }
}

function validateRouteRegistry(pluginId: string, routes: unknown): void {
  if (routes === undefined) return;
  if (!Array.isArray(routes)) {
    throw new Error(`[plugin:${pluginId}] routes must be an array.`);
  }

  const seen = new Set<string>();
  for (const [index, route] of routes.entries()) {
    if (!isRecord(route)) {
      throw new Error(
        `[plugin:${pluginId}] API route at index ${index.toString()} must be an object.`,
      );
    }
    const unsupportedKey = Object.keys(route).find((key) => !routeDefinitionKeys.has(key));
    if (unsupportedKey) {
      throw new Error(
        `[plugin:${pluginId}] API route at index ${index.toString()} has unsupported field "${unsupportedKey}".`,
      );
    }
    if (typeof route.method !== "string" || !supportedRouteMethods.has(route.method)) {
      throw new Error(
        `[plugin:${pluginId}] API route method must be one of ${npRouteMethods.join(", ")}.`,
      );
    }
    validateRoutePath(pluginId, route.path);
    if (typeof route.handler !== "function") {
      throw new Error(
        `[plugin:${pluginId}] API route "${route.method} ${route.path}" needs a handler.`,
      );
    }
    if (
      route.description !== undefined &&
      (typeof route.description !== "string" || route.description.trim().length === 0)
    ) {
      throw new Error(
        `[plugin:${pluginId}] API route "${route.method} ${route.path}" description must be non-empty.`,
      );
    }
    if (route.auth !== undefined && typeof route.auth !== "boolean") {
      throw new Error(
        `[plugin:${pluginId}] API route "${route.method} ${route.path}" auth must be boolean.`,
      );
    }

    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) {
      throw new Error(`[plugin:${pluginId}] duplicate API route "${key}".`);
    }
    seen.add(key);
  }
}

function validatePageRouteRegistry(pluginId: string, pageRoutes: unknown): void {
  if (pageRoutes === undefined) return;
  if (!Array.isArray(pageRoutes)) {
    throw new Error(`[plugin:${pluginId}] pageRoutes must be an array.`);
  }

  const patterns = new Set<string>();
  for (const [index, route] of pageRoutes.entries()) {
    const validation = npValidatePluginPageRouteDefinition(route);
    if (!validation.ok) {
      throw new Error(
        `[plugin:${pluginId}] invalid page route at index ${index.toString()}: ${validation.message}`,
      );
    }
    const pattern = (route as { pattern: string }).pattern;
    if (patterns.has(pattern)) {
      throw new Error(`[plugin:${pluginId}] duplicate page route "${pattern}".`);
    }
    patterns.add(pattern);
  }
}

/**
 * Capabilities the host can confidently infer from the plugin's declared
 * surface. We only auto-add ones whose presence is *unambiguous* from the
 * top-level definition — adding more permissive ones (`storage:kv`,
 * `media:write`, `network:fetch`, `content:write`) would require static
 * analysis of `setup` / route handler bodies, which is fragile and risks
 * silently granting privilege the author didn't ask for. So:
 *
 *   - Any `routes: [...]` entry → `api:route`.
 *   - Any `pageRoutes: [...]` entry → `site:route`.
 *   - Any `scheduled: [...]` entry → `hooks:scheduled`.
 *   - Any `hooks: { "<ns>:<event>": ... }` key → `hooks:<ns>`.
 *   - Any declarative admin panel / collection-tab / dashboard-widget
 *     surface → the matching `admin:*` capability.
 *
 * Author-declared capabilities keep their slot and merge with the
 * derived set — listing more (e.g. the always-explicit `storage:kv`
 * for plugins that touch `ctx.storage`) is still required.
 */
function deriveCapabilities(
  definition: NpPluginDefinition<unknown>,
  declared: readonly NpPluginCapability[] | undefined,
): NpPluginCapability[] {
  const set = new Set<NpPluginCapability>(declared ?? []);

  if (definition.routes && definition.routes.length > 0) {
    set.add("api:route");
  }

  for (const hookName of Object.keys(definition.hooks ?? {})) {
    const namespace = hookName.split(":")[0];
    if (!namespace) continue;
    const cap = `hooks:${namespace}` as NpPluginCapability;
    set.add(cap);
  }

  if (definition.pageRoutes && definition.pageRoutes.length > 0) {
    set.add("site:route");
  }

  if (definition.scheduled && definition.scheduled.length > 0) {
    set.add("hooks:scheduled");
  }

  if (definition.admin) {
    const hasPluginPanel =
      definition.admin.settings !== undefined ||
      Boolean(definition.admin.widgets?.length) ||
      Boolean(definition.admin.actions?.length) ||
      Boolean(definition.admin.tables?.length);

    if (hasPluginPanel) {
      set.add("admin:panel");
    }
    if (definition.admin.collectionTabs?.length) {
      set.add("admin:collection-tab");
    }
    if (definition.admin.dashboardWidgets?.length) {
      set.add("admin:dashboard");
    }
  }

  return [...set];
}

/**
 * Reads the surface declared on the plugin definition (`blocks`, `routes`,
 * `hooks`, etc.) and returns the matching `manifest.provides` shape. Used
 * by `definePlugin` to fill in `provides.*` automatically when the author
 * doesn't pass it — the manifest's primary purpose for those arrays is
 * machine-readable cataloging (npm search, the admin Browse panel), and
 * forcing authors to keep two copies of the same list in sync is the
 * #1 boilerplate complaint.
 *
 * Author-supplied entries take precedence: when the manifest already lists
 * an item, we don't duplicate it. Auto-derived entries are appended.
 */
function deriveProvides(
  definition: NpPluginDefinition<unknown>,
  declared:
    | {
        blocks?: readonly string[];
        fields?: readonly string[];
        collections?: readonly string[];
        adminExtensions?: readonly string[];
        actions?: readonly string[];
        apiRoutes?: readonly string[];
        pageRoutes?: readonly string[];
        scheduledTasks?: readonly string[];
        hooks?: readonly string[];
      }
    | undefined,
): {
  blocks: string[];
  fields: string[];
  collections: string[];
  adminExtensions: string[];
  actions: string[];
  apiRoutes: string[];
  pageRoutes: string[];
  scheduledTasks: string[];
  hooks: string[];
} {
  const merge = (declaredArr: readonly string[] | undefined, derived: string[]): string[] => {
    const set = new Set<string>(declaredArr ?? []);
    for (const entry of derived) set.add(entry);
    return [...set];
  };

  const blockTypes = (definition.blocks ?? [])
    .map((b) => b.type)
    .filter((t): t is string => typeof t === "string");
  const routePaths = (definition.routes ?? []).map((r) => `${r.method} ${r.path}`);
  const pageRoutePatterns = (definition.pageRoutes ?? []).map((r) => r.pattern);
  const scheduledTaskIds = (definition.scheduled ?? [])
    .map((task) => task.id)
    .filter((id): id is string => typeof id === "string");
  const hookNames = Object.keys(definition.hooks ?? {});
  // `admin.settings/widgets/actions/tables/collectionTabs/dashboardWidgets`
  // — flatten to the single label "admin" so we don't enumerate every id.
  // Catalog consumers that need detail walk `admin` directly.
  const adminExtensionLabels = definition.admin
    ? [
        ...(definition.admin.settings ? ["settings"] : []),
        ...(definition.admin.widgets?.length ? ["widgets"] : []),
        ...(definition.admin.actions?.length ? ["actions"] : []),
        ...(definition.admin.tables?.length ? ["tables"] : []),
        ...(definition.admin.collectionTabs?.length ? ["collectionTabs"] : []),
        ...(definition.admin.dashboardWidgets?.length ? ["dashboardWidgets"] : []),
      ]
    : [];
  const fieldTypes = (definition.fields ?? [])
    .map((f) => f.type)
    .filter((t): t is string => typeof t === "string");

  return {
    blocks: merge(declared?.blocks, blockTypes),
    fields: merge(declared?.fields, fieldTypes),
    collections: [...(declared?.collections ?? [])],
    adminExtensions: merge(declared?.adminExtensions, adminExtensionLabels),
    actions: merge(declared?.actions, Object.keys(definition.actions ?? {})),
    apiRoutes: merge(declared?.apiRoutes, routePaths),
    pageRoutes: merge(declared?.pageRoutes, pageRoutePatterns),
    scheduledTasks: merge(declared?.scheduledTasks, scheduledTaskIds),
    hooks: merge(declared?.hooks, hookNames),
  };
}

type AdminActionReference = {
  actionId: string;
  expectedKind: NpPluginActionKind | null;
  location: string;
};

function collectAdminActionReferences(admin: NpAdminExtension | undefined): AdminActionReference[] {
  if (!admin) return [];
  const references: AdminActionReference[] = [];
  const addWidgets = (widgets: NpAdminExtension["widgets"], location: string): void => {
    for (const widget of widgets ?? []) {
      references.push({
        actionId: widget.actionId,
        expectedKind: widget.kind,
        location: `${location}.${widget.id}`,
      });
    }
  };
  const addActions = (actions: NpAdminExtension["actions"], location: string): void => {
    for (const action of actions ?? []) {
      // Admin buttons intentionally accept every action kind. Existing
      // plugins commonly share a metric/status handler with a manual button.
      references.push({
        actionId: action.actionId,
        expectedKind: null,
        location: `${location}.${action.id}`,
      });
    }
  };

  addWidgets(admin.widgets, "admin.widgets");
  addActions(admin.actions, "admin.actions");
  for (const table of admin.tables ?? []) {
    references.push({
      actionId: table.rowsActionId,
      expectedKind: "table",
      location: `admin.tables.${table.id}`,
    });
  }
  for (const tab of admin.collectionTabs ?? []) {
    addWidgets(tab.widgets, `admin.collectionTabs.${tab.id}.widgets`);
    addActions(tab.actions, `admin.collectionTabs.${tab.id}.actions`);
  }
  addWidgets(admin.dashboardWidgets, "admin.dashboardWidgets");
  return references;
}

function validateActionRegistry(
  pluginId: string,
  registry: NpPluginActionRegistry<unknown> | undefined,
  admin: NpAdminExtension | undefined,
  hasSetup: boolean,
): void {
  const references = collectAdminActionReferences(admin);
  for (const reference of references) {
    if (reference.actionId === "." || reference.actionId === "..") {
      throw new Error(
        `[plugin:${pluginId}] ${reference.location} uses unsafe action id "${reference.actionId}".`,
      );
    }
  }
  if (registry === undefined && hasSetup) return;

  const validKinds = new Set<NpPluginActionKind>(["action", "metric", "status", "table"]);
  for (const [actionId, definition] of Object.entries(registry ?? {})) {
    if (actionId.length === 0) {
      throw new Error(`[plugin:${pluginId}] action registry contains an empty action id.`);
    }
    if (!definition || typeof definition !== "object") {
      throw new Error(`[plugin:${pluginId}] action "${actionId}" must be an object.`);
    }
    if (!validKinds.has(definition.kind)) {
      throw new Error(
        `[plugin:${pluginId}] action "${actionId}" has unsupported kind "${String(definition.kind)}".`,
      );
    }
    if (typeof definition.handler !== "function") {
      throw new Error(`[plugin:${pluginId}] action "${actionId}" must declare a handler.`);
    }
  }

  for (const reference of references) {
    if (!registry || !Object.hasOwn(registry, reference.actionId)) {
      // A setup callback can still supply this id dynamically. The runtime
      // host validates the completed registration after setup, while static
      // doctor reports the unresolved id as setup-untyped.
      if (hasSetup) continue;
      throw new Error(
        `[plugin:${pluginId}] ${reference.location} references missing action "${reference.actionId}".`,
      );
    }
    const action = registry[reference.actionId];
    if (!action) {
      throw new Error(
        `[plugin:${pluginId}] ${reference.location} references missing action "${reference.actionId}".`,
      );
    }
    if (reference.expectedKind !== null && action.kind !== reference.expectedKind) {
      throw new Error(
        `[plugin:${pluginId}] ${reference.location} expects a ${reference.expectedKind} action, ` +
          `but "${reference.actionId}" is registered as ${action.kind}.`,
      );
    }
  }
}

export function definePlugin<TConfig = Record<string, unknown>>(
  definition: NpPluginDefinition<TConfig>,
): NpResolvedPlugin<TConfig> {
  validateBlockRegistry(definition.manifest.id, definition.blocks);
  validateHookRegistry(definition.manifest.id, definition.hooks);
  validateRouteRegistry(definition.manifest.id, definition.routes);
  validatePageRouteRegistry(definition.manifest.id, definition.pageRoutes);

  // Auto-fill `manifest.provides.*` from the actual surface the plugin
  // contributes. Author-declared entries keep their slot; derived entries
  // append. This collapses the boilerplate floor for a block-only plugin
  // from "list every block twice" to "just declare the blocks array".
  const declaredProvides = (
    definition.manifest as { provides?: Parameters<typeof deriveProvides>[1] }
  ).provides;
  const declaredCaps = (definition.manifest as { capabilities?: readonly NpPluginCapability[] })
    .capabilities;
  const manifestWithDerived = {
    ...definition.manifest,
    provides: deriveProvides(definition as NpPluginDefinition<unknown>, declaredProvides),
    capabilities: deriveCapabilities(definition as NpPluginDefinition<unknown>, declaredCaps),
  };

  const manifest = npPluginManifestSchema.parse(manifestWithDerived);
  if (definition.admin !== undefined) {
    // Structural validation — catches typos in widget kinds, missing
    // actionIds, etc. at plugin-build time rather than runtime render.
    npAdminExtensionSchema.parse(definition.admin);
  }
  validateActionRegistry(
    manifest.id,
    definition.actions as NpPluginActionRegistry<unknown> | undefined,
    definition.admin,
    typeof definition.setup === "function",
  );
  return { ...definition, manifest };
}
