import type { ZodType } from "zod";
import type { NpBlockDefinition, NpPattern } from "@nexpress/blocks";
import type { NpFieldConfig } from "@nexpress/core";

import type { NpPluginManifest, NpPluginManifestResolved } from "./manifest.js";

// Re-export NpBlockDefinition so plugin authors get a single
// import: definePlugin({ blocks: [...] }) typed via the same
// package they reach for everything else.
export type { NpBlockDefinition, NpPattern } from "@nexpress/blocks";

export const npPluginCapabilities = [
  "content:read",
  "content:write",
  "content:delete",
  "media:read",
  "media:write",
  "media:delete",
  "settings:read",
  "settings:write",
  "theme:read",
  "theme:write",
  "admin:panel",
  "admin:dashboard",
  "admin:collection-tab",
  "api:route",
  "site:route",
  "network:fetch",
  "storage:kv",
  "hooks:content",
  "hooks:auth",
  "hooks:render",
  "hooks:scheduled",
  "hooks:media",
] as const;

/**
 * Map from a `ctx.<namespace>.<method>` call to the capability that gates
 * it. Plugin authors and the admin UI both read this — authors to know
 * which capabilities to declare, the admin to render a "this plugin can
 * do X" summary alongside each entry in `/admin/plugins`.
 *
 * Methods that are NOT gated (e.g. `ctx.cache.*`, `ctx.log.*`, `ctx.errors.*`,
 * `ctx.next.*`, `ctx.actions.*`) are deliberately omitted: they're either
 * in-process bookkeeping that costs nothing, or already gated upstream
 * (action dispatch is admin-only at the API layer).
 */
export const npCapabilityToCtxMembers: Readonly<
  Record<NpPluginCapability, readonly string[]>
> = Object.freeze({
  "content:read": ["content.find", "content.findOne", "content.count"],
  "content:write": ["content.create", "content.update"],
  "content:delete": ["content.delete"],
  "media:read": ["media.list", "media.getById", "media.getUrl"],
  "media:write": ["media.upload"],
  "media:delete": ["media.delete"],
  "settings:read": ["settings.getSite"],
  "settings:write": [],
  "theme:read": ["theme.getTokens"],
  "theme:write": ["theme.setTokens"],
  "admin:panel": [],
  "admin:dashboard": [],
  "admin:collection-tab": [],
  "api:route": ["routes[].handler"],
  "site:route": [],
  "network:fetch": ["http.fetch"],
  "storage:kv": ["storage.get", "storage.set", "storage.delete", "storage.list", "storage.has"],
  "hooks:content": ["hooks.content:*"],
  "hooks:auth": ["hooks.auth:*"],
  "hooks:render": ["hooks.render:*"],
  "hooks:scheduled": ["hooks.scheduled:*"],
  "hooks:media": ["hooks.media:*"],
});

export type NpPluginCapability = (typeof npPluginCapabilities)[number];

export const npPluginAgentCategories = [
  "seo",
  "analytics",
  "ecommerce",
  "forms",
  "social",
  "media",
  "security",
  "performance",
  "i18n",
  "email",
  "integration",
  "content",
  "layout",
  "navigation",
  "utility",
] as const;

export type NpPluginAgentCategory = (typeof npPluginAgentCategories)[number];

export const npHookNames = [
  "content:beforeCreate",
  "content:afterCreate",
  "content:beforeUpdate",
  "content:afterUpdate",
  "content:beforeDelete",
  "content:afterDelete",
  "content:beforePublish",
  "content:afterPublish",
  "content:beforeUnpublish",
  "auth:afterLogin",
  "auth:beforeLogout",
  "auth:afterRegister",
  "render:beforePage",
  "render:afterPage",
  "media:beforeUpload",
  "media:afterUpload",
] as const;

export type NpHookName = (typeof npHookNames)[number];

export const npRouteMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type NpRouteMethod = (typeof npRouteMethods)[number];

