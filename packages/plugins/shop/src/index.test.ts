import { describe, expect, it, vi } from "vitest";

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
      "shop-promotions",
      "shop-shipping-policies",
      "shop-product-reviews",
    ]);
    expect(shopPlugin.manifest.provides.collections).toEqual([
      "shop-categories",
      "shop-products",
      "shop-promotions",
      "shop-shipping-policies",
      "shop-product-reviews",
    ]);
    expect(shopPlugin.pageRoutes?.map((route) => route.pattern)).toEqual([
      "/shop",
      "/shop/categories/:categorySlug",
      "/shop/products/:productSlug",
      "/shop/wishlist",
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
    expect(shopCollections[1].community?.follows).toBe(true);
    expect(shopPlugin.manifest.styleSlots?.wishlist).toBe('[data-np-shop-surface="wishlist"]');
    expect(shopPlugin.manifest.styleSlots?.["wishlist-action"]).toBe(
      "[data-np-shop-wishlist-action]",
    );
    expect(shopPlugin.manifest.styleSlots?.["restock-alert"]).toBe("[data-np-shop-restock-alert]");
    expect(shopPlugin.manifest.styleSlots?.["price-alert"]).toBe("[data-np-shop-price-alert]");
    expect(shopPlugin.manifest.styleSlots?.["order-notifications"]).toBe(
      "[data-np-shop-order-notifications]",
    );
    expect(shopPlugin.manifest.styleSlots?.["return-postage"]).toBe(
      "[data-np-shop-return-postage-status]",
    );
    expect(shopPlugin.manifest.styleSlots?.["return-postage-settlement"]).toBe(
      "[data-np-shop-return-postage-settlement]",
    );
    expect(
      Object.entries(shopPlugin.actions ?? {}).map(([id, action]) => ({
        id,
        kind: action.kind,
      })),
    ).toEqual([
      { id: "countShippingPolicies", kind: "metric" },
      { id: "shippingPolicyHealth", kind: "status" },
      { id: "countPromotions", kind: "metric" },
      { id: "promotionHealth", kind: "status" },
      { id: "countProductReviews", kind: "metric" },
      { id: "productReviewHealth", kind: "status" },
      { id: "recentProductReviews", kind: "table" },
      { id: "hideProductReview", kind: "action" },
      { id: "restoreProductReview", kind: "action" },
      { id: "countProductWishlistSaves", kind: "metric" },
      { id: "wishlistHealth", kind: "status" },
      { id: "countActiveRestockAlerts", kind: "metric" },
      { id: "restockAlertHealth", kind: "status" },
      { id: "reconcileRestockAlerts", kind: "action" },
      { id: "countActivePriceAlerts", kind: "metric" },
      { id: "priceAlertHealth", kind: "status" },
      { id: "reconcilePriceAlerts", kind: "action" },
      { id: "countOrderNotifications", kind: "metric" },
      { id: "orderNotificationHealth", kind: "status" },
      { id: "recentOrderNotifications", kind: "table" },
      { id: "reconcileOrderNotifications", kind: "action" },
      { id: "retryOrderNotifications", kind: "action" },
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
      { id: "countPartialRefunds", kind: "metric" },
      { id: "refundHealth", kind: "status" },
      { id: "partialRefundHealth", kind: "status" },
      { id: "recentRefunds", kind: "table" },
      { id: "recentPartialRefunds", kind: "table" },
      { id: "refundOrder", kind: "action" },
      { id: "partialRefundReturn", kind: "action" },
      { id: "returnPostageSettlementRefund", kind: "action" },
      { id: "countReturns", kind: "metric" },
      { id: "returnHealth", kind: "status" },
      { id: "recentReturns", kind: "table" },
      { id: "countReturnLogistics", kind: "metric" },
      { id: "returnLogisticsHealth", kind: "status" },
      { id: "recentReturnLogistics", kind: "table" },
      { id: "countReturnPostage", kind: "metric" },
      { id: "returnPostageHealth", kind: "status" },
      { id: "recentReturnPostage", kind: "table" },
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
      { id: "countCarrierPickups", kind: "metric" },
      { id: "carrierPickupHealth", kind: "status" },
      { id: "recentCarrierPickups", kind: "table" },
      { id: "countTrackingEvents", kind: "metric" },
      { id: "trackingEventHealth", kind: "status" },
      { id: "recentTrackingEvents", kind: "table" },
      { id: "trackingPollHealth", kind: "status" },
      { id: "recentTrackingPolls", kind: "table" },
      { id: "countReturnTrackingEvents", kind: "metric" },
      { id: "returnTrackingEventHealth", kind: "status" },
      { id: "recentReturnTrackingEvents", kind: "table" },
      { id: "returnTrackingPollHealth", kind: "status" },
      { id: "recentReturnTrackingPolls", kind: "table" },
      { id: "bookCarrierShipment", kind: "action" },
      { id: "shipFulfillment", kind: "action" },
      { id: "readFulfillmentPrivate", kind: "action" },
      { id: "countPaymentEvents", kind: "metric" },
      { id: "paymentEventHealth", kind: "status" },
      { id: "recentPaymentEvents", kind: "table" },
      { id: "countPaymentAdjustments", kind: "metric" },
      { id: "paymentAdjustmentHealth", kind: "status" },
      { id: "recentPaymentAdjustments", kind: "table" },
      { id: "maintainOrders", kind: "action" },
    ]);
    expect(shopPlugin.routes?.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /cart",
      "GET /reviews",
      "POST /reviews",
      "PATCH /reviews",
      "DELETE /reviews",
      "GET /restock-alerts",
      "POST /restock-alerts",
      "DELETE /restock-alerts",
      "GET /price-alerts",
      "POST /price-alerts",
      "DELETE /price-alerts",
      "POST /cart",
      "PATCH /cart",
      "PUT /cart",
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
      "process-order-notifications",
      "reconcile-restock-alerts",
      "reconcile-price-alerts",
      "cleanup-expired-carts",
      "cleanup-expired-checkout-intents",
      "cleanup-expired-order-drafts",
      "cleanup-expired-return-logistics-private",
      "cleanup-expired-return-postage",
      "maintain-orders",
    ]);
    expect([...createShop().runtime.skins.keys()]).toEqual(["classic", "storefront-full"]);
    expect(storefrontFullShopSkin.id).toBe("storefront-full");
    expect(shopPlugin.hooks?.["content:afterUpdate"]).toBeTypeOf("function");
    expect(shopPlugin.hooks?.["content:afterDelete"]).toBeTypeOf("function");
    expect(shopPlugin.manifest.provides.apiRoutes).toContain("/restock-alerts");
    expect(shopPlugin.manifest.provides.apiRoutes).toContain("/price-alerts");
    expect(shopPlugin.manifest.provides.adminExtensions).toEqual(
      expect.arrayContaining([
        "dashboard:shop-restock-alerts",
        "widget:shop-restock-alert-health",
        "action:shop-restock-alert-reconcile",
        "dashboard:shop-price-alerts",
        "widget:shop-price-alert-health",
        "action:shop-price-alert-reconcile",
        "dashboard:shop-order-notifications",
        "widget:shop-order-notification-health",
        "table:shop-order-notifications",
        "action:shop-order-notification-reconcile",
        "action:shop-order-notification-retry",
      ]),
    );
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
    expect(() =>
      createShop({
        shipping: {
          adapter: {
            id: "shop-policy",
            quoteShipping: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/reserved for local policies/u);
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

  it("adds pickup scheduling only as one complete parcel-aware carrier capability", () => {
    const shop = createShop({
      carrier: {
        pickupLocationReference: "warehouse-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          bookShipmentWithParcels: () => Promise.reject(new Error("not called")),
          schedulePickup: () => Promise.reject(new Error("not called")),
          cancelPickup: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(shop.runtime.carrierPickupAdapter?.id).toBe("test-carrier");
    expect(shop.runtime.carrierPickupLocationReference).toBe("warehouse-seoul-1");
    expect(shop.plugin.actions?.scheduleCarrierPickup?.kind).toBe("action");
    expect(shop.plugin.actions?.resumeCarrierPickup?.kind).toBe("action");
    expect(shop.plugin.actions?.cancelCarrierPickup?.kind).toBe("action");
    expect(shop.plugin.manifest.provides.adminExtensions).toEqual(
      expect.arrayContaining([
        "dashboard:shop-carrier-pickups",
        "widget:shop-carrier-pickup-health",
        "table:shop-carrier-pickups",
        "action:shop-carrier-pickup",
      ]),
    );
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-bookings")
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
    ).toContain("scheduleCarrierPickup");
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-pickups")
        ?.rowActions?.map((action) => (action.type === "download" ? action.id : action.actionId)),
    ).toEqual(["resumeCarrierPickup", "cancelCarrierPickup"]);

    expect(() =>
      createShop({
        carrier: {
          pickupLocationReference: "warehouse-seoul-1",
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            bookShipmentWithParcels: () => Promise.reject(new Error("not called")),
            schedulePickup: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/schedulePickup and cancelPickup together/u);
    expect(() =>
      createShop({
        carrier: {
          pickupLocationReference: "warehouse-seoul-1",
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            schedulePickup: () => Promise.reject(new Error("not called")),
            cancelPickup: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/parcel-aware booking/u);
    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            bookShipmentWithParcels: () => Promise.reject(new Error("not called")),
            schedulePickup: () => Promise.reject(new Error("not called")),
            cancelPickup: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/pickup location/u);
  });

  it("adds return logistics only as one paired carrier capability with an opaque destination", () => {
    const shop = createShop({
      carrier: {
        returnLocationReference: "returns-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          createReturnShipment: () => Promise.reject(new Error("not called")),
          cancelReturnShipment: () => Promise.reject(new Error("not called")),
          readReturnLabel: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(shop.runtime.carrierReturnLogisticsAdapter?.id).toBe("test-carrier");
    expect(shop.runtime.carrierReturnLabelAdapter?.id).toBe("test-carrier");
    expect(shop.runtime.carrierReturnLocationReference).toBe("returns-seoul-1");
    expect(shop.plugin.manifest.provides.apiRoutes).toEqual(
      expect.arrayContaining(["/returns/logistics", "/returns/logistics/label"]),
    );
    expect(
      shop.plugin.routes?.find((route) => route.path === "/returns/logistics/label"),
    ).toMatchObject({ method: "GET", auth: false, responseMode: "binary" });
    expect(
      shop.plugin.routes
        ?.filter((route) => route.path === "/returns/logistics")
        .map((route) => route.method),
    ).toEqual(["POST", "PATCH", "DELETE"]);
    expect(shop.plugin.manifest.provides.adminExtensions).toEqual(
      expect.arrayContaining([
        "dashboard:shop-return-logistics",
        "widget:shop-return-logistics-health",
        "table:shop-return-logistics",
        "action:shop-return-logistics",
        "action:shop-return-label-download",
      ]),
    );
    expect(shop.plugin.actions?.countReturnLogistics?.kind).toBe("metric");
    expect(shop.plugin.actions?.returnLogisticsHealth?.kind).toBe("status");
    expect(shop.plugin.actions?.recentReturnLogistics?.kind).toBe("table");

    expect(() =>
      createShop({
        carrier: {
          returnLocationReference: "returns-seoul-1",
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            createReturnShipment: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/createReturnShipment and cancelReturnShipment together/u);
    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            createReturnShipment: () => Promise.reject(new Error("not called")),
            cancelReturnShipment: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/return location reference/u);
    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            readReturnLabel: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/return label retrieval requires the paired return logistics methods/u);
    expect(() =>
      createShop({
        carrier: {
          returnLocationReference: "returns-seoul-1",
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/returnLocationReference requires return logistics methods/u);
  });

  it("adds return-postage quoting only as a paired additive return-logistics capability", () => {
    const shop = createShop({
      carrier: {
        returnLocationReference: "returns-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          createReturnShipment: () => Promise.reject(new Error("not called")),
          cancelReturnShipment: () => Promise.reject(new Error("not called")),
          quoteReturnShipping: () => Promise.reject(new Error("not called")),
          createQuotedReturnShipment: () => Promise.reject(new Error("not called")),
        },
      },
    });

    expect(shop.runtime.carrierReturnPostageAdapter?.id).toBe("test-carrier");
    expect(
      shop.plugin.routes
        ?.filter((route) => route.path === "/returns/postage")
        .map((route) => route.method),
    ).toEqual(["POST", "PATCH"]);
    expect(shop.plugin.manifest.provides.apiRoutes).toContain("/returns/postage");
    expect(shop.plugin.manifest.provides.adminExtensions).toEqual(
      expect.arrayContaining([
        "dashboard:shop-return-postage",
        "widget:shop-return-postage-health",
        "table:shop-return-postage",
        "action:shop-return-postage",
      ]),
    );
    expect(shop.plugin.actions?.countReturnPostage?.kind).toBe("metric");
    expect(shop.plugin.actions?.returnPostageHealth?.kind).toBe("status");

    expect(() =>
      createShop({
        carrier: {
          returnLocationReference: "returns-seoul-1",
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            createReturnShipment: () => Promise.reject(new Error("not called")),
            cancelReturnShipment: () => Promise.reject(new Error("not called")),
            quoteReturnShipping: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/quoteReturnShipping and createQuotedReturnShipment together/u);
    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            quoteReturnShipping: () => Promise.reject(new Error("not called")),
            createQuotedReturnShipment: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/requires the paired return logistics methods/u);
  });

  it("adds reverse tracking as independent webhook and polling capabilities over return logistics", () => {
    const shop = createShop({
      carrier: {
        returnLocationReference: "returns-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          createReturnShipment: () => Promise.reject(new Error("not called")),
          cancelReturnShipment: () => Promise.reject(new Error("not called")),
          verifyReturnTrackingWebhook: () => null,
          readReturnTracking: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(shop.runtime.carrierReturnTrackingAdapter?.id).toBe("test-carrier");
    expect(shop.runtime.carrierReturnTrackingPollAdapter?.id).toBe("test-carrier");
    expect(
      shop.plugin.routes?.find((route) => route.path === "/carrier/return-tracking/webhook"),
    ).toMatchObject({ method: "POST", auth: false, bodyMode: "raw" });
    expect(shop.plugin.scheduled?.map((task) => task.id)).toContain(
      "reconcile-carrier-return-tracking",
    );
    expect(shop.plugin.actions?.countReturnTrackingEvents?.kind).toBe("metric");
    expect(shop.plugin.actions?.returnTrackingEventHealth?.kind).toBe("status");
    expect(shop.plugin.actions?.returnTrackingPollHealth?.kind).toBe("status");
    expect(shop.plugin.actions?.recentReturnTrackingEvents?.kind).toBe("table");
    expect(shop.plugin.actions?.recentReturnTrackingPolls?.kind).toBe("table");
    expect(shop.plugin.actions?.reconcileCarrierReturnTracking?.kind).toBe("action");

    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            verifyReturnTrackingWebhook: () => null,
          },
        },
      }),
    ).toThrow(/return tracking requires the paired return logistics methods/u);

    const webhookOnly = createShop({
      carrier: {
        returnLocationReference: "returns-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          createReturnShipment: () => Promise.reject(new Error("not called")),
          cancelReturnShipment: () => Promise.reject(new Error("not called")),
          verifyReturnTrackingWebhook: () => null,
        },
      },
    });
    expect(webhookOnly.runtime.carrierReturnTrackingAdapter?.id).toBe("test-carrier");
    expect(webhookOnly.runtime.carrierReturnTrackingPollAdapter).toBeNull();
    expect(webhookOnly.plugin.actions?.reconcileCarrierReturnTracking).toBeUndefined();
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
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
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

  it("exposes authenticated binary label download only for the optional carrier capability", async () => {
    const readShippingLabel = vi.fn(() => Promise.reject(new Error("not called")));
    const withLabels = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          readShippingLabel,
        },
      },
    });
    expect(withLabels.runtime.carrierLabelAdapter?.id).toBe("test-carrier");
    expect(
      withLabels.plugin.routes?.find((route) => route.path === "/carrier/shipping-label"),
    ).toMatchObject({ method: "GET", auth: true, responseMode: "binary" });
    expect(
      withLabels.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-bookings")
        ?.rowActions?.find((action) => action.type === "download"),
    ).toMatchObject({ routePath: "/carrier/shipping-label" });
    const labelRoute = withLabels.plugin.routes?.find(
      (route) => route.path === "/carrier/shipping-label",
    );
    await expect(
      labelRoute?.handler(
        {
          method: "HEAD",
          path: "/carrier/shipping-label",
          params: {},
          query: {},
          bodyMode: "none",
          body: undefined,
          rawBody: undefined,
          headers: {},
          user: { id: "staff-1", email: "staff@example.com", role: "admin" },
        },
        {} as never,
      ),
    ).resolves.toEqual({ status: 204 });
    expect(readShippingLabel).not.toHaveBeenCalled();

    const withoutLabels = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(withoutLabels.runtime.carrierLabelAdapter).toBeNull();
    expect(
      withoutLabels.plugin.routes?.some((route) => route.path === "/carrier/shipping-label"),
    ).toBe(false);
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
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
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
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
    ).toEqual(["refundOrder"]);
  });

  it("exposes return-linked partial refunds only for an explicit adapter capability", () => {
    const withoutPartialRefund = createShop({
      payment: { adapter: { id: "test-pay", verifyWebhook: () => null } },
    });
    expect(withoutPartialRefund.runtime.paymentPartialRefundAdapter).toBeNull();
    expect(
      withoutPartialRefund.plugin.manifest.provides.adminExtensions?.includes(
        "action:shop-return-partial-refund",
      ) ?? false,
    ).toBe(false);
    expect(
      withoutPartialRefund.plugin.admin?.tables
        ?.find((table) => table.id === "shop-returns")
        ?.rowActions?.map((action) => action.id),
    ).not.toContain("partial-refund-return");
    expect(
      withoutPartialRefund.plugin.admin?.tables
        ?.find((table) => table.id === "shop-partial-refunds")
        ?.rowActions?.map((action) => action.id),
    ).toContain("resume-partial-refund");

    const withPartialRefund = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: () => null,
          refundPaymentPartially: () => {
            throw new Error("not called");
          },
        },
      },
    });
    expect(withPartialRefund.runtime.paymentPartialRefundAdapter?.id).toBe("test-pay");
    expect(withPartialRefund.plugin.actions?.partialRefundReturn?.kind).toBe("action");
    expect(
      withPartialRefund.plugin.admin?.tables
        ?.find((table) => table.id === "shop-returns")
        ?.rowActions?.map((action) => action.id),
    ).toContain("partial-refund-return");
  });

  it("exposes quote-backed return-postage settlement only for its additive adapter capability", () => {
    const withoutSettlement = createShop({
      payment: { adapter: { id: "test-pay", verifyWebhook: () => null } },
    });
    expect(withoutSettlement.runtime.paymentReturnSettlementAdapter).toBeNull();
    expect(
      withoutSettlement.plugin.manifest.provides.adminExtensions?.includes(
        "action:shop-return-postage-settlement-refund",
      ) ?? false,
    ).toBe(false);
    expect(
      withoutSettlement.plugin.admin?.tables
        ?.find((table) => table.id === "shop-returns")
        ?.rowActions?.map((action) => action.id),
    ).not.toContain("return-postage-settlement-refund");

    const withSettlement = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: () => null,
          refundReturnSettlement: () => {
            throw new Error("not called");
          },
        },
      },
    });
    expect(withSettlement.runtime.paymentReturnSettlementAdapter?.id).toBe("test-pay");
    expect(withSettlement.plugin.actions?.returnPostageSettlementRefund?.kind).toBe("action");
    expect(withSettlement.plugin.manifest.provides.adminExtensions).toContain(
      "action:shop-return-postage-settlement-refund",
    );
    expect(
      withSettlement.plugin.admin?.tables
        ?.find((table) => table.id === "shop-returns")
        ?.rowActions?.find((action) => action.id === "return-postage-settlement-refund"),
    ).toMatchObject({
      visibleWhen: { field: "postageSettlement", oneOf: ["eligible"] },
    });
    expect(
      withSettlement.plugin.admin?.tables
        ?.find((table) => table.id === "shop-partial-refunds")
        ?.rowActions?.map((action) => action.id),
    ).toContain("resume-return-postage-settlement-refund");
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
      collections: {
        categories: "catalog-categories",
        products: "catalog-products",
        promotions: "catalog-promotions",
        shippingPolicies: "catalog-shipping-policies",
        reviews: "catalog-reviews",
      },
      skins: [editorial],
      defaultSkinId: "editorial",
    });

    expect(shop.plugin.pageRoutes?.[0]?.pattern).toBe("/commerce/catalog");
    expect(shop.collections.map((collection) => collection.slug)).toEqual([
      "catalog-categories",
      "catalog-products",
      "catalog-promotions",
      "catalog-shipping-policies",
      "catalog-reviews",
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

  it("normalizes coupon codes and forces promotion definitions private", () => {
    const beforeCreate = shopCollections[2].hooks?.beforeCreate?.[0];
    expect(beforeCreate).toBeTypeOf("function");
    expect(
      beforeCreate?.({
        data: {
          name: "Welcome",
          code: " welcome ",
          automatic: false,
          kind: "fixed",
          currency: "KRW",
          value: 5_000,
          maximumDiscountMinor: null,
          minimumSubtotalMinor: 0,
          target: "order",
          products: [],
          categories: [],
          startsAt: null,
          endsAt: null,
          priority: 0,
          stackable: false,
          totalUsageLimit: 0,
          perOwnerUsageLimit: 0,
          visibility: "public",
        },
        originalDoc: null,
        user: null,
        principal: null,
        collection: "shop-promotions",
      }),
    ).toMatchObject({ code: "WELCOME", visibility: "private" });
  });

  it("normalizes destination rules and forces shipping policies private", () => {
    const beforeCreate = shopCollections[3].hooks?.beforeCreate?.[0];
    expect(beforeCreate).toBeTypeOf("function");
    expect(
      beforeCreate?.({
        data: {
          name: "Jeju surcharge",
          methodCode: "standard",
          kind: "surcharge",
          label: "Standard delivery",
          currency: "KRW",
          amountMinor: 3_000,
          freeThresholdMinor: null,
          thresholdBasis: "discounted-subtotal",
          minimumDays: null,
          maximumDays: null,
          destinationScope: "postal-prefixes",
          countryCode: "kr",
          postalPrefixes: [{ prefix: "63-0" }],
          administrativeAreas: [],
          cartScope: "all",
          products: [],
          categories: [],
          startsAt: null,
          endsAt: null,
          priority: 10,
          visibility: "public",
        },
        originalDoc: null,
        user: null,
        principal: null,
        collection: "shop-shipping-policies",
      }),
    ).toMatchObject({
      countryCode: "KR",
      postalPrefixes: [{ prefix: "630" }],
      visibility: "private",
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
