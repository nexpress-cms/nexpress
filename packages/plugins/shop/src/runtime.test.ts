import { describe, expect, it } from "vitest";

import {
  buildShopCatalogHref,
  getShopStockQuantity,
  normalizeShopVariants,
  npShopCatalogLimits,
  parseShopCatalogQuery,
} from "./index.js";
import {
  normalizeShopProduct,
  normalizeShopProductSummary,
  normalizeShopPromotion,
  type ShopProductDocument,
} from "./runtime.js";

function product(overrides: Partial<ShopProductDocument> = {}): ShopProductDocument {
  return {
    id: "product-1",
    slug: "everyday-cup",
    status: "published",
    name: "Everyday cup",
    summary: "  A cup for every day.  ",
    description: null,
    currency: "KRW",
    priceMinor: 25_000,
    compareAtPriceMinor: 30_000,
    taxIncluded: true,
    sku: "CUP-001",
    featured: true,
    trackInventory: true,
    stockQuantity: 8,
    lowStockThreshold: 3,
    categories: ["category-1"],
    gallery: [],
    variants: [],
    skin: "classic",
    ...overrides,
  };
}

describe("shop catalog query contract", () => {
  it("normalizes supported values and ignores unrelated decorations", () => {
    expect(
      parseShopCatalogQuery({
        page: "2",
        q: "  ceramic\t cup  ",
        sort: "price-asc",
        stock: "available",
        utm_source: "newsletter",
      }),
    ).toEqual({
      page: 2,
      search: "ceramic cup",
      sort: "price-asc",
      inStockOnly: true,
    });
  });

  it.each([
    { page: "0" },
    { page: "01" },
    { page: "1.0" },
    { page: String(npShopCatalogLimits.maximumPage + 1) },
    { page: ["1", "2"] },
    { q: ["one", "two"] },
    { q: "x".repeat(npShopCatalogLimits.maximumSearchLength + 1) },
    { sort: "popular" },
    { stock: "all" },
  ])("rejects malformed supported query values: %j", (searchParams) => {
    expect(parseShopCatalogQuery(searchParams)).toBeNull();
  });

  it("builds stable links while omitting default state", () => {
    const query = {
      page: 2,
      search: "ceramic cup",
      sort: "price-desc" as const,
      inStockOnly: true,
    };
    expect(buildShopCatalogHref("/shop", query, { page: 3 })).toBe(
      "/shop?page=3&q=ceramic+cup&sort=price-desc&stock=available",
    );
    expect(
      buildShopCatalogHref("/shop", query, {
        page: 1,
        search: null,
        sort: "newest",
        inStockOnly: false,
      }),
    ).toBe("/shop");
  });
});

describe("shop persisted product contract", () => {
  it("uses variant inventory instead of double-counting the standalone quantity", async () => {
    const document = product({
      stockQuantity: 50,
      variants: [
        { name: "Small", sku: "CUP-S", stockQuantity: 1, enabled: true },
        { name: "Large", sku: "CUP-L", stockQuantity: 2, enabled: true },
        { name: "Archived", sku: "CUP-X", stockQuantity: 99, enabled: false },
      ],
    });
    expect(getShopStockQuantity(document)).toBe(3);
    await expect(normalizeShopProductSummary(document)).resolves.toMatchObject({
      stockQuantity: 3,
      inventoryState: "low-stock",
    });
  });

  it("rejects duplicate SKUs and unbounded aggregate stock", () => {
    expect(() =>
      normalizeShopVariants([
        { name: "Small", sku: "cup-s", stockQuantity: 1 },
        { name: "Small again", sku: "CUP-S", stockQuantity: 2 },
      ]),
    ).toThrow(/duplicated/u);
    expect(() =>
      getShopStockQuantity(
        product({
          variants: [
            {
              name: "One",
              sku: "ONE",
              stockQuantity: npShopCatalogLimits.maximumStockQuantity,
            },
            { name: "Two", sku: "TWO", stockQuantity: 1 },
          ],
        }),
      ),
    ).toThrow(/aggregate stock/u);
  });

  it("fails closed on corrupted persisted commercial values", async () => {
    await expect(
      normalizeShopProductSummary(product({ compareAtPriceMinor: 20_000 })),
    ).rejects.toThrow(/greater than/u);
    await expect(normalizeShopProduct(product({ sku: "not valid sku" }))).rejects.toThrow(
      /invalid persisted SKU/u,
    );
    await expect(normalizeShopProductSummary(product({ currency: "BTC" }))).rejects.toThrow(
      /currency/u,
    );
  });
});

describe("shop persisted promotion contract", () => {
  it("preserves database Date windows as canonical immutable timestamps", () => {
    expect(
      normalizeShopPromotion({
        id: "123e4567-e89b-42d3-a456-426614174000",
        status: "published",
        name: "Timed offer",
        code: "TIMED",
        kind: "percentage",
        currency: "KRW",
        value: 1_000,
        target: "order",
        startsAt: new Date("2026-08-05T00:00:00.000Z"),
        endsAt: new Date("2026-08-06T00:00:00.000Z"),
      }),
    ).toMatchObject({
      startsAt: "2026-08-05T00:00:00.000Z",
      endsAt: "2026-08-06T00:00:00.000Z",
    });
  });
});
