import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";

import type {
  NpBlockDefinition,
  NpBlockRenderContext,
  NpPattern,
} from "@nexpress/blocks";

/**
 * Local mirrors of `NpSitemapEntry` / `NpFeedEntry` from
 * `@nexpress/core` — same workaround as `NpThemeTokensOverlay`
 * elsewhere in this file. tsup's DTS bundler intermittently
 * fails to resolve named types across the `@nexpress/core`
 * boundary even when the symbols are present in the consumed
 * `dist/index.d.ts`. The structural mirror keeps theme authors
 * able to author hooks against the same shape; the runtime
 * passes values through unchanged so the structural identity
 * is enough.
 */
type LocalNpSitemapEntry = {
  loc: string;
  lastmod?: string;
  changefreq?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
};

type LocalNpFeedEntry = {
  id: string;
  title: string;
  summary: string | null;
  link: string;
  author: string | null;
  updated: string;
  published: string | null;
};
import type {
  NpRegisteredTheme,
  NpThemeColors,
  NpThemeManifest,
  NpThemeShape,
  NpThemeTypography,
} from "@nexpress/core";

/**
 * Local mirror of `NpNavItem` from `@nexpress/core` — same
 * tsup-DTS-bundler workaround as `NpThemeTokensOverlay` /
 * `LocalNpSitemapEntry` elsewhere in this file. The bundler
 * intermittently fails to resolve the named type across the
 * `@nexpress/core` boundary; the structural mirror keeps
 * theme authors able to declare nav items against the same
 * shape. The runtime passes values through unchanged so the
 * structural identity is enough.
 */
type LocalNpNavItem = {
  id: string;
  label: string;
  type: "link" | "collection" | "page";
  url?: string;
  collection?: string;
  collectionSlug?: string;
  pageId?: string;
  children?: LocalNpNavItem[];
};

/**
 * Local mirror of `NpThemeTokensOverlay` from `@nexpress/core` —
 * authored as `Partial`s of each sub-tree so a theme that overrides
 * only a few tokens (e.g. `colors.primary`) doesn't have to copy
 * the rest from `DEFAULT_THEME`. The runtime merger in
 * `@nexpress/core`'s `getTheme()` accepts the same shape and layers
 * it onto framework defaults before serving them.
 *
 * Re-declared here (instead of imported by name) as a workaround:
 * tsup's DTS bundler failed to resolve the named type from
 * `@nexpress/core/dist/index.d.ts` even though the symbol was
 * present in the file — likely a quirk in how the bundler walks
 * cross-package exports for type-only imports. Structural identity
 * is what consumers depend on, so the duplicated declaration is
 * functionally equivalent. If you're consuming this externally,
 * prefer importing `NpThemeTokensOverlay` from `@nexpress/core`
 * directly — this copy is a build-time crutch, not a parallel
 * surface.
 */
export interface NpThemeTokensOverlay {
  colors?: Partial<NpThemeColors>;
  typography?: Partial<NpThemeTypography>;
  shape?: Partial<NpThemeShape>;
}

/**
 * Phase 11.1 — `NpTheme` is the typed shape themes export.
 * Extends the core's opaque `NpRegisteredTheme.impl` slot
 * with React component types so consumers (the framework's
 * site layout, the admin theme picker) can render the right
 * pieces without typing them as `unknown` everywhere.
 *
 * Themes ship as npm packages that call `defineTheme(...)`
 * and export the result. The reference app registers them
 * in `nexpress.config.ts`'s `themes` array.
 */

export interface NpThemeShellProps {
  children: ReactNode;
}

