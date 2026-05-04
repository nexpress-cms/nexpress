import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  NX_DEFAULT_SITE_ID: "default",
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
