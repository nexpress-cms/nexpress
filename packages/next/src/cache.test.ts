import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  NP_DEFAULT_SITE_ID: "default",
  getActiveThemeId: vi.fn(),
  getCurrentSiteId: vi.fn(),
  getNavigation: vi.fn(),
  getRegisteredThemes: vi.fn(() => []),
  getTheme: vi.fn(),
  getThemeById: vi.fn(),
}));

const { unstable_cache } = await import("next/cache");
const core = await import("@nexpress/core");
const {
  cachedThemeFetch,
  getCachedActiveThemeId,
  getCachedNavigation,
  getCachedTheme,
  navCacheTag,
  themeCacheTag,
} = await import("./cache.js");

describe("cache tag helpers", () => {
  it("scopes the theme tag by site id", () => {
    expect(themeCacheTag("default")).toBe("nx:theme:default");
    expect(themeCacheTag("blog-jp")).toBe("nx:theme:blog-jp");
  });

  it("scopes the nav tag by site id and location", () => {
    expect(navCacheTag("default", "header")).toBe("nx:nav:default:header");
    expect(navCacheTag("blog-jp", "footer")).toBe(
      "nx:nav:blog-jp:footer",
    );
  });
});

describe("getCachedTheme", () => {
  it("registers a per-site tag with unstable_cache", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("blog-jp");
    const direct = vi.fn(() => Promise.resolve({ tokens: "stub" } as never));
    vi.mocked(unstable_cache).mockReturnValueOnce(direct as never);

    await getCachedTheme();

    expect(unstable_cache).toHaveBeenCalledWith(
      expect.any(Function),
      ["nx:theme", "blog-jp"],
      expect.objectContaining({ tags: ["nx:theme:blog-jp"] }),
    );
  });

  it("falls back to the default site id when no resolver is set", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce(null);
    const direct = vi.fn(() => Promise.resolve({ tokens: "stub" } as never));
    vi.mocked(unstable_cache).mockReturnValueOnce(direct as never);

    await getCachedTheme();

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      ["nx:theme", "default"],
      expect.objectContaining({ tags: ["nx:theme:default"] }),
    );
  });

  it("falls through to uncached read when Next's incremental cache is unavailable", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const cacheError = new Error("incrementalCache missing");
    vi.mocked(unstable_cache).mockReturnValueOnce(
      (() => Promise.reject(cacheError)) as never,
    );
    const expected = { tokens: "fresh" };
    vi.mocked(core.getTheme).mockResolvedValueOnce(expected as never);

    const result = await getCachedTheme();

    expect(result).toBe(expected);
    expect(core.getTheme).toHaveBeenCalledTimes(1);
  });
});

describe("getCachedActiveThemeId", () => {
  it("registers nx:theme:<siteId> tag (shares with theme tokens)", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const direct = vi.fn(() => Promise.resolve("magazine"));
    vi.mocked(unstable_cache).mockReturnValueOnce(direct as never);

    await getCachedActiveThemeId();

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      ["nx:theme:active-id", "default"],
      expect.objectContaining({ tags: ["nx:theme:default"] }),
    );
  });
});

describe("getCachedNavigation", () => {
  it("registers a (siteId, location) tag pair", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("blog-jp");
    const direct = vi.fn(() => Promise.resolve([]));
    vi.mocked(unstable_cache).mockReturnValueOnce(direct as never);

    await getCachedNavigation("footer");

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      ["nx:nav", "blog-jp", "footer"],
      expect.objectContaining({ tags: ["nx:nav:blog-jp:footer"] }),
    );
  });

  it("defaults the location to 'header' when omitted", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const direct = vi.fn(() => Promise.resolve([]));
    vi.mocked(unstable_cache).mockReturnValueOnce(direct as never);

    await getCachedNavigation();

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      ["nx:nav", "default", "header"],
      expect.objectContaining({ tags: ["nx:nav:default:header"] }),
    );
  });
});

describe("cachedThemeFetch", () => {
  it("registers a per-site cache key with caller-supplied parts", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("blog-jp");
    const direct = vi.fn(() => Promise.resolve("posts-data"));
    vi.mocked(unstable_cache).mockReturnValueOnce(direct as never);

    await cachedThemeFetch(["category-archive", "tech"], async () => "x");

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      ["nx:theme-fetch", "blog-jp", "category-archive", "tech"],
      expect.objectContaining({ tags: ["nx:theme:blog-jp"] }),
    );
  });

  it("defaults revalidate to 60 seconds", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const direct = vi.fn(() => Promise.resolve("x"));
    vi.mocked(unstable_cache).mockReturnValueOnce(direct as never);

    await cachedThemeFetch(["k"], async () => "x");

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Array),
      expect.objectContaining({ revalidate: 60 }),
    );
  });

  it("honors caller-supplied revalidate", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const direct = vi.fn(() => Promise.resolve("x"));
    vi.mocked(unstable_cache).mockReturnValueOnce(direct as never);

    await cachedThemeFetch(["k"], async () => "x", { revalidate: 300 });

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Array),
      expect.objectContaining({ revalidate: 300 }),
    );
  });

  it("appends extraTags after the always-on theme tag", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const direct = vi.fn(() => Promise.resolve("x"));
    vi.mocked(unstable_cache).mockReturnValueOnce(direct as never);

    await cachedThemeFetch(["k"], async () => "x", {
      extraTags: ["nx:collection:posts", "nx:collection:authors"],
    });

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Array),
      expect.objectContaining({
        tags: [
          "nx:theme:default",
          "nx:collection:posts",
          "nx:collection:authors",
        ],
      }),
    );
  });

  it("falls back to uncached fetcher when Next's incremental cache is unavailable", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const cacheError = new Error("incrementalCache missing");
    vi.mocked(unstable_cache).mockReturnValueOnce(
      (() => Promise.reject(cacheError)) as never,
    );
    const fetcher = vi.fn(() => Promise.resolve("fresh-result"));

    const result = await cachedThemeFetch(["k"], fetcher);

    expect(result).toBe("fresh-result");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("propagates non-incremental-cache errors", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const realError = new Error("DB connection refused");
    vi.mocked(unstable_cache).mockReturnValueOnce(
      (() => Promise.reject(realError)) as never,
    );
    const fetcher = vi.fn(() => Promise.resolve("x"));

    await expect(
      cachedThemeFetch(["k"], fetcher),
    ).rejects.toBe(realError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
