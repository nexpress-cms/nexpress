import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findDocuments: vi.fn() }));
vi.mock("@nexpress/core/collections", () => ({ findDocuments: mocks.findDocuments }));

import { createShopProductInquiryContextSource } from "./inquiry-context.js";

const productId = "2d4af53e-6f78-43e0-8682-67f5a7d2b92e";

describe("Shop product inquiry context source", () => {
  beforeEach(() => mocks.findDocuments.mockReset());

  it("returns only bounded published product labels and local paths", async () => {
    mocks.findDocuments.mockResolvedValue({
      docs: [{ id: productId, name: " 테스트 상품 ", slug: "test-product" }],
    });
    const source = createShopProductInquiryContextSource();
    await expect(source.resolve([productId, productId])).resolves.toEqual([
      { id: productId, label: "테스트 상품", href: "/shop/products/test-product" },
    ]);
    expect(mocks.findDocuments).toHaveBeenCalledWith("shop-products", {
      where: { id: [productId], status: "published" },
      sort: "name",
      page: 1,
      limit: 100,
    });
  });

  it("rejects malformed ids and unsafe source options", async () => {
    expect(() => createShopProductInquiryContextSource({ basePath: "//evil" })).toThrow(/options/u);
    await expect(createShopProductInquiryContextSource().resolve(["not-a-uuid"])).rejects.toThrow(
      /UUID/u,
    );
  });
});