export interface NpThemeSlots {
  /**
   * Renders inside the shell, above the main content area.
   * Typically the site nav. The framework provides no fallback;
   * if a theme omits `header`, the area is simply absent.
   */
  header?: ComponentType;
  /** Renders below the main content area. */
  footer?: ComponentType;
  /** Stand-alone navigation surface (e.g. mobile drawer). */
  nav?: ComponentType;
  /** Side rail for templates that opt into it. Optional. */
  sidebar?: ComponentType;
  /** Renders just before the page's content (banners, breadcrumbs). */
  beforeContent?: ComponentType;
  /** Renders just after the page's content (CTA, related posts). */
  afterContent?: ComponentType;
}

export interface NpTemplateRenderProps<T = Record<string, unknown>> {
  /** The doc being rendered, in whatever shape the collection produces. */
  doc: T;
  /**
   * Server-built block render ctx (issue #476). The site renderer
   * builds one per page render and threads it through so theme
   * templates that call `renderBlocks(blocks)` can pass it on:
   *
   *   renderBlocks(blocks, { ctx: blockCtx })
   *
   * Without it, data-bound blocks (`latest-posts`, `stats.counter`,
   * etc.) render the "ctx unavailable" placeholder instead of
   * querying content. Theme packages that don't ship data-bound
   * blocks can ignore the field entirely; static themes keep the
   * pre-#476 call shape unchanged.
   */
  blockCtx?: NpBlockRenderContext;
}

/**
 * A single page template. Each template carries human-readable
 * metadata so the admin picker (11.3) can render a meaningful
 * dropdown — bare component refs would force callers to maintain
 * a parallel id→label map.
 */
export interface NpThemeTemplate<T = Record<string, unknown>> {
  /** Human label shown in the admin template picker. */
  label: string;
  /** Optional description shown beneath the picker. */
  description?: string;
  /** The render component receives `{ doc }` and returns the page body. */
  component: ComponentType<NpTemplateRenderProps<T>>;
}

/**
 * Per-collection page templates.
 *
 *   templates: {
 *     pages: {
 *       default: { label: "Default", component: PageDefault },
 *       wide:    { label: "Wide", component: PageWide },
 *     },
 *     posts: { default: { label: "Article", component: PostArticle } },
 *   }
 *
 * The catch-all reads `doc.template` (or falls back to `default`)
 * and renders the corresponding component. Themes that don't
 * declare templates for a collection let the framework's existing
 * rendering path run.
 */
export type NpThemeTemplates = Record<
  string,
  Record<string, NpThemeTemplate>
>;

/**
 * Phase F.2 — props passed to a theme route component.
 *
 * `params` are extracted from the URL pattern (`/category/:slug`
 * → `{ slug: "politics" }`). `searchParams` are the URL query
 * string. `blockCtx` is the same server-built context page
 * templates already receive — pass it on to `renderBlocks` if
 * the route renders any blocks.
 */
export interface NpRouteRenderProps {
  params: Record<string, string>;
  searchParams: Record<string, string | string[] | undefined>;
  blockCtx: NpBlockRenderContext;
}

/**
 * Phase F.2 — one declared dynamic route on a theme.
 *
 * The pattern syntax is a simplified path-to-regexp subset:
 * literal segments must match exactly, `:name` matches a single
 * segment and captures it as a param, and `:name(regex)`
 * constrains the captured segment to the regex. Examples:
 *
 *   "/category/:slug"
 *   "/author/:id"
 *   "/:year(\\d{4})/:month(\\d{2})"
 *   "/search"
 *   "/lookbook"
 *
 * Patterns with multiple segments are matched left-to-right and
 * must consume the entire request path (no glob/wildcard in
 * v0.2). Theme routes are checked AFTER the page-document slug
 * lookup, so an operator who creates a page with the same slug
 * always wins — see `docs/design/theme-v0.2-extension.md` §4.2.
 */
