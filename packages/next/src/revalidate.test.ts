import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  getCurrentSiteId: vi.fn(() => Promise.resolve(null)),
  getLogger: () => ({ warn: () => {} }),
}));

// Import after the mocks so the helper picks up the mocked modules.
const { revalidatePath, revalidateTag } = await import("next/cache");
const { getCurrentSiteId } = await import("@nexpress/core");
const { getCdnPurgeAdapter, resetCdnPurgeAdapter, setCdnPurgeAdapter } =
  await import("./cdn-purge.js");
const { defaultRevalidationRules, revalidateCollection } = await import("./revalidate.js");

describe("revalidateCollection", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    vi.mocked(getCurrentSiteId).mockClear();
    resetCdnPurgeAdapter();
  });

  it("is a no-op for collections with no rule", () => {
    revalidateCollection({}, "unknown", { slug: "x" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("expands the {slug} placeholder using the document's slug", () => {
    revalidateCollection({ posts: { paths: ["/blog", "/blog/{slug}"] } }, "posts", {
      slug: "hello-world",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
    expect(revalidatePath).toHaveBeenCalledWith("/blog/hello-world");
  });

  it("skips paths with {slug} when the document has no slug", () => {
    revalidateCollection({ posts: { paths: ["/blog", "/blog/{slug}"] } }, "posts", {});
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
    expect(revalidatePath).not.toHaveBeenCalledWith("/blog/{slug}");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("handles a null/undefined document by emitting literal paths only", () => {
    revalidateCollection({ posts: { paths: ["/blog", "/blog/{slug}"] } }, "posts", null);
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });
});

describe("defaultRevalidationRules", () => {
  it("covers the canonical posts and pages routes", () => {
    expect(defaultRevalidationRules.posts?.paths).toContain("/blog");
    expect(defaultRevalidationRules.posts?.paths).toContain("/blog/{slug}");
    expect(defaultRevalidationRules.pages?.paths).toContain("/");
    expect(defaultRevalidationRules.pages?.paths).toContain("/{slug}");
  });

  it("declares cache tags so writes invalidate sitemap / feed alongside paths", () => {
    expect(defaultRevalidationRules.posts?.tags).toContain("nx:sitemap");
    expect(defaultRevalidationRules.posts?.tags).toContain("nx:feed:posts");
    expect(defaultRevalidationRules.pages?.tags).toContain("nx:sitemap");
  });

  it("declares the nx:search tag so the short-TTL search cache busts on every write (Phase 14.7)", () => {
    expect(defaultRevalidationRules.posts?.tags).toContain("nx:search");
    expect(defaultRevalidationRules.pages?.tags).toContain("nx:search");
  });

  it("declares site-scoped {siteId} tags alongside the global ones (Phase 15.10)", () => {
    expect(defaultRevalidationRules.posts?.tags).toContain("nx:sitemap:{siteId}");
    expect(defaultRevalidationRules.posts?.tags).toContain("nx:search:{siteId}");
    expect(defaultRevalidationRules.pages?.tags).toContain("nx:sitemap:{siteId}");
  });
});

describe("revalidateCollection — site-scoped tags (Phase 15.10)", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    vi.mocked(getCurrentSiteId).mockClear();
    resetCdnPurgeAdapter();
  });

  it("substitutes {siteId} when the resolver returns a site", async () => {
    vi.mocked(getCurrentSiteId).mockResolvedValueOnce("acme");
    revalidateCollection({ posts: { paths: [], tags: ["nx:sitemap:{siteId}"] } }, "posts", {
      slug: "x",
    });
    // The site-scoped tag emit is fire-and-forget; await a
    // microtask before assertion.
    await Promise.resolve();
    await Promise.resolve();
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap:acme", "default");
  });

  it("skips {siteId} tags when the resolver returns null (still emits global tags)", async () => {
    vi.mocked(getCurrentSiteId).mockResolvedValueOnce(null);
    revalidateCollection(
      {
        posts: {
          paths: [],
          tags: ["nx:sitemap", "nx:sitemap:{siteId}"],
        },
      },
      "posts",
      { slug: "x" },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap", "default");
    expect(revalidateTag).not.toHaveBeenCalledWith("nx:sitemap:{siteId}", "default");
    // Confirm no leftover {siteId} placeholder snuck through.
    const calls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0]);
    expect(calls.every((c) => !c.includes("{siteId}"))).toBe(true);
  });

  it("only resolves the site once per call (skips when no rule contains {siteId})", async () => {
    vi.mocked(getCurrentSiteId).mockClear();
    revalidateCollection({ posts: { paths: ["/blog"], tags: ["nx:sitemap"] } }, "posts", {
      slug: "x",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(getCurrentSiteId).not.toHaveBeenCalled();
  });
});

describe("revalidateCollection — tag bust (Phase 14.1)", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    vi.mocked(getCurrentSiteId).mockClear();
    resetCdnPurgeAdapter();
  });

  it("calls revalidateTag for every tag in the rule", () => {
    revalidateCollection({ posts: { paths: [], tags: ["nx:sitemap", "nx:feed:posts"] } }, "posts", {
      slug: "x",
    });
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap", "default");
    expect(revalidateTag).toHaveBeenCalledWith("nx:feed:posts", "default");
  });

  it("expands {slug} placeholders inside tag templates too", () => {
    revalidateCollection({ posts: { paths: [], tags: ["nx:posts:{slug}"] } }, "posts", {
      slug: "hello-world",
    });
    expect(revalidateTag).toHaveBeenCalledWith("nx:posts:hello-world", "default");
  });

  it("skips slug-templated tags when the doc has no slug (mirrors path behavior)", () => {
    revalidateCollection(
      { posts: { paths: [], tags: ["nx:sitemap", "nx:posts:{slug}"] } },
      "posts",
      null,
    );
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap", "default");
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });
});

describe("CDN purge adapter", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    vi.mocked(getCurrentSiteId).mockClear();
    resetCdnPurgeAdapter();
  });

  it("defaults to no adapter", () => {
    expect(getCdnPurgeAdapter()).toBeNull();
  });

  it("allows callers to install and reset a purge adapter", () => {
    const adapter = { purge: vi.fn() };
    setCdnPurgeAdapter(adapter);
    expect(getCdnPurgeAdapter()).toBe(adapter);
    resetCdnPurgeAdapter();
    expect(getCdnPurgeAdapter()).toBeNull();
  });

  it("rejects adapter objects without purge()", () => {
    expect(() => setCdnPurgeAdapter({ purge: undefined as never })).toThrow(
      "setCdnPurgeAdapter: adapter must implement purge()",
    );
  });

  it("receives the same collection paths and tags revalidateCollection emits", () => {
    const purge = vi.fn();
    setCdnPurgeAdapter({ purge });

    revalidateCollection(
      {
        posts: {
          paths: ["/blog", "/blog/{slug}"],
          tags: ["nx:sitemap", "nx:posts:{slug}"],
        },
      },
      "posts",
      { slug: "hello-world" },
    );

    expect(purge).toHaveBeenCalledWith({
      source: "collection",
      collection: "posts",
      documentSlug: "hello-world",
      siteId: null,
      paths: ["/blog", "/blog/hello-world"],
      tags: ["nx:sitemap", "nx:posts:hello-world"],
    });
  });

  it("dedupes path and tag hints before calling the adapter", () => {
    const purge = vi.fn();
    setCdnPurgeAdapter({ purge });

    revalidateCollection(
      {
        pages: {
          paths: ["/", "/"],
          tags: ["nx:sitemap", "nx:sitemap"],
        },
      },
      "pages",
      null,
    );

    expect(purge).toHaveBeenCalledWith(
      expect.objectContaining({
        paths: ["/"],
        tags: ["nx:sitemap"],
      }),
    );
  });

  it("still sends CDN purge hints when Next revalidation throws", () => {
    const purge = vi.fn();
    setCdnPurgeAdapter({ purge });
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("static generation store missing");
    });
    vi.mocked(revalidateTag).mockImplementationOnce(() => {
      throw new Error("static generation store missing");
    });

    revalidateCollection({ posts: { paths: ["/blog"], tags: ["nx:sitemap"] } }, "posts", null);

    expect(purge).toHaveBeenCalledWith(
      expect.objectContaining({
        paths: ["/blog"],
        tags: ["nx:sitemap"],
      }),
    );
  });

  it("purges site-scoped CDN hints after the site resolver completes", async () => {
    const purge = vi.fn();
    setCdnPurgeAdapter({ purge });
    vi.mocked(getCurrentSiteId).mockResolvedValueOnce("acme");

    revalidateCollection(
      {
        posts: {
          paths: ["/blog", "/sites/{siteId}/blog"],
          tags: ["nx:sitemap", "nx:sitemap:{siteId}"],
        },
      },
      "posts",
      { slug: "x" },
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(purge).toHaveBeenNthCalledWith(1, {
      source: "collection",
      collection: "posts",
      documentSlug: "x",
      siteId: null,
      paths: ["/blog"],
      tags: ["nx:sitemap"],
    });
    expect(purge).toHaveBeenNthCalledWith(2, {
      source: "collection",
      collection: "posts",
      documentSlug: "x",
      siteId: "acme",
      paths: ["/sites/acme/blog"],
      tags: ["nx:sitemap:acme"],
    });
  });

  it("does not let CDN purge failures fail the write-side invalidation path", async () => {
    setCdnPurgeAdapter({
      purge: () => Promise.reject(new Error("provider down")),
    });

    expect(() =>
      revalidateCollection({ posts: { paths: ["/blog"], tags: ["nx:sitemap"] } }, "posts", null),
    ).not.toThrow();

    await Promise.resolve();
  });
});
