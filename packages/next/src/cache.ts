import {
  NX_DEFAULT_SITE_ID,
  getActiveThemeId,
  getCurrentSiteId,
  getNavigation,
  getRegisteredThemes,
  getTheme,
  getThemeById,
} from "@nexpress/core";
import type {
  NpNavItem,
  NpRegisteredTheme,
  NpThemeTokens,
} from "@nexpress/core";
import { unstable_cache } from "next/cache";

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
  return (
    error instanceof Error && /incrementalCache/i.test(error.message)
  );
}

async function resolveSiteId(): Promise<string> {
  return (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
}

export function themeCacheTag(siteId: string): string {
  return `nx:theme:${siteId}`;
}

export function navCacheTag(siteId: string, location: string): string {
  return `nx:nav:${siteId}:${location}`;
}

export async function getCachedTheme(): Promise<NpThemeTokens> {
  const siteId = await resolveSiteId();
  const cached = unstable_cache(
    () => getTheme(),
    ["nx:theme", siteId],
    { tags: [themeCacheTag(siteId)], revalidate: REVALIDATE_SECONDS },
  );
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return getTheme();
    throw error;
  }
}

export async function getCachedActiveThemeId(): Promise<string | null> {
  const siteId = await resolveSiteId();
  const cached = unstable_cache(
    () => getActiveThemeId(),
    ["nx:theme:active-id", siteId],
    { tags: [themeCacheTag(siteId)], revalidate: REVALIDATE_SECONDS },
  );
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return getActiveThemeId();
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

export async function getCachedNavigation(
  location: string = "header",
): Promise<NpNavItem[]> {
  const siteId = await resolveSiteId();
  const cached = unstable_cache(
    () => getNavigation(location),
    ["nx:nav", siteId, location],
    { tags: [navCacheTag(siteId, location)], revalidate: REVALIDATE_SECONDS },
  );
  try {
    return await cached();
  } catch (error) {
    if (isMissingIncrementalCache(error)) return getNavigation(location);
    throw error;
  }
}
