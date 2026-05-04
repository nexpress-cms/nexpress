import { and, eq } from "drizzle-orm";

import { nxSettings } from "../db/schema/system.js";
import { nxNavigation } from "../db/schema/system.js";
import type { NxThemeTokens } from "../theme/types.js";
import type { NxNavItem, NxFindOptions, NxFindResult, NxAuthUser } from "../config/types.js";
import { DEFAULT_THEME } from "../theme/defaults.js";
import { findDocuments, getCollectionConfig, getDb } from "../collections/index.js";
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
async function resolveNavItemUrls(items: NxNavItem[]): Promise<NxNavItem[]> {
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

function collectPageRefs(items: NxNavItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (arr: NxNavItem[]): void => {
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
  item: NxNavItem,
  docByKey: Map<string, Record<string, unknown>>,
): NxNavItem {
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
