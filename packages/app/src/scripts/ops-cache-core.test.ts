import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { revalidatePath, revalidateTag } = await import("next/cache");
const { buildOpsCacheRevalidatePlan, runOpsCacheRevalidate } = await import("./ops-cache-core.js");

describe("ops-cache-core", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
  });

  it("plans public cache invalidation with global and site-scoped tags", () => {
    const plan = buildOpsCacheRevalidatePlan({ target: "public", siteId: "site-a" });

    expect(plan.paths.map((path) => path.path)).toEqual(["/", "/blog", "/search"]);
    expect(plan.tags).toEqual([
      "nx:sitemap",
      "nx:sitemap:site-a",
      "nx:feed",
      "nx:feed:site-a",
      "nx:search",
      "nx:search:site-a",
    ]);
  });

  it("plans collection cache invalidation with the generic cached-fetch tag", () => {
    const plan = buildOpsCacheRevalidatePlan({
      target: "collection",
      collection: "posts",
      documentSlug: "hello",
      siteId: "site-a",
    });

    expect(plan.paths.map((path) => path.path)).toEqual(["/blog", "/blog/hello"]);
    expect(plan.tags).toEqual([
      "nx:posts",
      "nx:sitemap",
      "nx:feed:posts",
      "nx:search",
      "nx:sitemap:site-a",
      "nx:feed:site-a:posts",
      "nx:feed:site-a",
      "nx:search:site-a",
      "nx:collection:posts",
    ]);
  });

  it("encodes unsafe document slug characters while planning concrete paths", () => {
    expect(
      buildOpsCacheRevalidatePlan({
        target: "collection",
        collection: "posts",
        documentSlug: "bad?slug",
        siteId: "site-a",
      }).paths,
    ).toContainEqual({ path: "/blog/bad%3Fslug" });
  });

  it("returns a dry-run result by default", async () => {
    const result = await runOpsCacheRevalidate({ target: "theme", siteId: "site-a" });

    expect(result.applied).toBe(false);
    expect(result.nextCommand).toContain("--execute --approve cache-revalidate");
    expect(result.invalidation).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("requires the cache-revalidate approval token before executing", async () => {
    const result = await runOpsCacheRevalidate({
      target: "site",
      siteId: "site-a",
      execute: true,
      approve: "wrong",
    });

    expect(result.applied).toBe(false);
    expect(result.error).toBe("Missing --approve cache-revalidate");
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("executes approved invalidation through Next cache helpers", async () => {
    const result = await runOpsCacheRevalidate({
      target: "theme",
      siteId: "site-a",
      execute: true,
      approve: "cache-revalidate",
    });

    expect(result.applied).toBe(true);
    expect(result.invalidation?.status).toBe("applied");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(revalidateTag).toHaveBeenCalledWith("nx:theme:site-a", "default");
    expect(revalidateTag).toHaveBeenCalledWith("nx:sitemap:site-a", "default");
    expect(revalidateTag).toHaveBeenCalledWith("nx:feed:site-a", "default");
  });
});
