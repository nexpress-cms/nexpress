import * as React from "react";
import type { NpRouteRenderProps } from "@nexpress/theme";
import { getCollectionConfig, searchCollections } from "@nexpress/core";

/**
 * Resolves a search-result URL via the collection's
 * `seo.urlPath` config when available, falling back to
 * `/<collection>/<slug>` convention. Without this, posts (which
 * typically live under `/blog/`) would 404 from search hits.
 * Wrapped in try/catch because `getCollectionConfig` throws for
 * unknown collections — a search adapter that returns rows from
 * a no-longer-registered collection shouldn't crash the page.
 */
function resolveResultUrl(
  collection: string,
  doc: Record<string, unknown>,
): string {
  try {
    const config = getCollectionConfig(collection);
    const urlPath = config.seo?.urlPath;
    if (typeof urlPath === "function") {
      const result = urlPath(doc);
      if (typeof result === "string" && result.length > 0) return result;
    }
  } catch {
    // Unknown collection or missing seo config — fall through.
  }
  const slug = typeof doc.slug === "string" ? doc.slug : "";
  return slug ? `/${collection}/${slug}` : "#";
}

/**
 * Phase F.9-B — `/search` route component.
 *
 * Reads `?q=` from searchParams, runs `searchCollections` (the
 * full-text search API), and renders the hits. Empty query →
 * empty results pane with hint copy. Stresses F.2's route
 * dispatch with a non-collection-walk shape (search is
 * cross-collection by design).
 */

export async function DocsSearch({
  searchParams,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const raw = searchParams.q;
  const query = typeof raw === "string" ? raw.trim() : "";

  if (query.length === 0) {
    return (
      <div className="np-docs-search">
        <p className="np-docs-search-heading">Search</p>
        <h1>Search the docs</h1>
        <p className="np-docs-search-empty">
          Enter a query in the masthead search box to find pages.
        </p>
      </div>
    );
  }

  const result = await searchCollections({ q: query, limit: 20 });
  return (
    <div className="np-docs-search">
      <p className="np-docs-search-heading">Search results for</p>
      <h1>&ldquo;{query}&rdquo;</h1>
      {result.results.length === 0 ? (
        <p className="np-docs-search-empty">No matches.</p>
      ) : (
        <ul className="np-docs-search-results">
          {result.results.map((item, i) => {
            const doc = item.doc;
            const slug = typeof doc.slug === "string" ? doc.slug : null;
            const title =
              typeof doc.title === "string" ? doc.title : (slug ?? "Untitled");
            const url = resolveResultUrl(item.collection, doc);
            return (
              <li
                key={`${item.collection}:${(doc.id as string | undefined) ?? i}`}
                className="np-docs-search-result"
              >
                <p className="np-docs-search-result-eyebrow">{item.collection}</p>
                <h2>
                  <a href={url}>{title}</a>
                </h2>
                {typeof doc.excerpt === "string" ? (
                  <p className="np-docs-search-result-excerpt">{doc.excerpt}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
