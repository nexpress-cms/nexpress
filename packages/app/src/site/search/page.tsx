import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getI18nConfig,
  searchCollections,
  type SearchCollectionFacet,
  type SearchResult,
  type SearchResultItem,
} from "@nexpress/core";
import Link from "next/link";

import { ShellWrap } from "../../components/shell-wrap";
import { ensureFor } from "../../lib/init-core";
import { highlightMatches, toPlainSearchText } from "../../lib/search-highlight";

interface SearchPageProps {
  searchParams: Promise<{ q?: string; page?: string; collections?: string; collection?: string }>;
}

const PAGE_SIZE = 20;

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Search",
  description: "Search across this site's content.",
};

/**
 * Phase 10.2 — site-side `/search` page. Calls
 * `searchCollections` (the same backbone the existing
 * `/api/search` route uses) directly from the server component
 * — no fetch hop, the query runs in-process. Results are
 * grouped by collection slug and rendered with the per-
 * collection `seo.urlPath` introduced in 10.1, so a row's
 * link is whatever the collection itself declared as its
 * public URL pattern. Collections without `seo.urlPath` are
 * silently skipped on the result list (the rows aren't
 * crawlable surface, so a result link would dead-end).
 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  await ensureFor("read");
  const { q: qRaw, page: pageRaw, collections: collectionsRaw, collection } = await searchParams;
  const q = (qRaw ?? "").trim();
  const page = parsePage(pageRaw);
  const offset = (page - 1) * PAGE_SIZE;
  const publicCollections = getPublicSearchCollections();
  const requestedCollections = parseCollections(collectionsRaw ?? collection);
  const selectedCollections = filterKnownCollections(requestedCollections, publicCollections);
  const locale = await resolveSearchLocale();
  const activeCollections =
    selectedCollections.length > 0
      ? selectedCollections.map((item) => item.collection)
      : publicCollections.map((item) => item.collection);

  const result =
    q.length > 0
      ? await searchCollections({
          q,
          limit: PAGE_SIZE,
          offset,
          collections: activeCollections.length > 0 ? activeCollections : undefined,
          ...(locale ? { locale } : {}),
        })
      : null;

  return (
    <ShellWrap surface="site">
      <section className="np-search">
        <header className="np-search-header">
          <h1>Search</h1>
          <p>Find published content across this site.</p>
          <SearchForm initialQ={q} selectedCollections={selectedCollections} />
        </header>

        <SearchFilters
          q={q}
          options={publicCollections}
          selectedCollections={selectedCollections}
          facets={result?.facets}
          total={result?.total ?? 0}
        />

        {result ? (
          <SearchResults
            q={q}
            result={result}
            page={page}
            selectedCollections={selectedCollections}
          />
        ) : (
          <EmptySearchPrompt hasFilters={publicCollections.length > 1} />
        )}
      </section>
    </ShellWrap>
  );
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 500);
}

function parseCollections(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const item of raw.split(",")) {
    const slug = item.trim();
    if (slug) seen.add(slug);
  }
  return [...seen];
}

interface SearchCollectionOption {
  collection: string;
  label: string;
}

function getPublicSearchCollections(): SearchCollectionOption[] {
  const options: SearchCollectionOption[] = [];
  for (const collection of getAllCollectionSlugs()) {
    try {
      const config = getCollectionConfig(collection);
      if (typeof config.seo?.urlPath !== "function") continue;
      options.push({ collection, label: config.labels.plural });
    } catch {
      // Ignore stale registrations while the app is booting.
    }
  }
  return options;
}

function filterKnownCollections(
  requested: string[],
  options: SearchCollectionOption[],
): SearchCollectionOption[] {
  if (requested.length === 0) return [];
  const bySlug = new Map(options.map((option) => [option.collection, option]));
  const selected: SearchCollectionOption[] = [];
  for (const slug of requested) {
    const option = bySlug.get(slug);
    if (option) selected.push(option);
  }
  return selected;
}

async function resolveSearchLocale(): Promise<string | undefined> {
  let candidate: string | null;
  try {
    const { headers } = await import("next/headers");
    const headerList = await headers();
    candidate = headerList.get("x-np-locale");
  } catch {
    candidate = null;
  }
  if (!candidate) return undefined;
  const config = getI18nConfig();
  if (!config?.locales.includes(candidate)) return undefined;
  return candidate;
}

function SearchForm({
  initialQ,
  selectedCollections,
}: {
  initialQ: string;
  selectedCollections: SearchCollectionOption[];
}) {
  return (
    <form action="/search" method="GET" role="search" className="np-search-form">
      <label className="np-search-form-label">
        <span className="sr-only">Search query</span>
        <input
          type="search"
          name="q"
          defaultValue={initialQ}
          placeholder="Search posts, pages, discussions…"
          autoComplete="off"
          aria-label="Search query"
          className="np-form-input"
        />
      </label>
      {selectedCollections.length > 0 ? (
        <input
          type="hidden"
          name="collections"
          value={selectedCollections.map((item) => item.collection).join(",")}
        />
      ) : null}
      <button type="submit" className="np-button-primary">
        Search
      </button>
    </form>
  );
}

function EmptySearchPrompt({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="np-search-empty">
      <p className="np-search-empty-title">Start with a keyword.</p>
      <p>
        Search looks through published public content and keeps results scoped to the filter you
        choose{hasFilters ? " above" : ""}.
      </p>
    </div>
  );
}

interface SearchFiltersProps {
  q: string;
  options: SearchCollectionOption[];
  selectedCollections: SearchCollectionOption[];
  facets: SearchCollectionFacet[] | undefined;
  total: number;
}

function SearchFilters({ q, options, selectedCollections, facets, total }: SearchFiltersProps) {
  if (options.length <= 1) return null;
  const selected = new Set(selectedCollections.map((item) => item.collection));
  const counts = new Map((facets ?? []).map((facet) => [facet.collection, facet.count]));
  const allSelected = selected.size === 0;

  return (
    <nav className="np-search-filters" aria-label="Search result filters">
      <Link
        href={buildHref({ q, page: 1, collections: [] })}
        className={allSelected ? "np-search-filter-active" : undefined}
        aria-current={allSelected ? "page" : undefined}
      >
        <span>All</span>
        {q && allSelected ? <span className="np-search-filter-count">{total}</span> : null}
      </Link>
      {options.map((option) => {
        const isSelected = selected.has(option.collection);
        const count = counts.get(option.collection);
        return (
          <Link
            key={option.collection}
            href={buildHref({ q, page: 1, collections: [option.collection] })}
            className={isSelected ? "np-search-filter-active" : undefined}
            aria-current={isSelected ? "page" : undefined}
          >
            <span>{option.label}</span>
            {q && count !== undefined ? (
              <span className="np-search-filter-count">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

interface SearchResultsProps {
  q: string;
  result: SearchResult;
  page: number;
  selectedCollections: SearchCollectionOption[];
}

function SearchResults({ q, result, page, selectedCollections }: SearchResultsProps) {
  if (result.total === 0) {
    return (
      <div className="np-search-empty">
        <p className="np-search-empty-title">No results for &ldquo;{q}&rdquo;.</p>
        <p>Try a broader keyword or switch back to all public content.</p>
      </div>
    );
  }

  const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const scopeLabel =
    selectedCollections.length > 0
      ? selectedCollections.map((item) => item.label).join(", ")
      : "all public content";

  return (
    <div className="np-search-results">
      <p className="np-search-summary">
        Showing {result.results.length} of {result.total} result
        {result.total === 1 ? "" : "s"} for <strong>{q}</strong> in {scopeLabel}.
      </p>

      <ul className="np-search-list">
        {result.results.map((item) => (
          <SearchResultRow key={`${item.collection}:${docId(item.doc)}`} item={item} query={q} />
        ))}
      </ul>

      {lastPage > 1 ? (
        <Pagination
          q={q}
          page={page}
          lastPage={lastPage}
          selectedCollections={selectedCollections}
        />
      ) : null}
    </div>
  );
}

function SearchResultRow({ item, query }: { item: SearchResultItem; query: string }) {
  const href = collectionUrlPath(item.collection, item.doc);
  const title = pickTitle(item.doc);
  const excerpt = pickExcerpt(item.doc);
  const highlightedTitle = highlightMatches(title, query);
  const highlightedExcerpt = excerpt ? highlightMatches(excerpt, query) : null;

  if (!href) {
    // Collection doesn't declare a public URL — render the title
    // as plain text so an admin viewing the search page sees the
    // hit, but don't bait public visitors with a dead link.
    return (
      <li className="np-search-result np-search-result-untargeted">
        <span className="np-search-result-title">{highlightedTitle}</span>
        {highlightedExcerpt ? (
          <p className="np-search-result-excerpt">{highlightedExcerpt}</p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="np-search-result">
      <p className="np-search-result-meta">
        <span>{collectionLabel(item.collection)}</span>
      </p>
      <Link href={href} className="np-search-result-title">
        {highlightedTitle}
      </Link>
      {highlightedExcerpt ? <p className="np-search-result-excerpt">{highlightedExcerpt}</p> : null}
    </li>
  );
}

function Pagination({
  q,
  page,
  lastPage,
  selectedCollections,
}: {
  q: string;
  page: number;
  lastPage: number;
  selectedCollections: SearchCollectionOption[];
}) {
  const collections = selectedCollections.map((item) => item.collection);
  const prev = page > 1 ? buildHref({ q, page: page - 1, collections }) : null;
  const next = page < lastPage ? buildHref({ q, page: page + 1, collections }) : null;

  return (
    <nav className="np-search-pagination" aria-label="Search pagination">
      {prev ? (
        <Link href={prev} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span className="np-search-pagination-disabled">← Previous</span>
      )}
      <span className="np-search-pagination-info">
        Page {page} of {lastPage}
      </span>
      {next ? (
        <Link href={next} rel="next">
          Next →
        </Link>
      ) : (
        <span className="np-search-pagination-disabled">Next →</span>
      )}
    </nav>
  );
}

function buildHref({
  q,
  page,
  collections,
}: {
  q: string;
  page: number;
  collections: string[];
}): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (collections.length > 0) params.set("collections", collections.join(","));
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

/**
 * Resolves the public URL for a search hit by delegating to the
 * collection's own `seo.urlPath` callback (introduced in 10.1).
 * Returns null when the collection isn't crawlable, in which
 * case the search row renders without a link rather than a
 * dead one.
 */
