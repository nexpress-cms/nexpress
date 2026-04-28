import { describe, expect, it, vi } from "vitest";

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
const { defaultRevalidationRules, revalidateCollection } = await import(
  "./revalidate.js"
);

describe("revalidateCollection", () => {
  it("is a no-op for collections with no rule", () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateCollection({}, "unknown", { slug: "x" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("expands the {slug} placeholder using the document's slug", () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateCollection(
      { posts: { paths: ["/blog", "/blog/{slug}"] } },
      "posts",
      { slug: "hello-world" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
    expect(revalidatePath).toHaveBeenCalledWith("/blog/hello-world");
  });

  it("skips paths with {slug} when the document has no slug", () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateCollection(
      { posts: { paths: ["/blog", "/blog/{slug}"] } },
      "posts",
      {},
    );
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
    expect(revalidatePath).not.toHaveBeenCalledWith("/blog/{slug}");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("handles a null/undefined document by emitting literal paths only", () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateCollection(
      { posts: { paths: ["/blog", "/blog/{slug}"] } },
      "posts",
      null,
    );
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
    expect(defaultRevalidationRules.posts?.tags).toContain(
      "nx:sitemap:{siteId}",
    );
    expect(defaultRevalidationRules.posts?.tags).toContain(
      "nx:search:{siteId}",
    );
    expect(defaultRevalidationRules.pages?.tags).toContain(
      "nx:sitemap:{siteId}",
    );
  });
});

describe("revalidateCollection — site-scoped tags (Phase 15.10)", () => {
  it("substitutes {siteId} when the resolver returns a site", async () => {
    vi.mocked(revalidateTag).mockClear();
    vi.mocked(getCurrentSiteId).mockResolvedValueOnce("acme");
    revalidateCollection(
      { posts: { paths: [], tags: ["nx:sitemap:{siteId}"] } },
      "posts",
      { slug: "x" },
    );
    // The site-scoped tag emit is fire-and-forget; await a
    // microtask before assertion.
    await Promise.resolve();
    await Promise.resolve();
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap:acme", "default");
  });

  it("skips {siteId} tags when the resolver returns null (still emits global tags)", async () => {
    vi.mocked(revalidateTag).mockClear();
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
    expect(revalidateTag).not.toHaveBeenCalledWith(
      "nx:sitemap:{siteId}",
      "default",
    );
    // Confirm no leftover {siteId} placeholder snuck through.
    const calls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0]);
    expect(calls.every((c) => !c.includes("{siteId}"))).toBe(true);
  });

  it("only resolves the site once per call (skips when no rule contains {siteId})", async () => {
    vi.mocked(getCurrentSiteId).mockClear();
    revalidateCollection(
      { posts: { paths: ["/blog"], tags: ["nx:sitemap"] } },
      "posts",
      { slug: "x" },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(getCurrentSiteId).not.toHaveBeenCalled();
  });
});

describe("revalidateCollection — tag bust (Phase 14.1)", () => {
  it("calls revalidateTag for every tag in the rule", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateCollection(
      { posts: { paths: [], tags: ["nx:sitemap", "nx:feed:posts"] } },
      "posts",
      { slug: "x" },
    );
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap", "default");
    expect(revalidateTag).toHaveBeenCalledWith("nx:feed:posts", "default");
  });

  it("expands {slug} placeholders inside tag templates too", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateCollection(
      { posts: { paths: [], tags: ["nx:posts:{slug}"] } },
      "posts",
      { slug: "hello-world" },
    );
    expect(revalidateTag).toHaveBeenCalledWith(
      "nx:posts:hello-world",
      "default",
    );
  });

  it("skips slug-templated tags when the doc has no slug (mirrors path behavior)", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateCollection(
      { posts: { paths: [], tags: ["nx:sitemap", "nx:posts:{slug}"] } },
      "posts",
      null,
    );
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap", "default");
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });
});