export interface NpPluginUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Legacy plugin-block declaration shape from a never-implemented
 * design (component-string indirection). Kept around as a type
 * export only — `NpPluginDefinition.blocks` now expects real
 * `NpBlockDefinition[]` from `@nexpress/blocks` so plugins can
 * pass actual render functions.
 *
 * @deprecated Will be removed before 1.0. Use `NpBlockDefinition`.
 */
export interface NpBlockRegistration {
  type: string;
  label: string;
  description?: string;
  component: string;
  propsSchema: Record<string, unknown>;
  thumbnail?: string;
  defaultProps?: Record<string, unknown>;
  usesTokens?: string[];
  styleSlots?: Record<string, string>;
}

export interface NpFieldRegistration {
  type: string;
  label: string;
  component: string;
  cellComponent?: string;
  schema: Record<string, unknown>;
}

/**
 * Declarative admin extension surface for plugins. Plugins describe what
 * they want shown — a settings form, a metric, a button, a table — and
 * the core admin renders it using its own UI primitives. Plugins never
 * ship UI code, so there's no framework coupling, no bundle bloat, and
 * no sandbox problem.
 *
 * Custom / bespoke UI (dashboards, visual editors, live charts) is an
 * explicit non-goal of this API — plugins that need that should serve
 * their own admin page at `/api/plugins/:id/...` and link to it.
 */

/**
 * Plugin settings form. Reuses the same `NpFieldConfig` shape the
 * collection editor renders, so the admin primitives can be used directly
 * via FieldRenderer. Values round-trip through `GET /api/plugins/:id` and
 * `PATCH /api/plugins/:id`.
 */
export interface NpAdminSettingsExtension {
  title?: string;
  description?: string;
  /** Reuses the collection field system — renders via FieldRenderer. */
  fields: NpFieldConfig[];
}

/**
 * Dashboard widget. Admin calls the referenced plugin action and renders
 * the returned value using the `kind`-specific primitive.
 *
 *  - `"metric"`: action returns `{ value: string | number, delta?: string }`.
 *  - `"status"`: action returns `{ level: "ok" | "warn" | "error", message: string }`.
 */
export interface NpAdminWidgetExtension {
  id: string;
  label: string;
  kind: "metric" | "status";
  /** The action id the plugin registered via `ctx.actions.register(actionId, …)`. */
  actionId: string;
  /** Optional help text shown under the widget label. */
  description?: string;
}

/**
 * Button that triggers a plugin action. Optional confirm message; result is
 * surfaced as a toast.
 */
export interface NpAdminActionExtension {
  id: string;
  label: string;
  actionId: string;
  /** Shown in a confirmation dialog before dispatch. Omit to skip confirm. */
  confirm?: string;
  description?: string;
}

/**
 * Read-only data table. Admin calls the action to populate rows; the action
 * returns `{ rows, total }` where each row matches the column keys.
 */
export interface NpAdminTableExtension {
  id: string;
  label: string;
  columns: Array<{ name: string; label: string }>;
  /** Action that returns `{ rows: Record<string, unknown>[], total: number }`. */
  rowsActionId: string;
  emptyMessage?: string;
}

/**
 * Per-document sidebar Card injected into the collection edit view.
 * Reuses the widget / action kinds from the plugin admin page but scoped
 * to the currently-edited document — admin passes `{ collection, documentId }`
 * in the action dispatch body so plugins can compute per-doc metrics or
 * act on the current doc.
 *
 * `collections: "*"` shows the tab on every collection. Use sparingly.
 */
export interface NpCollectionTabExtension {
  id: string;
  label: string;
  collections: string[] | "*";
  widgets?: NpAdminWidgetExtension[];
  actions?: NpAdminActionExtension[];
  description?: string;
}

/**
 * Widget surfaced on the global `/admin` dashboard. Same shape as a plugin
 * admin page widget, but the admin aggregates `dashboardWidgets` from every
 * registered plugin into one strip. The referenced action is dispatched with
 * an empty payload — dashboard widgets are global, not per-document.
 *
 * Requires the `admin:dashboard` capability.
 */
export interface NpAdminDashboardWidgetExtension extends NpAdminWidgetExtension {
  /**
   * Optional ordering hint when multiple plugins contribute widgets. Lower
   * numbers render first. Plugins without a priority fall to the end in
   * registration order.
   */
  priority?: number;
}

