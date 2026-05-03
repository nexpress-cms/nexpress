/**
 * Server-rendered pagination strip. Templates pass in the current
 * page + total count + URL builder; we render Prev / page numbers
 * / Next as plain anchors so it works without JS.
 */

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Builds the href for a given page number. Letting the
   *  caller own this means /blog?page= and /search?q=foo&page=
   *  share the same component. */
  hrefForPage: (page: number) => string;
  /** How many neighbours to show on each side of the active
   *  page before collapsing to "…". Default 1, like GitHub. */
  siblings?: number;
}

function pageWindow(
  current: number,
  total: number,
  siblings: number,
): Array<number | "gap"> {
  const windowSet = new Set<number>([1, total]);
  for (let i = -siblings; i <= siblings; i++) {
    const candidate = current + i;
    if (candidate >= 1 && candidate <= total) windowSet.add(candidate);
  }
  const sorted = Array.from(windowSet).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  let prev: number | null = null;
  for (const n of sorted) {
    if (prev !== null && n - prev > 1) out.push("gap");
    out.push(n);
    prev = n;
  }
  return out;
}

export function Pagination({ page, totalPages, hrefForPage, siblings = 1 }: PaginationProps) {
  if (totalPages <= 1) return null;
  const items = pageWindow(page, totalPages, siblings);
  const prev = page > 1 ? hrefForPage(page - 1) : null;
  const next = page < totalPages ? hrefForPage(page + 1) : null;

  return (
    <nav className="nx-pagination" aria-label="Pagination">
      {prev ? (
        <a href={prev} rel="prev" className="nx-pagination-step">
          ← Prev
        </a>
      ) : (
        <span className="nx-pagination-step nx-pagination-disabled">← Prev</span>
      )}
      <ol className="nx-pagination-pages">
        {items.map((entry, index) => (
          <li key={`${typeof entry === "number" ? entry.toString() : "gap"}-${index.toString()}`}>
            {entry === "gap" ? (
              <span className="nx-pagination-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <a
                href={hrefForPage(entry)}
                aria-current={entry === page ? "page" : undefined}
                className={
                  entry === page ? "nx-pagination-page nx-pagination-current" : "nx-pagination-page"
                }
              >
                {entry.toString()}
              </a>
            )}
          </li>
        ))}
      </ol>
      {next ? (
        <a href={next} rel="next" className="nx-pagination-step">
          Next →
        </a>
      ) : (
        <span className="nx-pagination-step nx-pagination-disabled">Next →</span>
      )}
    </nav>
  );
}
