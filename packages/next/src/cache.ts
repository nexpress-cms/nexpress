import {
  NP_DEFAULT_SITE_ID,
  getActiveThemeId,
  getCurrentSiteId,
  getNavigation,
  getPluginConfig,
  getRegisteredThemes,
  getSiteById,
  getTheme,
  getThemeById,
  getThemeSettings,
  pluginConfigCacheTag,
} from "@nexpress/core";
import type { NpNavItem, NpRegisteredTheme, NpSite, NpThemeTokens } from "@nexpress/core";
import { unstable_cache } from "next/cache";
import { invalidateCacheTargets } from "./cdn-purge.js";

/**
 * Phase 14.3 — `unstable_cache` wrappers around the public-site
 * read paths that fire on every page render: theme tokens,
 * active theme id, and navigation menus. The DB hit on each
 * happens once per `(siteId[, location])` until a write
 * invalidates the matching tag.
 *
 * Tag scheme is site-scoped so multi-tenant deployments don't
 * lose unrelated sites' caches when a single tenant edits its
 * theme:
 *
 *   - `nx:theme:<siteId>`            — tokens + active theme id
 *   - `nx:nav:<siteId>:<location>`   — one tag per nav location
 *
 * Each call constructs a fresh `unstable_cache` wrapper because
 * the `tags` option is fixed at definition time and we need it
 * to vary by siteId. The factory call is cheap; Next dedupes by
 * the keyParts so repeat calls with the same siteId hit the same
 * cache entry.
 *
 * Cache misses fall through transparently: if `unstable_cache`
 * throws because Next's incremental cache isn't reachable
 * (integration tests, scripts, background workers), we run the
 * uncached read so the helpers still work outside a request
 * context. Same pattern as `sitemap.xml`'s wrapper.
 */

const REVALIDATE_SECONDS = 600;

function isMissingIncrementalCache(error: unknown): boolean {
  return error instanceof Error && /incrementalCache/i.test(error.message);
}

async function resolveSiteId(): Promise<string> {
  return (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
}

export function themeCacheTag(siteId: string): string {
  return `nx:theme:${siteId}`;
}

export function navCacheTag(siteId: string, location: string): string {
  return `nx:nav:${siteId}:${location}`;
}

/**
 * Invalidate every cache surface that depends on the active
 * theme for a given site: theme tokens, sitemap, Atom feed, and
 * the root layout. Shared between the active-theme PUT and the
 * reseed POST so both paths bust the same tags in the same
 * order. Swallow errors because `revalidateTag` / `revalidatePath`
 * throw outside a request context (test harnesses, scripts) and
 * the caller has already persisted state — surfacing a cache-bust
 * failure as a 500 would be a worse experience than letting the
 * tag expire naturally.
 */
export function bustThemeCache(siteId: string): Promise<void> {
  invalidateCacheTargets({
    source: "theme",
    siteId,
    // F.7 — bust SEO tags unconditionally on theme change. Gating
    // on the new theme's hooks misses the case where the OLD
    // theme contributed SEO entries that linger in cache until
    // natural expiry.
    tags: [themeCacheTag(siteId), `nx:sitemap:${siteId}`, `nx:feed:${siteId}`],
    paths: [{ path: "/", type: "layout" }],
  });
  return Promise.resolve();
}

/**
 * Tag for the active site's `np_sites` row read. Bust whenever
 * the operator renames the site or changes its hostname so
 * themes that render `site.name` in the masthead refresh on
 * the next request.
 */
export function siteCacheTag(siteId: string): string {
  return `np:site:${siteId}`;
}

/**
 * Cached read of the active site's `np_sites` row. Themes that
 * render the operator's site name in the masthead / footer use
 * this so a single rename in admin propagates without an env
 * var or a redeploy.
 *
 * Returns `null` when the site context resolves to a row that
 * doesn't exist (e.g. mid-deletion); callers fall back to a
 * theme-local default in that case.
 */
export async function getCachedSite(): Promise<NpSite | null> {
  const siteId = await resolveSiteId();
  const cached = unstable_cache(() => getSiteById(siteId), ["np:site", siteId], {
    tags: [siteCacheTag(siteId)],
    revalidate: REVALIDATE_SECONDS,
  });
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return getSiteById(siteId);
    throw error;
  }
}

export async function getCachedTheme(): Promise<NpThemeTokens> {
  const siteId = await resolveSiteId();
  const cached = unstable_cache(() => getTheme(), ["nx:theme", siteId], {
    tags: [themeCacheTag(siteId)],
    revalidate: REVALIDATE_SECONDS,
  });
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return getTheme();
    throw error;
  }
}

export async function getCachedActiveThemeId(): Promise<string | null> {
  const siteId = await resolveSiteId();
  const cached = unstable_cache(() => getActiveThemeId(), ["nx:theme:active-id", siteId], {
    tags: [themeCacheTag(siteId)],
    revalidate: REVALIDATE_SECONDS,
  });
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return getActiveThemeId();
    throw error;
  }
}

