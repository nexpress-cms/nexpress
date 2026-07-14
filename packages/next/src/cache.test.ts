import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  NP_DEFAULT_SITE_ID: "default",
  getActiveThemeId: vi.fn(),
  getCurrentSiteId: vi.fn(),
  getNavigation: vi.fn(),
  getPluginConfig: vi.fn(),
  getRegisteredThemes: vi.fn(() => []),
  getTheme: vi.fn(),
  getThemeById: vi.fn(),
  getThemeSettings: vi.fn(),
  pluginConfigCacheTag: (id: string) => `np:plugin:${id}`,
}));

const { revalidatePath, revalidateTag, unstable_cache } = await import("next/cache");
const core = await import("@nexpress/core");
const { resetCdnPurgeAdapter, setCdnPurgeAdapter } = await import("./cdn-purge.js");
const {
  bustThemeCache,
  cachedPluginFetch,
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
    expect(navCacheTag("blog-jp", "footer")).toBe("nx:nav:blog-jp:footer");
  });

  it("rejects malformed site and navigation identities", () => {
    expect(() => themeCacheTag("BAD")).toThrow("canonical site id");
    expect(() => navCacheTag("default", "BAD location")).toThrow("canonical location");
  });
});

describe("bustThemeCache", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    resetCdnPurgeAdapter();
  });

  it("invalidates theme, SEO tags, root layout, and CDN hints together", async () => {
    const purge = vi.fn();
    setCdnPurgeAdapter({ purge });

    await bustThemeCache("default");

    expect(revalidateTag).toHaveBeenCalledWith("nx:theme:default", "default");
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap:default", "default");
    expect(revalidateTag).toHaveBeenCalledWith("nx:feed:default", "default");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(purge).toHaveBeenCalledWith({
      source: "theme",
      siteId: "default",
      tags: ["nx:theme:default", "nx:sitemap:default", "nx:feed:default"],
      paths: ["/"],
    });
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
    vi.mocked(unstable_cache).mockReturnValueOnce((() => Promise.reject(cacheError)) as never);
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

    await cachedThemeFetch(["category-archive", "tech"], () => Promise.resolve("x"));

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

    await cachedThemeFetch(["k"], () => Promise.resolve("x"));

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

    await cachedThemeFetch(["k"], () => Promise.resolve("x"), { revalidate: 300 });

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

    await cachedThemeFetch(["k"], () => Promise.resolve("x"), {
      extraTags: ["nx:collection:posts", "nx:collection:authors"],
    });

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Array),
      expect.objectContaining({
        tags: ["nx:theme:default", "nx:collection:posts", "nx:collection:authors"],
      }),
    );
  });

  it("falls back to uncached fetcher when Next's incremental cache is unavailable", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const cacheError = new Error("incrementalCache missing");
    vi.mocked(unstable_cache).mockReturnValueOnce((() => Promise.reject(cacheError)) as never);
    const fetcher = vi.fn(() => Promise.resolve("fresh-result"));

    const result = await cachedThemeFetch(["k"], fetcher);

    expect(result).toBe("fresh-result");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("propagates non-incremental-cache errors", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const realError = new Error("DB connection refused");
    vi.mocked(unstable_cache).mockReturnValueOnce((() => Promise.reject(realError)) as never);
    const fetcher = vi.fn(() => Promise.resolve("x"));

    await expect(cachedThemeFetch(["k"], fetcher)).rejects.toBe(realError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("cachedPluginFetch", () => {
  it("rejects malformed plugin ids and fetch options before site resolution", async () => {
    await expect(
      cachedPluginFetch("BAD plugin", ["k"], () => Promise.resolve("x")),
    ).rejects.toThrow("canonical plugin id");
    await expect(
      cachedPluginFetch(123 as never, ["k"], () => Promise.resolve("x")),
    ).rejects.toThrow("canonical plugin id");
    await expect(
      cachedPluginFetch("forum", [], () => Promise.resolve("x"), { revalidate: 0 }),
    ).rejects.toThrow();
    await expect(
      cachedPluginFetch("forum", ["k"], () => Promise.resolve("x"), {
        extraTags: Array.from({ length: 128 }, (_, index) => `tag:${index.toString()}`),
      }),
    ).rejects.toThrow("leave room");
    const revalidate = vi.fn(() => 60);
    const accessorOptions = Object.defineProperty({}, "revalidate", {
      enumerable: true,
      get: revalidate,
    });
    await expect(
      cachedPluginFetch("forum", ["k"], () => Promise.resolve("x"), accessorOptions as never),
    ).rejects.toThrow("enumerable data property");
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("registers a per-site, per-plugin cache key with caller-supplied parts", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("blog-jp");
    vi.mocked(unstable_cache).mockReturnValueOnce((() => Promise.resolve("x")) as never);

    await cachedPluginFetch("forum", ["list", "2"], () => Promise.resolve("data"));

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      ["np:plugin-fetch", "blog-jp", "forum", "list", "2"],
      expect.objectContaining({ tags: ["np:plugin:forum"] }),
    );
  });

  it("defaults revalidate to 60 seconds", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    vi.mocked(unstable_cache).mockReturnValueOnce((() => Promise.resolve("x")) as never);

    await cachedPluginFetch("forum", ["k"], () => Promise.resolve("x"));

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Array),
      expect.objectContaining({ revalidate: 60 }),
    );
  });

  it("honors caller-supplied revalidate", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    vi.mocked(unstable_cache).mockReturnValueOnce((() => Promise.resolve("x")) as never);

    await cachedPluginFetch("forum", ["k"], () => Promise.resolve("x"), {
      revalidate: 300,
    });

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Array),
      expect.objectContaining({ revalidate: 300 }),
    );
  });

  it("appends extraTags after the always-on plugin-config tag", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    vi.mocked(unstable_cache).mockReturnValueOnce((() => Promise.resolve("x")) as never);

    await cachedPluginFetch("forum", ["k"], () => Promise.resolve("x"), {
      extraTags: ["nx:collection:discussions"],
    });

    expect(unstable_cache).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Array),
      expect.objectContaining({
        tags: ["np:plugin:forum", "nx:collection:discussions"],
      }),
    );
  });

  it("falls back to uncached fetcher when Next's incremental cache is unavailable", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const cacheError = new Error("incrementalCache missing");
    vi.mocked(unstable_cache).mockReturnValueOnce((() => Promise.reject(cacheError)) as never);
    const fetcher = vi.fn(() => Promise.resolve("fresh-result"));

    const result = await cachedPluginFetch("forum", ["k"], fetcher);

    expect(result).toBe("fresh-result");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("propagates non-incremental-cache errors", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValueOnce("default");
    const realError = new Error("DB connection refused");
    vi.mocked(unstable_cache).mockReturnValueOnce((() => Promise.reject(realError)) as never);
    const fetcher = vi.fn(() => Promise.resolve("x"));

    await expect(cachedPluginFetch("forum", ["k"], fetcher)).rejects.toBe(realError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("two plugins use distinct cache namespaces", async () => {
    vi.mocked(core.getCurrentSiteId).mockResolvedValue("default");
    vi.mocked(unstable_cache).mockReturnValue((() => Promise.resolve("x")) as never);

    await cachedPluginFetch("forum", ["k"], () => Promise.resolve("x"));
    await cachedPluginFetch("calendar", ["k"], () => Promise.resolve("x"));

    const calls = vi.mocked(unstable_cache).mock.calls;
    expect(calls[calls.length - 2]?.[1]).toEqual(["np:plugin-fetch", "default", "forum", "k"]);
    expect(calls[calls.length - 1]?.[1]).toEqual(["np:plugin-fetch", "default", "calendar", "k"]);
  });
});
