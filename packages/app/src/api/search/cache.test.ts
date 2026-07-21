import type * as NpSearchModule from "@nexpress/core/search";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: () => unknown) => fn),
}));

vi.mock("@nexpress/core/search", async (importOriginal) => {
  const actual = await importOriginal<typeof NpSearchModule>();
  return {
    ...actual,
    getSearchCollectionLabels: (collections?: readonly string[]) =>
      Object.fromEntries(
        (collections ?? []).map((collection) => [
          collection,
          collection === "posts" ? "Posts" : "Pages",
        ]),
      ),
  };
});

const { unstable_cache } = await import("next/cache");
const {
  SEARCH_CACHE_REVALIDATE_SECONDS,
  buildSearchCacheKeyParts,
  buildSearchCacheTags,
  searchWithShortTtlCache,
} = await import("./cache.js");

function request(
  overrides: Partial<NpSearchModule.NpSearchAdapterContext> = {},
): NpSearchModule.NpSearchAdapterContext {
  return {
    siteId: "site-a",
    q: "walnut",
    collections: ["posts"],
    limit: 5,
    offset: 0,
    visibility: "public",
    audience: { mode: "public", collections: [] },
    ...overrides,
  };
}

function emptyResult(
  context: NpSearchModule.NpSearchAdapterContext,
): NpSearchModule.NpSearchResult {
  const collections = context.collections ?? [];
  return {
    results: [],
    total: 0,
    perCollection: Object.fromEntries(collections.map((collection) => [collection, 0])),
    facets: collections.map((collection) => ({
      collection,
      label: collection === "posts" ? "Posts" : "Pages",
      count: 0,
      selected: true,
    })),
    limit: context.limit,
    offset: context.offset,
    hasNextPage: false,
  };
}

describe("search cache", () => {
  beforeEach(() => {
    vi.mocked(unstable_cache).mockClear();
    vi.mocked(unstable_cache).mockImplementation((fn: () => unknown) => fn as never);
  });

  it("builds stable key parts from the exact normalized request shape", () => {
    expect(
      buildSearchCacheKeyParts(
        request({
          collections: ["pages", "posts"],
          limit: 10,
          offset: 20,
          locale: "en",
        }),
      ),
    ).toEqual([
      "nx:search",
      "site-a",
      "walnut",
      "pages,posts",
      "10",
      "20",
      "en",
      "public",
      "document-v1",
      "public",
      "",
    ]);

    expect(
      buildSearchCacheKeyParts(
        request({
          collections: ["posts", "pages"],
          limit: 10,
          offset: 20,
          locale: "en",
        }),
      ),
    ).toEqual([
      "nx:search",
      "site-a",
      "walnut",
      "posts,pages",
      "10",
      "20",
      "en",
      "public",
      "document-v1",
      "public",
      "",
    ]);

    expect(
      buildSearchCacheKeyParts(request({ audience: { mode: "public", collections: ["posts"] } })),
    ).toEqual([
      "nx:search",
      "site-a",
      "walnut",
      "posts",
      "5",
      "0",
      "",
      "public",
      "document-v1",
      "public",
      "posts",
    ]);
  });

  it("rejects cross-site requests before they enter Next's public cache", () => {
    expect(() => buildSearchCacheKeyParts(request({ siteId: "*" }))).toThrow(/must not enter/u);
    expect(() =>
      buildSearchCacheKeyParts(
        request({ visibility: "all", audience: { mode: "all", collections: [] } }),
      ),
    ).toThrow(/must not enter/u);
  });

  it("registers site-scoped and legacy search tags with a short TTL", async () => {
    const context = request({ locale: "ko" });
    const result = emptyResult(context);
    const search = vi.fn(() => Promise.resolve(result));

    await expect(searchWithShortTtlCache({ request: context, search })).resolves.toEqual(result);

    expect(unstable_cache).toHaveBeenCalledWith(
      expect.any(Function),
      [
        "nx:search",
        "site-a",
        "walnut",
        "posts",
        "5",
        "0",
        "ko",
        "public",
        "document-v1",
        "public",
        "",
      ],
      {
        tags: ["nx:search:site-a", "nx:search"],
        revalidate: SEARCH_CACHE_REVALIDATE_SECONDS,
      },
    );
    expect(search).toHaveBeenCalledWith({
      siteId: "site-a",
      q: "walnut",
      collections: ["posts"],
      limit: 5,
      offset: 0,
      locale: "ko",
      visibility: "public",
    });
  });

  it("falls back to a revalidated direct search when Next's incremental cache is absent", async () => {
    vi.mocked(unstable_cache).mockReturnValueOnce(() =>
      Promise.reject(new Error("Invariant: incrementalCache missing")),
    );
    const context = request({ collections: undefined, limit: 10 });
    const result = emptyResult(context);
    const search = vi.fn(() => Promise.resolve(result));

    await expect(searchWithShortTtlCache({ request: context, search })).resolves.toEqual(result);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed cached results instead of publishing them", async () => {
    const context = request();
    const search = vi.fn(() =>
      Promise.resolve({ ...emptyResult(context), hasNextPage: true }),
    ) as unknown as (
      options: NpSearchModule.NpSearchRequestInput,
    ) => Promise<NpSearchModule.NpSearchResult>;

    await expect(searchWithShortTtlCache({ request: context, search })).rejects.toThrow(
      /must match total/u,
    );
  });

  it("rethrows non-cache errors", async () => {
    vi.mocked(unstable_cache).mockReturnValueOnce(() =>
      Promise.reject(new Error("database unavailable")),
    );
    const context = request({ collections: undefined, limit: 10 });

    await expect(
      searchWithShortTtlCache({
        request: context,
        search: vi.fn(() => Promise.resolve(emptyResult(context))),
      }),
    ).rejects.toThrow("database unavailable");
  });

  it("keeps the tag helper aligned with revalidation rules", () => {
    expect(buildSearchCacheTags("site-a")).toEqual(["nx:search:site-a", "nx:search"]);
  });
});
