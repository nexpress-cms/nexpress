import { and, desc, eq } from "drizzle-orm";

import { npSettings } from "../db/schema/system.js";
import { npNavigation, npSlugHistory } from "../db/schema/system.js";
import type { NpThemeTokens, NpThemeTokensOverlay } from "../theme/types.js";
import type { NpNavItem, NpFindOptions, NpFindResult, NpAuthUser } from "../config/types.js";
import { DEFAULT_THEME } from "../theme/defaults.js";
import { findDocuments, getCollectionConfig, getDb } from "../collections/index.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { getActiveTheme } from "../themes/registry.js";

/**
 * Phase 15.4 — every settings/navigation read scopes by the
 * current site id so each tenant gets its own theme tokens,
 * navigation menus, and arbitrary settings. The resolver
 * falls back to the default site when no request context is
 * set (background workers, scripts, tests with no resolver
 * wired) so existing single-tenant code keeps working
 * unchanged.
 */
async function resolveSiteId(): Promise<string> {
  return (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
}

/**
 * Resolves the effective theme tokens for the current site by
 * layering three sources, last-writer-wins:
 *
 *   1. `DEFAULT_THEME` — framework baseline (always full).
 *   2. The active theme's `impl.tokens` — author-shipped defaults
 *      that distinguish a theme from the framework baseline (e.g.
 *      magazine's warm cream palette, portfolio's dark surface).
 *   3. The DB row in `np_settings.theme` — admin overrides via the
 *      theme settings tab.
 *
 * Each layer is `NpThemeTokensOverlay` (sub-tree-Partial) — themes
 * only declare the keys they care about, admins only save deltas
 * they edit. The merge ensures every emitted token has a value.
 *
 * This is the canonical token resolver — `apps/web`'s preview
 * route calls it directly so the page-builder iframe matches what
 * the public render produces for the same active theme.
 */
export async function getTheme(): Promise<NpThemeTokens> {
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "theme")))
    .limit(1);

  // `impl` is opaque to core (declared as `unknown` so React types
  // don't leak into this package). Cast narrowly to read the only
  // field we need; everything else stays opaque.
  const active = await getActiveTheme();
  const themeOverlay = (
    active?.impl as { tokens?: NpThemeTokensOverlay } | null | undefined
  )?.tokens;
  // Admin's theme settings tab historically saved a full
  // `NpThemeTokens` shape, but accept partial overlays too — same
  // sub-tree-aware merge applies, so a future admin UI that only
  // edits a handful of fields doesn't have to round-trip the entire
  // token tree on every save.
  const dbOverlay = rows[0]?.value as NpThemeTokensOverlay | undefined;

  if (!themeOverlay && !dbOverlay) return DEFAULT_THEME;
  return mergeThemeTokens(DEFAULT_THEME, themeOverlay, dbOverlay);
}

/**
 * Layered token merge. Each subsequent overlay wins on key
 * collision. Sub-objects merge field-by-field so a theme that only
 * sets `colors.primary` doesn't blow away the rest of the colors
 * sub-tree.
 */
function mergeThemeTokens(
  base: NpThemeTokens,
  ...overlays: Array<NpThemeTokensOverlay | undefined>
): NpThemeTokens {
  const result: NpThemeTokens = {
    colors: { ...base.colors },
    typography: { ...base.typography },
    shape: { ...base.shape },
  };
  for (const overlay of overlays) {
    if (!overlay) continue;
    if (overlay.colors) Object.assign(result.colors, overlay.colors);
    if (overlay.typography) Object.assign(result.typography, overlay.typography);
    if (overlay.shape) Object.assign(result.shape, overlay.shape);
  }
  return result;
}

export async function getNavigation(
  location: string = "header",
): Promise<NpNavItem[]> {
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(npNavigation)
    .where(
      and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, location)),
    )
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return [];
  }

  return resolveNavItemUrls(rows[0].items);
}

/**
 * Replaces `url` on dynamic nav items with values derived from
 * the underlying record:
 *
 *   - `type: "page"` + `pageId` (+ optional `collectionSlug`,
 *     defaults to `"pages"`) → the URL the source collection's
 *     `seo.urlPath` produces from the linked doc. Lets the page-
 *     edit "In navigation" panel (#436) work for any page-shaped
 *     collection, not just `pages`.
 *   - `type: "collection"` + `collection` → the conventional
 *     collection-list URL (`/{collection-slug}`). The convention
 *     is editor-side only; themes that route a collection
 *     elsewhere (e.g. /blog for posts) should keep using
 *     `type: "link"` with an explicit URL until a per-collection
 *     route helper lands.
 *
 * Themes still render `<a href={item.url}>` and need the resolved
 * URL handed to them. Items whose underlying record disappeared
 * (doc unpublished, collection unregistered, no `seo.urlPath` on
 * the collection) fall through to `#` so the rendered output stays
 * stable across status flips — dropping the item would invalidate
 * the cache shape every time.
 */
async function resolveNavItemUrls(items: NpNavItem[]): Promise<NpNavItem[]> {
  // Group page-typed refs by source collection so we issue one
  // batch of lookups per collection. Items missing `collectionSlug`
  // default to `"pages"` so existing nav rows keep resolving
  // unchanged — that's the v1 wire format.
  const refsByCollection = collectPageRefs(items);

  // Map keyed by `${collection}\0${docId}` so doc ids don't collide
  // across collections (different collections can technically share
  // the same uuid namespace).
  const docByKey = new Map<string, Record<string, unknown>>();

  await Promise.all(
    [...refsByCollection.entries()].map(async ([collection, ids]) => {
      try {
        await Promise.all(
          ids.map(async (id) => {
            const result = await findDocuments(collection, {
              where: { id, status: "published" },
              limit: 1,
            });
            const doc = result.docs[0];
            if (doc) docByKey.set(`${collection}\0${id}`, doc);
          }),
        );
      } catch {
        // Collection isn't registered (was renamed, removed, or
        // never existed). Items pointing at it just fall through
        // to "#" — same fate as items pointing at unpublished docs.
      }
    }),
  );

  return items.map((item) => mapNavItem(item, docByKey));
}

