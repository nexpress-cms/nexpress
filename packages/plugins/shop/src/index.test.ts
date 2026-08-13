import { describe, expect, it, vi } from "vitest";

import {
  createShop,
  shopCollections,
  shopPlugin,
  storefrontFullShopSkin,
  type NpShopPackagingAdapter,
  type NpShopPackingWorkAdapter,
} from "./index.js";

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
    expect(shopPlugin.manifest.agent?.description?.length).toBeLessThanOrEqual(2_000);
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
    expect(shopPlugin.manifest.styleSlots?.["order-readd"]).toBe("[data-np-shop-order-readd]");
    expect(shopPlugin.manifest.styleSlots?.["return-postage"]).toBe(
      "[data-np-shop-return-postage-status]",
    );
    expect(shopPlugin.manifest.styleSlots?.["return-postage-settlement"]).toBe(
      "[data-np-shop-return-postage-settlement]",
    );
    expect(shopPlugin.manifest.styleSlots?.exchange).toBe("[data-np-shop-exchange]");
    expect(shopPlugin.manifest.styleSlots?.["exchange-destination"]).toBe(
      "[data-np-shop-exchange-destination]",
    );
    expect(shopPlugin.manifest.styleSlots?.["exchange-carrier-booking"]).toBe(
      "[data-np-shop-exchange-carrier-booking]",
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
      { id: "countExchanges", kind: "metric" },
      { id: "exchangeHealth", kind: "status" },
      { id: "recentExchanges", kind: "table" },
      { id: "readExchangeDestination", kind: "action" },
      { id: "countReturnLogistics", kind: "metric" },
      { id: "returnLogisticsHealth", kind: "status" },
      { id: "recentReturnLogistics", kind: "table" },
      { id: "countReturnPostage", kind: "metric" },
      { id: "returnPostageHealth", kind: "status" },
      { id: "recentReturnPostage", kind: "table" },
      { id: "approveReturn", kind: "action" },
      { id: "rejectReturn", kind: "action" },
      { id: "receiveReturn", kind: "action" },
      { id: "createExchange", kind: "action" },
      { id: "processExchange", kind: "action" },
      { id: "shipExchange", kind: "action" },
      { id: "cancelExchange", kind: "action" },
      { id: "resumeExchangeCarrier", kind: "action" },
      { id: "shipBookedExchange", kind: "action" },
      { id: "cancelExchangeCarrier", kind: "action" },
      { id: "countFulfillments", kind: "metric" },
      { id: "fulfillmentHealth", kind: "status" },
      { id: "recentFulfillments", kind: "table" },
      { id: "countFulfillmentParcels", kind: "metric" },
      { id: "fulfillmentParcelHealth", kind: "status" },
      { id: "recentFulfillmentParcels", kind: "table" },
      { id: "countPackingWork", kind: "metric" },
      { id: "packingWorkHealth", kind: "status" },
      { id: "recentPackingWork", kind: "table" },
      { id: "countPackingStatusEvents", kind: "metric" },
      { id: "packingStatusHealth", kind: "status" },
      { id: "recentPackingStatusEvents", kind: "table" },
      { id: "finalizePackingWork", kind: "action" },
      { id: "saveFulfillmentParcels", kind: "action" },
      { id: "processFulfillment", kind: "action" },
      { id: "countCarrierBookings", kind: "metric" },
      { id: "carrierBookingHealth", kind: "status" },
      { id: "recentCarrierBookings", kind: "table" },
      { id: "countCarrierLabelAcquisitions", kind: "metric" },
      { id: "carrierLabelAcquisitionHealth", kind: "status" },
      { id: "recentCarrierLabelAcquisitions", kind: "table" },
      { id: "countCarrierPickupAvailability", kind: "metric" },
      { id: "carrierPickupAvailabilityHealth", kind: "status" },
      { id: "recentCarrierPickupAvailability", kind: "table" },
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
    const exchangeTable = shopPlugin.admin?.tables?.find((table) => table.id === "shop-exchanges");
    expect(exchangeTable?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "destination",
        "destinationRevision",
        "destinationExpiresAt",
        "carrierBooking",
        "bookingId",
        "bookingRevision",
        "provider",
      ]),
    );
    expect(
      exchangeTable?.rowActions?.find((action) => action.id === "read-exchange-destination"),
    ).toMatchObject({
      actionId: "readExchangeDestination",
      result: "details",
      visibleWhen: { field: "destination", oneOf: ["submitted", "accessed"] },
    });
    expect(
      shopPlugin.admin?.tables
        ?.find((table) => table.id === "shop-partial-refunds")
        ?.rowActions?.some((action) => action.id === "read-exchange-destination"),
    ).toBe(false);
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
      "POST /cart/re-add",
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
      "POST /exchanges/destination",
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
      "cleanup-expired-carrier-pickup-availability",
      "maintain-orders",
      "reconcile-packing-work",
    ]);
    expect([...createShop().runtime.skins.keys()]).toEqual(["classic", "storefront-full"]);
    expect(storefrontFullShopSkin.id).toBe("storefront-full");
    expect(shopPlugin.hooks?.["content:afterUpdate"]).toBeTypeOf("function");
    expect(shopPlugin.hooks?.["content:afterDelete"]).toBeTypeOf("function");
    expect(shopPlugin.manifest.provides.apiRoutes).toContain("/restock-alerts");
    expect(shopPlugin.manifest.provides.apiRoutes).toContain("/price-alerts");
    expect(shopPlugin.manifest.provides.apiRoutes).toContain("/cart/re-add");
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
        "dashboard:shop-exchanges",
        "widget:shop-exchange-health",
        "table:shop-exchanges",
        "action:shop-exchange-operations",
        "action:shop-exchange-destination-private-read",
        "dashboard:shop-packing-work",
        "widget:shop-packing-work-health",
        "table:shop-packing-work",
        "action:shop-packing-work-finalize",
        "dashboard:shop-packing-status-events",
        "widget:shop-packing-status-health",
        "table:shop-packing-status-events",
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

  it("adds exact packaging proposal operations without requiring a carrier", async () => {
    const proposeParcels = vi.fn(() => Promise.reject(new Error("must not be called")));
    const shop = createShop({
      packaging: {
        adapter: {
          id: "test-packaging",
          proposeParcels,
        },
      },
    });

    expect(shop.runtime.packagingAdapter?.id).toBe("test-packaging");
    expect(shop.runtime.carrierAdapter).toBeNull();
    expect(shop.plugin.actions?.proposeFulfillmentParcels).toMatchObject({ kind: "action" });
    expect(shop.plugin.actions?.proposeExchangeParcels).toMatchObject({ kind: "action" });
    expect(shop.plugin.actions?.packagingProposalHealth).toMatchObject({ kind: "status" });
    expect(shop.plugin.actions?.packagingProposalHealth?.handler).toBeTypeOf("function");
    expect(
      shop.plugin.admin?.widgets?.find((widget) => widget.id === "shop-packaging-proposal-health"),
    ).toMatchObject({
      kind: "status",
      actionId: "packagingProposalHealth",
    });
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-fulfillments")
        ?.rowActions?.find((action) => action.id === "suggest-parcels"),
    ).toMatchObject({
      actionId: "proposeFulfillmentParcels",
      rowFields: ["id", "fulfillmentRevision", "parcelRevision"],
      visibleWhen: { field: "parcelMutationEligible", oneOf: [true] },
    });
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.find((action) => action.id === "suggest-exchange-parcels"),
    ).toMatchObject({
      actionId: "proposeExchangeParcels",
      rowFields: ["id", "exchangeId", "exchangeRevision", "parcelRevision"],
      visibleWhen: { field: "parcelMutationEligible", oneOf: [true] },
    });
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.find((action) => action.id === "save-exchange-parcels"),
    ).toMatchObject({
      actionId: "saveExchangeParcels",
      rowFields: ["id", "exchangeId", "exchangeRevision", "parcelRevision"],
    });
    expect(shop.plugin.actions?.saveExchangeParcels).toMatchObject({ kind: "action" });
    expect(shop.plugin.manifest.provides.adminExtensions).toEqual(
      expect.arrayContaining([
        "widget:shop-packaging-proposal-health",
        "action:shop-packaging-proposal",
        "action:shop-exchange-parcel-snapshot",
      ]),
    );

    const fulfillmentHandler = shop.plugin.actions?.proposeFulfillmentParcels?.handler;
    const exchangeHandler = shop.plugin.actions?.proposeExchangeParcels?.handler;
    expect(fulfillmentHandler).toBeTypeOf("function");
    expect(exchangeHandler).toBeTypeOf("function");
    if (!fulfillmentHandler || !exchangeHandler) {
      throw new Error("Packaging proposal handlers are missing.");
    }
    await expect(fulfillmentHandler(null, {} as never)).resolves.toEqual({
      ok: false,
      error: "Parcel proposals require a direct staff action.",
    });
    await expect(exchangeHandler(null, {} as never)).resolves.toEqual({
      ok: false,
      error: "Replacement parcel proposals require a direct staff action.",
    });
    expect(proposeParcels).not.toHaveBeenCalled();
  });

  it("omits packaging proposal surfaces without an adapter and rejects malformed adapters", () => {
    const shop = createShop();
    expect(shop.runtime.packagingAdapter).toBeNull();
    expect(shop.plugin.actions?.proposeFulfillmentParcels).toBeUndefined();
    expect(shop.plugin.actions?.proposeExchangeParcels).toBeUndefined();
    expect(shop.plugin.actions?.packagingProposalHealth).toBeUndefined();
    expect(
      shop.plugin.admin?.widgets?.some((widget) => widget.id === "shop-packaging-proposal-health"),
    ).toBe(false);
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-fulfillments")
        ?.rowActions?.some((action) => action.id === "suggest-parcels"),
    ).toBe(false);
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.some((action) => action.id === "suggest-exchange-parcels"),
    ).toBe(false);
    expect(shop.plugin.manifest.provides.adminExtensions).not.toContain(
      "widget:shop-packaging-proposal-health",
    );
    expect(shop.plugin.manifest.provides.adminExtensions).not.toContain(
      "action:shop-packaging-proposal",
    );

    expect(() =>
      createShop({
        packaging: {
          adapter: {
            id: "Invalid Provider",
            proposeParcels: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/packaging provider id/u);

    expect(() =>
      createShop({
        packaging: {
          adapter: {
            id: "test-packaging",
            proposeParcels: "not-a-function",
          } as unknown as NpShopPackagingAdapter,
        },
      }),
    ).toThrow(/proposeParcels must be a function/u);
  });

  it("adds exact durable packing-work surfaces for one complete paired adapter", () => {
    const createPackingWork = vi.fn(() => Promise.reject(new Error("must not be called")));
    const cancelPackingWork = vi.fn(() => Promise.reject(new Error("must not be called")));
    const shop = createShop({
      packing: {
        adapter: {
          id: "test-packing",
          createPackingWork,
          cancelPackingWork,
        },
      },
    });

    expect(shop.runtime.packingWorkAdapter?.id).toBe("test-packing");
    expect(shop.runtime.packagingAdapter).toBeNull();
    expect(shop.runtime.carrierAdapter).toBeNull();
    expect(shop.plugin.actions?.countPackingWork).toMatchObject({ kind: "metric" });
    expect(shop.plugin.actions?.packingWorkHealth).toMatchObject({ kind: "status" });
    expect(shop.plugin.actions?.recentPackingWork).toMatchObject({ kind: "table" });
    expect(shop.plugin.actions?.finalizePackingWork).toMatchObject({ kind: "action" });
    expect(shop.plugin.actions?.createFulfillmentPackingWork).toMatchObject({ kind: "action" });
    expect(shop.plugin.actions?.createExchangePackingWork).toMatchObject({ kind: "action" });
    expect(shop.plugin.actions?.reconcilePackingWork).toMatchObject({ kind: "action" });
    expect(shop.plugin.actions?.cancelPackingWork).toMatchObject({ kind: "action" });
    expect(shop.plugin.scheduled?.map((task) => task.id)).toContain("reconcile-packing-work");

    const dashboard = shop.plugin.admin?.dashboardWidgets?.find(
      (widget) => widget.id === "shop-packing-work-total",
    );
    const health = shop.plugin.admin?.widgets?.find(
      (widget) => widget.id === "shop-packing-work-health",
    );
    const packingTable = shop.plugin.admin?.tables?.find(
      (table) => table.id === "shop-packing-work",
    );
    const fulfillmentTable = shop.plugin.admin?.tables?.find(
      (table) => table.id === "shop-fulfillments",
    );
    const exchangeTable = shop.plugin.admin?.tables?.find((table) => table.id === "shop-exchanges");
    expect(dashboard).toMatchObject({ kind: "metric", actionId: "countPackingWork" });
    expect(health).toMatchObject({ kind: "status", actionId: "packingWorkHealth" });
    expect(packingTable).toMatchObject({ rowsActionId: "recentPackingWork" });
    expect(
      packingTable?.rowActions?.map((action) =>
        action.type === "download" ? action.id : action.actionId,
      ),
    ).toEqual(["finalizePackingWork", "reconcilePackingWork", "cancelPackingWork"]);
    expect(
      packingTable?.rowActions?.find((action) => action.id === "reconcile-packing-work"),
    ).toMatchObject({
      visibleWhen: { field: "providerRetryEligible", oneOf: [true] },
    });
    expect(
      packingTable?.rowActions?.find((action) => action.id === "cancel-packing-work"),
    ).toMatchObject({
      visibleWhen: { field: "providerCancelEligible", oneOf: [true] },
    });
    expect(
      fulfillmentTable?.rowActions?.find((action) => action.id === "create-packing-work"),
    ).toMatchObject({
      actionId: "createFulfillmentPackingWork",
      rowFields: ["id", "fulfillmentRevision", "parcelRevision", "packingWorkRevision"],
      visibleWhen: { field: "packingWorkAction", oneOf: ["create"] },
    });
    expect(
      fulfillmentTable?.rowActions?.find((action) => action.id === "save-parcels"),
    ).toMatchObject({ visibleWhen: { field: "parcelMutationEligible", oneOf: [true] } });
    expect(fulfillmentTable?.rowActions?.find((action) => action.id === "ship")).toMatchObject({
      visibleWhen: { field: "manualShipmentEligible", oneOf: [true] },
    });
    expect(
      exchangeTable?.rowActions?.find((action) => action.id === "create-exchange-packing-work"),
    ).toMatchObject({
      actionId: "createExchangePackingWork",
      rowFields: ["id", "exchangeId", "exchangeRevision", "parcelRevision", "packingWorkRevision"],
      visibleWhen: { field: "packingWorkAction", oneOf: ["create"] },
    });
    expect(
      exchangeTable?.rowActions?.find((action) => action.id === "save-exchange-parcels"),
    ).toMatchObject({
      actionId: "saveExchangeParcels",
      visibleWhen: { field: "parcelMutationEligible", oneOf: [true] },
    });
    expect(
      exchangeTable?.rowActions?.find((action) => action.id === "process-exchange"),
    ).toMatchObject({ visibleWhen: { field: "processEligible", oneOf: [true] } });
    expect(
      exchangeTable?.rowActions?.find((action) => action.id === "ship-exchange"),
    ).toMatchObject({ visibleWhen: { field: "manualShipEligible", oneOf: [true] } });
    expect(
      exchangeTable?.rowActions?.find((action) => action.id === "cancel-exchange"),
    ).toMatchObject({ visibleWhen: { field: "cancelEligible", oneOf: [true] } });
    expect(shop.plugin.actions?.saveExchangeParcels).toMatchObject({ kind: "action" });

    const referencedKinds = [
      [dashboard?.actionId, "metric"],
      [health?.actionId, "status"],
      [packingTable?.rowsActionId, "table"],
      ["finalizePackingWork", "action"],
      ["reconcilePackingWork", "action"],
      ["cancelPackingWork", "action"],
      ["createFulfillmentPackingWork", "action"],
      ["createExchangePackingWork", "action"],
      ["saveExchangeParcels", "action"],
    ] as const;
    for (const [actionId, kind] of referencedKinds) {
      expect(actionId).toBeTypeOf("string");
      expect(shop.plugin.actions?.[actionId ?? ""]?.kind).toBe(kind);
    }

    expect(
      shop.plugin.manifest.provides.adminExtensions?.filter((id) => id.includes("packing-work")),
    ).toEqual([
      "dashboard:shop-packing-work",
      "widget:shop-packing-work-health",
      "table:shop-packing-work",
      "action:shop-packing-work-finalize",
      "action:shop-packing-work-create",
      "action:shop-packing-work-provider",
    ]);
    expect(shop.plugin.manifest.provides.adminExtensions).toContain(
      "action:shop-exchange-parcel-snapshot",
    );
    expect(createPackingWork).not.toHaveBeenCalled();
    expect(cancelPackingWork).not.toHaveBeenCalled();
  });

  it("adds the authenticated raw packing status callback only for the optional verifier", () => {
    const createPackingWork = vi.fn(() => Promise.reject(new Error("must not be called")));
    const cancelPackingWork = vi.fn(() => Promise.reject(new Error("must not be called")));
    const verifyPackingStatusWebhook = vi.fn(() => null);
    const withoutCallback = createShop({
      packing: { adapter: { id: "test-packing", createPackingWork, cancelPackingWork } },
    });
    const withCallback = createShop({
      packing: {
        adapter: {
          id: "test-packing",
          createPackingWork,
          cancelPackingWork,
          verifyPackingStatusWebhook,
        },
      },
    });

    expect(withoutCallback.runtime.packingWorkCallbackAdapter).toBeNull();
    expect(withoutCallback.plugin.manifest.provides.apiRoutes).not.toContain(
      "/packing/status/webhook",
    );
    expect(withCallback.runtime.packingWorkCallbackAdapter?.id).toBe("test-packing");
    expect(withCallback.plugin.manifest.provides.apiRoutes).toContain("/packing/status/webhook");
    expect(
      withCallback.plugin.routes?.find((route) => route.path === "/packing/status/webhook"),
    ).toMatchObject({ method: "POST", auth: false, bodyMode: "raw" });
    expect(withCallback.plugin.actions?.countPackingStatusEvents).toMatchObject({
      kind: "metric",
    });
    expect(withCallback.plugin.actions?.packingStatusHealth).toMatchObject({ kind: "status" });
    expect(withCallback.plugin.actions?.recentPackingStatusEvents).toMatchObject({
      kind: "table",
    });
    expect(
      withCallback.plugin.admin?.tables?.find((table) => table.id === "shop-packing-status-events"),
    ).toMatchObject({ rowsActionId: "recentPackingStatusEvents" });
    expect(verifyPackingStatusWebhook).not.toHaveBeenCalled();
  });

  it("keeps durable local packing-work operations without a provider", () => {
    const shop = createShop();
    expect(shop.runtime.packingWorkAdapter).toBeNull();
    expect(shop.runtime.packingWorkCallbackAdapter).toBeNull();
    expect(shop.plugin.actions?.countPackingWork).toMatchObject({ kind: "metric" });
    expect(shop.plugin.actions?.packingWorkHealth).toMatchObject({ kind: "status" });
    expect(shop.plugin.actions?.recentPackingWork).toMatchObject({ kind: "table" });
    expect(shop.plugin.actions?.finalizePackingWork).toMatchObject({ kind: "action" });
    expect(shop.plugin.scheduled?.map((task) => task.id)).toContain("reconcile-packing-work");
    for (const actionId of [
      "createFulfillmentPackingWork",
      "createExchangePackingWork",
      "reconcilePackingWork",
      "cancelPackingWork",
    ] as const) {
      expect(shop.plugin.actions?.[actionId]).toBeUndefined();
    }
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-packing-work")
        ?.rowActions?.map((action) => (action.type === "download" ? action.id : action.actionId)),
    ).toEqual(["finalizePackingWork"]);
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-fulfillments")
        ?.rowActions?.some((action) => action.id === "create-packing-work"),
    ).toBe(false);
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.some(
          (action) =>
            action.id === "create-exchange-packing-work" || action.id === "save-exchange-parcels",
        ),
    ).toBe(false);
    expect(
      shop.plugin.manifest.provides.adminExtensions?.filter((id) => id.includes("packing-work")),
    ).toEqual([
      "dashboard:shop-packing-work",
      "widget:shop-packing-work-health",
      "table:shop-packing-work",
      "action:shop-packing-work-finalize",
    ]);
  });

  it("keeps read-only parcel proposals independent from durable packing work", () => {
    const proposeParcels = vi.fn(() => Promise.reject(new Error("must not be called")));
    const createPackingWork = vi.fn(() => Promise.reject(new Error("must not be called")));
    const cancelPackingWork = vi.fn(() => Promise.reject(new Error("must not be called")));
    const proposalOnly = createShop({
      packaging: { adapter: { id: "test-packaging", proposeParcels } },
    });
    const both = createShop({
      packaging: { adapter: { id: "test-packaging", proposeParcels } },
      packing: {
        adapter: { id: "test-packing", createPackingWork, cancelPackingWork },
      },
    });

    expect(proposalOnly.runtime.packagingAdapter?.id).toBe("test-packaging");
    expect(proposalOnly.runtime.packingWorkAdapter).toBeNull();
    expect(proposalOnly.plugin.actions?.proposeFulfillmentParcels).toMatchObject({
      kind: "action",
    });
    expect(proposalOnly.plugin.actions?.createFulfillmentPackingWork).toBeUndefined();
    expect(proposalOnly.plugin.actions?.countPackingWork).toMatchObject({ kind: "metric" });

    expect(both.runtime.packagingAdapter?.id).toBe("test-packaging");
    expect(both.runtime.packingWorkAdapter?.id).toBe("test-packing");
    expect(both.plugin.actions?.proposeFulfillmentParcels).toMatchObject({ kind: "action" });
    expect(both.plugin.actions?.createFulfillmentPackingWork).toMatchObject({ kind: "action" });
    expect(both.plugin.actions?.proposeExchangeParcels).toMatchObject({ kind: "action" });
    expect(both.plugin.actions?.createExchangePackingWork).toMatchObject({ kind: "action" });
    expect(both.plugin.manifest.provides.adminExtensions).toEqual(
      expect.arrayContaining([
        "widget:shop-packaging-proposal-health",
        "action:shop-packaging-proposal",
        "action:shop-packing-work-create",
        "action:shop-packing-work-provider",
      ]),
    );
    expect(proposeParcels).not.toHaveBeenCalled();
    expect(createPackingWork).not.toHaveBeenCalled();
    expect(cancelPackingWork).not.toHaveBeenCalled();
  });

  it("rejects incomplete, non-function, and invalid-id packing-work adapters", () => {
    const createPackingWork = () => Promise.reject(new Error("must not be called"));
    const cancelPackingWork = () => Promise.reject(new Error("must not be called"));
    expect(() =>
      createShop({
        packing: {
          adapter: {
            id: "Invalid Provider",
            createPackingWork,
            cancelPackingWork,
          },
        },
      }),
    ).toThrow(/packing work provider id/u);
    expect(() =>
      createShop({
        packing: {
          adapter: { id: "test-packing", createPackingWork } as unknown as NpShopPackingWorkAdapter,
        },
      }),
    ).toThrow(/requires createPackingWork and cancelPackingWork functions/u);
    expect(() =>
      createShop({
        packing: {
          adapter: { id: "test-packing", cancelPackingWork } as unknown as NpShopPackingWorkAdapter,
        },
      }),
    ).toThrow(/requires createPackingWork and cancelPackingWork functions/u);
    expect(() =>
      createShop({
        packing: {
          adapter: {
            id: "test-packing",
            createPackingWork: "not-a-function",
            cancelPackingWork,
          } as unknown as NpShopPackingWorkAdapter,
        },
      }),
    ).toThrow(/requires createPackingWork and cancelPackingWork functions/u);
    expect(() =>
      createShop({
        packing: {
          adapter: {
            id: "test-packing",
            createPackingWork,
            cancelPackingWork: "not-a-function",
          } as unknown as NpShopPackingWorkAdapter,
        },
      }),
    ).toThrow(/requires createPackingWork and cancelPackingWork functions/u);
    expect(() =>
      createShop({
        packing: {
          adapter: {
            id: "test-packing",
            createPackingWork,
            cancelPackingWork,
            verifyPackingStatusWebhook: "not-a-function",
          } as unknown as NpShopPackingWorkAdapter,
        },
      }),
    ).toThrow(/verifyPackingStatusWebhook must be a function/u);
  });

  it("rejects non-staff packing-work actions before provider calls", async () => {
    const createPackingWork = vi.fn(() => Promise.reject(new Error("provider was called")));
    const cancelPackingWork = vi.fn(() => Promise.reject(new Error("provider was called")));
    const shop = createShop({
      packing: {
        adapter: { id: "test-packing", createPackingWork, cancelPackingWork },
      },
    });
    const handlers = [
      shop.plugin.actions?.createFulfillmentPackingWork?.handler,
      shop.plugin.actions?.createExchangePackingWork?.handler,
      shop.plugin.actions?.reconcilePackingWork?.handler,
      shop.plugin.actions?.cancelPackingWork?.handler,
      shop.plugin.actions?.finalizePackingWork?.handler,
    ];
    for (const handler of handlers) {
      expect(handler).toBeTypeOf("function");
      if (!handler) throw new Error("Packing-work action handler is missing.");
      await expect(handler(null, {} as never)).resolves.toEqual({
        ok: false,
        error: expect.stringContaining("direct staff action"),
      });
    }
    expect(createPackingWork).not.toHaveBeenCalled();
    expect(cancelPackingWork).not.toHaveBeenCalled();
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
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-fulfillments")
        ?.rowActions?.find((action) => action.id === "book-carrier"),
    ).toMatchObject({
      visibleWhen: { field: "carrierShipmentEligible", oneOf: [true] },
    });
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

  it("adds replacement booking only as one paired carrier capability", () => {
    const shop = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          bookExchangeShipment: (request) => ({
            contract: "np.shop-exchange-carrier-booking-result.v1",
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            exchangeId: request.exchangeId,
            bookingReference: "replacement_123",
            carrier: "Parcel Co",
            trackingNumber: "REPLACEMENT-123",
            bookedAt: request.requestedAt,
          }),
          cancelExchangeShipment: (request) => ({
            contract: "np.shop-exchange-carrier-cancel-result.v1",
            cancellationId: request.cancellationId,
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            exchangeId: request.exchangeId,
            cancelledAt: request.requestedAt,
          }),
        },
      },
    });
    expect(shop.runtime.carrierExchangeAdapter?.id).toBe("test-carrier");
    expect(Object.keys(shop.plugin.actions ?? {})).toEqual(
      expect.arrayContaining([
        "bookExchangeCarrier",
        "resumeExchangeCarrier",
        "shipBookedExchange",
        "cancelExchangeCarrier",
      ]),
    );
    expect(shop.plugin.manifest.provides.adminExtensions).toContain(
      "action:shop-exchange-carrier-booking",
    );
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.map((action) => action.id),
    ).toEqual(
      expect.arrayContaining([
        "book-exchange-carrier",
        "resume-exchange-carrier",
        "ship-booked-exchange",
        "cancel-booked-exchange",
      ]),
    );
    const exchangeActions = shop.plugin.admin?.tables?.find(
      (table) => table.id === "shop-exchanges",
    )?.rowActions;
    expect(exchangeActions?.find((action) => action.id === "book-exchange-carrier")).toMatchObject({
      visibleWhen: { field: "carrierBookEligible", oneOf: [true] },
    });
    expect(
      exchangeActions?.find((action) => action.id === "resume-exchange-carrier"),
    ).toMatchObject({ visibleWhen: { field: "carrierResumeEligible", oneOf: [true] } });
    expect(exchangeActions?.find((action) => action.id === "ship-booked-exchange")).toMatchObject({
      visibleWhen: { field: "carrierShipEligible", oneOf: [true] },
    });
    expect(exchangeActions?.find((action) => action.id === "cancel-booked-exchange")).toMatchObject(
      { visibleWhen: { field: "carrierCancelEligible", oneOf: [true] } },
    );
    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            bookExchangeShipment: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/bookExchangeShipment and cancelExchangeShipment together/u);
  });

  it("adds parcel-aware replacement booking only on top of the paired exchange capability", () => {
    const shop = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          bookExchangeShipment: () => Promise.reject(new Error("not called")),
          bookExchangeShipmentWithParcels: () => Promise.reject(new Error("not called")),
          cancelExchangeShipment: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(shop.runtime.carrierExchangeParcelAdapter?.id).toBe("test-carrier");
    expect(shop.plugin.actions?.saveExchangeParcels?.kind).toBe("action");
    expect(shop.plugin.manifest.provides.adminExtensions).toContain(
      "action:shop-exchange-parcel-snapshot",
    );
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.map((action) => action.id),
    ).toContain("save-exchange-parcels");
    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            bookExchangeShipmentWithParcels: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/paired exchange booking and cancellation/u);
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
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-pickups")
        ?.rowActions?.find((action) => action.id === "resume-carrier-pickup"),
    ).toMatchObject({ visibleWhen: { field: "resumeEligible", oneOf: [true] } });

    const replacementOnly = createShop({
      carrier: {
        pickupLocationReference: "warehouse-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          bookExchangeShipment: () => Promise.reject(new Error("not called")),
          bookExchangeShipmentWithParcels: () => Promise.reject(new Error("not called")),
          cancelExchangeShipment: () => Promise.reject(new Error("not called")),
          schedulePickup: () => Promise.reject(new Error("not called")),
          cancelPickup: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(replacementOnly.runtime.carrierPickupAdapter?.id).toBe("test-carrier");
    expect(
      replacementOnly.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-bookings")
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
    ).not.toContain("scheduleCarrierPickup");
    expect(
      replacementOnly.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
    ).toContain("scheduleCarrierPickup");

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

  it("adds short-lived pickup windows only on top of complete pickup scheduling", () => {
    const shop = createShop({
      carrier: {
        pickupLocationReference: "warehouse-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          bookShipmentWithParcels: () => Promise.reject(new Error("not called")),
          bookExchangeShipment: () => Promise.reject(new Error("not called")),
          bookExchangeShipmentWithParcels: () => Promise.reject(new Error("not called")),
          cancelExchangeShipment: () => Promise.reject(new Error("not called")),
          schedulePickup: () => Promise.reject(new Error("not called")),
          cancelPickup: () => Promise.reject(new Error("not called")),
          listPickupWindows: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(shop.runtime.carrierPickupAvailabilityAdapter?.id).toBe("test-carrier");
    expect(shop.plugin.actions?.listCarrierPickupWindows?.kind).toBe("action");
    expect(shop.plugin.actions?.scheduleCarrierPickupWindow?.kind).toBe("action");
    expect(shop.plugin.actions?.countCarrierPickupAvailability?.kind).toBe("metric");
    expect(shop.plugin.actions?.carrierPickupAvailabilityHealth?.kind).toBe("status");
    expect(shop.plugin.actions?.recentCarrierPickupAvailability?.kind).toBe("table");
    expect(shop.plugin.manifest.provides.adminExtensions).toEqual(
      expect.arrayContaining([
        "dashboard:shop-carrier-pickup-availability",
        "widget:shop-carrier-pickup-availability-health",
        "table:shop-carrier-pickup-availability",
        "action:shop-carrier-pickup-availability",
      ]),
    );
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-bookings")
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
    ).toContain("listCarrierPickupWindows");
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-bookings")
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
    ).not.toContain("scheduleCarrierPickup");
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
    ).toContain("listCarrierPickupWindows");
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
    ).not.toContain("scheduleCarrierPickup");
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-pickup-availability")
        ?.rowActions?.map((action) => (action.type === "download" ? action.id : action.actionId)),
    ).toEqual(["scheduleCarrierPickupWindow"]);
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-pickup-availability")
        ?.rowActions?.find((action) => action.id === "schedule-carrier-pickup-window"),
    ).toMatchObject({ visibleWhen: { field: "scheduleEligible", oneOf: [true] } });

    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            listPickupWindows: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/pickup availability requires listPickupWindows/u);
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
          bookExchangeShipment: () => Promise.reject(new Error("not called")),
          cancelExchangeShipment: () => Promise.reject(new Error("not called")),
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
    expect(
      shop.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.flatMap((action) => (action.type === "download" ? [] : [action.actionId])),
    ).toContain("reconcileCarrierTracking");
    expect(shop.plugin.manifest.styleSlots?.["exchange-tracking-status"]).toBe(
      "[data-np-shop-exchange-tracking]",
    );
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
    expect(
      withLabels.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.find((action) => action.type === "download"),
    ).toMatchObject({
      routePath: "/carrier/shipping-label",
      query: [
        { name: "orderId", rowField: "id" },
        { name: "shipmentId", rowField: "bookingId" },
      ],
      visibleWhen: { field: "carrierBooking", oneOf: ["completed", "shipped"] },
    });
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
    expect(
      withoutLabels.plugin.admin?.tables
        ?.find((table) => table.id === "shop-exchanges")
        ?.rowActions?.some((action) => action.type === "download"),
    ).toBe(false);
  });

  it("adds label purchase and regeneration only as an additive read-capable carrier capability", () => {
    const withAcquisition = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          readShippingLabel: () => Promise.reject(new Error("not called")),
          acquireShippingLabel: () => Promise.reject(new Error("not called")),
        },
      },
    });
    expect(withAcquisition.runtime.carrierLabelAcquisitionAdapter?.id).toBe("test-carrier");
    expect(withAcquisition.plugin.actions?.acquireCarrierShippingLabel?.kind).toBe("action");
    expect(
      withAcquisition.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-bookings")
        ?.rowActions?.map((action) => action.id),
    ).toEqual(
      expect.arrayContaining([
        "purchase-shipping-label",
        "regenerate-shipping-label",
        "resume-shipping-label",
      ]),
    );
    expect(
      withAcquisition.plugin.admin?.tables
        ?.find((table) => table.id === "shop-carrier-label-acquisitions")
        ?.rowActions?.find((action) => action.id === "resume-carrier-label-acquisition"),
    ).toMatchObject({ visibleWhen: { field: "resumeEligible", oneOf: [true] } });
    expect(() =>
      createShop({
        carrier: {
          adapter: {
            id: "test-carrier",
            bookShipment: () => Promise.reject(new Error("not called")),
            acquireShippingLabel: () => Promise.reject(new Error("not called")),
          },
        },
      }),
    ).toThrow(/requires acquireShippingLabel and readShippingLabel together/u);
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
    expect(
      withRefund.plugin.admin?.tables
        ?.find((table) => table.id === "shop-recent-orders")
        ?.rowActions?.find((action) => action.id === "full-refund"),
    ).toMatchObject({ visibleWhen: { field: "refundEligible", oneOf: [true] } });
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
