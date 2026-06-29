import { eq } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { findDocuments } from "./pipeline.js";
import { getDb } from "../db/runtime.js";
import { getAllCollectionSlugs, getCollectionConfig, getCollectionTable } from "./registry.js";
import { buildSearchVectorParts, buildWeightedSearchVectorSql } from "./search.js";
import { getSearchAdapter } from "./search-adapter.js";
import type { NpCollectionConfig } from "../config/types.js";

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
  /**
   * Relative relevance score for the default Postgres search path.
   * Higher values rank first. The scale is intentionally not stable API:
   * adapters may omit it or use their own scoring semantics.
   */
  score?: number;
}

export interface SearchCollectionFacet {
  collection: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface SearchResult {
  results: SearchResultItem[];
  total: number;
  perCollection: Record<string, number>;
  facets?: SearchCollectionFacet[];
  limit?: number;
  offset?: number;
  hasNextPage?: boolean;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SCORE_PRECISION = 6;
const MIN_TOKEN_LENGTH = 2;
const TOKEN_MATCH_WEIGHT = {
  a: 100,
  b: 40,
  c: 20,
  d: 10,
} as const;
const TITLE_EXACT_BOOST = 180;
const TITLE_PREFIX_BOOST = 100;
const TITLE_PHRASE_BOOST = 60;

function normalizeLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function normalizeOffset(offset: number | undefined): number {
  if (!offset || offset < 0) return 0;
  return Math.floor(offset);
}

function hasSearchVectorColumn(table: PgTable): boolean {
  return (table as unknown as Record<string, unknown>).searchVector !== undefined;
}

interface SearchCandidate {
  collection: string;
  doc: Record<string, unknown>;
  score: number;
  collectionOrder: number;
  rankWithinCollection: number;
}

function normalizeScoringText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase();
}

function tokenizeSearchQuery(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of normalizeScoringText(query).matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (token.length < MIN_TOKEN_LENGTH || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  let index = text.indexOf(token);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(token, index + token.length);
  }
  return count;
}

function scoreTextBucket(text: string, tokens: string[], phrase: string, weight: number): number {
  if (!text) return 0;
  const normalized = normalizeScoringText(text);
  let score = 0;

  for (const token of tokens) {
    const occurrences = countOccurrences(normalized, token);
    if (occurrences > 0) {
      score += weight * (1 + Math.log2(occurrences));
    }
  }

  if (phrase && normalized.includes(phrase)) {
    score += weight * 2;
  }

  return score;
}

function scoreSearchResult(
  config: NpCollectionConfig,
  doc: Record<string, unknown>,
  query: string,
): number {
  const tokens = tokenizeSearchQuery(query);
  const phrase = normalizeScoringText(query).trim();
  const parts = buildSearchVectorParts(config, doc);

  let score =
    scoreTextBucket(parts.a, tokens, phrase, TOKEN_MATCH_WEIGHT.a) +
    scoreTextBucket(parts.b, tokens, phrase, TOKEN_MATCH_WEIGHT.b) +
    scoreTextBucket(parts.c, tokens, phrase, TOKEN_MATCH_WEIGHT.c) +
    scoreTextBucket(parts.d, tokens, phrase, TOKEN_MATCH_WEIGHT.d);

  if (parts.a && phrase) {
    const titleText = normalizeScoringText(parts.a).trim();
    if (titleText === phrase) {
      score += TITLE_EXACT_BOOST;
    } else if (titleText.startsWith(phrase)) {
      score += TITLE_PREFIX_BOOST;
    } else if (titleText.includes(phrase)) {
      score += TITLE_PHRASE_BOOST;
    }
  }

  return Number(score.toFixed(SCORE_PRECISION));
}

/**
 * Cross-collection full-text search using the existing `search_vector`
 * column on each collection table. Built on top of `findDocuments` so it
 * inherits ts_rank candidate selection, access-control read checks, and
 * pagination. The default Postgres path then applies a shared relevance
 * score across the candidate set so title/name hits can outrank weaker body
 * hits even when they come from another collection.
 */
export async function searchCollections(opts: SearchCollectionsOptions): Promise<SearchResult> {
  const query = opts.q.trim();
  if (query.length === 0) {
    return { results: [], total: 0, perCollection: {} };
  }

  const slugs = opts.collections ?? getAllCollectionSlugs();
  const selected = opts.collections ? new Set(opts.collections) : null;
  const limit = normalizeLimit(opts.limit);
  const offset = normalizeOffset(opts.offset);
  const perCollectionLimit = offset + limit;
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

  const candidates: SearchCandidate[] = [];
  const facets: SearchCollectionFacet[] = [];
  const perCollection: Record<string, number> = {};
  let total = 0;

  for (const [collectionOrder, slug] of slugs.entries()) {
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
    const collectionLocale = config.i18n && opts.locale ? opts.locale : undefined;

    const page = await findDocuments(slug, {
      search: query,
      where: baseWhere,
      limit: perCollectionLimit,
      page: 1,
      ...(collectionLocale ? { locale: collectionLocale } : {}),
    });

    perCollection[slug] = page.totalDocs;
    facets.push({
      collection: slug,
      label: config.labels.plural,
      count: page.totalDocs,
      selected: selected ? selected.has(slug) : true,
    });
    total += page.totalDocs;
    for (const [rankWithinCollection, doc] of page.docs.entries()) {
      candidates.push({
        collection: slug,
        doc,
        score: scoreSearchResult(config, doc, query),
        collectionOrder,
        rankWithinCollection,
      });
    }
  }

  const rankedResults = candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.collectionOrder !== b.collectionOrder) return a.collectionOrder - b.collectionOrder;
    return a.rankWithinCollection - b.rankWithinCollection;
  });
  const pagedResults = rankedResults.slice(offset, offset + limit).map(
    ({ collection, doc, score }): SearchResultItem => ({
      collection,
      doc,
      score,
    }),
  );
  return {
    results: pagedResults,
    total,
    perCollection,
    facets,
    limit,
    offset,
    hasNextPage: offset + pagedResults.length < total,
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
