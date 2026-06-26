import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: () => unknown) => fn),
}));

const { unstable_cache } = await import("next/cache");
const {
  SEARCH_CACHE_REVALIDATE_SECONDS,
  buildSearchCacheKeyParts,
  buildSearchCacheTags,
  searchWithShortTtlCache,
} = await import("./cache.js");

describe("search cache", () => {
  beforeEach(() => {
    vi.mocked(unstable_cache).mockClear();
    vi.mocked(unstable_cache).mockImplementation((fn: () => unknown) => fn as never);
  });

  it("builds stable key parts from the full query shape", () => {
    expect(
      buildSearchCacheKeyParts({
        siteId: "site-a",
        q: "walnut",
        collections: ["pages", "posts"],
        limit: 10,
        offset: 20,
        locale: "en",
      }),
    ).toEqual(["nx:search", "site-a", "walnut", "pages,posts", "10", "20", "en"]);

    expect(
      buildSearchCacheKeyParts({
        siteId: "site-a",
        q: "walnut",
        collections: ["posts", "pages"],
        limit: 10,
        offset: 20,
        locale: "en",
      }),
    ).toEqual(["nx:search", "site-a", "walnut", "pages,posts", "10", "20", "en"]);
  });

  it("registers site-scoped and legacy search tags with a short TTL", async () => {
    const result = { results: [], total: 0, perCollection: {} };
    const search = vi.fn(() => Promise.resolve(result));

    await expect(
      searchWithShortTtlCache({
        siteId: "site-a",
        q: "walnut",
        collections: ["posts"],
        limit: 5,
        offset: 0,
        locale: "ko",
        search,
      }),
    ).resolves.toBe(result);

    expect(unstable_cache).toHaveBeenCalledWith(
      expect.any(Function),
      ["nx:search", "site-a", "walnut", "posts", "5", "0", "ko"],
      {
        tags: ["nx:search:site-a", "nx:search"],
        revalidate: SEARCH_CACHE_REVALIDATE_SECONDS,
      },
    );
    expect(search).toHaveBeenCalledWith({
      q: "walnut",
      collections: ["posts"],
      limit: 5,
      offset: 0,
      locale: "ko",
    });
  });

  it("omits locale from the search options when no locale is resolved", async () => {
    const result = { results: [], total: 0, perCollection: {} };
    const search = vi.fn(() => Promise.resolve(result));

    await searchWithShortTtlCache({
      siteId: "site-a",
      q: "walnut",
      collections: undefined,
      limit: 10,
      offset: 0,
      locale: undefined,
      search,
    });

    expect(search).toHaveBeenCalledWith({
      q: "walnut",
      collections: undefined,
      limit: 10,
      offset: 0,
    });
  });

  it("falls back to direct search when Next's incremental cache is absent", async () => {
    vi.mocked(unstable_cache).mockReturnValueOnce(() =>
      Promise.reject(new Error("Invariant: incrementalCache missing")),
    );
    const result = { results: [], total: 0, perCollection: {} };
    const search = vi.fn(() => Promise.resolve(result));

    await expect(
      searchWithShortTtlCache({
        siteId: "site-a",
        q: "walnut",
        collections: undefined,
        limit: 10,
        offset: 0,
        locale: undefined,
        search,
      }),
    ).resolves.toBe(result);

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-cache errors", async () => {
    vi.mocked(unstable_cache).mockReturnValueOnce(() =>
      Promise.reject(new Error("database unavailable")),
    );

    await expect(
      searchWithShortTtlCache({
        siteId: "site-a",
        q: "walnut",
        collections: undefined,
        limit: 10,
        offset: 0,
        locale: undefined,
        search: vi.fn(() => Promise.resolve({ results: [], total: 0, perCollection: {} })),
      }),
    ).rejects.toThrow("database unavailable");
  });

  it("keeps the tag helper aligned with revalidation rules", () => {
    expect(buildSearchCacheTags("site-a")).toEqual(["nx:search:site-a", "nx:search"]);
  });
});
