import { describe, expect, it, vi } from "vitest";

import { defaultRevalidationRules, revalidateCollection } from "./revalidate.js";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Import after the mock so the helper picks up the mocked module.
const { revalidatePath, revalidateTag } = await import("next/cache");

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
});

describe("revalidateCollection — tag bust (Phase 14.1)", () => {
  it("calls revalidateTag for every tag in the rule", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateCollection(
      { posts: { paths: [], tags: ["nx:sitemap", "nx:feed:posts"] } },
      "posts",
      { slug: "x" },
    );
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap");
    expect(revalidateTag).toHaveBeenCalledWith("nx:feed:posts");
  });

  it("expands {slug} placeholders inside tag templates too", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateCollection(
      { posts: { paths: [], tags: ["nx:posts:{slug}"] } },
      "posts",
      { slug: "hello-world" },
    );
    expect(revalidateTag).toHaveBeenCalledWith("nx:posts:hello-world");
  });

  it("skips slug-templated tags when the doc has no slug (mirrors path behavior)", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateCollection(
      { posts: { paths: [], tags: ["nx:sitemap", "nx:posts:{slug}"] } },
      "posts",
      null,
    );
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap");
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });
});
