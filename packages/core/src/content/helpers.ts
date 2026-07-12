import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { npSettings } from "../db/schema/system.js";
import { npNavigation, npSlugHistory } from "../db/schema/system.js";
import type { NpNavItem, NpFindOptions, NpFindResult, NpAuthUser } from "../config/types.js";
import { NpValidationError } from "../errors.js";
import { npAnalyzeNavigationItems, npAnalyzeNavigationLocation } from "../navigation/contract.js";
import type { NpResolvedNavItem } from "../navigation/types.js";
import {
  findDocuments,
  getCollectionConfig,
  getCollectionRegistration,
  getDb,
} from "../collections/index.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { npAssertSettingValue, npValidateSettingKey } from "../settings/contract.js";

export { getTheme } from "../theme/runtime.js";

/**
 * Phase 15.4 — every settings/navigation read scopes by the
 * current site id so each tenant gets its own theme tokens,
 * navigation menus, and registered framework settings. The resolver
 * falls back to the default site when no request context is
 * set (background workers, scripts, tests with no resolver
 * wired) so existing single-tenant code keeps working
 * unchanged.
 */
async function resolveSiteId(): Promise<string> {
  return (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
}

export async function getNavigation(location: string = "header"): Promise<NpResolvedNavItem[]> {
  const locationIssues = npAnalyzeNavigationLocation(location);
  if (locationIssues.length > 0) {
    throw new NpValidationError(
      "Invalid navigation location",
      locationIssues.map((entry) => ({ field: entry.path, message: entry.message })),
    );
  }
  const db = getDb();
  const siteId = await resolveSiteId();
  const rows = await db
    .select()
    .from(npNavigation)
    .where(and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, location)))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return [];
  }

  const itemIssues = npAnalyzeNavigationItems(rows[0].items);
  if (itemIssues.length > 0) {
    throw new NpValidationError(
      "Invalid stored navigation",
      itemIssues.map((entry) => ({
        field: entry.path.replace(/^navigation/u, `navigation.${location}`),
        message: entry.message,
      })),
    );
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
async function resolveNavItemUrls(items: NpNavItem[]): Promise<NpResolvedNavItem[]> {
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
): NpResolvedNavItem {
  const children = item.children
    ? item.children.map((child) => mapNavItem(child, docByKey))
    : undefined;
  if (item.type === "page") {
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
    return {
      id: item.id,
      label: item.label,
      type: "page",
      pageId: item.pageId,
      ...(item.collectionSlug ? { collectionSlug: item.collectionSlug } : {}),
      ...(children ? { children } : {}),
      url,
    };
  }

  if (item.type === "collection") {
    const slug = item.collection.replace(/^\/+/, "");
    const url = slug ? `/${slug}` : "#";
    return {
      id: item.id,
      label: item.label,
      type: "collection",
      collection: item.collection,
      ...(children ? { children } : {}),
      url,
    };
  }

  return {
    id: item.id,
    label: item.label,
    type: "link",
    url: item.url,
    ...(children ? { children } : {}),
  };
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

export async function findPosts(options: NpFindOptions, user?: NpAuthUser): Promise<NpFindResult> {
  const resolved = await resolveHasManyRelationshipWhere("posts", options);
  if (resolved.empty) {
    return emptyFindResult(options);
  }
  return findDocuments("posts", { ...options, where: resolved.where }, user);
}

function emptyFindResult(options: NpFindOptions): NpFindResult {
  const limit = options.limit ?? 20;
  return {
    docs: [],
    totalDocs: 0,
    totalPages: 0,
    page: options.page ?? 1,
    limit,
    hasNextPage: false,
    hasPrevPage: false,
  };
}

async function resolveHasManyRelationshipWhere(
  collectionSlug: string,
  options: NpFindOptions,
): Promise<{ where: Record<string, unknown>; empty: boolean }> {
  const where = options.where ? { ...options.where } : {};
  const registration = getCollectionRegistration(collectionSlug);
  const joinTables = registration.joinTables ?? {};
  const matchedIds: string[][] = [];

  for (const field of registration.config.fields) {
    if (field.type !== "relationship" || !field.hasMany) continue;
    const value = where[field.name];
    if (value === undefined) continue;
    const table = joinTables[field.name];
    if (!table) {
      throw new Error(
        `Collection "${collectionSlug}" relationship field "${field.name}" has no registered join table.`,
      );
    }

    delete where[field.name];
    const targetIds = (Array.isArray(value) ? value : [value]).filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
    if (targetIds.length === 0) {
      matchedIds.push([]);
      continue;
    }

    const pgTable = table as PgTable;
    const rows = await getDb()
      .select({ id: parentColumn(pgTable) })
      .from(pgTable)
      .where(inArray(column(pgTable, "targetId"), targetIds));
    matchedIds.push(rows.map((row) => String(row.id)));
  }

  if (matchedIds.length === 0) {
    return { where, empty: false };
  }

  let ids = matchedIds[0] ?? [];
  for (let i = 1; i < matchedIds.length; i++) {
    const allowed = new Set(matchedIds[i]);
    ids = ids.filter((id) => allowed.has(id));
  }

  const existingId = where.id;
  if (typeof existingId === "string") {
    ids = ids.includes(existingId) ? [existingId] : [];
  } else if (Array.isArray(existingId)) {
    const allowed = new Set(existingId.filter((item): item is string => typeof item === "string"));
    ids = ids.filter((id) => allowed.has(id));
  }

  if (ids.length === 0) {
    return { where, empty: true };
  }

  where.id = ids;
  return { where, empty: false };
}

function column(table: PgTable, key: string): PgColumn {
  const selected = getTableColumns(table)[key];
  if (!selected) {
    throw new Error(`Column '${key}' not found on relationship join table.`);
  }
  return selected;
}

function parentColumn(table: PgTable): PgColumn {
  const columns = getTableColumns(table);
  const key = Object.keys(columns).find(
    (candidate) =>
      candidate !== "id" &&
      candidate !== "targetId" &&
      candidate !== "order" &&
      candidate.endsWith("Id"),
  );
  if (!key) {
    throw new Error("Parent column not found on relationship join table.");
  }
  return columns[key];
}

export async function getAllPageSlugs(): Promise<string[]> {
  const result = await findDocuments("pages", {
    limit: 10000,
  });

  return result.docs.map((doc) => doc.slug as string).filter(Boolean);
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
  const keyValidation = npValidateSettingKey(key);
  if (!keyValidation.ok) {
    throw new NpValidationError("Invalid setting key", [
      { field: keyValidation.issue.path, message: keyValidation.issue.message },
    ]);
  }
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

  npAssertSettingValue(key, rows[0].value);
  return rows[0].value as T;
}
