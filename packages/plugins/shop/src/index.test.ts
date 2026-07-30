import { describe, expect, it } from "vitest";

import { createShop, shopCollections, shopPlugin, storefrontFullShopSkin } from "./index.js";

function validProductData() {
  return {
    name: "Everyday cup",
    description: { version: 1, document: {} },
    currency: "KRW",
    priceMinor: 25_000,
    compareAtPriceMinor: 30_000,
    taxIncluded: true,
    sku: " cup-001 ",
    trackInventory: true,
    stockQuantity: 8,
    lowStockThreshold: 3,
    featured: false,
    categories: [],
    gallery: [],
    variants: [],
  };
}

describe("shop factory", () => {
  it("closes every default surface over the same catalog collections", () => {
    expect(shopCollections.map((collection) => collection.slug)).toEqual([
      "shop-categories",
      "shop-products",
    ]);
    expect(shopPlugin.manifest.provides.collections).toEqual(["shop-categories", "shop-products"]);
    expect(shopPlugin.pageRoutes?.map((route) => route.pattern)).toEqual([
      "/shop",
      "/shop/categories/:categorySlug",
      "/shop/products/:productSlug",
      "/shop/cart",
      "/shop/checkout/:intentId",
    ]);
    expect(shopPlugin.blocks?.map((block) => block.type)).toEqual([
      "shop.featured-products",
      "shop.category-grid",
    ]);
    expect(shopPlugin.patterns?.map((pattern) => pattern.id)).toEqual(["shop.storefront-home"]);
    expect(
      Object.entries(shopPlugin.actions ?? {}).map(([id, action]) => ({
        id,
        kind: action.kind,
      })),
    ).toEqual([
      { id: "countProducts", kind: "metric" },
      { id: "countLowStockProducts", kind: "metric" },
      { id: "countActiveCarts", kind: "metric" },
      { id: "cartHealth", kind: "status" },
      { id: "cleanupExpiredCarts", kind: "action" },
      { id: "countActiveCheckoutIntents", kind: "metric" },
      { id: "checkoutIntentHealth", kind: "status" },
      { id: "cleanupExpiredCheckoutIntents", kind: "action" },
    ]);
    expect(shopPlugin.routes?.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /cart",
      "POST /cart",
      "PATCH /cart",
      "DELETE /cart",
      "GET /checkout",
      "POST /checkout",
      "DELETE /checkout",
    ]);
    expect(shopPlugin.scheduled?.map((task) => task.id)).toEqual([
      "cleanup-expired-carts",
      "cleanup-expired-checkout-intents",
    ]);
    expect([...createShop().runtime.skins.keys()]).toEqual(["classic", "storefront-full"]);
    expect(storefrontFullShopSkin.id).toBe("storefront-full");
  });

  it("applies custom paths, collection slugs, and skins across the contract", () => {
    const editorial = {
      id: "editorial",
      label: "Editorial",
      renderCatalog: () => null,
      renderCategory: () => null,
      renderProduct: () => null,
    };
    const shop = createShop({
      basePath: "/commerce/catalog",
      collections: { categories: "catalog-categories", products: "catalog-products" },
      skins: [editorial],
      defaultSkinId: "editorial",
    });

    expect(shop.plugin.pageRoutes?.[0]?.pattern).toBe("/commerce/catalog");
    expect(shop.collections.map((collection) => collection.slug)).toEqual([
      "catalog-categories",
      "catalog-products",
    ]);
    const categoryRelation = shop.collections[1].fields.find(
      (field) => "name" in field && field.name === "categories",
    );
    expect(categoryRelation).toMatchObject({
      type: "relationship",
      relationTo: "catalog-categories",
      hasMany: true,
    });
    const skinField = shop.collections[1].fields.find(
      (field) => "name" in field && field.name === "skin",
    );
    expect(skinField).toMatchObject({
      defaultValue: "editorial",
      options: [
        { label: "Classic catalog", value: "classic" },
        { label: "Storefront full", value: "storefront-full" },
        { label: "Editorial", value: "editorial" },
      ],
    });
    expect(shop.collections[0].seo?.urlPath?.({ slug: "living" })).toBe(
      "/commerce/catalog/categories/living",
    );
    expect(shop.collections[1].seo?.urlPath?.({ slug: "cup" })).toBe(
      "/commerce/catalog/products/cup",
    );
  });

  it("derives inventory fields and canonical SKUs before persistence", () => {
    const beforeCreate = shopCollections[1].hooks?.beforeCreate?.[0];
    expect(beforeCreate).toBeTypeOf("function");
    expect(
      beforeCreate?.({
        data: validProductData(),
        originalDoc: null,
        user: null,
        principal: null,
        collection: "shop-products",
      }),
    ).toMatchObject({
      sku: "CUP-001",
      available: true,
      inventoryState: "in-stock",
    });

    expect(
      beforeCreate?.({
        data: {
          ...validProductData(),
          stockQuantity: 99,
          lowStockThreshold: 3,
          variants: [
            {
              name: " Small ",
              sku: " cup-s ",
              optionSummary: " 240 ml ",
              stockQuantity: 2,
              enabled: true,
            },
          ],
        },
        originalDoc: null,
        user: null,
        principal: null,
        collection: "shop-products",
      }),
    ).toMatchObject({
      available: true,
      inventoryState: "low-stock",
      variants: [
        {
          name: "Small",
          sku: "CUP-S",
          optionSummary: "240 ml",
          stockQuantity: 2,
          enabled: true,
        },
      ],
    });

    expect(
      beforeCreate?.({
        data: { ...validProductData(), sku: "   " },
        originalDoc: null,
        user: null,
        principal: null,
        collection: "shop-products",
      }),
    ).toMatchObject({
      sku: null,
    });
  });

  it("rejects malformed catalog definitions and unsafe product values early", async () => {
    expect(() => createShop({ basePath: "/Shop" })).toThrow(/basePath/u);
    expect(() => createShop({ basePath: "/shop/" })).toThrow(/basePath/u);
    expect(() => createShop({ defaultSkinId: "missing" })).toThrow(/not registered/u);
    expect(() =>
      createShop({ collections: { categories: "catalog", products: "catalog" } }),
    ).toThrow(/must be different/u);
    expect(() =>
      createShop({
        skins: [
          {
            id: "classic",
            label: "Duplicate",
            renderCatalog: () => null,
            renderCategory: () => null,
            renderProduct: () => null,
          },
        ],
      }),
    ).toThrow(/more than once/u);
    expect(() =>
      createShop({
        skins: [
          {
            id: "broken",
            label: "Broken",
            renderCatalog: () => null,
            renderCategory: () => null,
            renderProduct: () => null,
            renderCheckout: "invalid",
          } as never,
        ],
      }),
    ).toThrow(/incomplete/u);

    const beforeCreate = shopCollections[1].hooks?.beforeCreate?.[0];
    let compareAtError: unknown;
    try {
      await beforeCreate?.({
        data: { ...validProductData(), compareAtPriceMinor: 20_000 },
        originalDoc: null,
        user: null,
        principal: null,
        collection: "shop-products",
      });
    } catch (error) {
      compareAtError = error;
    }
    expect(compareAtError).toMatchObject({
      errors: [
        {
          field: "compareAtPriceMinor",
          message: expect.stringMatching(/Compare-at price/u),
        },
      ],
    });

    let skuError: unknown;
    try {
      await beforeCreate?.({
        data: {
          ...validProductData(),
          variants: [{ name: "One", sku: "CUP-001", stockQuantity: 1, enabled: true }],
        },
        originalDoc: null,
        user: null,
        principal: null,
        collection: "shop-products",
      });
    } catch (error) {
      skuError = error;
    }
    expect(skuError).toMatchObject({
      errors: [
        {
          field: "variants",
          message: expect.stringMatching(/product SKU and variant SKUs/u),
        },
      ],
    });
  });
});
