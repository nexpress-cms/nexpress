import { describe, expect, it, vi } from "vitest";

import { defaultRevalidationRules, revalidateCollection } from "./revalidate.js";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Import after the mock so the helper picks up the mocked module.
const { revalidatePath } = await import("next/cache");

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
});