export interface NpThemeRoute {
  pattern: string;
  component: ComponentType<NpRouteRenderProps>;
  /**
   * Optional metadata builder. The framework's `generateMetadata`
   * uses the same dispatcher; if a route matches and declares
   * `metadata`, this builder runs in place of the page-fallback.
   * Without it, theme-rendered routes would emit framework-default
   * SEO — a real bug.
   */
  metadata?: (
    ctx: NpRouteRenderProps,
  ) => Promise<Metadata> | Metadata;
  // Note: a `revalidate` hint was considered but dropped from
  // v0.2 — Next's route-segment `revalidate` export is static
  // and can't vary per URL pattern from a single catch-all.
  // Theme routes that want caching wrap their data fetches in
  // `unstable_cache(...)` themselves. Per-route revalidation
  // semantics are tracked as a v0.3 candidate.
}

/**
 * Phase F.2 — sugar layer over `routes` for the most common
 * archive shapes. Each entry expands into a route at boot:
 *
 *   archives: {
 *     posts: {
 *       byCategory: { component: CategoryArchive },
 *       byTag:      { component: TagArchive },
 *       byAuthor:   { component: AuthorArchive },
 *       byDate:     { component: DateArchive, granularity: "month" },
 *       search:     { component: SearchResults },
 *     },
 *   }
 *
 * Default patterns (overridable per entry via `pattern`):
 *
 *   byCategory → "/category/:slug"
 *   byTag      → "/tag/:slug"
 *   byAuthor   → "/author/:id"
 *   byDate     → "/:year(\\d{4})/:month(\\d{2})" (granularity: month)
 *   search     → "/search"
 */
export interface NpThemeArchiveEntry {
  component: ComponentType<NpRouteRenderProps>;
  /** Override the default pattern for this archive kind. */
  pattern?: string;
  metadata?: NpThemeRoute["metadata"];
}

export interface NpThemeDateArchiveEntry extends NpThemeArchiveEntry {
  granularity: "year" | "month" | "day";
}

export interface NpThemeArchives {
  /**
   * Multi-collection note: the default patterns
   * (`/category/:slug`, `/tag/:slug`, `/author/:id`, `/search`)
   * don't include the collection name, so a theme that uses the
   * same archive kind for multiple collections (e.g. both
   * `posts.byCategory` AND `products.byCategory`) MUST override
   * the `pattern` for at least N-1 of them — otherwise both
   * register the same default pattern and only the first
   * declared one is reachable. The framework logs a one-time
   * dev warning when it detects pattern collisions in
   * `collectThemeRoutes`.
   */
  [collectionSlug: string]: {
    byCategory?: NpThemeArchiveEntry;
    byTag?: NpThemeArchiveEntry;
    byAuthor?: NpThemeArchiveEntry;
    byDate?: NpThemeDateArchiveEntry;
    search?: NpThemeArchiveEntry;
  };
}

/**
 * Static seed data themes ship for first-boot demo content.
 *
 * The setup wizard reads the active theme's `impl.seedContent`
 * and feeds it through the framework's seeder
 * (`seedAll` in `@nexpress/app`), so each piece flows through
 * the normal collection pipeline — access control, hooks,
 * validation, search-vector build, all the same as a write
 * coming from the admin. Themes therefore declare WHAT to seed,
 * not HOW; calling `saveDocument` directly from a theme would
 * bypass the pipeline and is not supported.
 *
 * All entries are optional; omitted slots fall through to the
 * framework's generic seed content (the current "Welcome to
 * NexPress" pages + 5 framework-themed posts). Themes that ship
 * a partial overlay (e.g. only `posts`, no custom pages) keep
 * the generic pages and override just the posts.
 *
 * **Asset references** — image URLs in `blocks` props (`hero.
 * backgroundImage`, `logosCloud.items[].src`, etc.) are baked
 * into the seeded page exactly as authored. Themes that need
 * branded imagery should reference URLs that don't go away
 * (their own CDN, a stable third-party host) — the seed pages
 * outlive the install, so a 404'd asset URL ships forever.
 */
export interface NpThemeSeedTerm {
  name: string;
  description?: string;
}

