import { unstable_cache } from "next/cache";

import {
  NpSearchContractError,
  getSearchCollectionLabels,
  npRequireSearchAdapterContext,
  npRequireSearchResult,
  type NpSearchAdapterContext,
  type NpSearchRequestInput,
  type NpSearchResult,
} from "@nexpress/core/search";

export const SEARCH_CACHE_REVALIDATE_SECONDS = 60;

interface CachedSearchArgs {
  request: NpSearchAdapterContext;
  search: (options: NpSearchRequestInput) => Promise<NpSearchResult>;
}

export function buildSearchCacheKeyParts(input: NpSearchAdapterContext): string[] {
  const request = npRequireSearchAdapterContext(input);
  if (request.siteId === "*") {
    throw new NpSearchContractError("Invalid cached search request", [
      {
        code: "invalid-field",
        path: "search.cache.siteId",
        message: 'the cross-site "*" scope must not enter the public Next data cache.',
      },
    ]);
  }
  if (request.visibility !== "public") {
    throw new NpSearchContractError("Invalid cached search request", [
      {
        code: "invalid-field",
        path: "search.cache.visibility",
        message: 'trusted visibility "all" must not enter the public Next data cache.',
      },
    ]);
  }
  return [
    "nx:search",
    request.siteId,
    request.q,
    request.collections ? request.collections.join(",") : "",
    request.limit.toString(),
    request.offset.toString(),
    request.locale ?? "",
    request.visibility,
  ];
}

export function buildSearchCacheTags(siteId: string): string[] {
  const request = npRequireSearchAdapterContext({
    q: "",
    limit: 1,
    offset: 0,
    siteId,
    visibility: "public",
  });
  if (request.siteId === "*") {
    throw new NpSearchContractError("Invalid cached search site", [
      {
        code: "invalid-field",
        path: "search.cache.siteId",
        message: 'the cross-site "*" scope has no public cache tag.',
      },
    ]);
  }
  return [`nx:search:${request.siteId}`, "nx:search"];
}

export async function searchWithShortTtlCache(args: CachedSearchArgs): Promise<NpSearchResult> {
  const request = npRequireSearchAdapterContext(args.request);
  const collectionLabels = getSearchCollectionLabels(request.collections);
  const cached = unstable_cache(() => args.search(request), buildSearchCacheKeyParts(request), {
    tags: buildSearchCacheTags(request.siteId),
    revalidate: SEARCH_CACHE_REVALIDATE_SECONDS,
  });

  try {
    const result = await cached();
    return npRequireSearchResult(result, request, collectionLabels, "search.cache.result");
  } catch (error) {
    // `unstable_cache` requires Next's incremental cache store. Tests that
    // invoke handlers directly use the same contract on the uncached path.
    if (error instanceof Error && /incrementalCache/i.test(error.message)) {
      const result = await args.search(request);
      return npRequireSearchResult(result, request, collectionLabels, "search.cache.result");
    }
    throw error;
  }
}
