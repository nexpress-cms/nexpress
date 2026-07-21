import { eq } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { findDocuments } from "./pipeline.js";
import { getDb } from "../db/runtime.js";
import { NP_DEFAULT_SITE_ID } from "../sites/id-contract.js";
import { getCurrentSiteId } from "../sites/context.js";
import { getI18nConfig } from "../i18n/registry.js";
import { getAllCollectionSlugs, getCollectionConfig, getCollectionTable } from "./registry.js";
import { buildSearchVectorParts, buildWeightedSearchVectorSql } from "./search.js";
import { getSearchAdapter, npRecordSearchAdapterFailure } from "./search-adapter.js";
import type { NpCollectionConfig, NpFindWhere } from "../config/types.js";
import {
  NpSearchContractError,
  npCreateEmptySearchResult,
  npCreateSearchResult,
  npRequireSearchAdapterContext,
  npRequireSearchCollectionSlug,
  npRequireSearchReindexResult,
  npRequireSearchResolvedRequest,
  npRequireSearchRequest,
  npSearchContractLimits,
} from "../search/contract.js";
import type {
  NpSearchAdapterResult,
  NpSearchAdapterContext,
  NpSearchReindexResult,
  NpSearchRequestInput,
  NpSearchResolvedRequest,
  NpSearchResult,
  NpSearchResultItem,
} from "../search/types.js";
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
export async function searchCollections(opts: NpSearchRequestInput): Promise<NpSearchResult> {
  const request = npRequireSearchRequest(opts);
  const siteId = request.siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const resolvedRequest = npRequireSearchResolvedRequest({ ...request, siteId });
  const { slugs, labels } = resolveSearchCatalog(resolvedRequest.collections);
  assertConfiguredSearchLocale(resolvedRequest.locale);
  const context = createSearchAdapterContext(resolvedRequest, slugs);
  if (
    (context.offset + context.limit) * Math.max(1, slugs.length) >
    npSearchContractLimits.candidateRows
  ) {
    throw new NpSearchContractError("Invalid search request", [
      {
        code: "max-items",
        path: "search.request.offset",
        message: `the selected collections and page depth may inspect at most ${npSearchContractLimits.candidateRows.toString()} candidate rows.`,
      },
    ]);
  }
  if (context.q.length === 0) return npCreateEmptySearchResult(resolvedRequest, labels);

  const query = context.q;
  const limit = context.limit;
  const offset = context.offset;
  const perCollectionLimit = offset + limit;
  const baseWhere: NpFindWhere =
    context.visibility === "public"
      ? { status: "published", visibility: "public", siteId: context.siteId }
      : { visibility: "*", siteId: context.siteId };
  // External engines own only the normalized candidate page. Core validates
  // its complete result/site/visibility/count contract before returning it;
  // malformed or throwing adapters are diagnosed and fall back to Postgres.
  // The exact adapter context identifies every audience-aware collection and
  // requires those result documents to carry the matching canonical audience.
  // The adapter can deliberately return null when its index is unavailable.
  const adapter = getSearchAdapter();
  if (adapter) {
    try {
      const adapterResult = await adapter.search(context);
      if (adapterResult !== null && adapterResult !== undefined) {
        try {
          return npCreateSearchResult(adapterResult, context, labels);
        } catch (error) {
          const message = npRecordSearchAdapterFailure(adapter.kind, "result-contract", error);
          await reportSearchAdapterFailure(adapter.kind, "result-contract", message).catch(
            () => undefined,
          );
        }
      }
    } catch (err) {
      const message = npRecordSearchAdapterFailure(adapter.kind, "dispatch", err);
      await reportSearchAdapterFailure(adapter.kind, "dispatch", message).catch(() => undefined);
    }
  }

  const candidates: SearchCandidate[] = [];
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
    const collectionLocale = config.i18n && context.locale ? context.locale : undefined;
    const audienceWhere =
      context.visibility === "public" && config.community?.audience === true
        ? { audience: "public" as const }
        : {};

    const page = await findDocuments(slug, {
      search: query,
      where: { ...baseWhere, ...audienceWhere },
      limit: perCollectionLimit,
      page: 1,
      ...(collectionLocale ? { locale: collectionLocale } : {}),
    });

    perCollection[slug] = page.totalDocs;
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
  const pagedResults = rankedResults
    .slice(offset, offset + limit)
    .map(({ collection, doc, score }): NpSearchResultItem => ({
      collection,
      doc: doc as NpSearchResultItem["doc"],
      score,
    }));
  const candidate: NpSearchAdapterResult = {
    results: pagedResults,
    total,
    perCollection,
  };
  return npCreateSearchResult(candidate, context, labels);
}

