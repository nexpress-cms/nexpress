import Link from "next/link";

export interface PaginationNavProps {
  page: number;
  totalPages: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  /**
   * Build a URL for a given page number. The caller composes
   * their own query string so this component doesn't have to know
   * about extra params (`?author=me`, locale prefixes, …) — every
   * listing page has its own URL contract.
   */
  hrefForPage: (page: number) => string;
  className?: string;
}

/**
 * Reference pagination component for listing pages. Lives in the
 * app (not the framework) because every site theme will want its
 * own visual treatment — the framework only ships the data shape
 * (`hasPrevPage` / `hasNextPage` / `page` / `totalPages` on
 * `NpFindResult`). Themes can copy this file and restyle, or
 * write their own.
 *
 * Renders nothing when `totalPages <= 1` so the caller doesn't
 * need to gate the include.
 */
export function PaginationNav({
  page,
  totalPages,
  hasPrevPage,
  hasNextPage,
  hrefForPage,
  className,
}: PaginationNavProps) {
  if (totalPages <= 1) return null;
  return (
    <nav className={className ?? "np-pagination-nav"} aria-label="Pagination">
      {hasPrevPage ? <Link href={hrefForPage(page - 1)}>← Previous</Link> : <span />}
      <span>
        Page {page} of {totalPages}
      </span>
      {hasNextPage ? <Link href={hrefForPage(page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}
