import * as React from "react";
import type { NpRouteRenderProps } from "@nexpress/theme";
import { searchCollections } from "@nexpress/core";

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
      <main className="np-docs-search">
        <h1>Search</h1>
        <p style={{ color: "var(--np-color-muted-foreground)" }}>
          Enter a query in the masthead search box to find pages.
        </p>
      </main>
    );
  }

  const result = await searchCollections({ q: query, limit: 20 });
  return (
    <main className="np-docs-search">
      <h1>Search results for &ldquo;{query}&rdquo;</h1>
      {result.results.length === 0 ? (
        <p style={{ color: "var(--np-color-muted-foreground)" }}>No matches.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "1.5rem 0 0" }}>
          {result.results.map((item, i) => {
            const doc = item.doc;
            const slug = typeof doc.slug === "string" ? doc.slug : null;
            const title =
              typeof doc.title === "string" ? doc.title : (slug ?? "Untitled");
            const url = slug ? `/${item.collection}/${slug}` : "#";
            return (
              <li
                key={`${item.collection}:${(doc.id as string | undefined) ?? i}`}
                style={{
                  padding: "1rem 0",
                  borderBottom: "1px solid var(--np-color-border)",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--np-color-muted-foreground)",
                  }}
                >
                  {item.collection}
                </p>
                <h2 style={{ margin: "0.25rem 0 0.5rem", fontSize: "1.125rem" }}>
                  <a
                    href={url}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    {title}
                  </a>
                </h2>
                {typeof doc.excerpt === "string" ? (
                  <p
                    style={{
                      margin: 0,
                      color: "var(--np-color-muted-foreground)",
                    }}
                  >
                    {doc.excerpt}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