function collectPageRefs(items: NpNavItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (arr: NpNavItem[]): void => {
    for (const item of arr) {
      if (item.type === "page" && item.pageId) {
        const slug = item.collectionSlug ?? "pages";
        const ids = out.get(slug) ?? [];
        ids.push(item.pageId);
        out.set(slug, ids);
      }
      if (item.children) walk(item.children);
    }
  };
  walk(items);
  return out;
}

function mapNavItem(
  item: NpNavItem,
  docByKey: Map<string, Record<string, unknown>>,
): NpNavItem {
  const children = item.children
    ? item.children.map((child) => mapNavItem(child, docByKey))
    : undefined;
  const withChildren = children ? { ...item, children } : item;

  if (item.type === "page" && item.pageId) {
    const collection = item.collectionSlug ?? "pages";
    const doc = docByKey.get(`${collection}\0${item.pageId}`);
    let url = "#";
    if (doc) {
      try {
        const config = getCollectionConfig(collection);
        const path = config.seo?.urlPath?.(doc);
        if (path) url = path;
      } catch {
        // Collection un-registered between fetch and lookup — keep
        // the "#" fallback so rendering doesn't blow up.
      }
    }
    return { ...withChildren, url };
  }

  if (item.type === "collection" && item.collection) {
    const slug = item.collection.replace(/^\/+/, "");
    const url = slug ? `/${slug}` : "#";
    return { ...withChildren, url };
  }

  return withChildren;
}

export async function getPageBySlug(
  slug: string,
  options?: { draft?: boolean; locale?: string },
): Promise<Record<string, unknown> | null> {
  const where: Record<string, unknown> = { slug: slug || "/" };

  if (!options?.draft) {
    where.status = "published";
  }

  // Locale-scoped lookup — when the caller supplies a locale, the
  // findDocuments query restricts to rows in that locale (matches
  // the `(site_id, locale, slug)` unique index on i18n collections).
  // Single-locale collections ignore the option, so callers can
  // pass it unconditionally.
  const result = await findDocuments("pages", {
    where,
    locale: options?.locale,
    limit: 1,
  });

  return result.docs[0] ?? null;
}

export async function getPostBySlug(
  slug: string,
  options?: { draft?: boolean },
): Promise<Record<string, unknown> | null> {
  const where: Record<string, unknown> = { slug };

  if (!options?.draft) {
    where.status = "published";
  }

  const result = await findDocuments("posts", {
    where,
    limit: 1,
  });

  return result.docs[0] ?? null;
}

export async function findPosts(
  options: NpFindOptions,
  user?: NpAuthUser,
): Promise<NpFindResult> {
  return findDocuments("posts", options, user);
}

export async function getAllPageSlugs(): Promise<string[]> {
  const result = await findDocuments("pages", {
    limit: 10000,
  });

  return result.docs
    .map((doc) => doc.slug as string)
    .filter(Boolean);
}

/**
 * When a slug-having collection's row gets renamed (`/old-page` →
 * `/new-page`), the public-site catch-all should 301 the old URL
 * to the new one instead of returning 404. This helper walks the
 * `np_slug_history` chain for the given collection + slug and
 * returns the most recent target.
 *
 * Chain example: A → B → C (renamed twice). Looking up A walks
 * `A → B → C` and returns C. Capped at 5 hops to bound work and
 * defend against pathological cycles (shouldn't happen but cheap
 * to enforce). Returns null when no redirect target exists or
 * the chain ends in the input slug itself.
 */
const SLUG_REDIRECT_MAX_HOPS = 5;

export async function findSlugRedirect(
  collection: string,
  oldSlug: string,
): Promise<string | null> {
  if (!oldSlug || oldSlug.length === 0) return null;
  const db = getDb();
  const siteId = await resolveSiteId();

  const seen = new Set<string>([oldSlug]);
  let currentOld = oldSlug;
  let resolved: string | null = null;
  for (let hop = 0; hop < SLUG_REDIRECT_MAX_HOPS; hop++) {
    // Take the most recently written row for this `(site, collection,
    // oldSlug)` triple — a slug can be reused over time (a doc renamed
    // away from "X" later, another doc renamed *to* "X", then "X" gets
    // renamed again). The newest record is the operator's intent.
    const [latest] = await db
      .select()
      .from(npSlugHistory)
      .where(
        and(
          eq(npSlugHistory.siteId, siteId),
          eq(npSlugHistory.collection, collection),
          eq(npSlugHistory.oldSlug, currentOld),
        ),
      )
      .orderBy(desc(npSlugHistory.createdAt))
      .limit(1);
    if (!latest) break;
    const next = latest.newSlug;
    if (next === oldSlug || seen.has(next)) {
      // Cycle (A→B→A) — surface as "no redirect". Defensive; the
      // pipeline only writes new history rows on actual changes,
      // so this is unreachable in normal operation.
      break;
    }
    resolved = next;
    seen.add(next);
    currentOld = next;
  }
  return resolved;
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, key)))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return null;
  }

  return rows[0].value as T;
}