export interface NpThemeSeedPage {
  title: string;
  /**
   * Override slug — e.g. `"/"` for the home page. The pipeline's
   * `slugField` normally derives the slug from `title`; passing
   * `slug` skips the derivation. Mostly used for `/`.
   */
  slug?: string;
  seoDescription?: string;
  /**
   * `NpBlockInstance[]` — kept as `unknown[]` here so the seed
   * types don't drag the blocks JSON shape across the package
   * boundary. The framework's seeder treats the array opaquely
   * and writes it to the `blocks` field on the seeded page.
   */
  blocks: unknown[];
}

export interface NpThemeSeedPost {
  title: string;
  excerpt: string;
  /**
   * Lexical rich-text document — same opacity rationale as
   * `NpThemeSeedPage.blocks`. The seeder passes it through to
   * the `content` field unchanged.
   */
  content: unknown;
  /** ISO date string. Past = published; future = scheduled. */
  publishedAt: string;
  status?: "draft" | "published";
  /**
   * Content-type discriminator. Defaults to `"article"`. Themes
   * seeding hierarchical content (docs, projects, …) set this
   * to the kind they registered via
   * `requires.collections.posts.fields.kind.options`. Unknown
   * kinds fail validation at seed time — the merge-requirements
   * union is the source of truth for valid kinds.
   * Universal-content-model Phase U.1 (#748).
   */
  kind?: string;
  /**
   * Hierarchical-kind support: parent post's slug. The seeder
   * resolves the slug to an id at seed time, after all sibling
   * rows have been written (two-pass), so seed authors can
   * reference parents declared later in the same array.
   * Optional and only meaningful for hierarchical kinds.
   */
  parentSlug?: string;
  /** Sort order within a parent. Only meaningful for hierarchical kinds. */
  order?: number;
  /**
   * Tag names to link via the `tags` collection. Names that
   * don't resolve (the seeder didn't create the tag, or the
   * theme didn't seed tags but referenced one) are skipped
   * silently — the post still seeds, just without that link.
   */
  tagNames?: string[];
  /**
   * Extra fields merged onto the seeded post. The pipeline's
   * Zod validation strips keys the collection doesn't declare,
   * so extra fields are silently dropped rather than rejected.
   * Use this for theme-contributed fields (lede, stableSince,
   * badge, …) that don't have first-class slots on this type.
   */
  data?: Record<string, unknown>;
}

export interface NpThemeSeedNavigation {
  header?: LocalNpNavItem[];
  footer?: LocalNpNavItem[];
}

export interface NpThemeSeedContent {
  tags?: NpThemeSeedTerm[];
  categories?: NpThemeSeedTerm[];
  pages?: NpThemeSeedPage[];
  /**
   * Posts seed. Each entry may carry a `kind` field (defaults to
   * `"article"`) so themes can seed documentation, projects, and
   * other content kinds through the same slot — the docs / project
   * rows land in `np_c_posts` with their kind set, the same as
   * runtime-authored content. Universal-content-model Phase U.1
   * (#748) — the legacy `documents` slot is gone.
   */
  posts?: NpThemeSeedPost[];
  navigation?: NpThemeSeedNavigation;
}

