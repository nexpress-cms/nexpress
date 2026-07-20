import type { NpForumCategory, NpForumPostListQuery, NpForumPostListQueryPatch } from "../types.js";

export const npForumPostListQueryLimits = Object.freeze({
  page: 10_000,
  searchLength: 120,
});

type NpForumSearchParams = Readonly<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | null | undefined {
  return Array.isArray(value) ? null : value;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/**
 * Parses the bounded public board-list query. `null` means a recognized
 * parameter is malformed, duplicated, or references an unknown category.
 * Unknown parameters are ignored so campaign/query decorations remain safe.
 */
export function parseForumPostListQuery(
  searchParams: NpForumSearchParams,
  categories: readonly NpForumCategory[],
): NpForumPostListQuery | null {
  const pageValue = single(searchParams.page);
  const searchValue = single(searchParams.q);
  const categoryValue = single(searchParams.category);
  const authorValue = single(searchParams.author);
  if (
    pageValue === null ||
    searchValue === null ||
    categoryValue === null ||
    authorValue === null
  ) {
    return null;
  }

  let page = 1;
  if (pageValue !== undefined) {
    if (!/^[1-9][0-9]{0,4}$/u.test(pageValue)) return null;
    page = Number(pageValue);
    if (!Number.isSafeInteger(page) || page > npForumPostListQueryLimits.page) return null;
  }

  const search = searchValue === undefined ? "" : normalizeSearch(searchValue);
  if (search.length > npForumPostListQueryLimits.searchLength) return null;

  const category = categoryValue?.trim() || null;
  if (category && !categories.some((candidate) => candidate.key === category)) return null;
  if (authorValue !== undefined && authorValue !== "me") return null;

  return {
    page,
    search: search || null,
    category,
    showMine: authorValue === "me",
  };
}

export function buildForumPostListHref(
  basePath: string,
  boardKey: string,
  current: NpForumPostListQuery,
  patch: NpForumPostListQueryPatch = {},
): string {
  const changesFilter =
    Object.hasOwn(patch, "search") ||
    Object.hasOwn(patch, "category") ||
    Object.hasOwn(patch, "showMine");
  const next = {
    ...current,
    ...patch,
    ...(changesFilter && patch.page === undefined ? { page: 1 } : {}),
  };
  const query = new URLSearchParams();
  if (next.category) query.set("category", next.category);
  if (next.search) query.set("q", next.search);
  if (next.showMine) query.set("author", "me");
  if (next.page > 1) query.set("page", next.page.toString());
  const suffix = query.toString();
  return `${basePath}/${boardKey}${suffix ? `?${suffix}` : ""}`;
}
