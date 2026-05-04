import { and, eq } from "drizzle-orm";

import { nxSettings } from "../db/schema/system.js";
import { nxNavigation } from "../db/schema/system.js";
import type { NxThemeTokens } from "../theme/types.js";
import type { NxNavItem, NxFindOptions, NxFindResult, NxAuthUser } from "../config/types.js";
import { DEFAULT_THEME } from "../theme/defaults.js";
import { findDocuments, getDb } from "../collections/index.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";

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
  return (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
}

export async function getTheme(): Promise<NxThemeTokens> {
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(nxSettings)
    .where(and(eq(nxSettings.siteId, siteId), eq(nxSettings.key, "theme")))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return DEFAULT_THEME;
  }

  return rows[0].value as NxThemeTokens;
}

export async function getNavigation(
  location: string = "header",
): Promise<NxNavItem[]> {
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(nxNavigation)
    .where(
      and(eq(nxNavigation.siteId, siteId), eq(nxNavigation.location, location)),
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
 *   - `type: "page"` + `pageId` → the linked page's current slug,
 *     so renaming the slug doesn't break the menu.
 *   - `type: "collection"` + `collection` → the conventional
 *     collection-list URL (`/{collection-slug}`). The convention
 *     is editor-side only; themes that route a collection
 *     elsewhere (e.g. /blog for posts) should keep using
 *     `type: "link"` with an explicit URL until a per-collection
 *     route helper lands.
 *
 * Themes still render `<a href={item.url}>` and need the resolved
 * URL handed to them. Items whose underlying record disappeared
 * (page unpublished, collection unregistered) fall through to `#`
 * so the rendered output stays stable across status flips —
 * dropping the item would invalidate the cache shape every time.
 */
async function resolveNavItemUrls(items: NxNavItem[]): Promise<NxNavItem[]> {
  const pageIds = collectPageIds(items);
  const pageById = new Map<string, Record<string, unknown>>();
  if (pageIds.length > 0) {
    // One DB hit per linked page. The pipeline's `where` only
    // supports equality, so we can't `in: [...]` in a single round
    // trip. Acceptable because nav menus are bounded by the
    // editor's UI (typically <10 page links) and the result is
    // cached by `getCachedNavigation` — this loop only runs on
    // cache miss.
    await Promise.all(
      pageIds.map(async (id) => {
        const result = await findDocuments("pages", {
          where: { id, status: "published" },
          limit: 1,
        });
        const page = result.docs[0];
        if (page) pageById.set(id, page);
      }),
    );
  }

  return items.map((item) => mapNavItem(item, pageById));
}

function collectPageIds(items: NxNavItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.type === "page" && item.pageId) ids.push(item.pageId);
    if (item.children) ids.push(...collectPageIds(item.children));
  }
  return ids;
}

function mapNavItem(
  item: NxNavItem,
  pageById: Map<string, Record<string, unknown>>,
): NxNavItem {
  const children = item.children
    ? item.children.map((child) => mapNavItem(child, pageById))
    : undefined;
  const withChildren = children ? { ...item, children } : item;

  if (item.type === "page" && item.pageId) {
    const page = pageById.get(item.pageId);
    const slug = page && typeof page.slug === "string" ? page.slug : null;
    // The reference pages collection treats slug "/" as the home
    // page; everything else maps to "/{slug}". Mirror the
    // `seo.urlPath` rule on the collection so themes don't end up
    // with a `//` or empty href.
    const url = slug === "/" ? "/" : slug ? `/${slug.replace(/^\/+/, "")}` : "#";
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
  options?: { draft?: boolean },
): Promise<Record<string, unknown> | null> {
  const where: Record<string, unknown> = { slug: slug || "/" };

  if (!options?.draft) {
    where.status = "published";
  }

  const result = await findDocuments("pages", {
    where,
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
  options: NxFindOptions,
  user?: NxAuthUser,
): Promise<NxFindResult> {
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

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(nxSettings)
    .where(and(eq(nxSettings.siteId, siteId), eq(nxSettings.key, key)))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return null;
  }

  return rows[0].value as T;
}