/**
 * Phase F.3 — cached read of a theme's operator settings.
 *
 * Reuses the existing `nx:theme:<siteId>` cache tag (settings
 * live on the same read paths as tokens / active id; bust them
 * together to keep the tag namespace tight). The `themeId`
 * keyParts entry ensures different themes' settings are
 * cached separately within the same site.
 */
export async function getCachedThemeSettings(themeId?: string): Promise<unknown> {
  const siteId = await resolveSiteId();
  const cached = unstable_cache(
    () => getThemeSettings(themeId),
    ["nx:theme:settings", siteId, themeId ?? ""],
    { tags: [themeCacheTag(siteId)], revalidate: REVALIDATE_SECONDS },
  );
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return getThemeSettings(themeId);
    throw error;
  }
}

/**
 * G.1 — cached read of a plugin's operator config.
 *
 * Tag scheme uses `np:plugin:<id>` (per CLAUDE.md "Naming
 * convention" the framework's owned-identifier prefix is `np`;
 * the legacy `nx:theme:*` tags above predate the prefix
 * migration and are NOT the convention for new tags). Bust on
 * save in the admin route handler.
 *
 * `siteId` keyParts entry keeps multi-tenant deployments scoped
 * — the same plugin id can have different config per site, and
 * cache entries shouldn't cross.
 */
export async function getCachedPluginConfig(pluginId: string): Promise<unknown> {
  const siteId = await resolveSiteId();
  const cached = unstable_cache(
    () => getPluginConfig(pluginId),
    ["np:plugin:config", siteId, pluginId],
    { tags: [pluginConfigCacheTag(pluginId)], revalidate: REVALIDATE_SECONDS },
  );
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return getPluginConfig(pluginId);
    throw error;
  }
}

export interface NpCachedThemeFetchOptions {
  /** Cache TTL in seconds. Defaults to 60 — theme route data
   *  (archives, search results, etc.) tends to be a lot more
   *  dynamic than tokens / active id, so a tight default keeps
   *  freshness reasonable while still cutting the per-request
   *  DB hit when traffic spikes on the same URL. Theme authors
   *  can pass a longer value for low-churn routes. */
  revalidate?: number;
  /** Extra tags to add alongside the always-on
   *  `nx:theme:<siteId>` so theme-switch / settings-save still
   *  bust this entry. Use for collection-scoped tags like
   *  `nx:collection:posts` so a content edit busts the relevant
   *  cached archive too. */
  extraTags?: string[];
}

/**
 * v0.3 (H) — per-route cache helper for theme route data
 * fetching.
 *
 * Theme routes (archives, custom URL patterns) render through
 * the framework's catch-all dispatcher, which doesn't expose
 * Next's route-segment `revalidate` at a per-pattern grain
 * (`/category/:slug` and `/author/:slug` share one segment).
 * This helper lets theme authors wrap their data fetches with
 * a per-key `unstable_cache` entry that:
 *
 *   - Auto-tags with `nx:theme:<siteId>` so theme switch /
 *     settings save / theme uninstall bust the cache.
 *   - Keys by site + author-supplied parts so `/category/tech`
 *     and `/category/design` cache independently.
 *   - Falls back to the uncached read when Next's incremental
 *     cache isn't reachable (integration tests, scripts).
 *
 * **Key namespacing** — prefix the first key part with a
 * theme/plugin id so two themes (or a theme + a plugin) using
 * the same route name don't collide on the cache. Convention:
 * `["<theme-id>.<route-name>", ...inputs]`.
 *
 * **Include every fetcher input in `keyParts`** — the cache
 * keys ONLY by what's in `keyParts`, not by what the fetcher
 * closes over. A `slug`, `pageSize`, or `locale` the fetcher
 * uses MUST appear in `keyParts` or different inputs will
 * silently share a cache entry.
 *
 * Example:
 *
 * ```ts
 * import { cachedThemeFetch } from "@nexpress/next";
 *
 * export async function CategoryArchive({ params }) {
 *   const data = await cachedThemeFetch(
 *     ["magazine.category-archive", params.slug, String(pageSize)],
 *     async () => {
 *       const cats = await findDocuments("categories", {...});
 *       const posts = await findDocuments("posts", {...});
 *       return { cats, posts };
 *     },
 *     {
 *       revalidate: 60,
 *       extraTags: ["nx:collection:posts", "nx:collection:categories"],
 *     },
 *   );
 *   return <ArchiveLayout posts={data.posts.docs} />;
 * }
 * ```
 *
 * `extraTags` is the escape hatch for authors who want a
 * collection edit to also bust the cached archive — pass a
 * `nx:collection:<slug>` tag for EVERY collection the fetcher
 * reads from. The framework's `revalidateCollection` emits the
 * matching generic collection tag on every write, even when the
 * collection has no path-specific revalidation rule.
 */
