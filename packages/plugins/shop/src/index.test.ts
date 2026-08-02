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
      "/shop/order-drafts/:draftId",
      "/shop/orders",
      "/shop/orders/:orderId",
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
      { id: "countActiveOrderDrafts", kind: "metric" },
      { id: "orderDraftHealth", kind: "status" },
      { id: "cleanupExpiredOrderDrafts", kind: "action" },
      { id: "countOrders", kind: "metric" },
      { id: "orderHealth", kind: "status" },
      { id: "countActiveInventoryReservations", kind: "metric" },
      { id: "inventoryReservationHealth", kind: "status" },
      { id: "recentInventoryReservations", kind: "table" },
      { id: "recentOrders", kind: "table" },
      { id: "countRefunds", kind: "metric" },
      { id: "refundHealth", kind: "status" },
      { id: "recentRefunds", kind: "table" },
      { id: "refundOrder", kind: "action" },
      { id: "countReturns", kind: "metric" },
      { id: "returnHealth", kind: "status" },
      { id: "recentReturns", kind: "table" },
      { id: "approveReturn", kind: "action" },
      { id: "rejectReturn", kind: "action" },
      { id: "receiveReturn", kind: "action" },
      { id: "countFulfillments", kind: "metric" },
      { id: "fulfillmentHealth", kind: "status" },
      { id: "recentFulfillments", kind: "table" },
      { id: "countFulfillmentParcels", kind: "metric" },
      { id: "fulfillmentParcelHealth", kind: "status" },
      { id: "recentFulfillmentParcels", kind: "table" },
      { id: "saveFulfillmentParcels", kind: "action" },
      { id: "processFulfillment", kind: "action" },
      { id: "countCarrierBookings", kind: "metric" },
      { id: "carrierBookingHealth", kind: "status" },
      { id: "recentCarrierBookings", kind: "table" },
      { id: "countTrackingEvents", kind: "metric" },
      { id: "trackingEventHealth", kind: "status" },
      { id: "recentTrackingEvents", kind: "table" },
      { id: "trackingPollHealth", kind: "status" },
      { id: "recentTrackingPolls", kind: "table" },
      { id: "bookCarrierShipment", kind: "action" },
      { id: "shipFulfillment", kind: "action" },
      { id: "readFulfillmentPrivate", kind: "action" },
      { id: "countPaymentEvents", kind: "metric" },
      { id: "paymentEventHealth", kind: "status" },
      { id: "recentPaymentEvents", kind: "table" },
      { id: "maintainOrders", kind: "action" },
    ]);
    expect(shopPlugin.routes?.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /cart",
      "POST /cart",
      "PATCH /cart",
      "DELETE /cart",
      "GET /checkout",
      "POST /checkout",
      "DELETE /checkout",
      "GET /order-drafts",
      "POST /order-drafts",
      "PATCH /order-drafts",
      "PUT /order-drafts",
      "DELETE /order-drafts",
      "GET /orders",
      "POST /orders",
      "DELETE /orders",
      "POST /returns",
      "DELETE /returns",
    ]);
    expect(shopPlugin.scheduled?.map((task) => task.id)).toEqual([
      "cleanup-expired-carts",
      "cleanup-expired-checkout-intents",
      "cleanup-expired-order-drafts",
      "maintain-orders",
    ]);
    expect([...createShop().runtime.skins.keys()]).toEqual(["classic", "storefront-full"]);
    expect(storefrontFullShopSkin.id).toBe("storefront-full");
  });

  it("adds the exact public raw webhook only when a payment adapter is configured", () => {
    const shop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: () => null,
        },
      },
    });
    expect(shop.plugin.manifest.provides.apiRoutes).toContain("/payments/webhook");
    expect(shop.plugin.routes?.find((route) => route.path === "/payments/webhook")).toMatchObject({
      method: "POST",
      auth: false,
      bodyMode: "raw",
    });
    expect(() =>
      createShop({
        payment: {
          adapter: {
            id: "Invalid Provider",
            verifyWebhook: () => null,
          },
        },
      }),
    ).toThrow(/provider id/u);
  });

  it("accepts only one complete server-side shipping quote adapter", () => {
    const shop = createShop({
      shipping: {
        adapter: {
          id: "test-shipping",
          quoteShipping: () => ({
            contract: "np.shop-shipping-quote-result.v1",
            quoteId: "quote_123",
            methods: [
              {
                id: "parcel",
                label: "Parcel",
                amountMinor: 3_000,
                estimatedDelivery: null,
              },
            ],
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        },
      },
    });
    expect(shop.runtime.shippingAdapter?.id).toBe("test-shipping");
    expect(() =>
      createShop({
        shipping: {
          adapter: {
            id: "Invalid Provider",
            quoteShipping: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/shipping provider id/u);
  });

  it("accepts only one complete server-side additional-tax quote adapter", () => {
    const shop = createShop({
      tax: {
        adapter: {
          id: "test-tax",
          quoteTax: () => ({
            contract: "np.shop-tax-quote-result.v1",
            quoteId: "tax_quote_123",
            components: [{ id: "vat", label: "VAT", amountMinor: 2_500 }],
            amountMinor: 2_500,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        },
      },
    });
    expect(shop.runtime.taxAdapter?.id).toBe("test-tax");
    expect(() =>
      createShop({
        tax: {
          adapter: {
            id: "Invalid Provider",
            quoteTax: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/tax provider id/u);
  });

  it("uses one complete server-side carrier adapter and exposes only its closed operations", () => {
    const shop = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: (request) => ({
            contract: "np.shop-carrier-booking-result.v1",
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            bookingReference: "booking_123",
            carrier: "Parcel Co",
            trackingNumber: "TRACK-123",
            bookedAt: request.requestedAt,
          }),
        },
      },
    });
    expect(shop.runtime.carrierAdapter?.id).toBe("test-carrier");
    expect(Object.keys(shop.plugin.actions ?? {})).toEqual(
      expect.arrayContaining([
        "countCarrierBookings",
        "carrierBookingHealth",
        "recentCarrierBookings",
        "bookCarrierShipment",
      ]),
    );
    expect(shop.plugin.actions?.shipFulfillment).toBeUndefined();
    expect(shop.plugin.manifest.provides.adminExtensions).toEqual(
      expect.arrayContaining([
        "dashboard:shop-carrier-bookings",
        "widget:shop-carrier-booking-health",
        "table:shop-carrier-bookings",
      ]),
    );
    expect(
      shop.plugin.admin?.tables?.find((table) => table.id === "shop-fulfillments")?.rowActions,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: "book-carrier" })]));
    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "Invalid Provider",
            bookShipment: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/carrier provider id/u);
  });

  it("adds a raw tracking webhook only for the optional carrier capability", () => {
    const shop = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          verifyTrackingWebhook: () => null,
        },
      },
    });
    expect(shop.runtime.carrierTrackingAdapter?.id).toBe("test-carrier");
    expect(shop.plugin.manifest.provides.apiRoutes).toContain("/carrier/tracking/webhook");
    expect(
      shop.plugin.routes?.find((route) => route.path === "/carrier/tracking/webhook"),
    ).toMatchObject({ method: "POST", auth: false, bodyMode: "raw" });
    expect(
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
          },
        },
      }).runtime.carrierTrackingAdapter,
    ).toBeNull();
  });

  it("adds parcel-aware booking as an independent carrier capability", () => {
    const shop = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          bookShipmentWithParcels: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(shop.runtime.carrierParcelAdapter?.id).toBe("test-carrier");
    expect(shop.plugin.actions?.saveFulfillmentParcels?.kind).toBe("action");
    expect(shop.plugin.manifest.provides.adminExtensions).toEqual(
      expect.arrayContaining([
        "widget:shop-fulfillment-parcel-health",
        "table:shop-fulfillment-parcels",
        "action:shop-fulfillment-parcels",
      ]),
    );
    expect(
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
          },
        },
      }).runtime.carrierParcelAdapter,
    ).toBeNull();
  });

  it("adds bounded tracking reconciliation only for the optional polling capability", () => {
    const shop = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          readTracking: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(shop.runtime.carrierTrackingPollAdapter?.id).toBe("test-carrier");
    expect(shop.plugin.actions?.reconcileCarrierTracking?.kind).toBe("action");
    expect(shop.plugin.scheduled?.map((task) => task.id)).toContain("reconcile-carrier-tracking");
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-bookings")
        ?.rowActions?.map((action) => action.actionId),
    ).toContain("reconcileCarrierTracking");
    const withoutPolling = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(withoutPolling.runtime.carrierTrackingPollAdapter).toBeNull();
    expect(withoutPolling.plugin.actions?.reconcileCarrierTracking).toBeUndefined();
    expect(withoutPolling.plugin.scheduled?.map((task) => task.id)).not.toContain(
      "reconcile-carrier-tracking",
    );
  });

  it("adds owner-scoped attempt routes and diagnostics only for a complete initiation adapter", () => {
    const shop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: () => null,
          preparePayment: () => ({ kind: "client", data: { clientKey: "public" } }),
          confirmPayment: () => {
            throw new Error("not called");
          },
          renderPaymentLauncher: () => null,
        },
      },
    });
    expect(
      shop.plugin.routes
        ?.filter((route) => route.path === "/payments/attempts")
        .map((route) => route.method),
    ).toEqual(["GET", "POST", "PATCH"]);
    expect(Object.keys(shop.plugin.actions ?? {})).toEqual(
      expect.arrayContaining([
        "countPaymentAttempts",
        "paymentAttemptHealth",
        "recentPaymentAttempts",
      ]),
    );
    const dashboardPriorities =
      shop.plugin.admin?.dashboardWidgets?.map((widget) => widget.priority) ?? [];
    expect(dashboardPriorities.every((priority) => typeof priority === "number")).toBe(true);
    expect(new Set(dashboardPriorities).size).toBe(dashboardPriorities.length);
    expect(shop.runtime.paymentInitiationAdapter?.id).toBe("test-pay");
    expect(() =>
      createShop({
        payment: {
          adapter: {
            id: "test-pay",
            verifyWebhook: () => null,
            preparePayment: () => ({ kind: "client", data: {} }),
          },
        },
      }),
    ).toThrow(/requires preparePayment, confirmPayment, and renderPaymentLauncher/u);
  });

  it("exposes the full-refund row action only for a refund-capable adapter", () => {
    const withoutRefund = createShop({
      payment: { adapter: { id: "test-pay", verifyWebhook: () => null } },
    });
    expect(withoutRefund.runtime.paymentRefundAdapter).toBeNull();
    expect(withoutRefund.plugin.actions?.refundOrder?.kind).toBe("action");
    expect(
      withoutRefund.plugin.admin?.tables?.find((table) => table.id === "shop-recent-orders")
        ?.rowActions,
    ).toEqual([]);
    expect(
      withoutRefund.plugin.admin?.tables
        ?.find((table) => table.id === "shop-refunds")
        ?.rowActions?.map((action) => action.actionId),
    ).toEqual(["refundOrder"]);

    const withRefund = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: () => null,
          refundPayment: () => {
            throw new Error("not called");
          },
        },
      },
    });
    expect(withRefund.runtime.paymentRefundAdapter?.id).toBe("test-pay");
    expect(withRefund.plugin.actions?.refundOrder?.kind).toBe("action");
    expect(
      withRefund.plugin.admin?.tables
        ?.find((table) => table.id === "shop-recent-orders")
        ?.rowActions?.map((action) => action.actionId),
    ).toEqual(["refundOrder"]);
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
