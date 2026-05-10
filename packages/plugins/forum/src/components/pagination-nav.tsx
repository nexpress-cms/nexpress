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
 * Pagination control for forum listing routes. Mirrors the
 * reference component the apps/web blog routes use; duplicated
 * (rather than imported across the package boundary) so the
 * plugin doesn't depend on a host-app file. Only ~50 lines.
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
      {hasPrevPage ? (
        <Link href={hrefForPage(page - 1)}>← Previous</Link>
      ) : (
        <span />
      )}
      <span>
        Page {page} of {totalPages}
      </span>
      {hasNextPage ? (
        <Link href={hrefForPage(page + 1)}>Next →</Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
