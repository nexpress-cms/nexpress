import { eq } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { findDocuments } from "./pipeline.js";
import { getDb } from "../db/runtime.js";
import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
} from "./registry.js";
import { buildWeightedSearchVectorSql } from "./search.js";
import { getSearchAdapter } from "./search-adapter.js";

export interface SearchCollectionsOptions {
  q: string;
  collections?: string[];
  limit?: number;
  offset?: number;
  /**
   * Extra where-filter applied on top of the default `{ status: "published" }`
   * for each collection. Pass `{}` to disable the status filter (caller should
   * only do this for authenticated admin contexts).
   */
  where?: Record<string, unknown>;
  /**
   * Phase 12.4 — restrict i18n collections to one locale. Non-
   * i18n collections ignore this (no `locale` column to match).
   * Public site search reads this from the URL's locale prefix
   * so visitors browsing in `/ko/` only see Korean hits.
   */
  locale?: string;
}

export interface SearchResultItem {
  collection: string;
  doc: Record<string, unknown>;
}

export interface SearchResult {
  results: SearchResultItem[];
  total: number;
  perCollection: Record<string, number>;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function normalizeLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function hasSearchVectorColumn(table: PgTable): boolean {
  return (table as unknown as Record<string, unknown>).searchVector !== undefined;
}

/**
 * Cross-collection full-text search using the existing `search_vector` column
 * on each collection table. Built on top of `findDocuments` so it inherits
 * the ts_rank ordering, access-control read checks, and pagination.
 *
 * Results are merged in per-collection slug order; for an MVP the within-
 * collection ranking is authoritative. A future version can do a UNION across
 * tables if global ranking becomes a priority.
 */
export async function searchCollections(
  opts: SearchCollectionsOptions,
): Promise<SearchResult> {
  const query = opts.q.trim();
  if (query.length === 0) {
    return { results: [], total: 0, perCollection: {} };
  }

  const slugs = opts.collections ?? getAllCollectionSlugs();
  const limit = normalizeLimit(opts.limit);
  const offset = opts.offset ?? 0;
  const baseWhere = opts.where ?? { status: "published" };

  // Phase 10.6 — pluggable adapter. When a site has installed an
  // external search engine (Algolia / Meilisearch / OpenSearch),
  // delegate to that. The adapter can return `null` to fall
  // through to the pg path (e.g. for collections it doesn't
  // index). Throws are fail-open: log + treat as null. The
  // adapter is responsible for keeping its index fresh — the
  // pipeline already fires `content:afterCreate / :afterUpdate /
  // :afterDelete` hooks (9.7o made them Principal-aware), so a
  // plugin subscribes to those for indexing without needing any
  // new framework plumbing.
  const adapter = getSearchAdapter();
  if (adapter) {
    try {
      const adapterResult = await adapter.search({
        q: query,
        collections: opts.collections,
        limit,
        offset,
        locale: opts.locale,
      });
      if (adapterResult) return adapterResult;
    } catch (err) {
      const { getLogger } = await import("../observability/logger.js");
      getLogger().warn("search adapter threw — falling back to pg tsvector", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const results: SearchResultItem[] = [];
  const perCollection: Record<string, number> = {};
  let total = 0;

  for (const slug of slugs) {
    let table: PgTable;
    try {
      table = getCollectionTable(slug) as PgTable;
    } catch {
      continue;
    }
    if (!hasSearchVectorColumn(table)) continue;

    // Phase 12.4 — fold locale into the per-collection where
    // clause for i18n collections. findDocuments() already
    // ignores `locale` on non-i18n collections (the column
    // doesn't exist), so we forward it unconditionally without
    // a config check here.
    const config = getCollectionConfig(slug);
    const collectionLocale =
      config.i18n && opts.locale ? opts.locale : undefined;

    const page = await findDocuments(slug, {
      search: query,
      where: baseWhere,
      limit,
      page: 1,
      ...(collectionLocale ? { locale: collectionLocale } : {}),
    });

    perCollection[slug] = page.totalDocs;
    total += page.totalDocs;
    for (const doc of page.docs) {
      results.push({ collection: slug, doc });
    }
  }

  return {
    results: results.slice(offset, offset + limit),
    total,
    perCollection,
  };
}

export interface ReindexResult {
  collection: string;
  processed: number;
}

function getTableColumn(table: PgTable, key: string): AnyPgColumn {
  const column = (table as unknown as Record<string, unknown>)[key];
  if (!column) {
    throw new Error(`Column '${key}' not found on collection table.`);
  }
  return column as AnyPgColumn;
}

/**
 * Rebuilds the `search_vector` column for every row in a collection. Useful
 * after bulk imports or for recovering from corrupted vectors. Idempotent —
 * safe to run against a live collection while writes continue.
 */
export async function reindexCollection(slug: string): Promise<ReindexResult> {
  const config = getCollectionConfig(slug);
  const table = getCollectionTable(slug) as PgTable;
  if (!hasSearchVectorColumn(table)) {
    return { collection: slug, processed: 0 };
  }

  const db = getDb();
  const idCol = getTableColumn(table, "id");
  const rows = (await db.select().from(table)) as Array<Record<string, unknown>>;

  let processed = 0;
  for (const row of rows) {
    // Phase 10.7 — match the pipeline's write path:
    //   1. Wrap in `to_tsvector('english', $)` so Postgres
    //      tokenizes the source text rather than parsing it
    //      as raw tsvector syntax (the colon-content bug
    //      that 11.x fixed for createMainDocument /
    //      updateMainDocument). Reindex was a parallel write
    //      path missing the same fix.
    //   2. Apply the weighted setweight() composition so
    //      title fields outrank body fields, matching the
    //      pipeline.
    const weighted = buildWeightedSearchVectorSql(config, row);
    await db
      .update(table)
      .set({ searchVector: weighted })
      .where(eq(idCol, row.id as string));
    processed += 1;
  }

  return { collection: slug, processed };
}
