import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@nexpress/core/observability", () => ({
  getLogger: () => ({ warn: vi.fn() }),
}));
vi.mock("@nexpress/core/sites", () => ({
  getCurrentSiteId: vi.fn(() => Promise.resolve(null)),
}));

const { revalidatePath, revalidateTag } = await import("next/cache");
const { getCurrentSiteId } = await import("@nexpress/core/sites");
const { resetCdnPurgeAdapter, setCdnPurgeAdapter } = await import("./cdn-purge.js");
const {
  collectionCacheTag,
  defaultRevalidationRules,
  npRequireRevalidationMap,
  revalidateCollection,
} = await import("./revalidate.js");

describe("revalidateCollection", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockReset();
    vi.mocked(revalidateTag).mockReset();
    vi.mocked(getCurrentSiteId).mockReset().mockResolvedValue(null);
    resetCdnPurgeAdapter();
  });

  it("always emits the generic collection tag", async () => {
    await revalidateCollection({}, "unknown", { slug: "x" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledWith("nx:collection:unknown", "default");
    expect(collectionCacheTag("posts")).toBe("nx:collection:posts");
  });

  it("expands slug and site placeholders into one awaited request", async () => {
    vi.mocked(getCurrentSiteId).mockResolvedValueOnce("acme");
    const purge = vi.fn().mockResolvedValue(undefined);
    setCdnPurgeAdapter({ kind: "cdn", purge });

    await expect(
      revalidateCollection(
        {
          posts: {
            paths: ["/blog", "/blog/{slug}", "/sites/{siteId}/blog"],
            tags: ["nx:sitemap", "nx:sitemap:{siteId}"],
          },
        },
        "posts",
        { slug: "hello-world" },
      ),
    ).resolves.toMatchObject({ status: "applied" });

    expect(getCurrentSiteId).toHaveBeenCalledOnce();
    expect(purge).toHaveBeenCalledOnce();
    expect(purge).toHaveBeenCalledWith({
      source: "collection",
      collection: "posts",
      documentSlug: "hello-world",
      siteId: "acme",
      paths: ["/blog", "/blog/hello-world", "/sites/acme/blog"],
      tags: ["nx:sitemap", "nx:sitemap:acme", "nx:collection:posts"],
    });
  });

  it("encodes document slugs when expanding path segments", async () => {
    await revalidateCollection({ posts: { paths: ["/blog/{slug}"] } }, "posts", {
      slug: "question?{draft}",
    });

    expect(revalidatePath).toHaveBeenCalledWith("/blog/question%3F%7Bdraft%7D");
  });

  it("keeps generic invalidation when an encoded document path exceeds the bound", async () => {
    await revalidateCollection({ posts: { paths: ["/blog/{slug}"] } }, "posts", {
      slug: "😀".repeat(128),
    });

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledWith("nx:collection:posts", "default");
  });

  it("skips unresolved placeholder targets while keeping global targets", async () => {
    await revalidateCollection(
      {
        posts: {
          paths: ["/blog", "/blog/{slug}"],
          tags: ["nx:sitemap", "nx:sitemap:{siteId}"],
        },
      },
      "posts",
      null,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
    expect(revalidatePath).not.toHaveBeenCalledWith("/blog/{slug}");
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap", "default");
    expect(vi.mocked(revalidateTag).mock.calls.flat()).not.toContain("nx:sitemap:{siteId}");
  });

  it("still resolves site context for CDN hints without site placeholders", async () => {
    vi.mocked(getCurrentSiteId).mockResolvedValueOnce("acme");
    const purge = vi.fn().mockResolvedValue(undefined);
    setCdnPurgeAdapter({ purge });
    await revalidateCollection({ posts: { paths: ["/blog"], tags: ["nx:sitemap"] } }, "posts");
    expect(getCurrentSiteId).toHaveBeenCalledOnce();
    expect(purge).toHaveBeenCalledWith(expect.objectContaining({ siteId: "acme" }));
  });

  it("rejects malformed rule maps before execution", async () => {
    expect(() => npRequireRevalidationMap({ posts: { paths: ["/blog/{unknown}"] } })).toThrow(
      "Unsupported cache revalidation placeholder",
    );
    await expect(
      revalidateCollection({ "BAD slug": { paths: ["/blog"] } }, "BAD slug"),
    ).rejects.toThrow("canonical collection slug");
    expect(() => collectionCacheTag(`a${"b".repeat(63)}`)).toThrow("canonical collection slug");
    const posts = vi.fn(() => ({ paths: ["/blog"] }));
    const accessorMap = Object.defineProperty({}, "posts", { enumerable: true, get: posts });
    expect(() => npRequireRevalidationMap(accessorMap)).toThrow("plain object");
    expect(posts).not.toHaveBeenCalled();
    expect(() => npRequireRevalidationMap({ posts: { paths: new Array<string>(1) } })).toThrow(
      "enumerable data element",
    );
  });

  it("copies validated rules before collection and placeholder expansion", async () => {
    const readConstructor = vi.fn(() => Array);
    const paths = ["/blog"];
    Object.defineProperty(paths, "constructor", { get: readConstructor });

    await revalidateCollection({ posts: { paths } }, "posts");

    expect(readConstructor).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
  });
});

describe("defaultRevalidationRules", () => {
  it("covers bundled paths, global tags, and site-scoped tags", () => {
    expect(defaultRevalidationRules.posts?.paths).toContain("/blog/{slug}");
    expect(defaultRevalidationRules.posts?.tags).toContain("nx:search");
    expect(defaultRevalidationRules.posts?.tags).toContain("nx:sitemap:{siteId}");
    expect(defaultRevalidationRules.pages?.paths).toContain("/");
  });
});