function createSearchAdapterContext(
  request: NpSearchResolvedRequest,
  slugs: readonly string[],
): NpSearchAdapterContext {
  return npRequireSearchAdapterContext({
    ...request,
    audience: {
      mode: request.visibility,
      collections: slugs.filter((slug) => getCollectionConfig(slug).community?.audience === true),
    },
  });
}

function resolveSearchCatalog(collections: readonly string[] | undefined): {
  readonly slugs: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
} {
  const requested = collections ?? getAllCollectionSlugs();
  const slugs: string[] = [];
  const labels: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const slug of requested) {
    let table: PgTable;
    let config: NpCollectionConfig;
    try {
      table = getCollectionTable(slug) as PgTable;
      config = getCollectionConfig(slug);
    } catch {
      if (!collections) continue;
      throw new NpSearchContractError("Invalid search request", [
        {
          code: "invalid-field",
          path: "search.request.collections",
          message: `collection "${slug}" is not registered.`,
        },
      ]);
    }
    if (!hasSearchVectorColumn(table)) {
      if (!collections) continue;
      throw new NpSearchContractError("Invalid search request", [
        {
          code: "invalid-field",
          path: "search.request.collections",
          message: `collection "${slug}" does not expose a search vector.`,
        },
      ]);
    }
    slugs.push(slug);
    labels[slug] = config.labels.plural;
  }
  if (slugs.length > npSearchContractLimits.collectionCount) {
    throw new NpSearchContractError("Invalid search request", [
      {
        code: "max-items",
        path: "search.request.collections",
        message: `at most ${npSearchContractLimits.collectionCount.toString()} searchable collections may participate in one request.`,
      },
    ]);
  }
  return { slugs: Object.freeze(slugs), labels: Object.freeze(labels) };
}

/** Exact registered labels used to revalidate cached/public result facets. */
export function getSearchCollectionLabels(
  collections?: readonly string[],
): Readonly<Record<string, string>> {
  return resolveSearchCatalog(collections).labels;
}

/** Resolve one exact adapter/cache context from registered collection policy. */
export function resolveSearchAdapterContext(input: unknown): NpSearchAdapterContext {
  const request = npRequireSearchResolvedRequest(input);
  const { slugs } = resolveSearchCatalog(request.collections);
  assertConfiguredSearchLocale(request.locale);
  return createSearchAdapterContext(request, slugs);
}

function assertConfiguredSearchLocale(locale: string | undefined): void {
  if (!locale) return;
  const config = getI18nConfig();
  if (!config || !config.locales.includes(locale)) {
    throw new NpSearchContractError("Invalid search request", [
      {
        code: "invalid-field",
        path: "search.request.locale",
        message: `locale "${locale}" is not configured for this project.`,
      },
    ]);
  }
}

async function reportSearchAdapterFailure(
  adapterKind: string,
  operation: "dispatch" | "result-contract",
  message: string,
): Promise<void> {
  const normalized = new Error(message);
  const { getLogger } = await import("../observability/logger.js");
  getLogger().warn("search adapter failed — falling back to pg tsvector", {
    adapterKind,
    operation,
    error: normalized.message,
  });
  const { reportError } = await import("../observability/error-reporter.js");
  await reportError(normalized, {
    tags: { component: "search-adapter", adapterKind, operation },
  });
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
export async function reindexCollection(slug: string): Promise<NpSearchReindexResult> {
  const collection = npRequireSearchCollectionSlug(slug, "search.reindex.collection");
  let config: NpCollectionConfig;
  let table: PgTable;
  try {
    config = getCollectionConfig(collection);
    table = getCollectionTable(collection) as PgTable;
  } catch {
    throw new NpSearchContractError("Invalid search reindex request", [
      {
        code: "invalid-field",
        path: "search.reindex.collection",
        message: `collection "${collection}" is not registered.`,
      },
    ]);
  }
  if (!hasSearchVectorColumn(table)) {
    throw new NpSearchContractError("Invalid search reindex request", [
      {
        code: "invalid-field",
        path: "search.reindex.collection",
        message: `collection "${collection}" does not expose a search vector.`,
      },
    ]);
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

  return npRequireSearchReindexResult({ collection, processed });
}
