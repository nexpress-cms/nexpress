# NexPress Plugin System Design

> Version: 0.1 (Draft)
> Date: 2026-04-17
> Status: Design phase — no code written yet
> Prerequisites: nexpress.txt (planning doc v3), EmDash CMS analysis, Oracle architecture consultations

---

## Table of Contents

1. [Stage 1 MVP Plugin Contract](#1-stage-1-mvp-plugin-contract)
2. [Self-hosted Isolation Technology Selection](#2-self-hosted-isolation-technology-selection)
3. [Bridge Pattern for Next.js RSC](#3-bridge-pattern-for-nextjs-rsc)
4. [Declarative UI for Sandboxed Plugins](#4-declarative-ui-for-sandboxed-plugins)
5. [Static Analysis Tool Spec](#5-static-analysis-tool-spec)

---

## 1. Stage 1 MVP Plugin Contract

### 1.1 Design Principles

- **Declarative-first**: Plugin capabilities are described in a manifest, not discovered at runtime
- **Agent-readable**: Every manifest field has a machine-interpretable schema + natural language description
- **Render/Effect split**: React components (Render) and server logic (Effect) are separate entry points
- **Namespace isolation**: All plugin resources (routes, cache keys, DB tables, CSS layers) are prefixed
- **Forward-compatible**: Stage 1 manifest is a subset of Stage 2/3; adding capabilities never breaks

### 1.1.1 v1 Plugin Execution Model (CRITICAL)

```
┌─────────────────────────────────────────────────────────────────────┐
│ v1 Plugin = npm package + rebuild                                   │
│                                                                     │
│ Installing a plugin IS a code change:                               │
│   1. pnpm add @nexpress/plugin-seo                                  │
│   2. Add to nexpress.config.ts plugins array                        │
│   3. If plugin adds collections/fields: pnpm db:generate + migrate  │
│   4. pnpm build (or restart dev server)                             │
│                                                                     │
│ There is NO runtime plugin installation in v1.                      │
│ There is NO plugin marketplace / hot-reload / dynamic loading.      │
│                                                                     │
│ This is intentional:                                                │
│   - Core CMS is a build-time codegen model                          │
│   - DB schema, types, API routes are all generated at build time    │
│   - A plugin that adds a collection MUST go through the same        │
│     codegen pipeline as user-defined collections                    │
│                                                                     │
│ What plugins CAN do at runtime (without rebuild):                   │
│   ✓ hooks (beforeCreate, afterPublish, etc.)                        │
│   ✓ actions (custom API handlers registered at setup)               │
│   ✓ widgets (declarative UI via NxWidget — no custom React)         │
│   ✓ scheduled tasks (registered at startup, executed by worker)     │
│                                                                     │
│ What plugins CANNOT do at runtime:                                  │
│   ✗ Add/modify collections or fields (requires codegen + migrate)   │
│   ✗ Add new page.tsx routes (requires build)                        │
│   ✗ Modify DB schema                                                │
│                                                                     │
│ Escalation: "Install plugin without rebuild" requires a             │
│ fundamentally different architecture (see Section 2/3 for future).  │
└─────────────────────────────────────────────────────────────────────┘
```

**Trust model**: v1 plugins run **in-process with full Node.js access**. A trusted plugin is equivalent to arbitrary code execution in your CMS process. This is the same model as Payload CMS, WordPress, and most self-hosted CMS platforms. Stage 2/3 (capability enforcement, isolated-vm) mitigate this for untrusted plugins — but v1 does not promise sandboxing.

**User-facing security warning** (MUST appear in plugin installation docs and Admin UI plugin page):

> ⚠️ **v1 plugins run with the same permissions as the NexPress core.** Only install plugins from authors you trust. A malicious plugin can read your database, access environment variables, and execute arbitrary code. Third-party plugin sandboxing is planned for a future release.

### 1.2 Capability Enum

```typescript
/**
 * Plugin capabilities — what a plugin declares it needs access to.
 * Stage 1: Declared in manifest, enforced by static analysis (lint warnings).
 * Stage 2: Enforced at runtime by host service layer.
 * Stage 3: Enforced at isolation boundary (bridge).
 */
export type NxPluginCapability =
  // Content operations
  | "content:read" // Read content from collections
  | "content:write" // Create/update content
  | "content:delete" // Delete content

  // Media operations
  | "media:read" // Read/list media files
  | "media:write" // Upload media
  | "media:delete" // Delete media

  // User operations (sensitive)
  | "users:read" // Read user profiles
  | "users:write" // Modify user data

  // Site settings
  | "settings:read" // Read site configuration
  | "settings:write" // Modify site configuration

  // Theme
  | "theme:read" // Read design tokens
  | "theme:write" // Modify design tokens

  // Admin UI extension
  | "admin:panel" // Register admin sidebar panels
  | "admin:dashboard" // Add dashboard widgets
  | "admin:collection-tab" // Add tabs to collection edit views

  // Routing
  | "api:route" // Register API route handlers
  | "site:route" // Register public site routes

  // Network
  | "network:fetch" // Make outbound HTTP requests

  // Plugin-scoped storage
  | "storage:kv" // Key-value storage for plugin state

  // Lifecycle hooks
  | "hooks:content" // Content lifecycle hooks (beforeCreate, afterPublish, etc.)
  | "hooks:auth" // Auth lifecycle hooks (afterLogin, beforeLogout, etc.)
  | "hooks:render" // Render pipeline hooks (beforeRender, afterRender)
  | "hooks:scheduled"; // Cron/scheduled task hooks
```

### 1.3 Plugin Manifest Schema

```typescript
import { z } from "zod";

/**
 * Static plugin manifest — shipped with the npm package.
 * JSON-serializable, validated at install time.
 */
export const nxPluginManifestSchema = z.object({
  /** Unique plugin ID. Convention: "@scope/plugin-name" or "plugin-name" */
  id: z.string().regex(/^(@[\w-]+\/)?[\w-]+$/),

  /** Plugin version (semver) */
  version: z.string().regex(/^\d+\.\d+\.\d+/),

  /** Human-readable plugin name */
  name: z.string().min(1).max(100),

  /** Short description (1-2 sentences) */
  description: z.string().min(1).max(500),

  /** Author information */
  author: z.object({
    name: z.string(),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  }),

  /** License identifier (SPDX) */
  license: z.string(),

  /** NexPress compatibility */
  nexpress: z.object({
    /** Minimum NexPress version required */
    minVersion: z.string(),
    /** Maximum NexPress version supported (optional) */
    maxVersion: z.string().optional(),
  }),

  /** Required capabilities */
  capabilities: z.array(
    z.enum([
      "content:read",
      "content:write",
      "content:delete",
      "media:read",
      "media:write",
      "media:delete",
      "users:read",
      "users:write",
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
    ]),
  ),

  /** Allowed external hosts for network:fetch (wildcards: *.example.com) */
  allowedHosts: z.array(z.string()).default([]),

  /** What this plugin provides (for registry/discovery) */
  provides: z
    .object({
      /** Block type IDs */
      blocks: z.array(z.string()).default([]),
      /** Custom field type IDs */
      fields: z.array(z.string()).default([]),
      /** Collection slugs this plugin creates */
      collections: z.array(z.string()).default([]),
      /** Admin panel extension IDs */
      adminExtensions: z.array(z.string()).default([]),
      /** API route paths */
      apiRoutes: z.array(z.string()).default([]),
      /** Root-level site route paths exposed through generated rewrites */
      siteRoutes: z.array(z.string()).default([]),
      /** Hook names this plugin listens to */
      hooks: z.array(z.string()).default([]),
    })
    .default({}),

  /** Agent-readable metadata */
  agent: z.object({
    /** Extended description for AI agents (what this plugin does, when to use it) */
    description: z.string(),
    /** Plugin category */
    category: z.enum([
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
    ]),
    /** Searchable tags */
    tags: z.array(z.string()).default([]),
    /** JSON Schema for plugin configuration */
    configSchema: z.record(z.unknown()).optional(),
  }),

  /** Design tokens this plugin's blocks use */
  usesTokens: z.array(z.string()).default([]),

  /** CSS class slots for theme override (slot name → description) */
  styleSlots: z.record(z.string()).default({}),
});

export type NxPluginManifest = z.infer<typeof nxPluginManifestSchema>;
```

### 1.4 definePlugin() API

```typescript
/**
 * Plugin definition — the main entry point for plugin authors.
 * Combines static manifest with runtime registration.
 *
 * Usage:
 *   // plugins/my-plugin/src/index.ts
 *   import { definePlugin } from "@nexpress/plugin-sdk";
 *   export default definePlugin({ ... });
 */
export function definePlugin<TConfig = Record<string, unknown>>(
  definition: NxPluginDefinition<TConfig>,
): NxResolvedPlugin<TConfig>;

/**
 * Full plugin definition.
 */
export interface NxPluginDefinition<TConfig = Record<string, unknown>> {
  /** Plugin manifest (static metadata) */
  manifest: NxPluginManifest;

  // ─── Render: React Components ──────────────────────────────

  /**
   * Block components this plugin provides.
   * These render in the public site's React tree (RSC or Client).
   */
  blocks?: NxBlockRegistration[];

  /**
   * Custom field type components for the admin editor.
   */
  fields?: NxFieldRegistration[];

  /**
   * Admin UI extensions (panels, tabs, dashboard widgets).
   * Components are referenced by path string (Payload pattern)
   * so they can be code-split and loaded on demand.
   */
  admin?: NxAdminExtension;

  // ─── Effect: Server Logic ──────────────────────────────────

  /**
   * Content lifecycle hooks.
   * In Stage 1-2: run in-process.
   * In Stage 3: can be isolated to worker/isolate.
   */
  hooks?: NxHookRegistration;

  /**
   * Plugin route handlers.
   * API routes mount at /api/plugins/{pluginId}/...
   * Site routes are validated and exposed through root-level rewrites.
   */
  routes?: NxRouteRegistration[];

  /**
   * Scheduled tasks (cron).
   */
  scheduled?: NxScheduledTask[];

  /**
   * Plugin configuration schema (what site admin configures).
   * Validated with Zod at runtime.
   */
  configSchema?: z.ZodType<TConfig>;

  /**
   * Plugin lifecycle: called once when plugin is loaded.
   * Receives scoped context — the only way to access NexPress services.
   */
  setup?: (ctx: NxPluginContext<TConfig>) => void | Promise<void>;

  /**
   * Plugin lifecycle: called when plugin is unloaded.
   */
  teardown?: () => void | Promise<void>;
}

// ─── Block Registration ────────────────────────────────────

export interface NxBlockRegistration {
  /** Block type ID. Namespaced: "pluginId:blockType" at runtime. */
  type: string;
  /** Human-readable label */
  label: string;
  /** Description for agents */
  description?: string;
  /**
   * Path to React component.
   * - RSC-safe component: "./blocks/MyBlock" (server component)
   * - Client component: "./blocks/MyBlock" with 'use client' directive
   */
  component: string;
  /** JSON Schema for block props (validated at save time, readable by agents) */
  propsSchema: Record<string, unknown>;
  /** Preview thumbnail path (optional) */
  thumbnail?: string;
  /** Default props */
  defaultProps?: Record<string, unknown>;
  /** Which design tokens this block uses */
  usesTokens?: string[];
  /** CSS class slots for fine-grained theme override */
  styleSlots?: Record<string, string>;
}

// ─── Field Registration ────────────────────────────────────

export interface NxFieldRegistration {
  /** Field type ID */
  type: string;
  /** Human-readable label */
  label: string;
  /**
   * Admin editor component path (must be client component for interactivity).
   * Pattern: "./fields/MyField" → resolved to "plugin-package/client#MyField"
   */
  component: string;
  /**
   * RSC cell component for list views (optional).
   * Pattern: "./fields/MyFieldCell" → resolved to "plugin-package/rsc#MyFieldCell"
   */
  cellComponent?: string;
  /** Field data schema */
  schema: Record<string, unknown>;
}

// ─── Admin Extension ───────────────────────────────────────

export interface NxAdminExtension {
  /** Sidebar panels */
  panels?: Array<{
    id: string;
    label: string;
    /** Component path: "./admin/MyPanel" */
    component: string;
    icon?: string;
    position?: "top" | "bottom";
  }>;

  /** Dashboard widgets */
  dashboardWidgets?: Array<{
    id: string;
    label: string;
    component: string;
    /** Grid size hint */
    size?: "small" | "medium" | "large";
  }>;

  /** Tabs added to collection edit views */
  collectionTabs?: Array<{
    id: string;
    label: string;
    component: string;
    /** Which collections: "*" for all, or specific slugs */
    collections: string[] | "*";
  }>;

  /** Components injected before/after specific admin slots */
  injections?: {
    beforeDashboard?: string[];
    afterDashboard?: string[];
    beforeLogin?: string[];
    afterLogin?: string[];
  };
}

// ─── Hook Registration ─────────────────────────────────────

export interface NxHookRegistration {
  /**
   * Content lifecycle hooks.
   * Each key is a hook name, value is handler function or path string.
   *
   * In Stage 1 (in-process): direct function reference.
   * In Stage 3 (isolated): path string to handler file.
   */
  "content:beforeCreate"?: NxHookHandler;
  "content:afterCreate"?: NxHookHandler;
  "content:beforeUpdate"?: NxHookHandler;
  "content:afterUpdate"?: NxHookHandler;
  "content:beforeDelete"?: NxHookHandler;
  "content:afterDelete"?: NxHookHandler;
  "content:beforePublish"?: NxHookHandler;
  "content:afterPublish"?: NxHookHandler;
  "content:beforeUnpublish"?: NxHookHandler;

  /** Auth hooks */
  "auth:afterLogin"?: NxHookHandler;
  "auth:beforeLogout"?: NxHookHandler;
  "auth:afterRegister"?: NxHookHandler;

  /** Render hooks */
  "render:beforePage"?: NxHookHandler;
  "render:afterPage"?: NxHookHandler;

  /** Media hooks */
  "media:beforeUpload"?: NxHookHandler;
  "media:afterUpload"?: NxHookHandler;
}

/**
 * Hook handler — function in Stage 1, path string in Stage 3.
 */
export type NxHookHandler = ((ctx: NxHookContext) => void | Promise<void>) | string; // path to handler file (for isolation)

export interface NxHookContext {
  /** Hook name */
  hook: string;
  /** The entity being operated on */
  data: Record<string, unknown>;
  /** Collection slug (for content hooks) */
  collection?: string;
  /** User performing the action */
  user?: { id: string; email: string; role: string };
  /** Plugin context for accessing services */
  ctx: NxPluginContext;
}

// ─── Route Registration ────────────────────────────────────

export type NxRouteRegistration = NxApiRouteRegistration | NxSiteRouteRegistration;

export interface NxBaseRouteRegistration {
  /** Route path handled by the plugin API mount */
  path: string;
  /** HTTP method */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Handler function or path string */
  handler: NxRouteHandler | string;
  /** Description for OpenAPI generation */
  description?: string;
  /** Whether this route requires authentication */
  auth?: boolean;
}

export interface NxApiRouteRegistration extends NxBaseRouteRegistration {
  /** API routes are mounted at /api/plugins/{pluginId}/{path} */
  kind?: "api";
}

export interface NxSiteRouteRegistration extends NxBaseRouteRegistration {
  /** Site routes are exposed at the site root through generated rewrites */
  kind: "site";
  /** Absolute public path, for example /sitemap.xml */
  exposeAt: `/${string}`;
  /**
   * Required when replacing a NexPress built-in generated route.
   * Other reserved paths cannot be overridden.
   */
  overridesBuiltIn?: "sitemap.xml" | "robots.txt";
}

export type NxRouteHandler = (
  req: NxRouteRequest,
  ctx: NxPluginContext,
) => Promise<NxRouteResponse>;

export interface NxRouteRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  user?: { id: string; email: string; role: string };
}

export interface NxRouteResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

// ─── Scheduled Tasks ───────────────────────────────────────

export interface NxScheduledTask {
  /** Task ID */
  id: string;
  /** Cron expression */
  cron: string;
  /** Handler */
  handler: ((ctx: NxPluginContext) => void | Promise<void>) | string;
  /** Description */
  description?: string;
}
```

API routes require the `api:route` capability and are always reachable through
the namespaced plugin mount. Site routes require the `site:route` capability and
must also be declared in `manifest.provides.siteRoutes`. During build, the host
rejects any site route that collides with admin/API/media routes, Next.js
internals, collection static routes, content pages, or another plugin site route.
Replacing `sitemap.xml` or `robots.txt` is allowed only when the matching
`overridesBuiltIn` value is present.

### 1.5 PluginContext Interface

```typescript
/**
 * NxPluginContext — the scoped interface through which plugins access NexPress services.
 *
 * Stage 1: Thin wrapper, calls go directly to core services.
 * Stage 2: Capability checks before every call.
 * Stage 3: Serialized RPC across isolation boundary.
 *
 * Design: Every method is async (even if Stage 1 could be sync)
 * to maintain API compatibility across all stages.
 */
export interface NxPluginContext<TConfig = Record<string, unknown>> {
  /** Plugin ID */
  readonly pluginId: string;

  /** Plugin's own configuration (set by site admin) */
  readonly config: Readonly<TConfig>;

  /** Plugin's declared capabilities */
  readonly capabilities: readonly NxPluginCapability[];

  // ─── Content Service ───────────────────────────────────

  /** Content operations (requires content:* capabilities) */
  readonly content: {
    find(collection: string, query?: NxContentQuery): Promise<NxContentResult>;
    findOne(collection: string, id: string): Promise<NxContentItem | null>;
    create(collection: string, data: Record<string, unknown>): Promise<NxContentItem>;
    update(collection: string, id: string, data: Record<string, unknown>): Promise<NxContentItem>;
    delete(collection: string, id: string): Promise<void>;
    count(collection: string, where?: NxContentWhere): Promise<number>;
  };

  // ─── Media Service ─────────────────────────────────────

  /** Media operations (requires media:* capabilities) */
  readonly media: {
    list(query?: NxMediaQuery): Promise<NxMediaResult>;
    getById(id: string): Promise<NxMediaItem | null>;
    getUrl(id: string, transform?: NxImageTransform): Promise<string>;
    upload(file: Buffer | ReadableStream, metadata: NxMediaUpload): Promise<NxMediaItem>;
    delete(id: string): Promise<void>;
  };

  // ─── Storage Service (Plugin-scoped KV) ────────────────

  /**
   * Plugin-scoped key-value storage.
   * Keys are automatically namespaced: "nx:plugin:{pluginId}:{key}"
   * Requires storage:kv capability.
   */
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options?: { ttl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
    has(key: string): Promise<boolean>;
  };

  // ─── Settings Service ──────────────────────────────────

  /** Site and plugin settings */
  readonly settings: {
    /** Get site-level settings (requires settings:read) */
    getSite(): Promise<NxSiteSettings>;
    /** Get this plugin's settings */
    getPlugin(): Promise<TConfig>;
    /** Update this plugin's settings (requires settings:write) */
    setPlugin(data: Partial<TConfig>): Promise<void>;
  };

  // ─── Theme Service ─────────────────────────────────────

  /** Theme token access (requires theme:* capabilities) */
  readonly theme: {
    /** Get current theme tokens */
    getTokens(): Promise<NxThemeTokens>;
    /** Update theme tokens (requires theme:write — use sparingly) */
    setTokens(tokens: Partial<NxThemeTokens>): Promise<void>;
  };

  // ─── HTTP Client ───────────────────────────────────────

  /**
   * Outbound HTTP client (requires network:fetch capability).
   * Requests are validated against manifest.allowedHosts.
   */
  readonly http: {
    fetch(url: string, options?: NxFetchOptions): Promise<NxFetchResponse>;
  };

  // ─── Logging ───────────────────────────────────────────

  /** Namespaced logger: all messages prefixed with [plugin:{pluginId}] */
  readonly log: {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
  };

  // ─── Cache ─────────────────────────────────────────────

  /**
   * Plugin-scoped cache.
   * Keys namespaced: "nx:cache:plugin:{pluginId}:{key}"
   */
  readonly cache: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, ttl?: number): Promise<void>;
    invalidate(key: string): Promise<void>;
    invalidateAll(): Promise<void>;
  };

  // ─── Next.js Integration ───────────────────────────────

  /** Next.js cache revalidation (safe: only plugin's own paths) */
  readonly next: {
    revalidatePath(path: string): Promise<void>;
    revalidateTag(tag: string): Promise<void>;
  };

  // ─── Action System ─────────────────────────────────────

  /**
   * Plugin action registration and dispatch.
   * Actions are named RPC endpoints callable from:
   * - Admin UI (via pluginAction() server action)
   * - NxWidget button/form actions
   * - Other plugins (if permitted)
   *
   * Actions are the ONLY way for client-side UI (including NxWidgets)
   * to trigger plugin server-side logic.
   */
  readonly actions: {
    /**
     * Register a named action handler.
     * Called during plugin setup() — handlers persist for plugin lifetime.
     * Action names are automatically namespaced: "{pluginId}:{actionName}"
     */
    register(actionName: string, handler: NxActionHandler): void;

    /**
     * Dispatch an action to another plugin (requires explicit permission).
     * For cross-plugin communication.
     */
    dispatch(pluginId: string, actionName: string, data?: unknown): Promise<NxActionResult>;
  };
}

/**
 * Action handler function.
 * Receives action data + plugin context, returns serializable result.
 */
export type NxActionHandler = (data: unknown, ctx: NxPluginContext) => Promise<NxActionResult>;

/**
 * Action result — must be JSON-serializable (crosses server/client boundary).
 */
export interface NxActionResult {
  /** Whether the action succeeded */
  ok: boolean;
  /** Result data (on success) */
  data?: unknown;
  /** Error message (on failure) */
  error?: string;
}
```

### 1.6 Plugin Registration Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    Plugin Installation Flow                    │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. pnpm add @nexpress/plugin-seo                             │
│     ↓                                                         │
│  2. Add to nexpress.config.ts: plugins: [seoPlugin()]         │
│     ↓                                                         │
│  3. NexPress CLI validates manifest (nxPluginManifestSchema)   │
│     ↓                                                         │
│  4. If plugin declares collections/fields:                     │
│     → pnpm db:generate (re-runs codegen with plugin schema)   │
│     → pnpm db:migrate  (applies migration)                    │
│     ↓                                                         │
│  5. pnpm build (or restart dev server)                        │
│     ↓                                                         │
│  6. On startup: plugin.setup(ctx) called                       │
│     - Hooks → Hook Pipeline                                   │
│     - Actions → Action Registry                                │
│     - Blocks → Block Registry                                  │
│     - Widgets → Widget Registry                                │
│     - Scheduled Tasks → Worker Queue                           │
│     ↓                                                         │
│  7. Plugin state saved to nx_plugins table (enabled, config)   │
│     ↓                                                         │
│  8. Plugin is active                                          │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 1.7 Example Plugin

```typescript
// packages/plugins/nexpress-plugin-seo/src/index.ts
import { definePlugin, z } from "@nexpress/plugin-sdk";

const configSchema = z.object({
  siteTitle: z.string().default("My Site"),
  titleSeparator: z.string().default(" | "),
  defaultDescription: z.string().default(""),
  enableSitemap: z.boolean().default(true),
  sitemapChangeFreq: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
});

export default definePlugin({
  manifest: {
    id: "@nexpress/seo",
    version: "1.0.0",
    name: "SEO Plugin",
    description: "Adds SEO meta fields, sitemap generation, and social sharing previews.",
    author: { name: "NexPress Team" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: [
      "content:read",
      "settings:read",
      "hooks:content",
      "api:route",
      "site:route",
      "storage:kv",
    ],
    allowedHosts: [],
    provides: {
      blocks: ["seo-preview"],
      fields: ["seo-meta"],
      adminExtensions: ["seo-settings", "seo-collection-tab"],
      apiRoutes: ["/sitemap.xml"],
      siteRoutes: ["/sitemap.xml"],
      hooks: ["content:afterPublish", "content:afterUpdate"],
    },
    agent: {
      description:
        "Manages SEO meta tags (title, description, OG tags) for all content types. " +
        "Generates XML sitemaps automatically. Provides SEO score preview in admin. " +
        "Install when the site needs search engine optimization.",
      category: "seo",
      tags: ["seo", "meta", "sitemap", "opengraph", "social"],
    },
    usesTokens: ["--nx-color-primary", "--nx-color-foreground", "--nx-color-muted"],
    styleSlots: {
      "seo-preview-card": "Container for SEO preview card",
      "seo-score-badge": "SEO score indicator badge",
    },
  },

  configSchema,

  blocks: [
    {
      type: "seo-preview",
      label: "SEO Preview",
      description: "Shows how content will appear in Google search results.",
      component: "./blocks/SeoPreview",
      propsSchema: {
        type: "object",
        properties: {
          showScore: { type: "boolean", default: true },
          showSocial: { type: "boolean", default: true },
        },
      },
    },
  ],

  fields: [
    {
      type: "seo-meta",
      label: "SEO Meta",
      component: "./fields/SeoMetaField",
      cellComponent: "./fields/SeoMetaCell",
      schema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 60 },
          description: { type: "string", maxLength: 160 },
          ogImage: { type: "string" },
          noIndex: { type: "boolean", default: false },
        },
      },
    },
  ],

  admin: {
    panels: [
      {
        id: "seo-settings",
        label: "SEO",
        component: "./admin/SeoSettingsPanel",
        icon: "Search",
      },
    ],
    collectionTabs: [
      {
        id: "seo-collection-tab",
        label: "SEO",
        component: "./admin/SeoTab",
        collections: "*",
      },
    ],
  },

  hooks: {
    "content:afterPublish": async (hookCtx) => {
      // Regenerate sitemap when content is published
      const { ctx, collection, data } = hookCtx;
      await ctx.storage.set(`sitemap:dirty`, true);
      ctx.log.info(`Content published in ${collection}, sitemap marked dirty`);
    },
    "content:afterUpdate": async (hookCtx) => {
      const { ctx, collection, data } = hookCtx;
      // Update SEO score in plugin storage
      if (data.seoMeta) {
        const score = calculateSeoScore(data.seoMeta);
        await ctx.storage.set(`seo-score:${collection}:${data.id}`, score);
      }
    },
  },

  routes: [
    {
      path: "/sitemap.xml",
      kind: "site",
      exposeAt: "/sitemap.xml",
      overridesBuiltIn: "sitemap.xml",
      method: "GET",
      description: "XML sitemap for search engines",
      auth: false,
      handler: async (req, ctx) => {
        const cached = await ctx.cache.get<string>("sitemap-xml");
        if (cached) {
          return { status: 200, body: cached, headers: { "Content-Type": "application/xml" } };
        }
        // Generate sitemap from all published content
        const posts = await ctx.content.find("posts", {
          where: { status: { equals: "published" } },
        });
        const pages = await ctx.content.find("pages", {
          where: { status: { equals: "published" } },
        });
        const xml = generateSitemapXml([...posts.docs, ...pages.docs], ctx.config);
        await ctx.cache.set("sitemap-xml", xml, 3600);
        return { status: 200, body: xml, headers: { "Content-Type": "application/xml" } };
      },
    },
  ],

  async setup(ctx) {
    ctx.log.info("SEO plugin initialized", { siteTitle: ctx.config.siteTitle });

    // Register actions callable from admin UI and NxWidgets
    ctx.actions.register("generate-sitemap", async (data, actCtx) => {
      const posts = await actCtx.content.find("posts", {
        where: { status: { equals: "published" } },
      });
      const xml = generateSitemapXml(posts.docs, actCtx.config);
      await actCtx.cache.set("sitemap-xml", xml, 3600);
      return { ok: true, data: { pages: posts.docs.length } };
    });
  },
});

function calculateSeoScore(meta: Record<string, unknown>): number {
  /* ... */
}
function generateSitemapXml(items: unknown[], config: unknown): string {
  /* ... */
}
```

---

## 2. Self-hosted Isolation Technology Selection

> Pending Oracle consultation — concrete recommendation below.

### 2.1 Technology Comparison Matrix

| Aspect                    | isolated-vm                                           | Worker Threads + vm                                                                     | SES/Compartments                                       | Wasm (Extism)                              | child_process            |
| ------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------ | ------------------------ |
| **Security Boundary**     | True V8 isolate (separate heap, no shared references) | Thread isolation + namespace restriction (vm.createContext is NOT a security mechanism) | Language-level (frozen prototypes, attenuated globals) | Memory-safe (separate linear memory)       | Full process isolation   |
| **Overhead per plugin**   | ~4MB RAM, <1ms call                                   | ~5-10MB RAM, 5-50ms spawn                                                               | Minimal (same process)                                 | ~1-5MB RAM, 10-100ms boundary              | ~30MB RAM, 50-100ms fork |
| **Node.js API Access**    | None (must bridge every API)                          | Controllable (whitelist globals in vm context)                                          | Controllable (Compartment globals)                     | None (must bridge)                         | Full (separate process)  |
| **Async I/O**             | Via Reference/callback bridge (complex)               | Native via MessagePort                                                                  | Native                                                 | Via host functions                         | Via IPC                  |
| **DX for Plugin Authors** | Write JS, but no built-in APIs                        | Write JS, limited APIs                                                                  | Write JS, some frozen APIs                             | Multi-lang supported, but compilation step | Write JS normally        |
| **Production Users**      | Backstage, NocoBase, GrowthBook, Jitsu                | OwnPilot                                                                                | MetaMask (LavaMoat)                                    | Shopify Functions, Fermyon                 | Common (basic)           |
| **Maturity**              | Stable, active maintenance                            | Node.js built-in (stable)                                                               | TC39 Stage 2 (pre-standard)                            | Active but young for JS plugins            | Node.js built-in         |
| **Node.js Compat**        | Requires `--no-node-snapshot` on Node 20+             | All versions                                                                            | Shim required                                          | WASI, Extism                               | All versions             |
| **Can Run TypeScript?**   | Pre-compiled JS only                                  | Pre-compiled JS only                                                                    | Pre-compiled JS only                                   | Via AssemblyScript/Javy                    | Yes                      |

### 2.2 Stage-by-Stage Recommendation

**Stage 2 (Permission-scoped) — No process isolation needed**

Mechanism: **Proxy-based capability enforcement on PluginContext**

```typescript
// Stage 2 implementation sketch
function createCapabilityProxy(
  ctx: NxPluginContextInternal,
  capabilities: NxPluginCapability[],
): NxPluginContext {
  return new Proxy(ctx, {
    get(target, prop) {
      // Check capability before returning service
      const requiredCap = CAPABILITY_MAP[prop as string];
      if (requiredCap && !capabilities.includes(requiredCap)) {
        throw new NxCapabilityError(
          `Plugin "${target.pluginId}" lacks capability "${requiredCap}" ` +
            `required to access "${String(prop)}"`,
        );
      }
      return target[prop as keyof NxPluginContextInternal];
    },
  });
}
```

This is sufficient for Stage 2 because:

- Plugin code runs in the same process (trusted npm packages)
- The goal is preventing _accidental_ overreach, not _malicious_ escape
- Zero overhead — just property access interception

**Stage 3 (Full Isolation) — `isolated-vm` (Oracle-recommended)**

Winner: **`isolated-vm`** — V8 isolates in-process, separate heap, no shared references.

Why isolated-vm over Worker Threads + vm:

- `vm.createContext` is NOT a security mechanism (Node.js docs are explicit about this)
- Worker Threads give thread isolation but still expose full Node.js APIs unless you also use vm (double layering, still not secure)
- `isolated-vm` provides a true V8 isolate with separate heap — no prototype chain escape, no shared references
- Battle-tested: Backstage (CNCF), NocoBase, GrowthBook, Jitsu all run production workloads
- ~4MB per isolate, <1ms call overhead — fits CMS workload profile (many short hook calls)

Key implementation decisions (from Oracle):

1. **Single bridge function**: Inject exactly ONE host reference into the isolate:

   ```typescript
   // Inside the isolate, plugins call:
   const result = await host.call({ op: "content.find", args: ["posts", { limit: 10 }] });
   ```

   The Plugin SDK generates the ergonomic API (`ctx.content.find(...)`) on top of this single call.

2. **Plain data only**: All data crossing the boundary must be structured-cloneable (JSON-safe).
   No host object references, no callbacks, no Promises leaked into the isolate.
   Large blobs → return opaque host-side handles, follow-up RPC calls.

3. **Isolate lifecycle**:
   - Pool isolates per plugin version (reuse across hook calls)
   - Dispose and recreate on: fault, deploy, quota breach
   - Per-plugin memory limit (128MB default, configurable)
   - Per-call CPU timeout (500ms for hooks, 5s for routes)

4. **`--no-node-snapshot`**: Required on Node.js 20+. Bake into Docker entrypoint early.

5. **Cancellation + audit**: The bridge layer is the choke point for security, quota accounting, and audit logging.

```typescript
// Stage 3: isolated-vm bridge implementation sketch
import { Isolate, Context, Reference } from "isolated-vm";

class NxIsolatedPluginRunner {
  private isolate: Isolate;
  private context: Context;

  constructor(
    private pluginId: string,
    private capabilities: Set<NxPluginCapability>,
  ) {
    this.isolate = new Isolate({ memoryLimit: 128 }); // MB
  }

  async initialize(pluginCode: string): Promise<void> {
    this.context = await this.isolate.createContext();
    const jail = this.context.global;

    // Inject the ONE bridge function
    await jail.set(
      "__host_call__",
      new Reference(async (opJson: string) => {
        const { op, args } = JSON.parse(opJson);
        // 1. Parse operation (e.g., "content.find" → service="content", method="find")
        const [service, method] = op.split(".");
        // 2. Check capability
        const cap = serviceMethodToCapability(service, method);
        if (!this.capabilities.has(cap)) {
          return JSON.stringify({ ok: false, error: `Missing capability: ${cap}` });
        }
        // 3. Execute against host service
        try {
          const result = await hostServices[service][method](...args);
          return JSON.stringify({ ok: true, result });
        } catch (e) {
          return JSON.stringify({ ok: false, error: e.message });
        }
      }),
    );

    // Inject minimal globals
    await jail.set("JSON", new Reference(JSON));

    // Compile and load the plugin SDK shim + plugin code
    const sdkShim = generateSdkShim(); // builds ctx.content.find() etc. on top of __host_call__
    const module = await this.isolate.compileScript(sdkShim + "\n" + pluginCode);
    await module.run(this.context, { timeout: 5000 });
  }

  async callHook(hookName: string, payload: Record<string, unknown>): Promise<unknown> {
    const hookRef = await this.context.global.get(hookName);
    if (!hookRef) return; // plugin doesn't handle this hook
    const resultJson = await hookRef.apply(undefined, [JSON.stringify(payload)], { timeout: 500 });
    return JSON.parse(resultJson as string);
  }

  dispose(): void {
    this.context?.release();
    this.isolate?.dispose();
  }
}

function generateSdkShim(): string {
  // This code runs INSIDE the isolate
  // It wraps __host_call__ into ergonomic ctx.content.find() etc.
  return `
    const ctx = {
      content: {
        async find(collection, query) {
          const r = JSON.parse(await __host_call__(JSON.stringify({ op: "content.find", args: [collection, query] })));
          if (!r.ok) throw new Error(r.error);
          return r.result;
        },
        async findOne(collection, id) {
          const r = JSON.parse(await __host_call__(JSON.stringify({ op: "content.findOne", args: [collection, id] })));
          if (!r.ok) throw new Error(r.error);
          return r.result;
        },
        // ... other methods follow same pattern
      },
      storage: {
        async get(key) {
          const r = JSON.parse(await __host_call__(JSON.stringify({ op: "storage.get", args: [key] })));
          if (!r.ok) throw new Error(r.error);
          return r.result;
        },
        // ...
      },
      log: {
        info(msg, data) { __host_call__(JSON.stringify({ op: "log.info", args: [msg, data] })); },
        warn(msg, data) { __host_call__(JSON.stringify({ op: "log.warn", args: [msg, data] })); },
        error(msg, data) { __host_call__(JSON.stringify({ op: "log.error", args: [msg, data] })); },
        debug(msg, data) { __host_call__(JSON.stringify({ op: "log.debug", args: [msg, data] })); },
      },
    };
  `;
}
```

**Escalation triggers** (when to move beyond isolated-vm):

- If plugins need arbitrary npm packages or complex native async I/O → add a Worker/process runner alongside isolated-vm
- If SES becomes standardized and adopted in Node.js → revisit as backend option for the same capability API

### 2.3 Disqualified Options

**Wasm (Extism)**: Plugin authors write TypeScript/React. Requiring Wasm compilation (via Javy or AssemblyScript) adds prohibitive DX friction. Wasm excels for compute-heavy pure functions (Shopify Functions), but NexPress plugins need rich interaction with host services (content, media, auth, cache). Every host API call crosses the Wasm boundary with serialization overhead.

**child_process**: 30MB+ per plugin process. A CMS with 10-20 plugins would need 300-600MB just for plugin processes. Unacceptable for self-hosted Docker deployments targeting 512MB-1GB containers.

**vm module alone**: Node.js documentation explicitly states `vm.createContext` is NOT a security mechanism. Prototype chain escapes are well-documented. Only acceptable as a namespace restriction layer _inside_ a Worker Thread (as OwnPilot does), never as a standalone isolation boundary.

### 2.4 SES/Compartments — Future Watch

Keep the `NxPluginContext` API shape compatible with SES-style Compartments, but do NOT put SES on the roadmap. Rationale:

- TC39 Stage 2 — not yet standardized
- Node.js doesn't ship SES natively; requires Agoric shim (`ses` package)
- LavaMoat (MetaMask) uses it, but for supply-chain defense, not plugin sandboxing
- The abstraction point is `NxPluginContext` — if SES matures, swap the transport layer only

### 2.5 Unified Programming Model (Critical Design Principle)

> **One API surface, three transport layers.**

Plugin authors write the same code regardless of stage:

```typescript
// This code is identical in Stage 1, 2, and 3
async function afterPublish(hookCtx: NxHookContext) {
  const { ctx, collection, data } = hookCtx;
  const score = calculateScore(data);
  await ctx.storage.set(`score:${data.id}`, score);
  ctx.log.info(`Scored ${collection}/${data.id}: ${score}`);
}
```

What changes between stages is **transport only**:

| Stage | `ctx.storage.set()` becomes...                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------ |
| 1     | Direct function call: `storageService.set(pluginId, key, value)`                                                   |
| 2     | Proxy-checked call: `checkCapability("storage:kv") → storageService.set(...)`                                      |
| 3     | Serialized RPC: `JSON.stringify({op:"storage.set",args}) → isolate boundary → host.call → storageService.set(...)` |

This means:

- Plugin migration from trusted (Stage 1) to sandboxed (Stage 3) requires **zero code changes**
- Plugin SDK (`@nexpress/plugin-sdk`) is the same package across all stages
- The only difference is host-side wiring, invisible to plugin authors

---

## 3. Bridge Pattern for Next.js RSC

### 3.1 Architecture Overview

The core insight from EmDash analysis: **the Bridge is a capability-gated RPC gateway**.

In EmDash (Cloudflare), the bridge is a `WorkerEntrypoint` — RPC is free because Cloudflare Workers communicate via structured cloning over bindings.

In NexPress (Node.js), the bridge must adapt to:

1. **App Router / RSC** — server components can't use client-side APIs
2. **'use client' boundary** — plugin interactive components need explicit client boundaries
3. **Server Actions** — plugin server mutations should go through Next.js server action mechanism
4. **Streaming SSR** — plugin blocks must support React Suspense/streaming

### 3.2 Render/Effect Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js App Router Host                      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Render Layer (Shared React Tree)             │   │
│  │                                                           │   │
│  │  RSC Page                                                 │   │
│  │  ├── <Layout>                                             │   │
│  │  ├── <Header />                                           │   │
│  │  ├── <BlockResolver blocks={pageBlocks}>                  │   │
│  │  │   ├── <CoreHeroBlock />         ← core block           │   │
│  │  │   ├── <PluginSeoPreview />      ← plugin block (trust) │   │
│  │  │   ├── <PluginContactForm />     ← plugin block (trust) │   │
│  │  │   └── <NxWidgetRenderer desc={sandboxUI} />            │   │
│  │  │       ↑ sandboxed plugin's declarative UI (Stage 3)    │   │
│  │  └── <Footer />                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          │ ctx.content.find(...)                  │
│                          │ ctx.hooks.run(...)                     │
│                          ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            Effect Layer (Plugin Host Services)            │   │
│  │                                                           │   │
│  │  NxPluginHost                                             │   │
│  │  ├── PluginRegistry (manifest, state, config)             │   │
│  │  ├── CapabilityEnforcer (Stage 2+)                        │   │
│  │  ├── HookPipeline (ordered hook execution)                │   │
│  │  ├── RouteRegistry (plugin API routes)                    │   │
│  │  └── NxPluginBridge (Stage 3 only)                        │   │
│  │      ├── Plugin A Effect → in-process (trusted)           │   │
│  │      ├── Plugin B Effect → in-process (trusted)           │   │
│  │      └── Plugin C Effect → isolated-vm/Worker (sandboxed) │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Plugin Component Loading in App Router

**Challenge**: Next.js App Router statically analyzes `app/` at build time. Plugin components can't create new `page.tsx` files dynamically.

**Solution**: Catch-all route + Block Resolver pattern (like Payload CMS)

```
app/
├── (site)/
│   ├── [...slug]/
│   │   └── page.tsx          ← Catch-all: resolves slug → page → blocks
│   └── layout.tsx
├── (admin)/
│   ├── admin/
│   │   ├── [...path]/
│   │   │   └── page.tsx      ← Catch-all: admin routes including plugin panels
│   │   └── layout.tsx
│   └── layout.tsx
├── api/
│   └── plugins/
│       └── [...route]/
│           └── route.ts      ← Catch-all: routes to plugin API handlers
└── layout.tsx
```

**Plugin component reference pattern** (borrowed from Payload CMS):

```typescript
// Plugin components are referenced by package path string
// NOT imported directly — this allows:
// 1. Code splitting (only loaded when needed)
// 2. No build-time dependency on plugin internals
// 3. Clean separation of server/client components

// In plugin manifest:
admin: {
  panels: [{
    component: "@nexpress/plugin-seo/client#SeoPanel",
    //          └── npm package ──────┘ └── export name
  }],
}

// Host resolves this at runtime:
const { SeoPanel } = await import("@nexpress/plugin-seo/client");
// or with next/dynamic:
const SeoPanel = dynamic(() =>
  import("@nexpress/plugin-seo/client").then(m => m.SeoPanel)
);
```

**Server Component plugins** (blocks rendered in RSC):

```typescript
// Block is a Server Component — renders on server, zero client JS
// Plugin author writes:
// plugins/seo/blocks/SeoPreview.tsx
export function SeoPreview({ title, description, showScore }: SeoPreviewProps) {
  return (
    <div className="nx-seo-preview" style={{ color: "var(--nx-color-foreground)" }}>
      <h3>{title}</h3>
      <p>{description}</p>
      {showScore && <SeoScoreBadge />}
    </div>
  );
}

// Host renders it in RSC tree via BlockResolver:
async function BlockResolver({ blocks }: { blocks: BlockData[] }) {
  return (
    <>
      {blocks.map(async (block) => {
        const Component = await resolveBlockComponent(block.type);
        return <Component key={block.id} {...block.props} />;
      })}
    </>
  );
}
```

### 3.4 Server Actions for Plugins

Plugins can't define raw Server Actions (security: arbitrary `'use server'` functions). Instead, host provides a dispatcher:

```typescript
// Host provides a single server action entry point
// app/(admin)/admin/actions.ts
"use server";

import { getPluginHost } from "@nexpress/core";

export async function pluginAction(pluginId: string, actionName: string, data: unknown) {
  const host = getPluginHost();
  // 1. Validate plugin exists and is active
  // 2. Look up registered action handler in plugin's action registry
  // 3. Check capability (plugin must have registered this action during setup)
  // 4. Execute handler with scoped NxPluginContext
  return host.executeAction(pluginId, actionName, data);
}

// Plugin registers actions in setup():
async setup(ctx) {
  ctx.actions.register("generate-sitemap", async (data, actCtx) => {
    // ... generate sitemap
    return { ok: true, data: { success: true } };
  });
}

// Plugin's admin component calls the host action:
// plugins/seo/admin/SeoPanel.tsx
"use client";
import { pluginAction } from "@nexpress/admin/actions";

export function SeoPanel() {
  const handleGenerate = async () => {
    const result = await pluginAction("@nexpress/seo", "generate-sitemap", {});
    // ...
  };
  return <button onClick={handleGenerate}>Generate Sitemap</button>;
}
```

### 3.5 Stage 3 Bridge (Isolated Effects)

```typescript
/**
 * NxPluginBridge — RPC gateway for sandboxed plugin effects.
 * Only used in Stage 3 for plugins that require isolation.
 *
 * Communication:
 * - Worker Threads: MessagePort (structured clone)
 * - isolated-vm: Reference/callback + JSON serialization
 */
export class NxPluginBridge {
  private isolate: Isolate | Worker;
  private capabilities: Set<NxPluginCapability>;

  constructor(
    pluginId: string,
    capabilities: NxPluginCapability[],
    isolationType: "isolated-vm" | "worker-thread",
  ) {
    this.capabilities = new Set(capabilities);
    // Initialize isolation runtime
  }

  /**
   * Dispatch a hook call to the sandboxed plugin.
   * 1. Check capability
   * 2. Serialize payload (JSON)
   * 3. Send to isolate
   * 4. Receive result (JSON)
   * 5. Return deserialized result
   */
  async callHook(hookName: string, payload: Record<string, unknown>): Promise<unknown> {
    this.assertCapability(hookToCapability(hookName));
    return this.rpc("hook", { name: hookName, payload });
  }

  async callRoute(method: string, path: string, request: NxRouteRequest): Promise<NxRouteResponse> {
    this.assertCapability("api:route");
    return this.rpc("route", { method, path, request });
  }

  /**
   * When sandboxed plugin calls ctx.content.find(), it arrives here as an RPC.
   * Bridge validates capability, then calls host's content service.
   */
  async handleHostCall(service: string, method: string, args: unknown[]): Promise<unknown> {
    const cap = serviceToCapability(service, method);
    this.assertCapability(cap);
    // Call the actual host service
    return this.hostServices[service][method](...args);
  }

  private assertCapability(cap: NxPluginCapability): void {
    if (!this.capabilities.has(cap)) {
      throw new NxCapabilityError(`Sandboxed plugin lacks capability: ${cap}`);
    }
  }

  private async rpc(method: string, args: unknown): Promise<unknown> {
    // Implementation depends on isolation type
    // For Worker Threads: postMessage + MessagePort
    // For isolated-vm: Reference.apply + JSON
  }
}
```

---

## 4. Declarative UI for Sandboxed Plugins

### 4.1 Motivation

Sandboxed plugins (Stage 3) cannot render React components in the host tree. They need a way to describe admin UI that the host renders on their behalf.

For trusted plugins (Stage 1-2), this is **optional** — they can use real React components. But the Widget Kit is recommended because:

- Agent-friendly (JSON-serializable UI descriptions)
- Standardizes common admin patterns
- Makes future sandbox migration painless
- Consistent look & feel (always renders as shadcn/ui)

### 4.2 NxWidget Type System

```typescript
/**
 * NxWidget — declarative UI node.
 * Host renders these using shadcn/ui components.
 * All widgets map 1:1 to a shadcn/ui component.
 */
export type NxWidget =
  // ─── Layout ──────────────────────────────
  | NxStackWidget
  | NxGridWidget
  | NxCardWidget
  | NxTabsWidget
  | NxDividerWidget
  | NxAccordionWidget

  // ─── Typography ──────────────────────────
  | NxHeadingWidget
  | NxTextWidget
  | NxCodeWidget

  // ─── Form Inputs ─────────────────────────
  | NxInputWidget
  | NxTextareaWidget
  | NxSelectWidget
  | NxCheckboxWidget
  | NxSwitchWidget
  | NxRadioGroupWidget
  | NxDatePickerWidget

  // ─── Data Display ────────────────────────
  | NxTableWidget
  | NxStatWidget
  | NxBadgeWidget
  | NxAlertWidget
  | NxProgressWidget

  // ─── Actions ─────────────────────────────
  | NxButtonWidget
  | NxFormWidget
  | NxLinkWidget

  // ─── Media ───────────────────────────────
  | NxImageWidget
  | NxAvatarWidget;

// ─── Widget Definitions ──────────────────────

interface NxStackWidget {
  type: "stack";
  direction: "horizontal" | "vertical";
  gap?: number; // in tailwind spacing units (1 = 0.25rem)
  align?: "start" | "center" | "end" | "stretch";
  children: NxWidget[];
}

interface NxGridWidget {
  type: "grid";
  columns: number; // 1-4
  gap?: number;
  children: NxWidget[];
}

interface NxCardWidget {
  type: "card";
  title?: string;
  description?: string;
  children: NxWidget[];
  footer?: NxWidget[];
}

interface NxTabsWidget {
  type: "tabs";
  items: Array<{
    id: string;
    label: string;
    children: NxWidget[];
  }>;
  defaultTab?: string;
}

interface NxHeadingWidget {
  type: "heading";
  level: 1 | 2 | 3 | 4;
  content: string;
}

interface NxTextWidget {
  type: "text";
  content: string;
  variant?: "default" | "muted" | "small";
}

interface NxInputWidget {
  type: "input";
  name: string;
  label: string;
  placeholder?: string;
  inputType?: "text" | "number" | "email" | "url" | "password";
  required?: boolean;
  defaultValue?: string;
  description?: string;
}

interface NxSelectWidget {
  type: "select";
  name: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  required?: boolean;
  defaultValue?: string;
}

interface NxTableWidget {
  type: "table";
  columns: Array<{
    key: string;
    label: string;
    sortable?: boolean;
  }>;
  /** Data source: "action:{actionName}" fetches from plugin action */
  dataSource: string;
  /** Rows per page */
  pageSize?: number;
}

interface NxStatWidget {
  type: "stat";
  label: string;
  value: string;
  description?: string;
  trend?: { direction: "up" | "down" | "neutral"; value: string };
}

interface NxButtonWidget {
  type: "button";
  label: string;
  /** Action ID — dispatched to plugin's registered action handler */
  action: string;
  /** Action payload (static) */
  actionData?: Record<string, unknown>;
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost";
  size?: "sm" | "default" | "lg";
  /** Show loading spinner while action executes */
  loading?: boolean;
}

interface NxFormWidget {
  type: "form";
  /** Form fields (NxWidget inputs) */
  children: NxWidget[];
  /** Action to dispatch on submit */
  onSubmit: string;
  /** Submit button label */
  submitLabel?: string;
}

interface NxAlertWidget {
  type: "alert";
  variant: "default" | "info" | "warning" | "error" | "success";
  title?: string;
  message: string;
}

interface NxBadgeWidget {
  type: "badge";
  label: string;
  variant?: "default" | "secondary" | "destructive" | "outline";
}

interface NxImageWidget {
  type: "image";
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

interface NxDividerWidget {
  type: "divider";
}

interface NxProgressWidget {
  type: "progress";
  value: number; // 0-100
  label?: string;
}

interface NxCodeWidget {
  type: "code";
  content: string;
  language?: string;
}

// ... remaining types follow the same pattern
```

### 4.3 Host Widget Renderer

```typescript
// packages/admin/src/components/NxWidgetRenderer.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pluginAction } from "@nexpress/admin/actions";
import type { NxWidget } from "@nexpress/plugin-sdk";

interface Props {
  widgets: NxWidget[];
  pluginId: string;
}

export function NxWidgetRenderer({ widgets, pluginId }: Props) {
  return (
    <>
      {widgets.map((widget, i) => (
        <NxWidgetNode key={i} widget={widget} pluginId={pluginId} />
      ))}
    </>
  );
}

function NxWidgetNode({ widget, pluginId }: { widget: NxWidget; pluginId: string }) {
  switch (widget.type) {
    case "card":
      return (
        <Card>
          {(widget.title || widget.description) && (
            <CardHeader>
              {widget.title && <CardTitle>{widget.title}</CardTitle>}
              {widget.description && <CardDescription>{widget.description}</CardDescription>}
            </CardHeader>
          )}
          <CardContent>
            <NxWidgetRenderer widgets={widget.children} pluginId={pluginId} />
          </CardContent>
          {widget.footer && (
            <CardFooter>
              <NxWidgetRenderer widgets={widget.footer} pluginId={pluginId} />
            </CardFooter>
          )}
        </Card>
      );

    case "button":
      return (
        <Button
          variant={widget.variant}
          size={widget.size}
          onClick={() => pluginAction(pluginId, widget.action, widget.actionData ?? {})}
        >
          {widget.label}
        </Button>
      );

    case "alert":
      return (
        <Alert variant={widget.variant === "error" ? "destructive" : "default"}>
          {widget.title && <AlertTitle>{widget.title}</AlertTitle>}
          <AlertDescription>{widget.message}</AlertDescription>
        </Alert>
      );

    // ... other widget types follow the same pattern
    default:
      return null;
  }
}
```

### 4.4 Plugin Declarative UI Example

```typescript
// Sandboxed plugin returns widget description via bridge
export function getSettingsPanel(): NxWidget {
  return {
    type: "stack",
    direction: "vertical",
    gap: 4,
    children: [
      {
        type: "heading",
        level: 2,
        content: "Analytics Settings",
      },
      {
        type: "card",
        title: "Tracking Configuration",
        children: [
          {
            type: "form",
            onSubmit: "save-analytics-config",
            submitLabel: "Save Settings",
            children: [
              {
                type: "input",
                name: "trackingId",
                label: "Google Analytics ID",
                placeholder: "G-XXXXXXXXXX",
                required: true,
              },
              {
                type: "switch",
                name: "enablePageViews",
                label: "Track Page Views",
              },
              {
                type: "select",
                name: "cookieConsent",
                label: "Cookie Consent Mode",
                options: [
                  { label: "Required", value: "required" },
                  { label: "Optional", value: "optional" },
                  { label: "None", value: "none" },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "card",
        title: "Recent Activity",
        children: [
          {
            type: "grid",
            columns: 3,
            gap: 4,
            children: [
              {
                type: "stat",
                label: "Page Views (24h)",
                value: "1,234",
                trend: { direction: "up", value: "+12%" },
              },
              {
                type: "stat",
                label: "Unique Visitors",
                value: "567",
                trend: { direction: "up", value: "+5%" },
              },
              {
                type: "stat",
                label: "Bounce Rate",
                value: "32%",
                trend: { direction: "down", value: "-3%" },
              },
            ],
          },
          {
            type: "table",
            columns: [
              { key: "page", label: "Page", sortable: true },
              { key: "views", label: "Views", sortable: true },
              { key: "avgTime", label: "Avg. Time" },
            ],
            dataSource: "action:get-top-pages",
            pageSize: 10,
          },
        ],
      },
    ],
  };
}
```

---

## 5. Static Analysis Tool Spec

### 5.1 Overview

`@nexpress/plugin-sdk` includes a set of ESLint rules and build-time validators that enforce plugin conventions. These run at:

- **Development time**: ESLint rules in IDE
- **Build time**: SDK build command validates before publish
- **Install time**: NexPress validates manifest on plugin installation

### 5.2 ESLint Rules

Package: `eslint-plugin-nexpress`

#### Theme Contract Rules

| Rule                                 | Severity | Description                                                                               |
| ------------------------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `nexpress/no-hardcoded-colors`       | error    | Forbid hex, rgb, hsl, oklch color literals in CSS/JSX style. Must use `var(--nx-color-*)` |
| `nexpress/no-hardcoded-fonts`        | error    | Forbid `font-family` declarations. Must use `var(--nx-font-*)`                            |
| `nexpress/no-important`              | error    | Forbid `!important` in CSS (breaks theme cascade)                                         |
| `nexpress/no-layer-escape`           | warning  | Plugin CSS must be in `@layer nx-blocks`                                                  |
| `nexpress/no-global-selectors`       | error    | Forbid selectors targeting `body`, `html`, `*`, `:root`                                   |
| `nexpress/no-tailwind-color-classes` | warning  | Warn on Tailwind color utilities like `text-blue-500` (should use token-based classes)    |

#### Security Rules

| Rule                              | Severity | Description                                                                  |
| --------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `nexpress/no-dangerous-apis`      | error    | Forbid `eval()`, `Function()`, `new Function()`                              |
| `nexpress/no-direct-fs`           | warning  | Warn on `fs`, `child_process`, `net` imports (should use ctx services)       |
| `nexpress/no-direct-db`           | error    | Forbid direct `pg`, `drizzle-orm`, `prisma` imports (must use `ctx.content`) |
| `nexpress/no-env-access`          | warning  | Warn on `process.env` access (should use `ctx.config`)                       |
| `nexpress/no-dynamic-require`     | error    | Forbid `require()` and dynamic `import()` of non-plugin paths                |
| `nexpress/no-prototype-pollution` | warning  | Warn on `Object.defineProperty`, `__proto__`, `constructor.prototype`        |

#### Manifest Integrity Rules

| Rule                                 | Severity | Description                                                                                        |
| ------------------------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| `nexpress/manifest-required-fields`  | error    | Manifest must have id, version, name, capabilities, agent                                          |
| `nexpress/manifest-capability-match` | warning  | Capabilities should match actual API usage in code                                                 |
| `nexpress/manifest-version-semver`   | error    | Version must be valid semver                                                                       |
| `nexpress/manifest-nexpress-compat`  | warning  | minVersion should match installed NexPress version                                                 |
| `nexpress/manifest-routes-declared`  | warning  | Routes in code should be listed in `manifest.provides.apiRoutes` or `manifest.provides.siteRoutes` |
| `nexpress/manifest-hooks-declared`   | warning  | Hooks in code should be listed in `manifest.provides.hooks`                                        |

#### Component Rules

| Rule                                | Severity | Description                                                          |
| ----------------------------------- | -------- | -------------------------------------------------------------------- |
| `nexpress/block-tokens-declared`    | warning  | `--nx-*` CSS vars used in block should be in `usesTokens`            |
| `nexpress/no-react-version-pin`     | error    | Don't pin React/Next.js versions in peerDependencies (core controls) |
| `nexpress/prefer-rsc-blocks`        | info     | Blocks without interactivity should be Server Components             |
| `nexpress/no-server-only-in-client` | error    | Don't import `server-only` code in client components                 |

### 5.3 Build-time Validators

Run by `npx nexpress-sdk build`:

```
1. Schema Validation
   ├── Validate manifest against nxPluginManifestSchema
   ├── Validate configSchema (if present) is valid Zod schema
   └── Validate propsSchema for each block is valid JSON Schema

2. Component Validation
   ├── Verify all component paths resolve to actual files
   ├── Check 'use client' directives are correct
   ├── Verify no circular dependencies within plugin
   └── Check bundle size (warn if >500KB, error if >2MB)

3. Capability Audit
   ├── Static analysis: what APIs does the plugin actually use?
   ├── Compare against declared capabilities
   ├── Report undeclared capabilities (warning)
   └── Report unused declared capabilities (info)

4. Theme Compliance
   ├── Scan CSS/styled-components for hardcoded values
   ├── Verify @layer usage
   └── Validate usesTokens matches actual usage

5. Security Scan
   ├── Check for known dangerous patterns
   ├── Scan dependencies for known vulnerabilities (npm audit)
   └── Report any use of blocked APIs
```

### 5.4 CLI Commands

```bash
# Lint plugin code
npx nexpress-sdk lint

# Build plugin (validate + bundle)
npx nexpress-sdk build

# Validate manifest only
npx nexpress-sdk validate

# Audit capabilities (what the plugin actually uses vs declares)
npx nexpress-sdk audit

# Generate manifest from code analysis (helper)
npx nexpress-sdk init-manifest

# Test plugin in isolation (mock NxPluginContext)
npx nexpress-sdk test
```

### 5.5 ESLint Config Preset

```javascript
// Plugin author's .eslintrc.js
module.exports = {
  extends: ["plugin:nexpress/recommended"],
  // "nexpress/recommended" includes all error-level rules
  // "nexpress/strict" includes all warning-level rules as errors
  // "nexpress/all" includes all rules
};
```

---

## Appendix A: Key Design Decisions

| Decision            | Choice                                                                                                        | Rationale                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Plugin packaging    | npm packages                                                                                                  | Leverages existing ecosystem, versioning, publishing                           |
| Manifest format     | Zod schema                                                                                                    | Runtime validation + TypeScript types + JSON Schema generation for agents      |
| Component reference | Path strings (Payload pattern)                                                                                | Enables code splitting, no build-time coupling                                 |
| Hook execution      | Pipeline (ordered, sequential)                                                                                | Predictable, debuggable; concurrent would need careful design                  |
| Plugin routes       | API routes are namespaced under `/api/plugins/{id}/`; site routes require `site:route` and generated rewrites | Prevents accidental collisions while allowing explicit root-level integrations |
| Plugin storage      | KV prefixed with `nx:plugin:{id}:`                                                                            | Namespace isolation at DB level                                                |
| Plugin CSS          | `@layer nx-blocks` required                                                                                   | Cascade layer ensures theme > plugin precedence                                |
| Server Actions      | Host dispatcher, not direct plugin actions                                                                    | Security: prevents arbitrary server-side execution                             |
| Declarative UI      | Optional NxWidget system                                                                                      | Agent-friendly, sandbox-ready, but not required for trusted plugins            |

## Appendix B: Migration Path (Stage 1 → 2 → 3)

```
Stage 1 (MVP)
├── Plugin calls ctx.content.find() → direct function call
├── No capability check at runtime
├── ESLint warns if usage doesn't match manifest
└── All plugins trusted (npm install)

    ↓ (non-breaking: add Proxy wrapper)

Stage 2 (Permission-scoped)
├── Plugin calls ctx.content.find() → Proxy checks capability → direct call
├── Runtime CapabilityError if undeclared
├── Admin UI shows capability review on install
└── All plugins still in-process (trusted code)

    ↓ (new: sandboxed plugin type)

Stage 3 (Full Isolation — sandboxed plugins only)
├── Trusted plugins: same as Stage 2 (in-process)
├── Sandboxed plugins:
│   ├── Effect code → isolated-vm/Worker Thread
│   ├── Plugin calls ctx.content.find() → serialized RPC → bridge → host service
│   ├── React components → NxWidget declarative UI only
│   └── Strict resource limits (memory, CPU, network)
└── Both types coexist — sandbox is opt-in per plugin
```

---

## Appendix C: QA Scenarios (per section)

Each section below defines concrete, executable verification steps. These run against the NexPress monorepo after implementation.

### QA: Section 1 — Plugin Contract

**QA-1.1: Manifest validation (unit test)**

```bash
# Tool: vitest
# File: packages/plugin-sdk/src/__tests__/manifest.test.ts
pnpm --filter @nexpress/plugin-sdk test -- --run manifest.test

# Expected: All pass
# Test cases:
#   ✓ valid manifest passes nxPluginManifestSchema.parse()
#   ✓ missing `id` → ZodError with path ["id"]
#   ✓ invalid semver version → ZodError
#   ✓ unknown capability → ZodError
#   ✓ empty capabilities array → passes (valid: plugin may need nothing)
#   ✓ provides.blocks default → [] when omitted
#   ✓ agent.category must be one of enum values
```

**QA-1.2: definePlugin() type safety (tsc)**

```bash
# Tool: tsc --noEmit
# File: packages/plugin-sdk/src/__tests__/type-check/
pnpm --filter @nexpress/plugin-sdk exec tsc --noEmit --project tsconfig.test.json

# Expected: Exit code 0
# Verify:
#   ✓ definePlugin({ manifest, blocks, hooks, setup }) compiles
#   ✓ setup(ctx) — ctx.content.find() returns Promise<NxContentResult>
#   ✓ ctx.actions.register("name", handler) — handler typed as NxActionHandler
#   ✓ configSchema: z.object({...}) → TConfig inferred in ctx.config
#   ✓ wrong hook name → type error
#   ✓ wrong capability string → type error
```

**QA-1.3: PluginContext capability enforcement (integration test)**

```bash
# Tool: vitest
# File: packages/core/src/__tests__/plugin-context.test.ts
pnpm --filter @nexpress/core test -- --run plugin-context.test

# Expected: All pass
# Test cases:
#   ✓ plugin with ["content:read"] → ctx.content.find() succeeds
#   ✓ plugin with ["content:read"] → ctx.content.create() throws NxCapabilityError
#   ✓ plugin with ["storage:kv"] → ctx.storage.set() succeeds
#   ✓ plugin with [] → ctx.http.fetch() throws NxCapabilityError
#   ✓ ctx.actions.register() → action callable via host.executeAction()
#   ✓ ctx.actions.dispatch() to other plugin → works if target allows
```

**QA-1.4: Example plugin loads correctly (e2e)**

```bash
# Tool: vitest (integration)
# File: packages/core/src/__tests__/plugin-loader.test.ts
pnpm --filter @nexpress/core test -- --run plugin-loader.test

# Expected: All pass
# Test cases:
#   ✓ @nexpress/plugin-seo manifest validates
#   ✓ plugin registers in Block Registry (seo-preview block)
#   ✓ plugin registers in Hook Pipeline (content:afterPublish)
#   ✓ plugin API routes mount at /api/plugins/@nexpress/seo/sitemap.xml
#   ✓ plugin site routes rewrite /sitemap.xml to the namespaced API route
#   ✓ plugin setup() runs and actions register
#   ✓ plugin sitemap route returns XML with Content-Type header
```

### QA: Section 2 — Isolation Technology

**QA-2.1: Stage 2 Proxy enforcement (unit test)**

```bash
# Tool: vitest
# File: packages/core/src/__tests__/capability-proxy.test.ts
pnpm --filter @nexpress/core test -- --run capability-proxy.test

# Expected: All pass
# Test cases:
#   ✓ createCapabilityProxy(ctx, ["content:read"]).content.find() → resolves
#   ✓ createCapabilityProxy(ctx, []).content.find() → throws NxCapabilityError
#   ✓ proxy overhead < 0.1ms per property access (performance benchmark)
#   ✓ proxy does not leak internal ctx properties
```

**QA-2.2: Stage 3 isolated-vm smoke test (integration test)**

```bash
# Tool: vitest
# File: packages/core/src/__tests__/isolated-runner.test.ts
pnpm --filter @nexpress/core test -- --run isolated-runner.test

# Expected: All pass
# Prereq: npm install isolated-vm, Node.js started with --no-node-snapshot
# Test cases:
#   ✓ NxIsolatedPluginRunner initializes with 128MB isolate
#   ✓ callHook("content:afterPublish", payload) → returns result via bridge
#   ✓ plugin calls ctx.content.find() inside isolate → bridge RPC → host service → result
#   ✓ plugin without "content:read" calls ctx.content.find() → NxCapabilityError
#   ✓ infinite loop → timeout after 500ms, isolate disposed
#   ✓ memory exceed → isolate terminated, new isolate created
#   ✓ host.call() only accepts JSON-serializable data
```

**QA-2.3: Docker --no-node-snapshot (deployment check)**

```bash
# Tool: docker build + run
docker build -t nexpress-test .
docker run --rm nexpress-test node -e "require('isolated-vm')"

# Expected: Exit code 0, no snapshot error
# Verify: Dockerfile CMD or ENTRYPOINT includes NODE_OPTIONS=--no-node-snapshot
```

### QA: Section 3 — Bridge Pattern / Next.js RSC

**QA-3.1: Catch-all route resolves plugin blocks (e2e)**

```bash
# Tool: Playwright
# File: apps/web/e2e/plugin-blocks.spec.ts
pnpm --filter web exec playwright test plugin-blocks.spec.ts

# Expected: All pass
# Steps:
#   1. Navigate to a page with plugin block (e.g., seo-preview)
#   2. Assert block component renders in page HTML (SSR check — visible in page source)
#   3. Assert block uses --nx-color-* CSS vars (theme compliance)
#   4. Assert no hydration errors in browser console
```

**QA-3.2: Plugin admin panel loads via path string (e2e)**

```bash
# Tool: Playwright
# File: apps/web/e2e/plugin-admin.spec.ts
pnpm --filter web exec playwright test plugin-admin.spec.ts

# Expected: All pass
# Steps:
#   1. Login to admin (/admin)
#   2. Navigate to SEO panel (registered by plugin)
#   3. Assert SeoSettingsPanel component renders
#   4. Assert "Generate Sitemap" button exists
#   5. Click button → pluginAction() fires → returns ok: true
#   6. Assert success feedback in UI
```

**QA-3.3: Server action dispatcher security (integration test)**

```bash
# Tool: vitest
# File: packages/core/src/__tests__/action-dispatcher.test.ts
pnpm --filter @nexpress/core test -- --run action-dispatcher.test

# Expected: All pass
# Test cases:
#   ✓ pluginAction("@nexpress/seo", "generate-sitemap", {}) → ok: true
#   ✓ pluginAction("nonexistent", "anything", {}) → error: plugin not found
#   ✓ pluginAction("@nexpress/seo", "unregistered-action", {}) → error: action not found
#   ✓ pluginAction with inactive plugin → error: plugin not active
#   ✓ action result is JSON-serializable (no functions, no circular refs)
```

### QA: Section 4 — Declarative UI (NxWidget)

**QA-4.1: NxWidgetRenderer renders all widget types (component test)**

```bash
# Tool: vitest + @testing-library/react
# File: packages/admin/src/__tests__/widget-renderer.test.tsx
pnpm --filter @nexpress/admin test -- --run widget-renderer.test

# Expected: All pass
# Test cases (one per widget type):
#   ✓ { type: "card", title: "Test", children: [...] } → renders <Card>
#   ✓ { type: "button", label: "Go", action: "test" } → renders <Button>, fires pluginAction on click
#   ✓ { type: "form", children: [...inputs], onSubmit: "save" } → renders form, collects values, dispatches action
#   ✓ { type: "table", columns: [...], dataSource: "action:get-data" } → renders <Table>, fetches via action
#   ✓ { type: "stat", label: "Views", value: "100" } → renders stat display
#   ✓ { type: "alert", variant: "error", message: "fail" } → renders destructive Alert
#   ✓ nested widgets (stack > card > form > input) → renders full tree
#   ✓ unknown widget type → renders null, no crash
```

**QA-4.2: Widget action integration (e2e)**

```bash
# Tool: Playwright
# File: apps/web/e2e/widget-actions.spec.ts
pnpm --filter web exec playwright test widget-actions.spec.ts

# Expected: All pass
# Steps:
#   1. Load admin panel with a plugin using NxWidget settings panel
#   2. Fill form fields in the widget
#   3. Click submit button
#   4. Assert pluginAction is called with correct pluginId, actionName, form data
#   5. Assert success/error feedback renders in widget
```

### QA: Section 5 — Static Analysis

**QA-5.1: ESLint rules catch violations (unit test)**

```bash
# Tool: vitest + eslint RuleTester
# File: packages/plugin-sdk/src/__tests__/eslint-rules.test.ts
pnpm --filter @nexpress/plugin-sdk test -- --run eslint-rules.test

# Expected: All pass
# Test cases per rule:
#   ✓ nexpress/no-hardcoded-colors: `color: "#ff0000"` → error
#   ✓ nexpress/no-hardcoded-colors: `color: "var(--nx-color-primary)"` → pass
#   ✓ nexpress/no-important: `!important` → error
#   ✓ nexpress/no-direct-db: `import { drizzle } from "drizzle-orm"` → error
#   ✓ nexpress/no-dangerous-apis: `eval("code")` → error
#   ✓ nexpress/no-env-access: `process.env.SECRET` → warning
#   ✓ nexpress/manifest-required-fields: manifest without `id` → error
#   ✓ nexpress/no-react-version-pin: `"react": "^19.0.0"` in peerDeps → error
```

**QA-5.2: SDK build validates example plugin (integration test)**

```bash
# Tool: nexpress-sdk CLI
# Working directory: packages/plugins/nexpress-plugin-seo/
npx nexpress-sdk build

# Expected: Exit code 0
# Output includes:
#   ✓ Manifest valid
#   ✓ All component paths resolve
#   ✓ Capabilities match usage
#   ✓ Theme compliance: no hardcoded colors
#   ✓ Bundle size: < 500KB
#   ✓ No security warnings
```

**QA-5.3: SDK build rejects invalid plugin (integration test)**

```bash
# Tool: nexpress-sdk CLI
# Working directory: test fixture with violations
npx nexpress-sdk build --cwd fixtures/invalid-plugin/

# Expected: Exit code 1
# Output includes:
#   ✗ Manifest validation failed: missing `id`
#   ✗ Component path "./blocks/Missing.tsx" not found
#   ✗ Undeclared capability: plugin uses ctx.content.create() but declares only ["content:read"]
#   ✗ Hardcoded color found: `color: #333` in blocks/Header.tsx:14
```
