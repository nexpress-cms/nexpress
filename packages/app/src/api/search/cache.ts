import type { SearchCollectionsOptions, SearchResult } from "@nexpress/core";
import { unstable_cache } from "next/cache";

export const SEARCH_CACHE_REVALIDATE_SECONDS = 60;

interface SearchCacheArgs {
  siteId: string;
  q: string;
  collections: string[] | undefined;
  limit: number;
  offset: number;
  locale: string | undefined;
}

interface CachedSearchArgs extends SearchCacheArgs {
  search: (options: SearchCollectionsOptions) => Promise<SearchResult>;
}

export function buildSearchCacheKeyParts(args: SearchCacheArgs): string[] {
  return [
    "nx:search",
    args.siteId,
    args.q,
    args.collections ? args.collections.slice().sort().join(",") : "",
    String(args.limit),
    String(args.offset),
    args.locale ?? "",
  ];
}

export function buildSearchCacheTags(siteId: string): string[] {
  return [`nx:search:${siteId}`, "nx:search"];
}

function buildSearchOptions(args: SearchCacheArgs): SearchCollectionsOptions {
  return {
    q: args.q,
    collections: args.collections,
    limit: args.limit,
    offset: args.offset,
    ...(args.locale ? { locale: args.locale } : {}),
  };
}

export async function searchWithShortTtlCache(args: CachedSearchArgs): Promise<SearchResult> {
  const searchOptions = buildSearchOptions(args);
  const cached = unstable_cache(() => args.search(searchOptions), buildSearchCacheKeyParts(args), {
    tags: buildSearchCacheTags(args.siteId),
    revalidate: SEARCH_CACHE_REVALIDATE_SECONDS,
  });

  try {
    return await cached();
  } catch (error) {
    // `unstable_cache` requires Next's incremental cache store.
    // Tests that invoke route handlers directly miss it; fall
    // through to the uncached path so behavior remains testable.
    if (error instanceof Error && /incrementalCache/i.test(error.message)) {
      return args.search(searchOptions);
    }
    throw error;
  }
}