function collectionUrlPath(collection: string, doc: Record<string, unknown>): string | null {
  try {
    const config = getCollectionConfig(collection);
    const path = config.seo?.urlPath?.(doc);
    return path ?? null;
  } catch {
    return null;
  }
}

function pickTitle(doc: Record<string, unknown>): string {
  if (typeof doc.title === "string" && doc.title.length > 0) {
    const title = toPlainSearchText(doc.title);
    if (title) return title;
  }
  if (typeof doc.name === "string" && doc.name.length > 0) {
    const name = toPlainSearchText(doc.name);
    if (name) return name;
  }
  if (typeof doc.handle === "string" && doc.handle.length > 0) return `@${doc.handle}`;
  if (typeof doc.slug === "string" && doc.slug.length > 0) return toPlainSearchText(doc.slug);
  return "Untitled";
}

function pickExcerpt(doc: Record<string, unknown>): string | null {
  const candidates = [
    doc.excerpt,
    doc.summary,
    doc.description,
    doc.seoDescription,
    doc.seoMetaDescription,
    doc.bio,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      const trimmed = toPlainSearchText(value);
      if (!trimmed) continue;
      return trimmed.length > 200 ? `${trimmed.slice(0, 197)}…` : trimmed;
    }
  }
  return null;
}

function collectionLabel(collection: string): string {
  try {
    return getCollectionConfig(collection).labels.singular;
  } catch {
    return collection;
  }
}

function docId(doc: Record<string, unknown>): string {
  if (typeof doc.id === "string") return doc.id;
  if (typeof doc.id === "number") return String(doc.id);
  const title = typeof doc.title === "string" ? doc.title : "untitled";
  const slug = typeof doc.slug === "string" ? doc.slug : "no-slug";
  return `${title}:${slug}`;
}