export interface NpThemeImpl {
  /** Site-wide shell. Wraps every (site) route. */
  shell?: ComponentType<NpThemeShellProps>;
  slots?: NpThemeSlots;
  /** Per-collection page templates (`{ posts: { default: ..., featured: ... } }`). */
  templates?: NpThemeTemplates;
  /**
   * Default tokens. Each sub-tree (colors / typography / shape) is
   * a `Partial<...>` so a theme that overrides only a few keys
   * (e.g. `colors.primary` + `typography.fontHeading`) doesn't have
   * to copy the rest from `DEFAULT_THEME`. The runtime merger in
   * `getTheme()` layers this overlay onto the framework defaults
   * before serving them. Admin overrides via the theme settings
   * tab compose on top in turn.
   */
  tokens?: NpThemeTokensOverlay;
  /**
   * Theme-owned CSS, served alongside the theme's components.
   * The framework injects this as a `<style data-np-theme="{id}">`
   * tag in the layout's head when this theme is active. Phase 11.2
   * lets themes ship the layout-level rules (header / footer /
   * shell) that previously lived in `apps/web/globals.css` so a
   * theme swap actually changes the rendered shell, not just the
   * components but the styles around them. Cross-theme primitives
   * (form inputs, member auth pages, etc.) stay in the consuming
   * app's globals.css because they aren't theme-specific.
   */
  css?: string;
  /**
   * Phase 12.5 — UI string bundles per locale. Themes that
   * render hardcoded chrome ("Read more", "by {{author}}",
   * "{{minutes}} min read") localize them by registering keys
   * here and calling `t(key, locale, params)` from their
   * components. The theme registry merges these into the
   * global string registry at activation time.
   *
   *   i18n: {
   *     en: { "magazine.tagline": "Stories, essays, reports" },
   *     ko: { "magazine.tagline": "이야기, 에세이, 리포트" },
   *   }
   */
  i18n?: Record<string, Record<string, string>>;
  /**
   * Phase F.2 — declared dynamic routes the framework's
   * catch-all should dispatch to. Linear match order; first
   * pattern to match wins. Checked AFTER app-explicit Next.js
   * routes and the page-document slug lookup.
   */
  routes?: NpThemeRoute[];
  /**
   * Phase F.2 — sugar over `routes` for the common archive
   * patterns (`byCategory` / `byTag` / `byAuthor` / `byDate` /
   * `search`). The framework expands these into routes at boot
   * with sensible default patterns.
   */
  archives?: NpThemeArchives;
  /**
   * Phase F.4 — theme-shipped block types.
   *
   * Themes can register their own block definitions (e.g.
   * `magazine.hero-feature`, `magazine.three-col-grid`) that
   * appear in the page-builder's Add-block popover and resolve
   * during server render exactly like plugin blocks. The
   * framework auto-stamps each block's `source` with the
   * concrete `theme:<manifest.id>` identity at registration so
   * the active-source filter can distinguish (e.g.) magazine's
   * blocks from portfolio's in a multi-site process.
   *
   * Type prefix on block `type` strings (e.g. `magazine.hero-
   * feature`) is convention; `source` identity is the contract
   * the activation filter uses. See design doc §4.4 for the
   * append-only-registry / filter-at-read-time model that lets
   * site A active=magazine and site B active=portfolio coexist
   * in the same process.
   */
  blocks?: NpBlockDefinition[];
  /**
   * Phase F.5 — theme-shipped block patterns.
   *
   * Themes can register pre-shaped block subtrees that appear
   * in the page-builder's pattern picker (Cmd-K → "Pattern"
   * group today; a categorized + thumbnailed picker is tracked
   * as F.5.1 follow-up). Operators drop a pattern in one click,
   * the editor deep-clones it with fresh ids, and the resulting
   * blocks are regular editable instances.
   *
   * Bootstrap auto-stamps `source: "theme:<manifest.id>"` on
   * each pattern so the active-source filter scopes patterns
   * the same way it scopes blocks (multi-site safe).
   */
  patterns?: NpPattern[];
  /**
   * Phase F.6 — declared nav menu mount points.
   *
   * Themes name the semantic nav locations they consume in
   * their shell / slot components (e.g. `primary` for the
   * header nav, `footerLinks` for the footer column, etc.).
   * The admin nav editor reads this to populate its location
   * dropdown with friendly labels operator-side, instead of
   * forcing the operator to type a string that has to match
   * the theme's expectation.
   *
   * Theme components consume the mounted menu via
   * `<NavMenu location="primary" />` from `@nexpress/next` —
   * the component reads `getNavigation(locationKey)` for the
   * current site and renders the items.
   *
   * The location keys are free-form per theme; declared keys
   * appear alongside the framework's hardcoded defaults
   * (`header` / `footer` / `main`) and any custom locations the
   * operator has authored. Theme-provided labels win on key
   * collision (e.g. theme declares `header` with label "Site
   * Header" — the editor shows that instead of the default).
   */
  navLocations?: Record<string, NpThemeNavLocation>;
  /**
   * Phase F.7 — error / 404 page chrome.
   *
   * `notFound` renders for `(site)/not-found.tsx` (any 404
   * inside the public site). `error` is the Next error
   * boundary fallback for `(site)/error.tsx` — its props
   * follow Next's `ErrorBoundary` shape.
   *
   * Both fall back to framework defaults when omitted, so
   * themes can opt into one or both without forcing the other.
   *
   * **F.7.1 — `error` delegation pattern**: Next requires
   * `error.tsx` to be a client component, so the framework
   * can't transparently consume an `impl.error` declared on a
   * server-imported registry (the React server→client boundary
   * blocks it). Themes that want custom error chrome ship a
   * SEPARATE client component at a `./components/error`
   * subpath of their package; the operator's `(site)/error.tsx`
   * lazy-imports it based on the active theme id (read from the
   * `<style data-np-theme>` tag emitted by the layout). This
   * `impl.error` slot is kept as a forward-compat type marker —
   * a future Next API for server-rendered error fallbacks
   * would let the framework wire it transparently.
   *
   * Reference implementation:
   * `@nexpress/theme-magazine/components/error` +
   * `apps/web/src/app/(site)/error.tsx`'s registry.
   */
  notFound?: ComponentType;
  error?: ComponentType<NpThemeErrorProps>;
  /**
   * Phase M.1 — member surface skinning.
   *
   * Optional override slots for the `(member)/members/*` route
   * tree (login / register / forgot-password / reset-password /
   * verify / me/notifications). Lets a theme wrap the
   * framework-owned auth pages in the same masthead + footer it
   * uses for the public site, without rewriting the form-submit
   * + email-verification + OAuth flows that live in the framework.
   *
   * **Fallback chain** at the `(member)/layout.tsx` level:
   *   1. `impl.members.shell` truthy → use it
   *   2. `impl.members.shell === null` → opt out explicitly
   *      (member pages render bare, no shell wrap — useful for
   *      themes where the public-site shell would clash with
   *      narrow auth forms)
   *   3. `impl.members.shell === undefined` → fall back to
   *      `impl.shell` (the public-site shell)
   *   4. `impl.shell === undefined` → transparent fragment
   *
   * `pageTitle` carries theme-provided variants of the framework's
   * default member chrome strings ("Sign in", "Create account",
   * etc.). Operators with the i18n package layer per-locale
   * overrides on top via the existing UI-string registry.
   *
   * See `docs/design/member-surface-skinning.md` for the contract
   * + reference implementation plan.
   */
  members?: {
    shell?: ComponentType<NpThemeShellProps> | null;
    pageTitle?: {
      login?: string;
      register?: string;
      forgotPassword?: string;
      resetPassword?: string;
      verify?: string;
      notifications?: string;
    };
    /**
     * Phase M.3 — member-tree 404. Mirrors `impl.notFound` for
     * the `(member)/members/*` route subtree. Server-rendered;
     * core resolves it via `getActiveThemeMembersNotFound()` and
     * `apps/web/src/app/(member)/not-found.tsx` casts to
     * `ComponentType` at the JSX site.
     *
     * Falls back to `impl.notFound` when omitted (which itself
     * falls back to the framework default). Set explicitly when
     * the member surface needs a different 404 voice — e.g. a
     * "this auth link expired" tone vs the public site's "this
     * post no longer exists" tone.
     */
    notFound?: ComponentType;
    /**
     * Phase M.3 — member-tree error boundary. Forward-compat
     * type marker; behaves the same way `impl.error` does for
     * the public site (F.7.1 delegation pattern: themes ship a
     * `./components/members-error` client subpath, the operator's
     * `(member)/error.tsx` lazy-imports it based on the active
     * theme id from the `<style data-np-theme>` tag).
     *
     * Falls back to `impl.error` when omitted; ultimately to the
     * framework default. The runtime registry of theme-id → lazy
     * import lives in `apps/web/src/app/(member)/error.tsx`;
     * adding a theme means adding an entry there.
     */
    error?: ComponentType<NpThemeErrorProps>;
  };
  /**
   * Phase F.7 — SEO surface contributions.
   *
   * Themes can extend the framework-built sitemap and feed
   * with their own dynamic entries (e.g. magazine archive
   * pages that aren't in the regular collection walk) or
   * override the `robots.txt` body. The framework merges
   * `sitemapEntries` / `feedEntries` results into the standard
   * output; `robotsTxt` (when present) replaces the framework
   * default entirely.
   *
   * Cache invalidation: when the active theme contributes any
   * of these hooks, theme switches and theme settings saves
   * additionally bust the `nx:sitemap:<siteId>` and
   * `nx:feed:<siteId>` tags so the SEO output stays in sync.
   * The framework wires this — themes don't have to opt in.
   */
  seo?: NpThemeSeoHooks;
  /**
   * Theme-shipped first-boot demo content.
   *
   * Consumed by the setup wizard's `seedAll(actor, theme)`
   * dispatch when the operator opts into sample content. Each
   * slot is independent: a theme that overrides only `posts`
   * keeps the framework's generic pages and seeds the posts on
   * top. See `NpThemeSeedContent` for the shape and the
   * "asset references" note (image URLs are baked into the
   * seeded page exactly as authored).
   *
   * When the active theme has no `seedContent` (or this slot is
   * unset), the setup wizard falls back to the framework's
   * generic "Welcome to NexPress" pages + 5 framework-themed
   * posts. That fallback is the v0.1 default; built-in themes
   * are expected to override it in their respective refactor
   * PRs so the demo content matches the theme's visual
   * language.
   */
  seedContent?: NpThemeSeedContent;
}