export interface NpAdminExtension {
  settings?: NpAdminSettingsExtension;
  widgets?: NpAdminWidgetExtension[];
  actions?: NpAdminActionExtension[];
  tables?: NpAdminTableExtension[];
  collectionTabs?: NpCollectionTabExtension[];
  dashboardWidgets?: NpAdminDashboardWidgetExtension[];
}

/**
 * Declarative page-render contribution returned by a `render:beforePage`
 * hook. The host collects contributions from every plugin that handles
 * the hook, flattens them, and renders the tags as real DOM elements via
 * React 19 head hoisting. Plugins don't render React directly — they
 * describe what should appear, and the host emits it.
 *
 * Use cases: SEO meta tags, canonical URLs, JSON-LD, analytics scripts,
 * third-party widget loaders. For anything richer (inline components,
 * interactive widgets), plugins should ship a block instead.
 *
 * SECURITY NOTE: `attrs` values and `children` are rendered into markup
 * with React's default escaping for attributes/text, but `<script>`
 * `children` is injected as an inline script body. Plugins are trusted
 * code in v1 — review them before installing.
 */
export interface NpRenderContribution {
  /** Tags hoisted into `<head>` — meta, link, script, style. */
  head?: NpHeadEntry[];
  /** Tags appended just before `</body>` — typically analytics scripts. */
  bodyEnd?: NpBodyEntry[];
}

export type NpHeadEntry =
  | { tag: "meta"; attrs: Record<string, string> }
  | { tag: "link"; attrs: Record<string, string> }
  | { tag: "script"; attrs?: Record<string, string>; children?: string }
  | { tag: "style"; attrs?: Record<string, string>; children: string };

export type NpBodyEntry =
  | { tag: "script"; attrs?: Record<string, string>; children?: string }
  | { tag: "noscript"; children: string };

/**
 * Data passed to `render:beforePage` handlers. `document` is the resolved
 * page/post record the request is about to render. `collection` is the
 * registered collection slug (e.g. `"pages"`, `"posts"`). `slug` is the
 * URL path slug the renderer resolved it from.
 */
export interface NpRenderHookData {
  collection: string;
  slug: string;
  document: Record<string, unknown>;
}

export interface NpContentFilterOperator {
  equals?: unknown;
  notEquals?: unknown;
  in?: unknown[];
  notIn?: unknown[];
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  exists?: boolean;
  gt?: number | string | Date;
  gte?: number | string | Date;
  lt?: number | string | Date;
  lte?: number | string | Date;
}

export interface NpContentWhere {
  and?: NpContentWhere[];
  or?: NpContentWhere[];
  // Index signature is deliberately broad: plugins may pass direct values
  // (string, number, Date, etc.) alongside the structured operators.
  [field: string]: unknown;
}

export interface NpContentQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  select?: string[];
  where?: NpContentWhere;
  draft?: boolean;
}

