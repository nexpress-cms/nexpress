import {
  getCollectionConfig,
  searchCollections,
  type SearchResultItem,
} from "@nexpress/core";
import Link from "next/link";

import { ensureCoreServices } from "@/lib/init-core";
import { highlightMatches } from "@/lib/search-highlight";

interface SearchPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
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
  ensureCoreServices();
  const { q: qRaw, page: pageRaw } = await searchParams;
  const q = (qRaw ?? "").trim();
  const page = parsePage(pageRaw);
  const offset = (page - 1) * PAGE_SIZE;

  const result = q.length > 0
    ? await searchCollections({ q, limit: PAGE_SIZE, offset })
    : null;

  return (
    <section className="nx-search">
      <header className="nx-search-header">
        <h1>Search</h1>
        <SearchForm initialQ={q} />
      </header>

      {result ? (
        <SearchResults q={q} result={result} page={page} />
      ) : (
        <p className="nx-search-empty">
          Type a query above to search across the site.
        </p>
      )}
    </section>
  );
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 500);
}

function SearchForm({ initialQ }: { initialQ: string }) {
  return (
    <form action="/search" method="GET" role="search" className="nx-search-form">
      <label className="nx-search-form-label">
        <span className="sr-only">Search query</span>
        <input
          type="search"
          name="q"
          defaultValue={initialQ}
          placeholder="Search posts, pages, discussions…"
          autoComplete="off"
          aria-label="Search query"
          className="nx-form-input"
        />
      </label>
      <button type="submit" className="nx-button-primary">
        Search
      </button>
    </form>
  );
}

interface SearchResultsProps {
  q: string;
  result: Awaited<ReturnType<typeof searchCollections>>;
  page: number;
}

function SearchResults({ q, result, page }: SearchResultsProps) {
  if (result.total === 0) {
    return (
      <p className="nx-search-empty">
        No results for <strong>{q}</strong>. Try a different keyword.
      </p>
    );
  }

  // Group hits by collection so the rendered list reads as a
  // table-of-contents rather than a flat soup. Within a group
  // the order is whatever ts_rank decided (authoritative per
  // collection — global cross-collection ranking is a future
  // improvement called out in `searchCollections`'s doc).
  const grouped = new Map<string, SearchResultItem[]>();
  for (const item of result.results) {
    const list = grouped.get(item.collection) ?? [];
    list.push(item);
    grouped.set(item.collection, list);
  }

  const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="nx-search-results">
      <p className="nx-search-summary">
        {result.total} result{result.total === 1 ? "" : "s"} for{" "}
        <strong>{q}</strong>
      </p>

      {[...grouped.entries()].map(([collection, items]) => (
        <section key={collection} className="nx-search-group">
          <h2 className="nx-search-group-title">
            {collection} ({result.perCollection[collection] ?? items.length})
          </h2>
          <ul className="nx-search-list">
            {items.map((item) => (
              <SearchResultRow
                key={`${item.collection}:${docId(item.doc)}`}
                item={item}
                query={q}
              />
            ))}
          </ul>
        </section>
      ))}

      {lastPage > 1 ? (
        <Pagination q={q} page={page} lastPage={lastPage} />
      ) : null}
    </div>
  );
}

function SearchResultRow({
  item,
  query,
}: {
  item: SearchResultItem;
  query: string;
}) {
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
      <li className="nx-search-result nx-search-result-untargeted">
        <span className="nx-search-result-title">{highlightedTitle}</span>
        {highlightedExcerpt ? (
          <p className="nx-search-result-excerpt">{highlightedExcerpt}</p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="nx-search-result">
      <Link href={href} className="nx-search-result-title">
        {highlightedTitle}
      </Link>
      {highlightedExcerpt ? (
        <p className="nx-search-result-excerpt">{highlightedExcerpt}</p>
      ) : null}
    </li>
  );
}

function Pagination({
  q,
  page,
  lastPage,
}: {
  q: string;
  page: number;
  lastPage: number;
}) {
  const prev = page > 1 ? buildHref(q, page - 1) : null;
  const next = page < lastPage ? buildHref(q, page + 1) : null;

  return (
    <nav className="nx-search-pagination" aria-label="Search pagination">
      {prev ? (
        <Link href={prev} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span className="nx-search-pagination-disabled">← Previous</span>
      )}
      <span className="nx-search-pagination-info">
        Page {page} of {lastPage}
      </span>
      {next ? (
        <Link href={next} rel="next">
          Next →
        </Link>
      ) : (
        <span className="nx-search-pagination-disabled">Next →</span>
      )}
    </nav>
  );
}

function buildHref(q: string, page: number): string {
  const params = new URLSearchParams({ q });
  if (page > 1) params.set("page", String(page));
  return `/search?${params.toString()}`;
}

/**
 * Resolves the public URL for a search hit by delegating to the
 * collection's own `seo.urlPath` callback (introduced in 10.1).
 * Returns null when the collection isn't crawlable, in which
 * case the search row renders without a link rather than a
 * dead one.
 */
function collectionUrlPath(
  collection: string,
  doc: Record<string, unknown>,
): string | null {
  try {
    const config = getCollectionConfig(collection);
    const path = config.seo?.urlPath?.(doc);
    return path ?? null;
  } catch {
    return null;
  }
}

function pickTitle(doc: Record<string, unknown>): string {
  if (typeof doc.title === "string" && doc.title.length > 0) return doc.title;
  if (typeof doc.name === "string" && doc.name.length > 0) return doc.name;
  if (typeof doc.handle === "string" && doc.handle.length > 0)
    return `@${doc.handle}`;
  if (typeof doc.slug === "string" && doc.slug.length > 0) return doc.slug;
  return "Untitled";
}

function pickExcerpt(doc: Record<string, unknown>): string | null {
  const candidates = [doc.excerpt, doc.summary, doc.description, doc.bio];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      const trimmed = value.trim();
      return trimmed.length > 200 ? `${trimmed.slice(0, 197)}…` : trimmed;
    }
  }
  return null;
}

function docId(doc: Record<string, unknown>): string {
  if (typeof doc.id === "string") return doc.id;
  if (typeof doc.id === "number") return String(doc.id);
  return Math.random().toString(36).slice(2, 10);
}
