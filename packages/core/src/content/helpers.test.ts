import { beforeEach, describe, expect, it, vi } from "vitest";

const collectionMocks = vi.hoisted(() => ({
  findDocuments: vi.fn(),
  getCollectionConfig: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../collections/index.js", () => collectionMocks);

import { findPosts, getPageBySlug } from "./helpers.js";

describe("content helpers", () => {
  beforeEach(() => {
    collectionMocks.findDocuments.mockReset();
    collectionMocks.getCollectionConfig.mockReset();
    collectionMocks.getDb.mockReset();
  });

  it("only forwards locale for i18n-enabled page collections", async () => {
    collectionMocks.findDocuments.mockResolvedValue({ docs: [{ id: "page-1" }] });
    collectionMocks.getCollectionConfig.mockReturnValue({ i18n: false });

    await expect(getPageBySlug("about", { locale: "ko" })).resolves.toEqual({ id: "page-1" });
    expect(collectionMocks.findDocuments).toHaveBeenLastCalledWith("pages", {
      where: { slug: "about", status: "published" },
      limit: 1,
    });

    collectionMocks.getCollectionConfig.mockReturnValue({ i18n: true });
    await getPageBySlug("about", { locale: "ko" });
    expect(collectionMocks.findDocuments).toHaveBeenLastCalledWith("pages", {
      where: { slug: "about", status: "published" },
      locale: "ko",
      limit: 1,
    });
  });

  it("treats non-document catch-all paths as a page miss before strict querying", async () => {
    await expect(getPageBySlug("tag/postgres")).resolves.toBeNull();
    expect(collectionMocks.findDocuments).not.toHaveBeenCalled();
    expect(collectionMocks.getCollectionConfig).not.toHaveBeenCalled();
  });

  it("delegates post filters to the canonical collection query contract", async () => {
    const result = {
      docs: [],
      totalDocs: 0,
      totalPages: 0,
      page: 2,
      limit: 10,
      hasNextPage: false,
      hasPrevPage: false,
    };
    collectionMocks.findDocuments.mockResolvedValue(result);
    const options = { page: 2, where: { categories: ["category-1"] } };

    await expect(findPosts(options)).resolves.toBe(result);
    expect(collectionMocks.findDocuments).toHaveBeenCalledWith("posts", options, undefined);
  });
});