export interface NpContentItem {
  id: string;
  collection?: string;
  slug?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface NpContentResult {
  docs: NpContentItem[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface NpImageTransform {
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  quality?: number;
  format?: "webp" | "avif" | "jpeg" | "png";
}

export interface NpMediaQuery {
  page?: number;
  limit?: number;
  search?: string;
  mimeType?: string;
  folder?: string;
  tags?: string[];
}

export interface NpMediaItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url?: string;
  alt?: string;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface NpMediaResult {
  docs: NpMediaItem[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface NpMediaUpload {
  filename: string;
  mimeType: string;
  alt?: string;
  folder?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface NpReadableStreamLike<T = Uint8Array> extends AsyncIterable<T> {
  cancel?(reason?: unknown): Promise<void>;
}

export type NpUploadInput = Uint8Array | ArrayBuffer | NpReadableStreamLike<Uint8Array>;

export type NpFetchBody =
  | string
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | Record<string, unknown>
  | null;

export interface NpFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: NpFetchBody;
  timeoutMs?: number;
}

export interface NpFetchResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

export type NpSiteSettings = Record<string, unknown>;

export type NpThemeTokens = Record<string, string | number>;

export interface NpRouteRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  user?: NpPluginUser;
}

export interface NpRouteResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type NpActionHandler<TConfig = Record<string, unknown>> = (
  data: unknown,
  ctx: NpPluginContext<TConfig>,
) => Promise<NpActionResult>;

export interface NpActionResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface NpPluginContext<TConfig = Record<string, unknown>> {
  readonly pluginId: string;
  readonly config: Readonly<TConfig>;
  readonly capabilities: readonly NpPluginCapability[];
  readonly content: {
    find(collection: string, query?: NpContentQuery): Promise<NpContentResult>;
    findOne(collection: string, id: string): Promise<NpContentItem | null>;
    create(collection: string, data: Record<string, unknown>): Promise<NpContentItem>;
    update(collection: string, id: string, data: Record<string, unknown>): Promise<NpContentItem>;
    delete(collection: string, id: string): Promise<void>;
    count(collection: string, where?: NpContentWhere): Promise<number>;
  };
  readonly media: {
    list(query?: NpMediaQuery): Promise<NpMediaResult>;
    getById(id: string): Promise<NpMediaItem | null>;
    getUrl(id: string, transform?: NpImageTransform): Promise<string>;
    upload(file: NpUploadInput, metadata: NpMediaUpload): Promise<NpMediaItem>;
    delete(id: string): Promise<void>;
  };
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options?: { ttl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
    has(key: string): Promise<boolean>;
  };
  readonly settings: {
    getSite(): Promise<NpSiteSettings>;
    getPlugin(): Promise<TConfig>;
    setPlugin(data: Partial<TConfig>): Promise<void>;
  };
  readonly theme: {
    getTokens(): Promise<NpThemeTokens>;
    setTokens(tokens: Partial<NpThemeTokens>): Promise<void>;
  };
  readonly http: {
    fetch(url: string, options?: NpFetchOptions): Promise<NpFetchResponse>;
  };
  readonly log: {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
  };
  /**
   * Forwards an error to the host's installed error reporter (Sentry, Bugsnag,
   * etc.) with `pluginId` automatically tagged. The host already auto-reports
   * thrown hook handlers, so use this only when you *catch* an error
   * internally (e.g. a non-fatal upstream failure you log but recover from).
   */
  readonly errors: {
    report(
      error: unknown,
      context?: {
        extra?: Record<string, unknown>;
        tags?: Record<string, string>;
        user?: { id?: string; email?: string; role?: string };
      },
    ): Promise<void>;
  };
  readonly cache: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, ttl?: number): Promise<void>;
    invalidate(key: string): Promise<void>;
    invalidateAll(): Promise<void>;
  };
  readonly next: {
    revalidatePath(path: string): Promise<void>;
    revalidateTag(tag: string): Promise<void>;
  };
  readonly actions: {
    register(actionName: string, handler: NpActionHandler<TConfig>): void;
    dispatch(pluginId: string, actionName: string, data?: unknown): Promise<NpActionResult>;
  };
}

export interface NpHookContext<TConfig = Record<string, unknown>> {
  hook: string;
  data: Record<string, unknown>;
  collection?: string;
  user?: NpPluginUser;
  ctx: NpPluginContext<TConfig>;
}

export type NpHookHandler<TConfig = Record<string, unknown>> =
  | ((ctx: NpHookContext<TConfig>) => unknown)
  | string;

/**
 * Object form of a hook registration: lets a plugin pick a non-default
 * priority and / or per-handler timeout while still using the same handler
 * signature as the plain-function form.
 *
 * - `priority` — lower runs first, default 100. Use `<100` to mutate the
 *   payload before observers run, `>100` to react after the dust has settled.
 * - `timeoutMs` — when set, the host treats a handler that doesn't settle in
 *   time as a failure (logged + reported, then skipped). Untouched payload.
 */
export interface NpHookRegistrationDescriptor<TConfig = Record<string, unknown>> {
  handler: NpHookHandler<TConfig>;
  priority?: number;
  timeoutMs?: number;
}

export type NpHookRegistration<TConfig = Record<string, unknown>> = Partial<
  Record<NpHookName, NpHookHandler<TConfig> | NpHookRegistrationDescriptor<TConfig>>
>;

export type NpRouteHandler<TConfig = Record<string, unknown>> = (
  req: NpRouteRequest,
  ctx: NpPluginContext<TConfig>,
) => Promise<NpRouteResponse>;

export interface NpRouteRegistration<TConfig = Record<string, unknown>> {
  path: string;
  method: NpRouteMethod;
  handler: NpRouteHandler<TConfig> | string;
  description?: string;
  auth?: boolean;
}

export interface NpScheduledTask<TConfig = Record<string, unknown>> {
  id: string;
  cron: string;
  handler: ((ctx: NpPluginContext<TConfig>) => void | Promise<void>) | string;
  description?: string;
}

export interface NpPluginDefinition<TConfig = Record<string, unknown>> {
  manifest: NpPluginManifest;
  /**
   * Block definitions the plugin contributes. Registered into the
   * shared block registry by the bootstrap so they appear in the
   * admin's Add-block popover and resolve correctly during the
   * server render. Each block ships its real `render` function
   * (no string indirection). See `@nexpress/blocks` for the shape.
   */
  blocks?: NpBlockDefinition[];
  /**
   * Page-builder patterns the plugin contributes. Registered into
   * the shared pattern registry by the bootstrap so they show up
   * in the editor's command-menu pattern picker alongside built-in
   * and operator-saved patterns. Each pattern is a pre-shaped
   * subtree (`NpBlockInstance[]`) — see `@nexpress/blocks`'s
   * `NpPattern` shape. Wire format = page-builder tree state, so
   * plugin authors can copy a saved-pattern JSON straight in.
   */
  patterns?: NpPattern[];
  fields?: NpFieldRegistration[];
  admin?: NpAdminExtension;
  hooks?: NpHookRegistration<TConfig>;
  routes?: NpRouteRegistration<TConfig>[];
  scheduled?: NpScheduledTask<TConfig>[];
  configSchema?: ZodType<TConfig>;
  setup?: (ctx: NpPluginContext<TConfig>) => void | Promise<void>;
  teardown?: () => void | Promise<void>;
  /**
   * Phase 12.5 — UI string bundles per locale. Plugin
   * authors register keys here and call `t(key, locale)`
   * from their templates / routes. Bundles merge into the
   * global registry at boot; later plugins overwrite earlier
   * ones on key collision so plugin-order in the config
   * drives override priority.
   *
   *   i18n: {
   *     en: { "forum.replyButton": "Reply" },
   *     ko: { "forum.replyButton": "답글" },
   *   }
   */
  i18n?: Record<string, Record<string, string>>;
  /**
   * Phase 14.5 — page templates the plugin contributes to
   * the shared template registry. Same shape as a theme's
   * `impl.templates`: keyed by collection slug, then by
   * template id, with `{ label, description?, component }`
   * values. The plugin host merges these at boot so admin
   * pickers and the catch-all see them. Theme entries win
   * id collisions — the active theme is the design authority
   * for the site, plugins are baseline / alternates.
   *
   *   templates: {
   *     pages: {
   *       docs: {
   *         label: "Documentation",
   *         description: "Sidebar TOC + prev/next nav",
   *         component: DocsTemplate,
   *       },
   *     },
   *   }
   */
  templates?: Record<string, Record<string, unknown>>;
}

export type NpResolvedPlugin<TConfig = Record<string, unknown>> = Omit<
  NpPluginDefinition<TConfig>,
  "manifest"
> & {
  /**
   * Post-parse manifest with every default applied. `definePlugin()`
   * runs the manifest through Zod, so by the time the host receives a
   * resolved plugin every optional-with-default field
   * (`capabilities`, `provides`, `agent`, `usesTokens`, `styleSlots`,
   * etc.) is populated. The author-facing `NpPluginManifest` keeps the
   * input shape where those fields are optional.
   */
  manifest: NpPluginManifestResolved;
};