/**
 * Phase F.7 — props passed to a theme `error` component. Mirrors
 * Next's error boundary shape so themes can drop in a
 * function-shaped component without translation.
 */
export interface NpThemeErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export interface NpThemeSeoHooks {
  /** Extra sitemap entries beyond the framework's collection
   *  walk. Returned entries are deduplicated by `loc` against
   *  the framework output (framework wins on collision). */
  sitemapEntries?: () =>
    | Promise<LocalNpSitemapEntry[]>
    | LocalNpSitemapEntry[];
  /** Extra feed entries beyond the framework's collection feed.
   *  Same dedup behavior. */
  feedEntries?: () =>
    | Promise<LocalNpFeedEntry[]>
    | LocalNpFeedEntry[];
  /** Replace the framework's default `robots.txt` body. Returns
   *  the full body string. Omitting falls back to the framework
   *  default. */
  robotsTxt?: () => string | Promise<string>;
}

/**
 * Phase F.6 — one declared nav location.
 *
 * `label` is the human-readable name shown in admin (e.g.
 * "Primary header nav"). `description` and `maxItems` are
 * advisory hints surfaced in the location's edit panel.
 */
export interface NpThemeNavLocation {
  label: string;
  description?: string;
  maxItems?: number;
}

export interface NpTheme extends NpRegisteredTheme {
  manifest: NpThemeManifest;
  impl: NpThemeImpl;
}

/**
 * Identity helper. Themes call this so TypeScript infers the
 * full `NpTheme` shape; the runtime is a no-op pass-through.
 * Mirrors `definePlugin()` and `defineCollection()` from the
 * rest of the framework.
 */
export function defineTheme(theme: NpTheme): NpTheme {
  return theme;
}
