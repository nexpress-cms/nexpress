import type { ZodType } from "zod";
import type { NxFieldConfig } from "@nexpress/core";

import type { NxPluginManifest } from "./manifest.js";

export const nxPluginCapabilities = [
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
] as const;

export type NxPluginCapability = (typeof nxPluginCapabilities)[number];

export const nxPluginAgentCategories = [
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

export type NxPluginAgentCategory = (typeof nxPluginAgentCategories)[number];

export const nxHookNames = [
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

export type NxHookName = (typeof nxHookNames)[number];

export const nxRouteMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type NxRouteMethod = (typeof nxRouteMethods)[number];

export interface NxPluginUser {
  id: string;
  email: string;
  role: string;
}

export interface NxBlockRegistration {
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

export interface NxFieldRegistration {
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
 * Plugin settings form. Reuses the same `NxFieldConfig` shape the
 * collection editor renders, so the admin primitives can be used directly
 * via FieldRenderer. Values round-trip through `GET /api/plugins/:id` and
 * `PATCH /api/plugins/:id`.
 */
export interface NxAdminSettingsExtension {
  title?: string;
  description?: string;
  /** Reuses the collection field system — renders via FieldRenderer. */
  fields: NxFieldConfig[];
}

/**
 * Dashboard widget. Admin calls the referenced plugin action and renders
 * the returned value using the `kind`-specific primitive.
 *
 *  - `"metric"`: action returns `{ value: string | number, delta?: string }`.
 *  - `"status"`: action returns `{ level: "ok" | "warn" | "error", message: string }`.
 */
export interface NxAdminWidgetExtension {
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
export interface NxAdminActionExtension {
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
export interface NxAdminTableExtension {
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
export interface NxCollectionTabExtension {
  id: string;
  label: string;
  collections: string[] | "*";
  widgets?: NxAdminWidgetExtension[];
  actions?: NxAdminActionExtension[];
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
export interface NxAdminDashboardWidgetExtension extends NxAdminWidgetExtension {
  /**
   * Optional ordering hint when multiple plugins contribute widgets. Lower
   * numbers render first. Plugins without a priority fall to the end in
   * registration order.
   */
  priority?: number;
}

export interface NxAdminExtension {
  settings?: NxAdminSettingsExtension;
  widgets?: NxAdminWidgetExtension[];
  actions?: NxAdminActionExtension[];
  tables?: NxAdminTableExtension[];
  collectionTabs?: NxCollectionTabExtension[];
  dashboardWidgets?: NxAdminDashboardWidgetExtension[];
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
export interface NxRenderContribution {
  /** Tags hoisted into `<head>` — meta, link, script, style. */
  head?: NxHeadEntry[];
  /** Tags appended just before `</body>` — typically analytics scripts. */
  bodyEnd?: NxBodyEntry[];
}

export type NxHeadEntry =
  | { tag: "meta"; attrs: Record<string, string> }
  | { tag: "link"; attrs: Record<string, string> }
  | { tag: "script"; attrs?: Record<string, string>; children?: string }
  | { tag: "style"; attrs?: Record<string, string>; children: string };

export type NxBodyEntry =
  | { tag: "script"; attrs?: Record<string, string>; children?: string }
  | { tag: "noscript"; children: string };

/**
 * Data passed to `render:beforePage` handlers. `document` is the resolved
 * page/post record the request is about to render. `collection` is the
 * registered collection slug (e.g. `"pages"`, `"posts"`). `slug` is the
 * URL path slug the renderer resolved it from.
 */
export interface NxRenderHookData {
  collection: string;
  slug: string;
  document: Record<string, unknown>;
}

export interface NxContentFilterOperator {
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

export interface NxContentWhere {
  and?: NxContentWhere[];
  or?: NxContentWhere[];
  // Index signature is deliberately broad: plugins may pass direct values
  // (string, number, Date, etc.) alongside the structured operators.
  [field: string]: unknown;
}

export interface NxContentQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  select?: string[];
  where?: NxContentWhere;
  draft?: boolean;
}

export interface NxContentItem {
  id: string;
  collection?: string;
  slug?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface NxContentResult {
  docs: NxContentItem[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface NxImageTransform {
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  quality?: number;
  format?: "webp" | "avif" | "jpeg" | "png";
}

export interface NxMediaQuery {
  page?: number;
  limit?: number;
  search?: string;
  mimeType?: string;
  folder?: string;
  tags?: string[];
}

export interface NxMediaItem {
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

export interface NxMediaResult {
  docs: NxMediaItem[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface NxMediaUpload {
  filename: string;
  mimeType: string;
  alt?: string;
  folder?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface NxReadableStreamLike<T = Uint8Array> extends AsyncIterable<T> {
  cancel?(reason?: unknown): Promise<void>;
}

export type NxUploadInput = Uint8Array | ArrayBuffer | NxReadableStreamLike<Uint8Array>;

export type NxFetchBody =
  | string
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | Record<string, unknown>
  | null;

export interface NxFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: NxFetchBody;
  timeoutMs?: number;
}

export interface NxFetchResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

export type NxSiteSettings = Record<string, unknown>;

export type NxThemeTokens = Record<string, string | number>;

export interface NxRouteRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  user?: NxPluginUser;
}

export interface NxRouteResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type NxActionHandler<TConfig = Record<string, unknown>> = (
  data: unknown,
  ctx: NxPluginContext<TConfig>,
) => Promise<NxActionResult>;

export interface NxActionResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface NxPluginContext<TConfig = Record<string, unknown>> {
  readonly pluginId: string;
  readonly config: Readonly<TConfig>;
  readonly capabilities: readonly NxPluginCapability[];
  readonly content: {
    find(collection: string, query?: NxContentQuery): Promise<NxContentResult>;
    findOne(collection: string, id: string): Promise<NxContentItem | null>;
    create(collection: string, data: Record<string, unknown>): Promise<NxContentItem>;
    update(collection: string, id: string, data: Record<string, unknown>): Promise<NxContentItem>;
    delete(collection: string, id: string): Promise<void>;
    count(collection: string, where?: NxContentWhere): Promise<number>;
  };
  readonly media: {
    list(query?: NxMediaQuery): Promise<NxMediaResult>;
    getById(id: string): Promise<NxMediaItem | null>;
    getUrl(id: string, transform?: NxImageTransform): Promise<string>;
    upload(file: NxUploadInput, metadata: NxMediaUpload): Promise<NxMediaItem>;
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
    getSite(): Promise<NxSiteSettings>;
    getPlugin(): Promise<TConfig>;
    setPlugin(data: Partial<TConfig>): Promise<void>;
  };
  readonly theme: {
    getTokens(): Promise<NxThemeTokens>;
    setTokens(tokens: Partial<NxThemeTokens>): Promise<void>;
  };
  readonly http: {
    fetch(url: string, options?: NxFetchOptions): Promise<NxFetchResponse>;
  };
  readonly log: {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
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
    register(actionName: string, handler: NxActionHandler<TConfig>): void;
    dispatch(pluginId: string, actionName: string, data?: unknown): Promise<NxActionResult>;
  };
}

export interface NxHookContext<TConfig = Record<string, unknown>> {
  hook: string;
  data: Record<string, unknown>;
  collection?: string;
  user?: NxPluginUser;
  ctx: NxPluginContext<TConfig>;
}

export type NxHookHandler<TConfig = Record<string, unknown>> =
  | ((ctx: NxHookContext<TConfig>) => unknown | Promise<unknown>)
  | string;

export type NxHookRegistration<TConfig = Record<string, unknown>> = Partial<
  Record<NxHookName, NxHookHandler<TConfig>>
>;

export type NxRouteHandler<TConfig = Record<string, unknown>> = (
  req: NxRouteRequest,
  ctx: NxPluginContext<TConfig>,
) => Promise<NxRouteResponse>;

export interface NxRouteRegistration<TConfig = Record<string, unknown>> {
  path: string;
  method: NxRouteMethod;
  handler: NxRouteHandler<TConfig> | string;
  description?: string;
  auth?: boolean;
}

export interface NxScheduledTask<TConfig = Record<string, unknown>> {
  id: string;
  cron: string;
  handler: ((ctx: NxPluginContext<TConfig>) => void | Promise<void>) | string;
  description?: string;
}

export interface NxPluginDefinition<TConfig = Record<string, unknown>> {
  manifest: NxPluginManifest;
  blocks?: NxBlockRegistration[];
  fields?: NxFieldRegistration[];
  admin?: NxAdminExtension;
  hooks?: NxHookRegistration<TConfig>;
  routes?: NxRouteRegistration<TConfig>[];
  scheduled?: NxScheduledTask<TConfig>[];
  configSchema?: ZodType<TConfig>;
  setup?: (ctx: NxPluginContext<TConfig>) => void | Promise<void>;
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

export type NxResolvedPlugin<TConfig = Record<string, unknown>> = Omit<
  NxPluginDefinition<TConfig>,
  "manifest"
> & {
  manifest: NxPluginManifest;
};