export async function cachedThemeFetch<T>(
  keyParts: string[],
  fetcher: () => Promise<T>,
  options?: NpCachedThemeFetchOptions,
): Promise<T> {
  const siteId = await resolveSiteId();
  const tags = [themeCacheTag(siteId), ...(options?.extraTags ?? [])];
  const cached = unstable_cache(fetcher, ["nx:theme-fetch", siteId, ...keyParts], {
    tags,
    revalidate: options?.revalidate ?? 60,
  });
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return fetcher();
    throw error;
  }
}

export interface NpCachedPluginFetchOptions {
  /** Cache TTL in seconds. Defaults to 60 — same rationale as
   *  `cachedThemeFetch`: plugin pages tend to be more dynamic
   *  than config / static settings, so a short floor keeps
   *  freshness reasonable while still deduping under traffic
   *  spikes. Plugins serving low-churn data can pass a longer
   *  value. */
  revalidate?: number;
  /** Extra tags to add alongside the always-on
   *  `np:plugin:<pluginId>` (which the framework auto-busts on
   *  plugin-config save / plugin disable). Use for
   *  collection-scoped tags like `nx:collection:discussions`
   *  so a content edit busts the relevant cached page too. */
  extraTags?: string[];
}

/**
 * Plugin-side parallel of `cachedThemeFetch`. Wraps a plugin
 * route's data fetch in `unstable_cache` with the plugin's
 * config tag (`np:plugin:<pluginId>`) so:
 *
 *   - Saving the plugin's config in `/admin/plugins/<id>` busts
 *     the cache automatically (the framework already revalidates
 *     this tag inside `setPluginConfig`).
 *   - Reloading or disabling the plugin from the admin shell
 *     busts the cache too (same tag).
 *   - Multi-tenant deployments key by site, so site A's cache
 *     doesn't leak into site B.
 *
 * **Key namespacing.** The cache key is
 * `["np:plugin-fetch", siteId, pluginId, ...keyParts]`. Plugin
 * authors don't need to prefix their own keyParts with the
 * plugin id — the wrapper does that. Within a plugin, prefix
 * by route or fetcher name (e.g. `["forum.list", String(page)]`)
 * so two routes in the same plugin don't collide.
 *
 * **Include every fetcher input in `keyParts`** — `unstable_cache`
 * keys ONLY by what's in `keyParts`, not by what the fetcher
 * closes over. A `slug`, `pageSize`, or `locale` the fetcher
 * uses MUST appear in `keyParts` or different inputs will
 * silently share a cache entry.
 *
 * Example:
 *
 * ```ts
 * import { cachedPluginFetch } from "@nexpress/next";
 *
 * export async function ListRoute({ searchParams }) {
 *   const page = Number(searchParams.page ?? 1);
 *   const data = await cachedPluginFetch(
 *     "forum",
 *     ["list", String(page)],
 *     async () => findDocuments("discussions", { page }),
 *     { revalidate: 60, extraTags: ["nx:collection:discussions"] },
 *   );
 *   // ...
 * }
 * ```
 *
 * `extraTags` is the escape hatch for plugins whose data depends
 * on collections. Use `nx:collection:<slug>` for every collection
 * the fetcher reads; the framework emits that generic tag on each
 * collection write. The always-on `np:plugin:<pluginId>` tag is
 * fired automatically by `setPluginConfig` — plugin-config saves
 * invalidate the cache without extra setup.
 */
export async function cachedPluginFetch<T>(
  pluginId: string,
  keyParts: string[],
  fetcher: () => Promise<T>,
  options?: NpCachedPluginFetchOptions,
): Promise<T> {
  const siteId = await resolveSiteId();
  const tags = [pluginConfigCacheTag(pluginId), ...(options?.extraTags ?? [])];
  const cached = unstable_cache(fetcher, ["np:plugin-fetch", siteId, pluginId, ...keyParts], {
    tags,
    revalidate: options?.revalidate ?? 60,
  });
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return fetcher();
    throw error;
  }
}

/**
 * Cached active-theme lookup. Mirrors core's
 * `getActiveTheme()` semantics — falls back to the first
 * registered theme when the persisted id is unset, missing, or
 * points at an unregistered theme — but only the id read hits
 * the cache. Registry lookups are in-memory and don't need
 * caching.
 *
 * Return type is the registered theme object, which contains
 * React components in `impl` and so can't itself live inside an
 * `unstable_cache`. Caching the id (string) and resolving
 * uncached after preserves the in-process registry semantics
 * while skipping the DB hit.
 */
export async function getCachedActiveTheme(): Promise<NpRegisteredTheme | null> {
  const id = await getCachedActiveThemeId();
  if (id) {
    const theme = getThemeById(id);
    if (theme) return theme;
  }
  const all = getRegisteredThemes();
  return all[0] ?? null;
}

export async function getCachedNavigation(location: string = "header"): Promise<NpNavItem[]> {
  const siteId = await resolveSiteId();
  const cached = unstable_cache(() => getNavigation(location), ["nx:nav", siteId, location], {
    tags: [navCacheTag(siteId, location)],
    revalidate: REVALIDATE_SECONDS,
  });
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return getNavigation(location);
    throw error;
  }
}
