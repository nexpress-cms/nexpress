import type { SearchResult } from "./search-api.js";

/**
 * Phase 10.6 — pluggable search adapter. Same shape as the
 * spam / profanity / reputation adapters from Phase 9.6+:
 * a single global slot, opt-in via `setSearchAdapter`, default
 * is "no adapter" which keeps the existing pg `tsvector` path
 * authoritative.
 *
 * Plugins implement this interface to delegate search to an
 * external engine — Algolia, Meilisearch, OpenSearch, etc.
 * The plugin is responsible for KEEPING the engine's index
 * fresh; that's done by subscribing to the `content:afterCreate` /
 * `:afterUpdate` / `:afterDelete` hooks the framework already
 * fires (9.7o made those Principal-aware) — no new plumbing
 * in the pipeline. The adapter ONLY handles the read path.
 *
 * Returning `null` / `undefined` from `search()` means "I don't
 * know how to handle this query; fall through to the pg
 * default." Useful when an adapter only indexes certain
 * collections, or wants to defer to pg under specific
 * conditions (e.g. very short queries).
 *
 * Errors thrown by the adapter are fail-open: the framework
 * logs a warning and falls back to pg. Sites that want
 * fail-closed wrap their adapter in try/catch and return
 * `null` on error.
 */
export interface NxSearchAdapterContext {
  /** Trimmed query string (already non-empty by the time this runs). */
  q: string;
  /** Subset of collection slugs the caller asked to search. */
  collections?: string[];
  /** Page size cap, already normalized. */
  limit: number;
  /** Skip count, already normalized. */
  offset: number;
  /**
   * Phase 12.4 — locale to scope results to. When set, the
   * framework expects only docs in this locale (for i18n
   * collections) plus all docs from non-i18n collections. The
   * default pg path applies a `locale = $1` filter on i18n
   * collections; external adapters typically rebuild the index
   * with one document per (sourceId, locale) and filter on the
   * locale field. Adapters that don't support per-locale
   * filtering can return `null` to fall through to pg.
   */
  locale?: string;
}

export interface NxSearchAdapter {
  /**
   * Implementation hook. Return a `SearchResult` to override the
   * default pg tsvector path, or `null` / `undefined` to fall
   * through. Throws are fail-open (logged + treated as null).
   */
  search(
    ctx: NxSearchAdapterContext,
  ): Promise<SearchResult | null | undefined> | SearchResult | null | undefined;
}

let currentAdapter: NxSearchAdapter | null = null;

/**
 * Replace the global search adapter. Call once at app boot,
 * typically from a plugin's `setup()`. The framework holds at
 * most one adapter; sites that want to layer multiple engines
 * (e.g. blog → Algolia, products → Meilisearch) compose them
 * inside a single adapter and dispatch on `ctx.collections`.
 */
export function setSearchAdapter(adapter: NxSearchAdapter): void {
  if (typeof adapter?.search !== "function") {
    throw new Error("setSearchAdapter: adapter must implement search()");
  }
  currentAdapter = adapter;
}

export function getSearchAdapter(): NxSearchAdapter | null {
  return currentAdapter;
}

/** Reset to no adapter. Tests use this between cases. */
export function resetSearchAdapter(): void {
  currentAdapter = null;
}
