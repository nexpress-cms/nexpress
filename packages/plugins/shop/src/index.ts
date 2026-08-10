import {
  definePlugin,
  npAdminStatus,
  npAdminTable,
  type NpPluginContext,
  type NpPluginPageRouteRegistration,
} from "@nexpress/plugin-sdk";
import { registerNotificationKind } from "@nexpress/core/community";

import { createShopCartApiHandler } from "./cart-api.js";
import { npCleanupExpiredShopCarts, npCountShopCarts } from "./cart-service.js";
import { createShopCheckoutApiHandler } from "./checkout-api.js";
import { createShopCarrierLabelApiHandler } from "./carrier-label-api.js";
import {
  npCleanupExpiredShopCheckoutIntents,
  npCountShopCheckoutIntents,
} from "./checkout-service.js";
import {
  defineShopCategoriesCollection,
  defineShopProductsCollection,
  defineShopPromotionsCollection,
  defineShopShippingPoliciesCollection,
  defineShopProductReviewsCollection,
} from "./collections.js";
import { createShopHomeBlocks, shopHomePatterns } from "./home-blocks.js";
import {
  npCountShopInventoryReservations,
  npListRecentShopInventoryReservations,
} from "./inventory-reservation-service.js";
import { createShopOrderDraftApiHandler } from "./order-draft-api.js";
import {
  npCleanupExpiredShopOrderDrafts,
  npCountShopOrderDrafts,
  npReadShopShippingHealth,
  npReadShopTaxHealth,
} from "./order-draft-service.js";
import { createShopOrderApiHandler } from "./order-api.js";
import { createShopExchangeDestinationApiHandler } from "./exchange-destination-api.js";
import {
  npRequireShopCarrierBookingActionInput,
  npRequireShopCarrierProviderId,
  type NpShopCarrierAdapter,
  type NpShopCarrierExchangeAdapter,
  type NpShopCarrierExchangeParcelAdapter,
  type NpShopCarrierLabelAcquisitionAdapter,
  type NpShopCarrierLabelAdapter,
  type NpShopCarrierParcelAdapter,
  type NpShopCarrierPickupAvailabilityAdapter,
  type NpShopCarrierPickupAdapter,
  type NpShopCarrierReturnLabelAdapter,
  type NpShopCarrierReturnLogisticsAdapter,
  type NpShopCarrierReturnPostageAdapter,
  type NpShopCarrierReturnTrackingAdapter,
  type NpShopCarrierReturnTrackingPollAdapter,
  type NpShopCarrierTrackingAdapter,
  type NpShopCarrierTrackingPollAdapter,
} from "./carrier-contract.js";
import {
  npAcquireShopCarrierShippingLabel,
  npCountShopCarrierLabelAcquisitions,
  npListRecentShopCarrierLabelAcquisitions,
} from "./label-acquisition-service.js";
import { npRequireShopCarrierLabelAcquisitionActionInput } from "./label-acquisition-contract.js";
import {
  npBookShopCarrierShipment,
  npCountShopCarrierBookings,
  npCountShopOrders,
  npCountShopPaymentEvents,
  npCountShopFulfillments,
  npCountShopFulfillmentParcels,
  npCountShopRefunds,
  npCountShopReturns,
  npCountShopExchanges,
  npCountShopExchangeCarrierBookings,
  npCountShopExchangeParcels,
  npListRecentShopFulfillments,
  npListRecentShopFulfillmentParcels,
  npListRecentShopCarrierBookings,
  npListRecentShopOrders,
  npListRecentShopPaymentEvents,
  npListRecentShopRefunds,
  npListRecentShopReturns,
  npListRecentShopExchanges,
  npMaintainShopOrders,
  npProcessShopFulfillment,
  npReadShopFulfillmentPrivate,
  npRefundShopOrder,
  npApproveShopReturn,
  npReceiveShopReturn,
  npRejectShopReturn,
  npCreateShopExchange,
  npProcessShopExchange,
  npReadShopExchangeDestination,
  npShipShopExchange,
  npCancelShopExchange,
  npBookShopExchangeCarrierShipment,
  npCancelShopExchangeCarrierShipment,
  npShipBookedShopExchange,
  npShipShopFulfillment,
  npSaveShopFulfillmentParcels,
  npSaveShopExchangeParcels,
} from "./order-service.js";
import {
  npCancelShopCarrierPickup,
  npCountShopCarrierPickups,
  npListRecentShopCarrierPickups,
  npResumeShopCarrierPickup,
  npScheduleShopCarrierPickup,
} from "./pickup-service.js";
import {
  npRequireShopCarrierPickupCancelInput,
  npRequireShopCarrierPickupLocationReference,
  npRequireShopCarrierPickupResumeInput,
  npRequireShopCarrierPickupScheduleInput,
} from "./pickup-contract.js";
import {
  npRequireShopCarrierPickupAvailabilityQueryInput,
  npRequireShopCarrierPickupAvailabilitySelectionInput,
} from "./pickup-availability-contract.js";
import {
  npCleanupExpiredShopCarrierPickupAvailability,
  npCountShopCarrierPickupAvailability,
  npListRecentShopCarrierPickupAvailability,
  npListShopCarrierPickupWindows,
  npReadShopCarrierPickupAvailabilityHealth,
  npScheduleShopCarrierPickupWindow,
} from "./pickup-availability-service.js";
import {
  npRequireShopFulfillmentPrivateReadInput,
  npRequireShopFulfillmentProcessInput,
  npRequireShopFulfillmentShipInput,
} from "./fulfillment-contract.js";
import { npRequireShopFulfillmentParcelsSaveInput } from "./parcel-contract.js";
import { npRequireShopExchangeParcelsSaveInput } from "./exchange-parcel-contract.js";
import { npRequireShopRefundActionInput } from "./refund-contract.js";
import {
  npRequireShopPartialRefundActionInput,
  npRequireShopReturnSettlementRefundActionInput,
} from "./partial-refund-contract.js";
import {
  npCountShopPartialRefunds,
  npListRecentShopPartialRefunds,
  npPartiallyRefundShopReturn,
  npSettleShopReturnPostageRefund,
} from "./partial-refund-service.js";
import { createShopReturnApiHandler } from "./return-api.js";
import { createShopReturnLogisticsApiHandler } from "./return-logistics-api.js";
import { createShopReturnLogisticsLabelApiHandler } from "./return-logistics-label-api.js";
import { createShopReturnPostageApiHandler } from "./return-postage-api.js";
import { createShopReturnTrackingApiHandler } from "./return-tracking-api.js";
import {
  npRequireShopReturnApproveInput,
  npRequireShopReturnReceiveInput,
  npRequireShopReturnRejectInput,
} from "./return-contract.js";
import {
  npRequireShopExchangeCreateInput,
  npRequireShopExchangeShipInput,
  npRequireShopExchangeUpdateInput,
} from "./exchange-contract.js";
import { npRequireShopExchangeDestinationReadInput } from "./exchange-destination-contract.js";
import {
  npRequireShopExchangeCarrierBookActionInput,
  npRequireShopExchangeCarrierExistingActionInput,
} from "./exchange-carrier-contract.js";
import { npRequireShopReturnLocationReference } from "./return-logistics-contract.js";
import {
  npCleanupExpiredShopReturnLogisticsPrivate,
  npCountShopReturnLogistics,
  npListRecentShopReturnLogistics,
} from "./return-logistics-service.js";
import {
  npCleanupExpiredShopReturnPostage,
  npCountShopReturnPostage,
  npListRecentShopReturnPostage,
  npReadShopReturnPostageHealth,
} from "./return-postage-service.js";
import {
  npCountShopReturnTrackingEvents,
  npCountShopReturnTrackingPolls,
  npListRecentShopReturnTrackingEvents,
  npListShopReturnTrackingPolls,
  npReconcileShopReturnTracking,
} from "./return-tracking-service.js";
import { npRequireShopReturnTrackingReconcileActionInput } from "./return-tracking-contract.js";
import { createShopPaymentApiHandler } from "./payment-api.js";
import {
  npCountShopPaymentAdjustments,
  npListRecentShopPaymentAdjustments,
} from "./payment-adjustment-service.js";
import { createShopTrackingApiHandler } from "./tracking-api.js";
import {
  npCountShopTrackingEvents,
  npCountShopTrackingPolls,
  npListRecentShopTrackingEvents,
  npListShopTrackingPolls,
  npReconcileShopTracking,
} from "./tracking-service.js";
import { npRequireShopTrackingReconcileActionInput } from "./tracking-contract.js";
import { createShopPaymentAttemptApiHandler } from "./payment-attempt-api.js";
import {
  npCountShopPaymentAttempts,
  npListRecentShopPaymentAttempts,
} from "./payment-attempt-service.js";
import {
  npRequireShopPaymentProviderId,
  type NpShopPaymentAdapter,
  type NpShopPaymentInitiationAdapter,
  type NpShopPaymentPartialRefundAdapter,
  type NpShopPaymentReturnSettlementAdapter,
  type NpShopPaymentRefundAdapter,
} from "./payment-contract.js";
import { createShopCatalogMetadata, createShopCatalogRoute } from "./routes/catalog.js";
import { createShopCartRoute } from "./routes/cart.js";
import { createShopCheckoutRoute } from "./routes/checkout.js";
import { createShopCategoryMetadata, createShopCategoryRoute } from "./routes/category.js";
import { createShopOrderDraftRoute } from "./routes/order-draft.js";
import { createShopOrderRoute } from "./routes/order.js";
import { createShopOrdersRoute } from "./routes/orders.js";
import { createShopProductMetadata, createShopProductRoute } from "./routes/product.js";
import { createShopWishlistRoute } from "./routes/wishlist.js";
import { npCountShopPromotionUsage } from "./promotion-service.js";
import { npShopPromotionLimits } from "./promotion-contract.js";
import type { NpShopRuntime } from "./runtime.js";
import {
  npRequireShopShippingProviderId,
  type NpShopShippingAdapter,
} from "./shipping-contract.js";
import { NP_SHOP_SHIPPING_POLICY_PROVIDER_ID } from "./shipping-policy-contract.js";
import { npRequireShopProductReviewModerationActionInput } from "./review-contract.js";
import { createShopProductReviewApiHandler } from "./review-api.js";
import {
  npHideShopProductReview,
  npInspectShopProductReviews,
  npListRecentShopProductReviews,
  npRestoreShopProductReview,
} from "./review-service.js";
import { createShopRestockAlertApiHandler } from "./restock-alert-api.js";
import {
  npDeleteShopRestockAlertsForProduct,
  npInspectShopRestockAlerts,
  npProcessShopRestockAlerts,
} from "./restock-alert-service.js";
import { createShopPriceAlertApiHandler } from "./price-alert-api.js";
import { NP_SHOP_PRICE_DROP_NOTIFICATION_KIND } from "./price-alert-contract.js";
import {
  npDeleteShopPriceAlertsForProduct,
  npInspectShopPriceAlerts,
  npProcessShopPriceAlerts,
} from "./price-alert-service.js";
import {
  npInspectShopOrderNotifications,
  npListRecentShopOrderNotifications,
  npProcessShopOrderNotifications,
  npRetryShopOrderNotifications,
} from "./order-notification-service.js";
import { NP_SHOP_ORDER_NOTIFICATION_KIND } from "./order-notification-contract.js";
import {
  npInspectShopShippingPolicies,
  npListShopShippingPolicies,
} from "./shipping-policy-service.js";
import { npRequireShopTaxProviderId, type NpShopTaxAdapter } from "./tax-contract.js";
import { classicShopSkin } from "./skins/classic.js";
import { storefrontFullShopSkin } from "./skins/storefront-full.js";
import type {
  NpShopCollectionSlugs,
  NpShopContextualQuestionsAdapter,
  NpShopSkin,
} from "./types.js";
import { npCountShopWishlistSaves } from "./wishlist-service.js";

const SAFE_SEGMENT = /^[a-z][a-z0-9-]*$/u;

export interface NpShopOptions {
  /** Public catalog root. Defaults to `/shop`. */
  basePath?: string;
  /** Generated collection slugs. Override before first schema generation. */
  collections?: Partial<NpShopCollectionSlugs>;
  /** Additional build-time skins registered after the built-in skins. */
  skins?: readonly NpShopSkin[];
  /** Default list/category skin and product fallback skin. */
  defaultSkinId?: string;
  /** Build-time provider adapter for verified events and optional payment initiation. */
  payment?: {
    adapter: NpShopPaymentAdapter;
  };
  /** Optional server-only delivery quote provider. */
  shipping?: {
    adapter: NpShopShippingAdapter;
  };
  /** Optional server-only additional-tax quote provider. */
  tax?: {
    adapter: NpShopTaxAdapter;
  };
  /** Optional server-only carrier booking, pickup, label, and tracking provider. */
  carrier?: {
    adapter: NpShopCarrierAdapter;
    /** Provider-owned server-side origin token; required with pickup methods. */
    pickupLocationReference?: string;
    /** Provider-owned server-side return destination token. */
    returnLocationReference?: string;
  };
  /** Optional contextual Q&A renderer, for example the Forum bridge. */
  inquiries?: {
    adapter: NpShopContextualQuestionsAdapter;
  };
}

function requireBasePath(value: string): string {
  if (
    value === "/" ||
    value.endsWith("/") ||
    !value.startsWith("/") ||
    !value
      .slice(1)
      .split("/")
      .every((segment) => SAFE_SEGMENT.test(segment))
  ) {
    throw new Error(
      `Shop basePath "${value}" must contain lowercase literal segments without a trailing slash.`,
    );
  }
  return value;
}

function createRuntime(options: NpShopOptions): NpShopRuntime {
  const skins = new Map<string, NpShopSkin>();
  for (const skin of [classicShopSkin, storefrontFullShopSkin, ...(options.skins ?? [])]) {
    if (!SAFE_SEGMENT.test(skin.id)) {
      throw new Error(`Shop skin id "${skin.id}" is invalid.`);
    }
    if (skins.has(skin.id)) {
      throw new Error(`Shop skin id "${skin.id}" is registered more than once.`);
    }
    if (
      !skin.label.trim() ||
      typeof skin.renderCatalog !== "function" ||
      typeof skin.renderCategory !== "function" ||
      typeof skin.renderProduct !== "function" ||
      (skin.renderCart !== undefined && typeof skin.renderCart !== "function") ||
      (skin.renderCheckout !== undefined && typeof skin.renderCheckout !== "function") ||
      (skin.renderOrderDraft !== undefined && typeof skin.renderOrderDraft !== "function") ||
      (skin.renderOrders !== undefined && typeof skin.renderOrders !== "function") ||
      (skin.renderOrder !== undefined && typeof skin.renderOrder !== "function")
    ) {
      throw new Error(`Shop skin "${skin.id}" is incomplete.`);
    }
    skins.set(skin.id, skin);
  }
  const defaultSkinId = options.defaultSkinId ?? classicShopSkin.id;
  if (!skins.has(defaultSkinId)) {
    throw new Error(`Shop default skin "${defaultSkinId}" is not registered.`);
  }
  const collections = {
    categories: options.collections?.categories ?? "shop-categories",
    products: options.collections?.products ?? "shop-products",
    promotions: options.collections?.promotions ?? "shop-promotions",
    shippingPolicies: options.collections?.shippingPolicies ?? "shop-shipping-policies",
    reviews: options.collections?.reviews ?? "shop-product-reviews",
  };
  if (
    !SAFE_SEGMENT.test(collections.categories) ||
    !SAFE_SEGMENT.test(collections.products) ||
    !SAFE_SEGMENT.test(collections.promotions) ||
    !SAFE_SEGMENT.test(collections.shippingPolicies) ||
    !SAFE_SEGMENT.test(collections.reviews)
  ) {
    throw new Error("Shop collection slugs must be lowercase literal segments.");
  }
  if (new Set(Object.values(collections)).size !== 5) {
    throw new Error("Shop collection slugs must be different.");
  }
  const inquiryAdapter = options.inquiries?.adapter ?? null;
  if (
    inquiryAdapter &&
    (!SAFE_SEGMENT.test(inquiryAdapter.id) ||
      typeof inquiryAdapter.renderContextQuestions !== "function")
  ) {
    throw new Error(
      "Shop inquiry adapter requires a canonical id and renderContextQuestions method.",
    );
  }
  const configuredPaymentAdapter = options.payment?.adapter ?? null;
  let paymentAdapter: NpShopPaymentAdapter | null = null;
  let paymentInitiationAdapter: NpShopPaymentInitiationAdapter | null = null;
  let paymentRefundAdapter: NpShopPaymentRefundAdapter | null = null;
  let paymentPartialRefundAdapter: NpShopPaymentPartialRefundAdapter | null = null;
  let paymentReturnSettlementAdapter: NpShopPaymentReturnSettlementAdapter | null = null;
  if (configuredPaymentAdapter) {
    const id = npRequireShopPaymentProviderId(configuredPaymentAdapter.id);
    if (typeof configuredPaymentAdapter.verifyWebhook !== "function") {
      throw new Error("Shop payment adapter verifyWebhook must be a function.");
    }
    const verifyWebhook = configuredPaymentAdapter.verifyWebhook.bind(configuredPaymentAdapter);
    if (configuredPaymentAdapter.refundPayment !== undefined) {
      if (typeof configuredPaymentAdapter.refundPayment !== "function") {
        throw new Error("Shop payment adapter refundPayment must be a function when provided.");
      }
      paymentRefundAdapter = Object.freeze({
        id,
        verifyWebhook,
        refundPayment: configuredPaymentAdapter.refundPayment.bind(configuredPaymentAdapter),
      });
    }
    if (configuredPaymentAdapter.refundPaymentPartially !== undefined) {
      if (typeof configuredPaymentAdapter.refundPaymentPartially !== "function") {
        throw new Error(
          "Shop payment adapter refundPaymentPartially must be a function when provided.",
        );
      }
      paymentPartialRefundAdapter = Object.freeze({
        id,
        verifyWebhook,
        refundPaymentPartially:
          configuredPaymentAdapter.refundPaymentPartially.bind(configuredPaymentAdapter),
      });
    }
    if (configuredPaymentAdapter.refundReturnSettlement !== undefined) {
      if (typeof configuredPaymentAdapter.refundReturnSettlement !== "function") {
        throw new Error(
          "Shop payment adapter refundReturnSettlement must be a function when provided.",
        );
      }
      paymentReturnSettlementAdapter = Object.freeze({
        id,
        verifyWebhook,
        refundReturnSettlement:
          configuredPaymentAdapter.refundReturnSettlement.bind(configuredPaymentAdapter),
      });
    }
    const initiationMethods = [
      typeof configuredPaymentAdapter.preparePayment === "function",
      typeof configuredPaymentAdapter.confirmPayment === "function",
      typeof configuredPaymentAdapter.renderPaymentLauncher === "function",
    ];
    const initiationMethodCount = initiationMethods.filter(Boolean).length;
    if (initiationMethodCount !== 0 && initiationMethodCount !== 3) {
      throw new Error(
        "Shop payment initiation requires preparePayment, confirmPayment, and renderPaymentLauncher together.",
      );
    }
    if (initiationMethodCount === 3) {
      paymentInitiationAdapter = Object.freeze({
        id,
        verifyWebhook,
        preparePayment: configuredPaymentAdapter.preparePayment!.bind(configuredPaymentAdapter),
        confirmPayment: configuredPaymentAdapter.confirmPayment!.bind(configuredPaymentAdapter),
        renderPaymentLauncher:
          configuredPaymentAdapter.renderPaymentLauncher!.bind(configuredPaymentAdapter),
      });
      paymentAdapter = paymentInitiationAdapter;
    } else {
      paymentAdapter = Object.freeze({ id, verifyWebhook });
    }
  }
  const configuredShippingAdapter = options.shipping?.adapter ?? null;
  let shippingAdapter: NpShopShippingAdapter | null = null;
  if (configuredShippingAdapter) {
    const id = npRequireShopShippingProviderId(configuredShippingAdapter.id);
    if (id === NP_SHOP_SHIPPING_POLICY_PROVIDER_ID) {
      throw new Error(
        `Shop shipping adapter id "${NP_SHOP_SHIPPING_POLICY_PROVIDER_ID}" is reserved for local policies.`,
      );
    }
    if (typeof configuredShippingAdapter.quoteShipping !== "function") {
      throw new Error("Shop shipping adapter quoteShipping must be a function.");
    }
    shippingAdapter = Object.freeze({
      id,
      quoteShipping: configuredShippingAdapter.quoteShipping.bind(configuredShippingAdapter),
    });
  }
  const configuredTaxAdapter = options.tax?.adapter ?? null;
  let taxAdapter: NpShopTaxAdapter | null = null;
  if (configuredTaxAdapter) {
    const id = npRequireShopTaxProviderId(configuredTaxAdapter.id);
    if (typeof configuredTaxAdapter.quoteTax !== "function") {
      throw new Error("Shop tax adapter quoteTax must be a function.");
    }
    taxAdapter = Object.freeze({
      id,
      quoteTax: configuredTaxAdapter.quoteTax.bind(configuredTaxAdapter),
    });
  }
  const configuredCarrierAdapter = options.carrier?.adapter ?? null;
  let carrierAdapter: NpShopCarrierAdapter | null = null;
  let carrierExchangeAdapter: NpShopCarrierExchangeAdapter | null = null;
  let carrierExchangeParcelAdapter: NpShopCarrierExchangeParcelAdapter | null = null;
  let carrierLabelAcquisitionAdapter: NpShopCarrierLabelAcquisitionAdapter | null = null;
  let carrierLabelAdapter: NpShopCarrierLabelAdapter | null = null;
  let carrierParcelAdapter: NpShopCarrierParcelAdapter | null = null;
  let carrierPickupAdapter: NpShopCarrierPickupAdapter | null = null;
  let carrierPickupAvailabilityAdapter: NpShopCarrierPickupAvailabilityAdapter | null = null;
  let carrierPickupLocationReference: string | null = null;
  let carrierReturnLogisticsAdapter: NpShopCarrierReturnLogisticsAdapter | null = null;
  let carrierReturnPostageAdapter: NpShopCarrierReturnPostageAdapter | null = null;
  let carrierReturnLabelAdapter: NpShopCarrierReturnLabelAdapter | null = null;
  let carrierReturnLocationReference: string | null = null;
  let carrierReturnTrackingAdapter: NpShopCarrierReturnTrackingAdapter | null = null;
  let carrierReturnTrackingPollAdapter: NpShopCarrierReturnTrackingPollAdapter | null = null;
  let carrierTrackingAdapter: NpShopCarrierTrackingAdapter | null = null;
  let carrierTrackingPollAdapter: NpShopCarrierTrackingPollAdapter | null = null;
  if (configuredCarrierAdapter) {
    const id = npRequireShopCarrierProviderId(configuredCarrierAdapter.id);
    if (typeof configuredCarrierAdapter.bookShipment !== "function") {
      throw new Error("Shop carrier adapter bookShipment must be a function.");
    }
    const hasTrackingWebhook = configuredCarrierAdapter.verifyTrackingWebhook !== undefined;
    const hasTrackingPoll = configuredCarrierAdapter.readTracking !== undefined;
    const hasParcelBooking = configuredCarrierAdapter.bookShipmentWithParcels !== undefined;
    const hasShippingLabel = configuredCarrierAdapter.readShippingLabel !== undefined;
    const hasLabelAcquisition = configuredCarrierAdapter.acquireShippingLabel !== undefined;
    const hasPickupSchedule = configuredCarrierAdapter.schedulePickup !== undefined;
    const hasPickupCancel = configuredCarrierAdapter.cancelPickup !== undefined;
    const hasPickupAvailability = configuredCarrierAdapter.listPickupWindows !== undefined;
    const hasReturnCreate = configuredCarrierAdapter.createReturnShipment !== undefined;
    const hasReturnCancel = configuredCarrierAdapter.cancelReturnShipment !== undefined;
    const hasReturnLabel = configuredCarrierAdapter.readReturnLabel !== undefined;
    const hasReturnPostageQuote = configuredCarrierAdapter.quoteReturnShipping !== undefined;
    const hasQuotedReturnCreate = configuredCarrierAdapter.createQuotedReturnShipment !== undefined;
    const hasReturnTrackingWebhook =
      configuredCarrierAdapter.verifyReturnTrackingWebhook !== undefined;
    const hasReturnTrackingPoll = configuredCarrierAdapter.readReturnTracking !== undefined;
    const hasExchangeBooking = configuredCarrierAdapter.bookExchangeShipment !== undefined;
    const hasExchangeParcelBooking =
      configuredCarrierAdapter.bookExchangeShipmentWithParcels !== undefined;
    const hasExchangeCancellation = configuredCarrierAdapter.cancelExchangeShipment !== undefined;
    if (
      hasTrackingWebhook &&
      typeof configuredCarrierAdapter.verifyTrackingWebhook !== "function"
    ) {
      throw new Error(
        "Shop carrier adapter verifyTrackingWebhook must be a function when provided.",
      );
    }
    if (hasTrackingPoll && typeof configuredCarrierAdapter.readTracking !== "function") {
      throw new Error("Shop carrier adapter readTracking must be a function when provided.");
    }
    if (
      hasParcelBooking &&
      typeof configuredCarrierAdapter.bookShipmentWithParcels !== "function"
    ) {
      throw new Error(
        "Shop carrier adapter bookShipmentWithParcels must be a function when provided.",
      );
    }
    if (hasShippingLabel && typeof configuredCarrierAdapter.readShippingLabel !== "function") {
      throw new Error("Shop carrier adapter readShippingLabel must be a function when provided.");
    }
    if (
      hasLabelAcquisition &&
      (!hasShippingLabel || typeof configuredCarrierAdapter.acquireShippingLabel !== "function")
    ) {
      throw new Error(
        "Shop carrier label acquisition requires acquireShippingLabel and readShippingLabel together.",
      );
    }
    if (hasPickupSchedule !== hasPickupCancel) {
      throw new Error("Shop carrier pickup requires schedulePickup and cancelPickup together.");
    }
    if (
      hasPickupAvailability &&
      (!hasPickupSchedule || typeof configuredCarrierAdapter.listPickupWindows !== "function")
    ) {
      throw new Error(
        "Shop carrier pickup availability requires listPickupWindows with paired pickup scheduling and cancellation.",
      );
    }
    if (hasReturnCreate !== hasReturnCancel) {
      throw new Error(
        "Shop return logistics requires createReturnShipment and cancelReturnShipment together.",
      );
    }
    if (hasExchangeBooking !== hasExchangeCancellation) {
      throw new Error(
        "Shop exchange carrier booking requires bookExchangeShipment and cancelExchangeShipment together.",
      );
    }
    if (hasExchangeParcelBooking && !hasExchangeBooking) {
      throw new Error(
        "Shop exchange parcel booking requires the paired exchange booking and cancellation methods.",
      );
    }
    if (
      hasExchangeBooking &&
      (typeof configuredCarrierAdapter.bookExchangeShipment !== "function" ||
        typeof configuredCarrierAdapter.cancelExchangeShipment !== "function")
    ) {
      throw new Error("Shop exchange carrier methods must be functions when provided.");
    }
    if (
      hasExchangeParcelBooking &&
      typeof configuredCarrierAdapter.bookExchangeShipmentWithParcels !== "function"
    ) {
      throw new Error(
        "Shop carrier adapter bookExchangeShipmentWithParcels must be a function when provided.",
      );
    }
    if (hasReturnPostageQuote !== hasQuotedReturnCreate) {
      throw new Error(
        "Shop return postage requires quoteReturnShipping and createQuotedReturnShipment together.",
      );
    }
    if ((hasReturnPostageQuote || hasQuotedReturnCreate) && !hasReturnCreate) {
      throw new Error("Shop return postage requires the paired return logistics methods.");
    }
    if (
      hasReturnPostageQuote &&
      (typeof configuredCarrierAdapter.quoteReturnShipping !== "function" ||
        typeof configuredCarrierAdapter.createQuotedReturnShipment !== "function")
    ) {
      throw new Error("Shop return postage methods must be functions when provided.");
    }
    if (
      hasReturnCreate &&
      (typeof configuredCarrierAdapter.createReturnShipment !== "function" ||
        typeof configuredCarrierAdapter.cancelReturnShipment !== "function")
    ) {
      throw new Error("Shop return logistics methods must be functions when provided.");
    }
    if (
      hasReturnLabel &&
      (!hasReturnCreate || typeof configuredCarrierAdapter.readReturnLabel !== "function")
    ) {
      throw new Error("Shop return label retrieval requires the paired return logistics methods.");
    }
    if ((hasReturnTrackingWebhook || hasReturnTrackingPoll) && !hasReturnCreate) {
      throw new Error("Shop return tracking requires the paired return logistics methods.");
    }
    if (
      hasReturnTrackingWebhook &&
      typeof configuredCarrierAdapter.verifyReturnTrackingWebhook !== "function"
    ) {
      throw new Error(
        "Shop carrier adapter verifyReturnTrackingWebhook must be a function when provided.",
      );
    }
    if (
      hasReturnTrackingPoll &&
      typeof configuredCarrierAdapter.readReturnTracking !== "function"
    ) {
      throw new Error("Shop carrier adapter readReturnTracking must be a function when provided.");
    }
    if (
      hasPickupSchedule &&
      ((!hasParcelBooking && !hasExchangeParcelBooking) ||
        typeof configuredCarrierAdapter.schedulePickup !== "function" ||
        typeof configuredCarrierAdapter.cancelPickup !== "function")
    ) {
      throw new Error(
        "Shop carrier pickup requires outbound or replacement parcel-aware booking plus schedulePickup and cancelPickup functions.",
      );
    }
    if (hasPickupSchedule) {
      carrierPickupLocationReference = npRequireShopCarrierPickupLocationReference(
        options.carrier?.pickupLocationReference,
      );
    } else if (options.carrier?.pickupLocationReference !== undefined) {
      throw new Error(
        "Shop carrier pickupLocationReference requires schedulePickup and cancelPickup methods.",
      );
    }
    if (hasReturnCreate) {
      carrierReturnLocationReference = npRequireShopReturnLocationReference(
        options.carrier?.returnLocationReference,
      );
    } else if (options.carrier?.returnLocationReference !== undefined) {
      throw new Error("Shop carrier returnLocationReference requires return logistics methods.");
    }
    carrierAdapter = Object.freeze({
      id,
      bookShipment: configuredCarrierAdapter.bookShipment.bind(configuredCarrierAdapter),
      ...(configuredCarrierAdapter.verifyTrackingWebhook
        ? {
            verifyTrackingWebhook:
              configuredCarrierAdapter.verifyTrackingWebhook.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.readTracking
        ? { readTracking: configuredCarrierAdapter.readTracking.bind(configuredCarrierAdapter) }
        : {}),
      ...(configuredCarrierAdapter.bookShipmentWithParcels
        ? {
            bookShipmentWithParcels:
              configuredCarrierAdapter.bookShipmentWithParcels.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.readShippingLabel
        ? {
            readShippingLabel:
              configuredCarrierAdapter.readShippingLabel.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.acquireShippingLabel
        ? {
            acquireShippingLabel:
              configuredCarrierAdapter.acquireShippingLabel.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.schedulePickup && configuredCarrierAdapter.cancelPickup
        ? {
            schedulePickup: configuredCarrierAdapter.schedulePickup.bind(configuredCarrierAdapter),
            cancelPickup: configuredCarrierAdapter.cancelPickup.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.listPickupWindows
        ? {
            listPickupWindows:
              configuredCarrierAdapter.listPickupWindows.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.createReturnShipment &&
      configuredCarrierAdapter.cancelReturnShipment
        ? {
            createReturnShipment:
              configuredCarrierAdapter.createReturnShipment.bind(configuredCarrierAdapter),
            cancelReturnShipment:
              configuredCarrierAdapter.cancelReturnShipment.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.quoteReturnShipping &&
      configuredCarrierAdapter.createQuotedReturnShipment
        ? {
            quoteReturnShipping:
              configuredCarrierAdapter.quoteReturnShipping.bind(configuredCarrierAdapter),
            createQuotedReturnShipment:
              configuredCarrierAdapter.createQuotedReturnShipment.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.readReturnLabel
        ? {
            readReturnLabel:
              configuredCarrierAdapter.readReturnLabel.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.verifyReturnTrackingWebhook
        ? {
            verifyReturnTrackingWebhook:
              configuredCarrierAdapter.verifyReturnTrackingWebhook.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.readReturnTracking
        ? {
            readReturnTracking:
              configuredCarrierAdapter.readReturnTracking.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.bookExchangeShipment &&
      configuredCarrierAdapter.cancelExchangeShipment
        ? {
            bookExchangeShipment:
              configuredCarrierAdapter.bookExchangeShipment.bind(configuredCarrierAdapter),
            cancelExchangeShipment:
              configuredCarrierAdapter.cancelExchangeShipment.bind(configuredCarrierAdapter),
          }
        : {}),
      ...(configuredCarrierAdapter.bookExchangeShipmentWithParcels
        ? {
            bookExchangeShipmentWithParcels:
              configuredCarrierAdapter.bookExchangeShipmentWithParcels.bind(
                configuredCarrierAdapter,
              ),
          }
        : {}),
    });
    if (carrierAdapter.verifyTrackingWebhook) {
      carrierTrackingAdapter = carrierAdapter as NpShopCarrierTrackingAdapter;
    }
    if (carrierAdapter.readTracking) {
      carrierTrackingPollAdapter = carrierAdapter as NpShopCarrierTrackingPollAdapter;
    }
    if (carrierAdapter.bookShipmentWithParcels) {
      carrierParcelAdapter = carrierAdapter as NpShopCarrierParcelAdapter;
    }
    if (carrierAdapter.readShippingLabel) {
      carrierLabelAdapter = carrierAdapter as NpShopCarrierLabelAdapter;
    }
    if (carrierLabelAdapter?.acquireShippingLabel) {
      carrierLabelAcquisitionAdapter = carrierLabelAdapter as NpShopCarrierLabelAcquisitionAdapter;
    }
    if (carrierAdapter.schedulePickup && carrierAdapter.cancelPickup) {
      carrierPickupAdapter = carrierAdapter as NpShopCarrierPickupAdapter;
    }
    if (carrierPickupAdapter?.listPickupWindows) {
      carrierPickupAvailabilityAdapter =
        carrierPickupAdapter as NpShopCarrierPickupAvailabilityAdapter;
    }
    if (carrierAdapter.createReturnShipment && carrierAdapter.cancelReturnShipment) {
      carrierReturnLogisticsAdapter = carrierAdapter as NpShopCarrierReturnLogisticsAdapter;
    }
    if (
      carrierReturnLogisticsAdapter?.quoteReturnShipping &&
      carrierReturnLogisticsAdapter.createQuotedReturnShipment
    ) {
      carrierReturnPostageAdapter =
        carrierReturnLogisticsAdapter as NpShopCarrierReturnPostageAdapter;
    }
    if (carrierReturnLogisticsAdapter?.readReturnLabel) {
      carrierReturnLabelAdapter = carrierReturnLogisticsAdapter as NpShopCarrierReturnLabelAdapter;
    }
    if (carrierReturnLogisticsAdapter?.verifyReturnTrackingWebhook) {
      carrierReturnTrackingAdapter =
        carrierReturnLogisticsAdapter as NpShopCarrierReturnTrackingAdapter;
    }
    if (carrierReturnLogisticsAdapter?.readReturnTracking) {
      carrierReturnTrackingPollAdapter =
        carrierReturnLogisticsAdapter as NpShopCarrierReturnTrackingPollAdapter;
    }
    if (carrierAdapter.bookExchangeShipment && carrierAdapter.cancelExchangeShipment) {
      carrierExchangeAdapter = carrierAdapter as NpShopCarrierExchangeAdapter;
    }
    if (carrierExchangeAdapter?.bookExchangeShipmentWithParcels) {
      carrierExchangeParcelAdapter = carrierExchangeAdapter as NpShopCarrierExchangeParcelAdapter;
    }
  }
  return {
    basePath: requireBasePath(options.basePath ?? "/shop"),
    collections,
    defaultSkinId,
    skins,
    paymentAdapter,
    paymentInitiationAdapter,
    paymentRefundAdapter,
    paymentPartialRefundAdapter,
    paymentReturnSettlementAdapter,
    shippingAdapter,
    taxAdapter,
    carrierAdapter,
    carrierExchangeAdapter,
    carrierExchangeParcelAdapter,
    carrierLabelAcquisitionAdapter,
    carrierLabelAdapter,
    carrierParcelAdapter,
    carrierPickupAdapter,
    carrierPickupAvailabilityAdapter,
    carrierPickupLocationReference,
    carrierReturnLogisticsAdapter,
    carrierReturnPostageAdapter,
    carrierReturnLabelAdapter,
    carrierReturnLocationReference,
    carrierReturnTrackingAdapter,
    carrierReturnTrackingPollAdapter,
    carrierTrackingAdapter,
    carrierTrackingPollAdapter,
    inquiryAdapter,
  };
}

const messages = {
  en: {
    "shop.catalog": "Shop",
    "shop.products": "products",
    "shop.categories": "Categories",
    "shop.featuredProducts": "Featured products",
    "shop.featured": "Featured",
    "shop.reviewHeading": "Product reviews",
    "shop.reviewVerified": "Verified purchase",
    "shop.reviewEmpty": "No reviews have been published yet.",
    "shop.reviewWrite": "Write a review",
    "shop.reviewEdit": "Edit my review",
    "shop.reviewLogin": "Sign in to review a shipped purchase.",
    "shop.reviewUnavailable": "No shipped purchase is currently eligible for review.",
    "shop.reviewPurchase": "Purchased item",
    "shop.reviewRating": "Rating",
    "shop.reviewTitle": "Title",
    "shop.reviewBody": "Review",
    "shop.reviewPhotos": "Photos (up to 5, 5 MB each)",
    "shop.reviewUpload": "Add photos",
    "shop.reviewRemove": "Remove",
    "shop.reviewSave": "Save review",
    "shop.reviewSaving": "Saving…",
    "shop.reviewDelete": "Delete my review",
    "shop.reviewFailed": "The review could not be updated.",
    "shop.wishlist": "Saved products",
    "shop.wishlistSave": "Save",
    "shop.wishlistSaved": "Saved",
    "shop.wishlistSaving": "Saving…",
    "shop.wishlistSignIn": "Sign in to save",
    "shop.wishlistFailed": "The saved-product list could not be updated.",
    "shop.wishlistEmpty": "You have not saved any available products yet.",
    "shop.wishlistLogin": "Sign in to keep a site-scoped list of products you want to revisit.",
    "shop.wishlistBrowse": "Browse products",
    "shop.restockHeading": "Back-in-stock alert",
    "shop.restockSelect": "Unavailable option",
    "shop.restockSubscribe": "Notify me when available",
    "shop.restockSubscribed": "Alert requested · cancel",
    "shop.restockSaving": "Updating…",
    "shop.restockSignIn": "Sign in to request a one-time alert",
    "shop.restockUnavailable": "This item is unavailable.",
    "shop.restockFailed": "The restock alert could not be updated.",
    "shop.priceAlertHeading": "Price-drop alert",
    "shop.priceAlertSelect": "Catalog price target",
    "shop.priceAlertSubscribe": "Notify me if this price drops",
    "shop.priceAlertSubscribed": "Price alert requested · cancel",
    "shop.priceAlertSaving": "Updating…",
    "shop.priceAlertSignIn": "Sign in to request a one-time price alert",
    "shop.priceAlertUnavailable": "This price cannot decrease.",
    "shop.priceAlertFailed": "The price alert could not be updated.",
    "shop.search": "Search products",
    "shop.searchPlaceholder": "Name, summary, or description",
    "shop.sort": "Sort",
    "shop.newest": "Newest",
    "shop.priceLow": "Price: low to high",
    "shop.priceHigh": "Price: high to low",
    "shop.name": "Name",
    "shop.inStockOnly": "Available only",
    "shop.apply": "Apply",
    "shop.clear": "Clear",
    "shop.emptyProducts": "No products match this catalog view.",
    "shop.emptyCategories": "No categories have been published.",
    "shop.inventoryInStock": "In stock",
    "shop.inventoryLow": "Low stock",
    "shop.inventoryOut": "Out of stock",
    "shop.inventoryUntracked": "Availability varies",
    "shop.compareAtPrice": "Original price",
    "shop.sku": "SKU",
    "shop.variants": "Variants",
    "shop.option": "Option",
    "shop.price": "Price",
    "shop.stock": "Stock",
    "shop.taxIncluded": "Tax included where applicable.",
    "shop.catalogOnly":
      "Catalog and checkout preview — payment-provider availability depends on site configuration.",
    "shop.cart": "Cart",
    "shop.addToCart": "Add to cart",
    "shop.addingToCart": "Adding…",
    "shop.addedToCart": "Added",
    "shop.cartEmpty": "Your cart is empty.",
    "shop.cartQuantity": "Quantity",
    "shop.cartRemove": "Remove",
    "shop.cartClear": "Clear cart",
    "shop.cartSubtotal": "Subtotal",
    "shop.promotionDiscount": "Promotion discount",
    "shop.couponCode": "Coupon code",
    "shop.couponPlaceholder": "WELCOME",
    "shop.couponApply": "Apply coupon",
    "shop.couponRemove": "Remove",
    "shop.couponRejected": "This coupon is unavailable or its conditions are not met.",
    "shop.cartUnavailable": "This item is no longer available.",
    "shop.cartPriceChanged": "The current price has changed.",
    "shop.cartInsufficientStock": "The requested quantity is unavailable.",
    "shop.cartMixedCurrency": "Items in different currencies cannot be checked out together.",
    "shop.cartReady": "The cart can create a short-lived checkout intent.",
    "shop.cartNotReady": "Resolve the cart issues before checkout.",
    "shop.cartCheckoutUnavailable":
      "A checkout intent freezes this quote briefly; it does not place an order or take payment.",
    "shop.cartUpdateFailed": "The cart could not be updated.",
    "shop.selectVariant": "Select an option",
    "shop.checkout": "Checkout",
    "shop.checkoutCreating": "Preparing checkout…",
    "shop.checkoutIntent": "Checkout intent",
    "shop.checkoutOpen": "Current cart verified",
    "shop.checkoutStale": "Cart changed — create a new checkout intent",
    "shop.checkoutCancelled": "Checkout intent cancelled",
    "shop.checkoutExpired": "Checkout intent expired",
    "shop.checkoutCancel": "Cancel checkout intent",
    "shop.checkoutExpires": "Expires",
    "shop.checkoutPaymentUnavailable":
      "This intent only freezes a quote; it does not place an order or take payment.",
    "shop.checkoutBackToCart": "Back to cart",
    "shop.checkoutFailed": "The checkout intent could not be loaded.",
    "shop.orderDraft": "Order draft",
    "shop.orderDraftCreate": "Continue to delivery details",
    "shop.orderDraftCreating": "Preparing order draft…",
    "shop.orderDraftCollecting": "Contact and delivery details needed",
    "shop.orderDraftReviewable": "Details saved for review",
    "shop.orderDraftStale": "Cart changed — delete this draft and start again",
    "shop.orderDraftExpires": "Private details expire",
    "shop.orderDraftCustomer": "Customer details",
    "shop.orderDraftShipping": "Delivery address",
    "shop.orderDraftShippingMethods": "Delivery method",
    "shop.orderDraftShippingSelect": "Select delivery method",
    "shop.orderDraftShippingSelecting": "Selecting…",
    "shop.orderDraftShippingRequired": "Choose a current delivery quote before placing the order.",
    "shop.orderDraftShippingUnavailable": "No current delivery method is available.",
    "shop.orderDraftShippingDays": "days",
    "shop.orderDraftFullName": "Full name",
    "shop.orderDraftEmail": "Email",
    "shop.orderDraftPhone": "Phone",
    "shop.orderDraftRecipientName": "Recipient name",
    "shop.orderDraftCountryCode": "Country code",
    "shop.orderDraftPostalCode": "Postal code",
    "shop.orderDraftAddressLine1": "Address",
    "shop.orderDraftAddressLine2": "Address detail (optional)",
    "shop.orderDraftLocality": "City / locality",
    "shop.orderDraftAdministrativeArea": "State / province (optional)",
    "shop.orderDraftSave": "Save details",
    "shop.orderDraftSaving": "Saving…",
    "shop.orderDraftDelete": "Delete private draft",
    "shop.orderDraftPrivacy":
      "These details stay outside search and content export. Cancellation deletes them immediately; they expire after 24 hours and hourly cleanup permanently removes untouched expired drafts.",
    "shop.orderDraftPaymentUnavailable":
      "Saving these details does not place an order, reserve inventory, remit tax, or take payment.",
    "shop.orderDraftFailed": "The order draft could not be updated.",
    "shop.shippingAmount": "Shipping",
    "shop.taxAmount": "Additional tax",
    "shop.taxBreakdown": "Tax breakdown",
    "shop.orderTotal": "Total",
    "shop.order": "Order",
    "shop.orders": "Orders",
    "shop.orderCreate": "Create pending order",
    "shop.orderCreating": "Creating order…",
    "shop.orderPendingPayment": "Pending payment",
    "shop.orderPaid": "Paid",
    "shop.orderRefunded": "Refunded",
    "shop.orderPaymentFailed": "Payment failed",
    "shop.orderCancelled": "Cancelled",
    "shop.orderPaymentVerified":
      "The provider callback was verified and this order was marked paid.",
    "shop.orderRefundedDetail": "The configured provider completed a full payment refund.",
    "shop.orderPartialRefundedDetail":
      "The configured provider refunded the received return items and explicit shipping/tax allocation.",
    "shop.orderPaymentFailedDetail":
      "The provider reported a failed payment. Inventory was released and private details were deleted.",
    "shop.orderPrivateRetained":
      "Private delivery details are deleted after shipment or within 30 days of verified payment.",
    "shop.orderPrivateRedacted": "Private delivery details were permanently deleted.",
    "shop.orderInventoryHeld": "Tracked inventory is reserved until this order expires.",
    "shop.orderInventoryConsumed": "Reserved tracked inventory was deducted.",
    "shop.orderInventoryReleased": "The inventory reservation was released.",
    "shop.orderInventoryNotRequired": "This order does not use tracked inventory.",
    "shop.orderRefundInventoryRestocked": "Tracked inventory was restored after the refund.",
    "shop.orderRefundInventoryManual":
      "The refund completed, but inventory requires operator reconciliation.",
    "shop.orderRefundInventoryShipped":
      "This order was already shipped, so the refund did not automatically restore inventory.",
    "shop.orderFulfillmentAwaiting": "Fulfillment is awaiting processing.",
    "shop.orderFulfillmentProcessing": "This order is being prepared for shipment.",
    "shop.orderFulfillmentShipped": "This order was shipped.",
    "shop.orderFulfillmentCancelled": "Fulfillment was cancelled after the full refund.",
    "shop.orderFulfillmentTracking": "Tracking",
    "shop.orderTrackingInTransit": "The shipment is in transit.",
    "shop.orderTrackingOutForDelivery": "The shipment is out for delivery.",
    "shop.orderTrackingDelivered": "The shipment was delivered.",
    "shop.orderTrackingException": "The carrier reported a delivery exception.",
    "shop.orderReturn": "Return items",
    "shop.orderReturnRequested": "Return requested — awaiting staff review.",
    "shop.orderReturnApproved": "Return approved — send items according to the site's policy.",
    "shop.orderReturnRejected": "Return request rejected.",
    "shop.orderReturnReceived": "Returned items received.",
    "shop.orderReturnCancelled": "Return request cancelled.",
    "shop.orderExchange": "Replacement exchange",
    "shop.orderExchangeAwaiting": "The same-item replacement is awaiting processing.",
    "shop.orderExchangeProcessing": "The same-item replacement is being prepared.",
    "shop.orderExchangeShipped": "The same-item replacement was shipped.",
    "shop.orderExchangeCancelled": "The same-item replacement was cancelled.",
    "shop.orderExchangeInventoryRestocked": "Replacement inventory was restored.",
    "shop.orderExchangeInventoryManual": "Replacement inventory requires operator reconciliation.",
    "shop.orderExchangeTracking": "Replacement tracking",
    "shop.orderExchangeDestination": "Replacement delivery address",
    "shop.orderExchangeDestinationAwaiting":
      "Enter a new delivery address for this replacement. The original order address is never reused.",
    "shop.orderExchangeDestinationSubmitted":
      "The replacement address is retained while staff review it.",
    "shop.orderExchangeDestinationAccessed":
      "Staff accessed the replacement address and can begin processing.",
    "shop.orderExchangeDestinationExpired":
      "The retained replacement address expired. Submit it again to continue.",
    "shop.orderExchangeDestinationSubmit": "Submit replacement address",
    "shop.orderExchangeDestinationSubmitting": "Submitting replacement address…",
    "shop.orderExchangeDestinationPrivacy":
      "This address is kept separately for at most 24 hours, access is audited, and it is deleted when processing begins.",
    "shop.orderExchangeDestinationFailed": "The replacement address could not be submitted.",
    "shop.orderReturnReason": "Return reason",
    "shop.orderReturnReasonDamaged": "Damaged in transit",
    "shop.orderReturnReasonDefective": "Defective",
    "shop.orderReturnReasonWrongItem": "Wrong item",
    "shop.orderReturnReasonChangedMind": "Changed mind",
    "shop.orderReturnReasonOther": "Other",
    "shop.orderReturnDetail": "Details (optional, do not include sensitive data)",
    "shop.orderReturnSubmit": "Request return",
    "shop.orderReturnSubmitting": "Requesting return…",
    "shop.orderReturnSelectItem": "Select at least one item to return.",
    "shop.orderReturnCancel": "Cancel return request",
    "shop.orderReturnPolicy":
      "This request records physical item intake only. It does not issue a refund, buy a shipping label, schedule pickup, or guarantee policy eligibility.",
    "shop.orderReturnInventoryRestocked": "Received tracked inventory was restored.",
    "shop.orderReturnInventoryManual":
      "The return was received, but inventory requires operator reconciliation.",
    "shop.orderReturnInventoryNotRequired": "No tracked inventory restoration was required.",
    "shop.orderReturnFailed": "The return request could not be updated.",
    "shop.orderReturnLogistics": "Return shipping",
    "shop.orderReturnLogisticsDropoff": "Drop off with a return label",
    "shop.orderReturnLogisticsPickup": "Schedule carrier pickup",
    "shop.orderReturnLogisticsCreate": "Create return shipment",
    "shop.orderReturnLogisticsCreating": "Creating return shipment…",
    "shop.orderReturnLogisticsPending": "Return shipping is awaiting provider reconciliation.",
    "shop.orderReturnLogisticsActive": "Return shipping is active.",
    "shop.orderReturnLogisticsCancelled": "Return shipping was cancelled.",
    "shop.orderReturnLogisticsResume": "Retry return shipping",
    "shop.orderReturnLogisticsCancel": "Cancel return shipping",
    "shop.orderReturnLogisticsLabel": "Download return label",
    "shop.orderReturnLogisticsReadyAt": "Pickup ready time",
    "shop.orderReturnLogisticsCloseAt": "Pickup closing time",
    "shop.orderReturnLogisticsPrivacy":
      "The pickup address is sent only to the configured carrier, deleted after confirmation, and otherwise expires within 24 hours.",
    "shop.orderReturnLogisticsFailed": "Return shipping could not be updated.",
    "shop.orderReturnPostageQuote": "Get return shipping prices",
    "shop.orderReturnPostageQuoting": "Getting return shipping prices…",
    "shop.orderReturnPostageSelect": "Select this return method",
    "shop.orderReturnPostageSelecting": "Selecting return method…",
    "shop.orderReturnPostageSelected": "Selected return shipping method",
    "shop.orderReturnPostageExpires": "Quote expires",
    "shop.orderReturnPostagePrivacy":
      "The origin is sent only to the configured carrier and expires with this quote within one hour.",
    "shop.orderReturnPostageBoundary":
      "This carrier price is informational for return shipment creation. It is not charged, deducted from a refund, or a decision about who pays.",
    "shop.orderReturnPostageFailed": "Return shipping prices could not be updated.",
    "shop.orderReturnPostageResponsibility": "Return-postage responsibility",
    "shop.orderReturnPostageMerchant": "Merchant absorbs postage",
    "shop.orderReturnPostageCustomer": "Customer postage is deducted",
    "shop.orderReturnPostageDeduction": "Return-postage deduction",
    "shop.orderReturnRefundNet": "Net refund",
    "shop.orderReturnTrackingInTransit": "Your return is in transit to the return facility.",
    "shop.orderReturnTrackingOutForDelivery":
      "Your return is out for delivery to the return facility.",
    "shop.orderReturnTrackingDelivered":
      "The carrier delivered your return. Warehouse receipt is still pending.",
    "shop.orderReturnTrackingException":
      "The carrier reported an exception while transporting your return.",
    "shop.orderExpires": "Pending order expires",
    "shop.orderCreated": "Created",
    "shop.orderNotifications": "Order updates",
    "shop.orderCancel": "Cancel order and delete private details",
    "shop.orderHistory": "Order history",
    "shop.orderEmpty": "No orders have been created for this browser identity.",
    "shop.orderReference": "Order reference",
    "shop.orderPaymentUnavailable":
      "This order remains pending until an enabled provider supplies a verified callback. Tax remittance, carrier booking, fulfillment, and refunds are separate.",
    "shop.orderPay": "Pay with configured provider",
    "shop.orderPaymentPreparing": "Preparing secure payment…",
    "shop.orderPaymentConfirming": "Confirming payment with the provider…",
    "shop.orderPaymentRetry": "Prepare another payment attempt",
    "shop.orderPaymentStartFailed":
      "Payment could not be started or confirmed. The order remains pending and no success was assumed.",
    "shop.orderFailed": "The order could not be updated.",
    "shop.previous": "Previous",
    "shop.next": "Next",
    "shop.backToCatalog": "Back to shop",
    "shop.viewProduct": "View product",
  },
  ko: {
    "shop.catalog": "스토어",
    "shop.products": "개 상품",
    "shop.categories": "카테고리",
    "shop.featuredProducts": "추천 상품",
    "shop.featured": "추천",
    "shop.reviewHeading": "상품 리뷰",
    "shop.reviewVerified": "구매 확인",
    "shop.reviewEmpty": "아직 등록된 리뷰가 없습니다.",
    "shop.reviewWrite": "리뷰 작성",
    "shop.reviewEdit": "내 리뷰 수정",
    "shop.reviewLogin": "로그인하면 배송 완료된 구매 상품의 리뷰를 작성할 수 있습니다.",
    "shop.reviewUnavailable": "리뷰를 작성할 수 있는 배송 완료 구매 건이 없습니다.",
    "shop.reviewPurchase": "리뷰를 남길 구매 상품",
    "shop.reviewRating": "평점",
    "shop.reviewTitle": "제목",
    "shop.reviewBody": "내용",
    "shop.reviewPhotos": "사진 (최대 5개, 각 5 MB)",
    "shop.reviewUpload": "사진 추가",
    "shop.reviewRemove": "삭제",
    "shop.reviewSave": "저장",
    "shop.reviewSaving": "저장 중…",
    "shop.reviewDelete": "내 리뷰 삭제",
    "shop.reviewFailed": "리뷰를 갱신하지 못했습니다.",
    "shop.wishlist": "찜한 상품",
    "shop.wishlistSave": "찜하기",
    "shop.wishlistSaved": "찜함",
    "shop.wishlistSaving": "저장 중…",
    "shop.wishlistSignIn": "로그인하고 찜하기",
    "shop.wishlistFailed": "찜 목록을 갱신하지 못했습니다.",
    "shop.wishlistEmpty": "현재 볼 수 있는 찜한 상품이 없습니다.",
    "shop.wishlistLogin": "로그인하면 이 사이트에서 다시 보고 싶은 상품을 저장할 수 있습니다.",
    "shop.wishlistBrowse": "상품 둘러보기",
    "shop.restockHeading": "재입고 알림",
    "shop.restockSelect": "품절 옵션",
    "shop.restockSubscribe": "재입고 시 알림 받기",
    "shop.restockSubscribed": "알림 신청됨 · 취소",
    "shop.restockSaving": "처리 중…",
    "shop.restockSignIn": "로그인하고 일회성 재입고 알림 받기",
    "shop.restockUnavailable": "현재 품절된 상품입니다.",
    "shop.restockFailed": "재입고 알림을 갱신하지 못했습니다.",
    "shop.priceAlertHeading": "가격 인하 알림",
    "shop.priceAlertSelect": "카탈로그 가격 대상",
    "shop.priceAlertSubscribe": "가격이 내려가면 알림 받기",
    "shop.priceAlertSubscribed": "가격 알림 신청됨 · 취소",
    "shop.priceAlertSaving": "처리 중…",
    "shop.priceAlertSignIn": "로그인하고 일회성 가격 인하 알림 받기",
    "shop.priceAlertUnavailable": "더 낮아질 수 없는 가격입니다.",
    "shop.priceAlertFailed": "가격 인하 알림을 갱신하지 못했습니다.",
    "shop.search": "상품 검색",
    "shop.searchPlaceholder": "상품명, 요약 또는 설명",
    "shop.sort": "정렬",
    "shop.newest": "최신순",
    "shop.priceLow": "낮은 가격순",
    "shop.priceHigh": "높은 가격순",
    "shop.name": "이름순",
    "shop.inStockOnly": "구매 가능 상품만",
    "shop.apply": "적용",
    "shop.clear": "초기화",
    "shop.emptyProducts": "조건에 맞는 상품이 없습니다.",
    "shop.emptyCategories": "공개된 카테고리가 없습니다.",
    "shop.inventoryInStock": "재고 있음",
    "shop.inventoryLow": "품절 임박",
    "shop.inventoryOut": "품절",
    "shop.inventoryUntracked": "재고 문의",
    "shop.compareAtPrice": "정상 가격",
    "shop.sku": "상품 코드",
    "shop.variants": "옵션",
    "shop.option": "옵션",
    "shop.price": "가격",
    "shop.stock": "재고",
    "shop.taxIncluded": "표시 가격에는 해당되는 세금이 포함되어 있습니다.",
    "shop.catalogOnly":
      "카탈로그·결제 흐름 체험 — 결제사 사용 가능 여부는 사이트 설정에 따라 다릅니다.",
    "shop.cart": "장바구니",
    "shop.addToCart": "장바구니 담기",
    "shop.addingToCart": "담는 중…",
    "shop.addedToCart": "담았습니다",
    "shop.cartEmpty": "장바구니가 비어 있습니다.",
    "shop.cartQuantity": "수량",
    "shop.cartRemove": "삭제",
    "shop.cartClear": "장바구니 비우기",
    "shop.cartSubtotal": "상품 금액",
    "shop.promotionDiscount": "프로모션 할인",
    "shop.couponCode": "쿠폰 코드",
    "shop.couponPlaceholder": "WELCOME",
    "shop.couponApply": "쿠폰 적용",
    "shop.couponRemove": "삭제",
    "shop.couponRejected": "사용할 수 없거나 조건을 충족하지 않은 쿠폰입니다.",
    "shop.cartUnavailable": "더 이상 구매할 수 없는 상품입니다.",
    "shop.cartPriceChanged": "현재 판매 가격이 변경되었습니다.",
    "shop.cartInsufficientStock": "요청한 수량만큼 재고가 없습니다.",
    "shop.cartMixedCurrency": "통화가 다른 상품은 함께 결제할 수 없습니다.",
    "shop.cartReady": "짧은 수명의 결제 의도를 만들 수 있는 상태입니다.",
    "shop.cartNotReady": "결제 전에 장바구니 문제를 해결해 주세요.",
    "shop.cartCheckoutUnavailable":
      "결제 의도는 이 견적을 잠시 고정하지만 주문을 만들거나 결제하지 않습니다.",
    "shop.cartUpdateFailed": "장바구니를 갱신하지 못했습니다.",
    "shop.selectVariant": "옵션 선택",
    "shop.checkout": "결제 준비",
    "shop.checkoutCreating": "결제 준비 중…",
    "shop.checkoutIntent": "결제 의도",
    "shop.checkoutOpen": "현재 장바구니 확인 완료",
    "shop.checkoutStale": "장바구니가 변경됨 — 새 결제 의도를 만들어 주세요",
    "shop.checkoutCancelled": "결제 의도가 취소되었습니다",
    "shop.checkoutExpired": "결제 의도가 만료되었습니다",
    "shop.checkoutCancel": "결제 의도 취소",
    "shop.checkoutExpires": "만료",
    "shop.checkoutPaymentUnavailable":
      "결제 의도는 견적만 잠시 고정하며 주문을 만들거나 결제하지 않습니다.",
    "shop.checkoutBackToCart": "장바구니로 돌아가기",
    "shop.checkoutFailed": "결제 의도를 불러오지 못했습니다.",
    "shop.orderDraft": "주문 초안",
    "shop.orderDraftCreate": "배송정보 입력으로 계속",
    "shop.orderDraftCreating": "주문 초안 준비 중…",
    "shop.orderDraftCollecting": "연락처와 배송정보를 입력해 주세요",
    "shop.orderDraftReviewable": "검토할 정보를 저장했습니다",
    "shop.orderDraftStale": "장바구니가 변경됨 — 초안을 삭제하고 다시 시작해 주세요",
    "shop.orderDraftExpires": "개인정보 만료",
    "shop.orderDraftCustomer": "주문자 정보",
    "shop.orderDraftShipping": "배송지",
    "shop.orderDraftShippingMethods": "배송 방법",
    "shop.orderDraftShippingSelect": "배송 방법 선택",
    "shop.orderDraftShippingSelecting": "선택 중…",
    "shop.orderDraftShippingRequired": "주문 전에 유효한 배송 방법을 선택해 주세요.",
    "shop.orderDraftShippingUnavailable": "현재 선택할 수 있는 배송 방법이 없습니다.",
    "shop.orderDraftShippingDays": "일",
    "shop.orderDraftFullName": "이름",
    "shop.orderDraftEmail": "이메일",
    "shop.orderDraftPhone": "전화번호",
    "shop.orderDraftRecipientName": "받는 분",
    "shop.orderDraftCountryCode": "국가 코드",
    "shop.orderDraftPostalCode": "우편번호",
    "shop.orderDraftAddressLine1": "주소",
    "shop.orderDraftAddressLine2": "상세주소 (선택)",
    "shop.orderDraftLocality": "시·군·구",
    "shop.orderDraftAdministrativeArea": "시·도 (선택)",
    "shop.orderDraftSave": "정보 저장",
    "shop.orderDraftSaving": "저장 중…",
    "shop.orderDraftDelete": "개인정보 초안 삭제",
    "shop.orderDraftPrivacy":
      "입력 정보는 검색·콘텐츠 내보내기에 포함되지 않습니다. 취소하면 즉시 삭제되며 24시간 후 만료된 초안은 시간별 정리 작업이 영구 삭제합니다.",
    "shop.orderDraftPaymentUnavailable":
      "정보를 저장해도 주문 생성, 재고 예약, 세금 신고·납부 또는 결제가 실행되지 않습니다.",
    "shop.orderDraftFailed": "주문 초안을 갱신하지 못했습니다.",
    "shop.shippingAmount": "배송비",
    "shop.taxAmount": "추가 세액",
    "shop.taxBreakdown": "세액 내역",
    "shop.orderTotal": "총 결제금액",
    "shop.order": "주문",
    "shop.orders": "주문 내역",
    "shop.orderCreate": "결제 대기 주문 만들기",
    "shop.orderCreating": "주문 만드는 중…",
    "shop.orderPendingPayment": "결제 대기",
    "shop.orderPaid": "결제 완료",
    "shop.orderRefunded": "전액 환불",
    "shop.orderPaymentFailed": "결제 실패",
    "shop.orderCancelled": "취소됨",
    "shop.orderPaymentVerified": "결제사 콜백을 검증했고 주문을 결제 완료로 전환했습니다.",
    "shop.orderRefundedDetail": "설정된 결제사가 결제 전액을 환불했습니다.",
    "shop.orderPartialRefundedDetail":
      "설정된 결제사가 수령된 반품 상품과 지정된 배송비·세액을 부분 환불했습니다.",
    "shop.orderPaymentFailedDetail":
      "결제사가 실패를 알렸습니다. 재고 예약을 해제하고 배송 개인정보를 삭제했습니다.",
    "shop.orderPrivateRetained":
      "배송 개인정보는 출고 즉시 또는 결제 확인 후 최대 30일 안에 영구 삭제됩니다.",
    "shop.orderPrivateRedacted": "배송 개인정보가 영구 삭제되었습니다.",
    "shop.orderInventoryHeld": "재고 추적 상품은 이 주문이 만료될 때까지 예약됩니다.",
    "shop.orderInventoryConsumed": "예약된 추적 재고를 차감했습니다.",
    "shop.orderInventoryReleased": "재고 예약이 해제되었습니다.",
    "shop.orderInventoryNotRequired": "이 주문에는 재고 추적 상품이 없습니다.",
    "shop.orderRefundInventoryRestocked": "환불 후 추적 재고를 복원했습니다.",
    "shop.orderRefundInventoryManual": "환불은 완료됐지만 재고는 운영자가 직접 조정해야 합니다.",
    "shop.orderRefundInventoryShipped":
      "이미 출고된 주문이므로 환불 시 재고를 자동 복원하지 않았습니다.",
    "shop.orderFulfillmentAwaiting": "배송 처리를 기다리고 있습니다.",
    "shop.orderFulfillmentProcessing": "상품을 출고 준비 중입니다.",
    "shop.orderFulfillmentShipped": "상품이 출고되었습니다.",
    "shop.orderFulfillmentCancelled": "전액 환불 후 배송 작업이 취소되었습니다.",
    "shop.orderFulfillmentTracking": "배송 조회",
    "shop.orderTrackingInTransit": "배송 중입니다.",
    "shop.orderTrackingOutForDelivery": "배송 출발했습니다.",
    "shop.orderTrackingDelivered": "배송이 완료되었습니다.",
    "shop.orderTrackingException": "택배사에서 배송 예외를 보고했습니다.",
    "shop.orderReturn": "상품 반품",
    "shop.orderReturnRequested": "반품을 요청했습니다. 관리자 검토를 기다리고 있습니다.",
    "shop.orderReturnApproved": "반품이 승인되었습니다. 사이트 정책에 따라 상품을 보내 주세요.",
    "shop.orderReturnRejected": "반품 요청이 거절되었습니다.",
    "shop.orderReturnReceived": "반품 상품 입고가 확인되었습니다.",
    "shop.orderReturnCancelled": "반품 요청을 취소했습니다.",
    "shop.orderExchange": "교환 상품",
    "shop.orderExchangeAwaiting": "동일 상품 교환 처리를 기다리고 있습니다.",
    "shop.orderExchangeProcessing": "동일 상품 교환 출고를 준비 중입니다.",
    "shop.orderExchangeShipped": "동일 상품 교환품이 출고되었습니다.",
    "shop.orderExchangeCancelled": "동일 상품 교환이 취소되었습니다.",
    "shop.orderExchangeInventoryRestocked": "교환용 재고를 복원했습니다.",
    "shop.orderExchangeInventoryManual": "교환용 재고를 운영자가 직접 조정해야 합니다.",
    "shop.orderExchangeTracking": "교환 배송 조회",
    "shop.orderExchangeDestination": "교환품 배송지",
    "shop.orderExchangeDestinationAwaiting":
      "교환품을 받을 새 배송지를 입력해 주세요. 기존 주문 배송지는 재사용하지 않습니다.",
    "shop.orderExchangeDestinationSubmitted":
      "관리자가 확인할 때까지 교환품 배송지를 별도로 보관합니다.",
    "shop.orderExchangeDestinationAccessed":
      "관리자가 교환품 배송지를 확인해 처리를 시작할 수 있습니다.",
    "shop.orderExchangeDestinationExpired":
      "보관 중이던 교환품 배송지가 만료되었습니다. 계속하려면 다시 제출해 주세요.",
    "shop.orderExchangeDestinationSubmit": "교환품 배송지 제출",
    "shop.orderExchangeDestinationSubmitting": "교환품 배송지 제출 중…",
    "shop.orderExchangeDestinationPrivacy":
      "배송지는 별도 저장소에 최대 24시간만 보관하고 열람을 감사하며, 처리 시작 시 삭제합니다.",
    "shop.orderExchangeDestinationFailed": "교환품 배송지를 제출하지 못했습니다.",
    "shop.orderReturnReason": "반품 사유",
    "shop.orderReturnReasonDamaged": "배송 중 파손",
    "shop.orderReturnReasonDefective": "상품 불량",
    "shop.orderReturnReasonWrongItem": "다른 상품 배송",
    "shop.orderReturnReasonChangedMind": "단순 변심",
    "shop.orderReturnReasonOther": "기타",
    "shop.orderReturnDetail": "상세 사유 (선택, 민감정보 입력 금지)",
    "shop.orderReturnSubmit": "반품 요청",
    "shop.orderReturnSubmitting": "반품 요청 중…",
    "shop.orderReturnSelectItem": "반품할 상품을 하나 이상 선택해 주세요.",
    "shop.orderReturnCancel": "반품 요청 취소",
    "shop.orderReturnPolicy":
      "이 요청은 실물 상품 반품 접수만 기록합니다. 결제 환불, 반품 운송장 구매, 수거 예약 또는 정책상 승인 여부를 보장하지 않습니다.",
    "shop.orderReturnInventoryRestocked": "입고 확인된 추적 재고를 복원했습니다.",
    "shop.orderReturnInventoryManual": "입고는 확인했지만 재고는 관리자가 직접 조정해야 합니다.",
    "shop.orderReturnInventoryNotRequired": "복원할 추적 재고가 없습니다.",
    "shop.orderReturnFailed": "반품 요청을 갱신하지 못했습니다.",
    "shop.orderReturnLogistics": "반품 배송",
    "shop.orderReturnLogisticsDropoff": "반품 운송장을 출력해 직접 접수",
    "shop.orderReturnLogisticsPickup": "택배사 회수 예약",
    "shop.orderReturnLogisticsCreate": "반품 배송 만들기",
    "shop.orderReturnLogisticsCreating": "반품 배송 생성 중…",
    "shop.orderReturnLogisticsPending": "택배사 확인 또는 로컬 조정을 기다리고 있습니다.",
    "shop.orderReturnLogisticsActive": "반품 배송이 접수되었습니다.",
    "shop.orderReturnLogisticsCancelled": "반품 배송을 취소했습니다.",
    "shop.orderReturnLogisticsResume": "반품 배송 다시 시도",
    "shop.orderReturnLogisticsCancel": "반품 배송 취소",
    "shop.orderReturnLogisticsLabel": "반품 운송장 다운로드",
    "shop.orderReturnLogisticsReadyAt": "회수 시작 시각",
    "shop.orderReturnLogisticsCloseAt": "회수 종료 시각",
    "shop.orderReturnLogisticsPrivacy":
      "회수 주소는 설정된 택배사에만 전달하고 확인 즉시 삭제하며, 확인되지 않아도 24시간 안에 만료됩니다.",
    "shop.orderReturnLogisticsFailed": "반품 배송을 갱신하지 못했습니다.",
    "shop.orderReturnPostageQuote": "반품 배송비 조회",
    "shop.orderReturnPostageQuoting": "반품 배송비를 조회하는 중…",
    "shop.orderReturnPostageSelect": "이 반품 배송 방법 선택",
    "shop.orderReturnPostageSelecting": "반품 배송 방법을 선택하는 중…",
    "shop.orderReturnPostageSelected": "선택한 반품 배송 방법",
    "shop.orderReturnPostageExpires": "견적 만료",
    "shop.orderReturnPostagePrivacy":
      "회수 주소는 설정된 택배사에만 전달하며 이 견적과 함께 1시간 안에 만료됩니다.",
    "shop.orderReturnPostageBoundary":
      "표시 금액은 반품 배송 생성용 운송사 견적입니다. 자동 결제·환불 차감이나 비용 부담자 판단을 하지 않습니다.",
    "shop.orderReturnPostageFailed": "반품 배송비를 갱신하지 못했습니다.",
    "shop.orderReturnPostageResponsibility": "반품 배송비 부담",
    "shop.orderReturnPostageMerchant": "판매자 부담",
    "shop.orderReturnPostageCustomer": "구매자 부담 및 환불 차감",
    "shop.orderReturnPostageDeduction": "반품 배송비 차감",
    "shop.orderReturnRefundNet": "최종 환불액",
    "shop.orderReturnTrackingInTransit": "반품 상품이 반품 센터로 이동 중입니다.",
    "shop.orderReturnTrackingOutForDelivery": "반품 상품이 반품 센터 배송 출발 상태입니다.",
    "shop.orderReturnTrackingDelivered":
      "택배사가 반품 상품을 배송했습니다. 창고 입고 확인은 아직 별도입니다.",
    "shop.orderReturnTrackingException": "반품 운송 중 택배사 예외가 발생했습니다.",
    "shop.orderExpires": "결제 대기 만료",
    "shop.orderCreated": "생성",
    "shop.orderNotifications": "주문 진행 내역",
    "shop.orderCancel": "주문 취소 및 개인정보 삭제",
    "shop.orderHistory": "주문 내역",
    "shop.orderEmpty": "이 브라우저 식별자로 만든 주문이 없습니다.",
    "shop.orderReference": "주문 번호",
    "shop.orderPaymentUnavailable":
      "활성 결제사가 검증된 콜백을 보낼 때까지 결제 대기 상태입니다. 세금 신고·납부, 운송사 예약, 배송 처리 및 환불은 별도 계약입니다.",
    "shop.orderPay": "연결된 결제사로 결제하기",
    "shop.orderPaymentPreparing": "안전한 결제를 준비하는 중…",
    "shop.orderPaymentConfirming": "결제사에서 결제를 승인하는 중…",
    "shop.orderPaymentRetry": "새 결제 시도 준비",
    "shop.orderPaymentStartFailed":
      "결제를 시작하거나 승인하지 못했습니다. 주문은 결제 대기로 유지되며 성공으로 간주하지 않았습니다.",
    "shop.orderFailed": "주문을 갱신하지 못했습니다.",
    "shop.previous": "이전",
    "shop.next": "다음",
    "shop.backToCatalog": "스토어로 돌아가기",
    "shop.viewProduct": "상품 보기",
  },
} as const;

/**
 * Creates the complete catalog definition. Register both `collections` and
 * `plugin`; the default app does this through `defaultCollections` and
 * `defaultPlugins`.
 */
export function createShop(options: NpShopOptions = {}) {
  const runtime = createRuntime(options);
  const shippingMode = runtime.shippingAdapter?.id ?? `${NP_SHOP_SHIPPING_POLICY_PROVIDER_ID}/zero`;
  const collections = [
    defineShopCategoriesCollection(runtime),
    defineShopProductsCollection(runtime),
    defineShopPromotionsCollection(runtime),
    defineShopShippingPoliciesCollection(runtime),
    defineShopProductReviewsCollection(runtime),
  ] as const;
  const blocks = createShopHomeBlocks(runtime);
  const cartApiHandler = createShopCartApiHandler(runtime);
  const reviewApiHandler = createShopProductReviewApiHandler(runtime);
  const restockAlertApiHandler = createShopRestockAlertApiHandler(runtime);
  const priceAlertApiHandler = createShopPriceAlertApiHandler(runtime);
  const checkoutApiHandler = createShopCheckoutApiHandler(runtime);
  const orderDraftApiHandler = createShopOrderDraftApiHandler(runtime);
  const orderApiHandler = createShopOrderApiHandler(runtime);
  const exchangeDestinationApiHandler = createShopExchangeDestinationApiHandler();
  const returnApiHandler = createShopReturnApiHandler();
  const returnLogisticsApiHandler = runtime.carrierReturnLogisticsAdapter
    ? createShopReturnLogisticsApiHandler(runtime)
    : null;
  const returnLogisticsLabelApiHandler = runtime.carrierReturnLabelAdapter
    ? createShopReturnLogisticsLabelApiHandler(runtime)
    : null;
  const returnPostageApiHandler = runtime.carrierReturnPostageAdapter
    ? createShopReturnPostageApiHandler(runtime)
    : null;
  const returnTrackingApiHandler = runtime.carrierReturnTrackingAdapter
    ? createShopReturnTrackingApiHandler(runtime.carrierReturnTrackingAdapter)
    : null;
  const paymentApiHandler = runtime.paymentAdapter ? createShopPaymentApiHandler(runtime) : null;
  const trackingApiHandler = runtime.carrierTrackingAdapter
    ? createShopTrackingApiHandler(runtime.carrierTrackingAdapter)
    : null;
  const carrierLabelApiHandler = runtime.carrierLabelAdapter
    ? createShopCarrierLabelApiHandler(runtime)
    : null;
  const paymentAttemptApiHandler = runtime.paymentInitiationAdapter
    ? createShopPaymentAttemptApiHandler(runtime)
    : null;
  const pageRoutes = [
    {
      pattern: runtime.basePath,
      component: createShopCatalogRoute(runtime),
      metadata: createShopCatalogMetadata(runtime),
    },
    {
      pattern: `${runtime.basePath}/categories/:categorySlug`,
      component: createShopCategoryRoute(runtime),
      metadata: createShopCategoryMetadata(runtime),
    },
    {
      pattern: `${runtime.basePath}/products/:productSlug`,
      component: createShopProductRoute(runtime),
      metadata: createShopProductMetadata(runtime),
    },
    {
      pattern: `${runtime.basePath}/wishlist`,
      component: createShopWishlistRoute(runtime),
    },
    {
      pattern: `${runtime.basePath}/cart`,
      component: createShopCartRoute(runtime),
    },
    {
      pattern: `${runtime.basePath}/checkout/:intentId`,
      component: createShopCheckoutRoute(runtime),
    },
    {
      pattern: `${runtime.basePath}/order-drafts/:draftId`,
      component: createShopOrderDraftRoute(runtime),
    },
    {
      pattern: `${runtime.basePath}/orders`,
      component: createShopOrdersRoute(runtime),
    },
    {
      pattern: `${runtime.basePath}/orders/:orderId`,
      component: createShopOrderRoute(runtime),
    },
  ] satisfies NpPluginPageRouteRegistration[];

  const plugin = definePlugin({
    manifest: {
      id: "shop",
      version: "0.4.2",
      name: "Shop",
      description:
        "Product catalog, wishlists, stock and price alerts, verified reviews, promotions, carts, checkout, private drafts, shipping and tax quotes, durable orders, inventory, optional payments and refunds, fulfillment, carrier booking, labels, pickup availability and scheduling, tracking, physical returns, same-item exchanges, public storefront routes, skins, and homepage blocks.",
      author: { name: "NexPress" },
      license: "MIT",
      nexpress: { minVersion: "0.4.2" },
      capabilities: [
        "content:read",
        "admin:panel",
        "admin:dashboard",
        "api:route",
        "hooks:scheduled",
        "storage:kv",
      ],
      allowedHosts: [],
      provides: {
        blocks: [],
        collections: [
          runtime.collections.categories,
          runtime.collections.products,
          runtime.collections.promotions,
          runtime.collections.shippingPolicies,
          runtime.collections.reviews,
        ],
        adminExtensions: [
          "dashboard:shop-products",
          "dashboard:shop-low-stock",
          "dashboard:shop-promotions",
          "widget:shop-promotion-health",
          "dashboard:shop-shipping-policies",
          "widget:shop-shipping-policy-health",
          "dashboard:shop-product-reviews",
          "widget:shop-product-review-health",
          "table:shop-product-reviews",
          "action:shop-product-review-hide",
          "action:shop-product-review-restore",
          "dashboard:shop-wishlists",
          "widget:shop-wishlist-health",
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
          "dashboard:shop-carts",
          "widget:shop-cart-health",
          "action:shop-cart-cleanup",
          "dashboard:shop-checkout-intents",
          "widget:shop-checkout-health",
          "action:shop-checkout-cleanup",
          "dashboard:shop-order-drafts",
          "widget:shop-order-draft-health",
          "action:shop-order-draft-cleanup",
          "dashboard:shop-orders",
          "widget:shop-order-health",
          "table:shop-recent-orders",
          "dashboard:shop-fulfillments",
          "widget:shop-fulfillment-health",
          "table:shop-fulfillments",
          "dashboard:shop-fulfillment-parcels",
          "widget:shop-fulfillment-parcel-health",
          "table:shop-fulfillment-parcels",
          "action:shop-fulfillment-parcels",
          "dashboard:shop-carrier-bookings",
          "widget:shop-carrier-booking-health",
          "table:shop-carrier-bookings",
          ...(carrierLabelApiHandler ? ["action:shop-carrier-label-download"] : []),
          "dashboard:shop-carrier-label-acquisitions",
          "widget:shop-carrier-label-acquisition-health",
          "table:shop-carrier-label-acquisitions",
          ...(runtime.carrierLabelAcquisitionAdapter
            ? ["action:shop-carrier-label-acquisition"]
            : []),
          "dashboard:shop-return-logistics",
          "widget:shop-return-logistics-health",
          "table:shop-return-logistics",
          ...(returnLogisticsApiHandler ? ["action:shop-return-logistics"] : []),
          ...(returnLogisticsLabelApiHandler ? ["action:shop-return-label-download"] : []),
          "dashboard:shop-return-postage",
          "widget:shop-return-postage-health",
          "table:shop-return-postage",
          ...(returnPostageApiHandler ? ["action:shop-return-postage"] : []),
          "dashboard:shop-carrier-pickup-availability",
          "widget:shop-carrier-pickup-availability-health",
          "table:shop-carrier-pickup-availability",
          "dashboard:shop-carrier-pickups",
          "widget:shop-carrier-pickup-health",
          "table:shop-carrier-pickups",
          ...(runtime.carrierPickupAdapter ? ["action:shop-carrier-pickup"] : []),
          ...(runtime.carrierPickupAvailabilityAdapter
            ? ["action:shop-carrier-pickup-availability"]
            : []),
          "dashboard:shop-tracking-events",
          "widget:shop-tracking-event-health",
          "table:shop-tracking-events",
          "widget:shop-tracking-poll-health",
          "table:shop-tracking-polls",
          ...(runtime.carrierTrackingPollAdapter ? ["action:shop-tracking-poll"] : []),
          "dashboard:shop-return-tracking-events",
          "widget:shop-return-tracking-event-health",
          "table:shop-return-tracking-events",
          "widget:shop-return-tracking-poll-health",
          "table:shop-return-tracking-polls",
          ...(runtime.carrierReturnTrackingPollAdapter ? ["action:shop-return-tracking-poll"] : []),
          "dashboard:shop-inventory-reservations",
          "widget:shop-inventory-reservation-health",
          "table:shop-inventory-reservations",
          "action:shop-order-maintenance",
          "dashboard:shop-payment-events",
          "widget:shop-payment-event-health",
          "table:shop-payment-events",
          "dashboard:shop-refunds",
          "widget:shop-refund-health",
          "table:shop-refunds",
          "dashboard:shop-partial-refunds",
          "widget:shop-partial-refund-health",
          "table:shop-partial-refunds",
          ...(runtime.paymentPartialRefundAdapter ? ["action:shop-return-partial-refund"] : []),
          ...(runtime.paymentReturnSettlementAdapter
            ? ["action:shop-return-postage-settlement-refund"]
            : []),
          "dashboard:shop-returns",
          "widget:shop-return-health",
          "table:shop-returns",
          "dashboard:shop-exchanges",
          "widget:shop-exchange-health",
          "table:shop-exchanges",
          "action:shop-exchange-operations",
          "action:shop-exchange-destination-private-read",
          ...(runtime.carrierExchangeAdapter ? ["action:shop-exchange-carrier-booking"] : []),
          ...(runtime.carrierExchangeParcelAdapter ? ["action:shop-exchange-parcel-snapshot"] : []),
          ...(paymentAttemptApiHandler
            ? [
                "dashboard:shop-payment-attempts",
                "widget:shop-payment-attempt-health",
                "table:shop-payment-attempts",
              ]
            : []),
        ],
        apiRoutes: [
          "/cart",
          "/checkout",
          "/order-drafts",
          "/orders",
          "/reviews",
          "/restock-alerts",
          "/price-alerts",
          "/returns",
          "/exchanges/destination",
          ...(paymentApiHandler ? ["/payments/webhook"] : []),
          ...(trackingApiHandler ? ["/carrier/tracking/webhook"] : []),
          ...(returnTrackingApiHandler ? ["/carrier/return-tracking/webhook"] : []),
          ...(carrierLabelApiHandler ? ["/carrier/shipping-label"] : []),
          ...(returnLogisticsApiHandler ? ["/returns/logistics"] : []),
          ...(returnPostageApiHandler ? ["/returns/postage"] : []),
          ...(returnLogisticsLabelApiHandler ? ["/returns/logistics/label"] : []),
          ...(paymentAttemptApiHandler ? ["/payments/attempts"] : []),
        ],
        hooks: [],
      },
      agent: {
        description:
          "Catalog, member-owned saved products over the shared follow graph, independent one-shot member restock and catalog price-drop alerts, promotions, shipped-purchase reviews, bounded cart, checkout-intent, private order-draft, local shipping policies or optional provider-neutral shipping quotes, additional-tax quotes, exact order totals, durable orders, transaction-safe inventory reservations, optional provider-neutral payment initiation, verified payment events, full refunds with safe compensation, received-return partial refunds with exact allocation and optional quote-backed merchant/customer postage settlement, revision-safe fulfillment and parcel snapshots, carrier booking, durable outbound and replacement shipping-label acquisition with transient retrieval, bounded outbound and replacement carrier pickup availability plus scheduling, verified or reconciled outbound and replacement tracking, physical return intake, exact same-item replacement exchanges with revision-bound owner address intake, audited short-lived private storage, and optional paired provider booking/cancellation, approved-return logistics with optional return-postage quotes and transient labels, and independent verified or reconciled reverse tracking. Separate return-postage charges, automatic or jurisdictional payer policy, recurring/discount-aware price alerts, recurring restock alerts, inventory reservation, automatic cart insertion, tax remittance/filing, exemptions, invoices, customs, provider settlement, reversals, repeated or non-return partial refunds, substitutions or price-difference exchanges, automatic address correction, label billing/void policy, recurring pickup, general carrier calendars, warehouse automation, dynamic carrier-rate policy, and provider-specific carrier protocols remain external.",
        category: "ecommerce",
        tags: [
          "shop",
          "catalog",
          "product",
          "wishlist",
          "restock-alert",
          "price-alert",
          "review",
          "inventory",
          "storefront",
        ],
      },
      usesTokens: [
        "colors.primary",
        "colors.primaryForeground",
        "colors.background",
        "colors.foreground",
        "colors.muted",
        "colors.mutedForeground",
        "colors.border",
        "colors.card",
        "typography.fontHeading",
        "typography.fontBody",
        "shape.radiusSm",
        "shape.radiusMd",
        "shape.radiusLg",
        "shape.shadowSm",
      ],
      styleSlots: {
        root: ".np-shop",
        catalog: '[data-np-shop-surface="catalog"]',
        category: '[data-np-shop-surface="category"]',
        product: '[data-np-shop-surface="product"]',
        wishlist: '[data-np-shop-surface="wishlist"]',
        cart: '[data-np-shop-surface="cart"]',
        checkout: '[data-np-shop-surface="checkout"]',
        "order-draft": '[data-np-shop-surface="order-draft"]',
        orders: '[data-np-shop-surface="orders"]',
        order: '[data-np-shop-surface="order"]',
        "cart-action": "[data-np-shop-cart-action]",
        "cart-line": "[data-np-shop-cart-line]",
        "checkout-line": "[data-np-shop-checkout-line]",
        "checkout-status": "[data-np-shop-checkout-status]",
        "order-draft-line": "[data-np-shop-order-draft-line]",
        "order-draft-status": "[data-np-shop-order-draft-status]",
        "order-line": "[data-np-shop-order-line]",
        "order-status": "[data-np-shop-order-status]",
        "order-notifications": "[data-np-shop-order-notifications]",
        "fulfillment-status": "[data-np-shop-fulfillment-status]",
        "tracking-status": "[data-np-shop-tracking-status]",
        "return-tracking-status": "[data-np-shop-return-tracking-status]",
        "return-status": "[data-np-shop-return-status]",
        exchange: "[data-np-shop-exchange]",
        "exchange-destination": "[data-np-shop-exchange-destination]",
        "exchange-carrier-booking": "[data-np-shop-exchange-carrier-booking]",
        "exchange-tracking-status": "[data-np-shop-exchange-tracking]",
        "return-postage": "[data-np-shop-return-postage-status]",
        "return-postage-settlement": "[data-np-shop-return-postage-settlement]",
        "product-card": ".np-shop-product-card",
        "wishlist-action": "[data-np-shop-wishlist-action]",
        "restock-alert": "[data-np-shop-restock-alert]",
        "price-alert": "[data-np-shop-price-alert]",
        reviews: "[data-np-shop-reviews]",
        inquiries: "[data-np-forum-context-questions]",
        "review-card": "[data-np-shop-review]",
        "review-form": "[data-np-shop-review-form]",
        "product-grid": ".np-shop-product-grid",
        "category-grid": ".np-shop-category-grid",
        filters: ".np-shop-filters",
        inventory: "[data-np-shop-inventory]",
        "featured-products-block": '[data-np-shop-block="products"]',
        "category-grid-block": '[data-np-shop-block="categories"]',
      },
    },
    blocks,
    patterns: shopHomePatterns,
    i18n: messages,
    setup: () => {
      registerNotificationKind({
        kind: "shop.product-restocked",
        label: "Product restock alerts",
        description: "One selected Shop product or option became available again.",
      });
      registerNotificationKind({
        kind: NP_SHOP_PRICE_DROP_NOTIFICATION_KIND,
        label: "Product price-drop alerts",
        description: "One selected Shop catalog price dropped below its subscription baseline.",
      });
      registerNotificationKind({
        kind: NP_SHOP_ORDER_NOTIFICATION_KIND,
        label: "Shop order updates",
        description: "A durable Shop order, payment, delivery, return, or refund state changed.",
      });
    },
    hooks: {
      "content:afterUpdate": async ({ data }) => {
        if (
          data.collection !== runtime.collections.products ||
          typeof data.document.id !== "string"
        ) {
          return;
        }
        await Promise.all([
          npProcessShopRestockAlerts(runtime, { productId: data.document.id }),
          npProcessShopPriceAlerts(runtime, { productId: data.document.id }),
        ]);
      },
      "content:afterDelete": async ({ data }) => {
        if (data.collection !== runtime.collections.products) return;
        await Promise.all([
          npDeleteShopRestockAlertsForProduct(data.documentId),
          npDeleteShopPriceAlertsForProduct(data.documentId),
        ]);
      },
    },
    admin: {
      dashboardWidgets: [
        {
          id: "shop-products-total",
          label: "Products",
          kind: "metric",
          actionId: "countProducts",
          description: "Total catalog products across all lifecycle states.",
          priority: 22,
        },
        {
          id: "shop-low-stock-total",
          label: "Low-stock products",
          kind: "metric",
          actionId: "countLowStockProducts",
          description: "Published products at or below their low-stock threshold.",
          priority: 23,
        },
        {
          id: "shop-promotions-total",
          label: "Published promotions",
          kind: "metric",
          actionId: "countPromotions",
          description: "Automatic and coupon campaigns currently published for evaluation.",
          priority: 21,
        },
        {
          id: "shop-shipping-policies-total",
          label: "Published shipping policies",
          kind: "metric",
          actionId: "countShippingPolicies",
          description: "Published local base-rate and surcharge rules for this site.",
          priority: 20,
        },
        {
          id: "shop-product-reviews-total",
          label: "Product reviews",
          kind: "metric",
          actionId: "countProductReviews",
          description:
            "Verified-purchase review rows across published, pending, and hidden states.",
          priority: 19,
        },
        {
          id: "shop-wishlists-total",
          label: "Saved products",
          kind: "metric",
          actionId: "countProductWishlistSaves",
          description: "Site-scoped member-to-product saves in the shared community follow graph.",
          priority: 18,
        },
        {
          id: "shop-restock-alerts-total",
          label: "Active restock alerts",
          kind: "metric",
          actionId: "countActiveRestockAlerts",
          description:
            "PII-free member-owned product or option alerts awaiting one availability transition.",
          priority: 17,
        },
        {
          id: "shop-price-alerts-total",
          label: "Active price-drop alerts",
          kind: "metric",
          actionId: "countActivePriceAlerts",
          description: "PII-free member-owned catalog price baselines awaiting one exact decrease.",
          priority: 16,
        },
        {
          id: "shop-order-notifications-total",
          label: "Order notification events",
          kind: "metric",
          actionId: "countOrderNotifications",
          description: "PII-free durable order timeline and delivery outbox events.",
          priority: 15,
        },
        {
          id: "shop-carts-total",
          label: "Active carts",
          kind: "metric",
          actionId: "countActiveCarts",
          description: "Unexpired member and guest carts for this site.",
          priority: 24,
        },
        {
          id: "shop-checkout-intents-total",
          label: "Unexpired checkout intents",
          kind: "metric",
          actionId: "countActiveCheckoutIntents",
          description:
            "Unexpired non-cancelled intent records; each public read revalidates its cart.",
          priority: 25,
        },
        {
          id: "shop-order-drafts-total",
          label: "Private order drafts",
          kind: "metric",
          actionId: "countActiveOrderDrafts",
          description:
            "Unexpired owner-scoped drafts; customer and shipping values are never exposed here.",
          priority: 26,
        },
        {
          id: "shop-orders-total",
          label: "Orders",
          kind: "metric",
          actionId: "countOrders",
          description:
            "Durable commercial snapshots only; customer and shipping values are excluded.",
          priority: 27,
        },
        {
          id: "shop-inventory-reservations-total",
          label: "Active inventory reservations",
          kind: "metric",
          actionId: "countActiveInventoryReservations",
          description: "PII-free product and variant holds owned by pending orders for this site.",
          priority: 29,
        },
        {
          id: "shop-fulfillments-total",
          label: "Fulfillments",
          kind: "metric",
          actionId: "countFulfillments",
          description: "Paid orders tracked through awaiting, processing, and shipped states.",
          priority: 28,
        },
        {
          id: "shop-fulfillment-parcels-total",
          label: "Prepared parcels",
          kind: "metric",
          actionId: "countFulfillmentParcels",
          description: "PII-free package snapshots prepared for paid-order fulfillment.",
          priority: 36,
        },
        {
          id: "shop-carrier-bookings-total",
          label: "Carrier bookings",
          kind: "metric",
          actionId: "countCarrierBookings",
          description: "PII-free durable carrier attempts and locally completed shipments.",
          priority: 30,
        },
        {
          id: "shop-carrier-label-acquisitions-total",
          label: "Carrier labels",
          kind: "metric",
          actionId: "countCarrierLabelAcquisitions",
          description: "PII-free durable label purchase and regeneration attempts.",
          priority: 44,
        },
        {
          id: "shop-carrier-pickup-availability-total",
          label: "Pickup windows",
          kind: "metric",
          actionId: "countCarrierPickupAvailability",
          description: "Short-lived PII-free provider pickup windows awaiting staff selection.",
          priority: 45,
        },
        {
          id: "shop-carrier-pickups-total",
          label: "Carrier pickups",
          kind: "metric",
          actionId: "countCarrierPickups",
          description: "PII-free durable pickup scheduling and cancellation attempts.",
          priority: 37,
        },
        {
          id: "shop-tracking-events-total",
          label: "Tracking events",
          kind: "metric",
          actionId: "countTrackingEvents",
          description: "Verified PII-free carrier events retained with their shipments.",
          priority: 31,
        },
        {
          id: "shop-return-tracking-events-total",
          label: "Return tracking events",
          kind: "metric",
          actionId: "countReturnTrackingEvents",
          description: "Verified PII-free reverse-shipment events retained with their returns.",
          priority: 39,
        },
        {
          id: "shop-payment-events-total",
          label: "Payment events",
          kind: "metric",
          actionId: "countPaymentEvents",
          description:
            "Verified, PII-free provider event receipts retained with their commercial orders.",
          priority: 32,
        },
        {
          id: "shop-payment-adjustments-total",
          label: "Payment adjustments",
          kind: "metric",
          actionId: "countPaymentAdjustments",
          description:
            "Provider-confirmed full or partial cancellations reconciled with Shop refunds and orders.",
          priority: 41,
        },
        {
          id: "shop-refunds-total",
          label: "Refunds",
          kind: "metric",
          actionId: "countRefunds",
          description: "Durable full-refund attempts and completed inventory compensation.",
          priority: 34,
        },
        {
          id: "shop-partial-refunds-total",
          label: "Return refunds",
          kind: "metric",
          actionId: "countPartialRefunds",
          description:
            "Durable provider refunds linked to received physical returns, including quote-backed postage settlements.",
          priority: 40,
        },
        {
          id: "shop-returns-total",
          label: "Returns",
          kind: "metric",
          actionId: "countReturns",
          description: "Durable item-level physical return requests for shipped orders.",
          priority: 35,
        },
        {
          id: "shop-exchanges-total",
          label: "Same-item exchanges",
          kind: "metric",
          actionId: "countExchanges",
          description: "Received returns with one exact replacement inventory and shipment state.",
          priority: 43,
        },
        {
          id: "shop-return-logistics-total",
          label: "Return shipments",
          kind: "metric" as const,
          actionId: "countReturnLogistics",
          description:
            "PII-free provider return shipment and pickup state; origin addresses are excluded.",
          priority: 38,
        },
        {
          id: "shop-return-postage-total",
          label: "Return-postage quotes",
          kind: "metric" as const,
          actionId: "countReturnPostage",
          description:
            "Short-lived PII-free carrier methods; private origins are withheld and expire with quotes.",
          priority: 42,
        },
        ...(paymentAttemptApiHandler
          ? [
              {
                id: "shop-payment-attempts-total",
                label: "Payment attempts",
                kind: "metric" as const,
                actionId: "countPaymentAttempts",
                description:
                  "PII-free owner-scoped handoffs retained with their commercial orders.",
                priority: 33,
              },
            ]
          : []),
      ],
      widgets: [
        {
          id: "shop-promotion-health",
          label: "Promotion usage contract",
          kind: "status",
          actionId: "promotionHealth",
        },
        {
          id: "shop-shipping-policy-health",
          label: "Shipping policy contract",
          kind: "status",
          actionId: "shippingPolicyHealth",
        },
        {
          id: "shop-product-review-health",
          label: "Product review contract",
          kind: "status",
          actionId: "productReviewHealth",
        },
        {
          id: "shop-wishlist-health",
          label: "Saved-product contract",
          kind: "status",
          actionId: "wishlistHealth",
          description:
            "Checks the site-scoped shared follow graph used by member product wishlists.",
        },
        {
          id: "shop-restock-alert-health",
          label: "Restock alert contract",
          kind: "status",
          actionId: "restockAlertHealth",
          description:
            "Checks bounded storage, member/product targets, processing leases, and pending availability.",
        },
        {
          id: "shop-price-alert-health",
          label: "Price-drop alert contract",
          kind: "status",
          actionId: "priceAlertHealth",
          description:
            "Checks bounded catalog-price baselines, targets, currencies, processing leases, and due decreases.",
        },
        {
          id: "shop-order-notification-health",
          label: "Order notification delivery",
          kind: "status",
          actionId: "orderNotificationHealth",
          description:
            "Checks PII-free delivery state, bounded leases, and expired private recipient sidecars.",
        },
        {
          id: "shop-cart-health",
          label: "Cart storage",
          kind: "status",
          actionId: "cartHealth",
        },
        {
          id: "shop-checkout-health",
          label: "Checkout intent storage",
          kind: "status",
          actionId: "checkoutIntentHealth",
        },
        {
          id: "shop-order-draft-health",
          label: "Private order draft storage",
          kind: "status",
          actionId: "orderDraftHealth",
        },
        {
          id: "shop-order-health",
          label: "Order storage",
          kind: "status",
          actionId: "orderHealth",
        },
        {
          id: "shop-inventory-reservation-health",
          label: "Inventory reservation storage",
          kind: "status",
          actionId: "inventoryReservationHealth",
        },
        {
          id: "shop-fulfillment-health",
          label: "Fulfillment storage",
          kind: "status",
          actionId: "fulfillmentHealth",
        },
        {
          id: "shop-fulfillment-parcel-health",
          label: "Fulfillment parcel storage",
          kind: "status",
          actionId: "fulfillmentParcelHealth",
        },
        {
          id: "shop-carrier-booking-health",
          label: "Carrier booking contract",
          kind: "status",
          actionId: "carrierBookingHealth",
        },
        {
          id: "shop-carrier-pickup-availability-health",
          label: "Carrier pickup availability contract",
          kind: "status",
          actionId: "carrierPickupAvailabilityHealth",
        },
        {
          id: "shop-carrier-label-acquisition-health",
          label: "Carrier label acquisition contract",
          kind: "status",
          actionId: "carrierLabelAcquisitionHealth",
        },
        {
          id: "shop-carrier-pickup-health",
          label: "Carrier pickup contract",
          kind: "status",
          actionId: "carrierPickupHealth",
        },
        {
          id: "shop-tracking-event-health",
          label: "Carrier tracking contract",
          kind: "status",
          actionId: "trackingEventHealth",
        },
        {
          id: "shop-tracking-poll-health",
          label: "Carrier tracking polling",
          kind: "status",
          actionId: "trackingPollHealth",
        },
        {
          id: "shop-return-tracking-event-health",
          label: "Return tracking contract",
          kind: "status",
          actionId: "returnTrackingEventHealth",
        },
        {
          id: "shop-return-tracking-poll-health",
          label: "Return tracking polling",
          kind: "status",
          actionId: "returnTrackingPollHealth",
        },
        {
          id: "shop-payment-event-health",
          label: "Payment event contract",
          kind: "status",
          actionId: "paymentEventHealth",
        },
        {
          id: "shop-payment-adjustment-health",
          label: "Payment adjustment contract",
          kind: "status",
          actionId: "paymentAdjustmentHealth",
        },
        {
          id: "shop-refund-health",
          label: "Refund contract",
          kind: "status",
          actionId: "refundHealth",
        },
        {
          id: "shop-partial-refund-health",
          label: "Return partial refund contract",
          kind: "status",
          actionId: "partialRefundHealth",
        },
        {
          id: "shop-return-health",
          label: "Return contract",
          kind: "status",
          actionId: "returnHealth",
        },
        {
          id: "shop-exchange-health",
          label: "Same-item exchange contract",
          kind: "status",
          actionId: "exchangeHealth",
        },
        {
          id: "shop-return-logistics-health",
          label: "Return logistics contract",
          kind: "status" as const,
          actionId: "returnLogisticsHealth",
        },
        {
          id: "shop-return-postage-health",
          label: "Return-postage quote contract",
          kind: "status" as const,
          actionId: "returnPostageHealth",
        },
        ...(paymentAttemptApiHandler
          ? [
              {
                id: "shop-payment-attempt-health",
                label: "Payment initiation contract",
                kind: "status" as const,
                actionId: "paymentAttemptHealth",
              },
            ]
          : []),
      ],
      actions: [
        {
          id: "shop-restock-alert-reconcile",
          label: "Reconcile restock alerts",
          actionId: "reconcileRestockAlerts",
          confirm: "Process one bounded batch of active Shop restock alerts for this site?",
        },
        {
          id: "shop-price-alert-reconcile",
          label: "Reconcile price-drop alerts",
          actionId: "reconcilePriceAlerts",
          confirm: "Process one bounded batch of active Shop price-drop alerts for this site?",
        },
        {
          id: "shop-order-notification-reconcile",
          label: "Deliver order notifications",
          actionId: "reconcileOrderNotifications",
          confirm: "Process one bounded batch of pending Shop order notifications for this site?",
        },
        {
          id: "shop-order-notification-retry",
          label: "Retry attention order notifications",
          actionId: "retryOrderNotifications",
          confirm:
            "Reset one bounded batch of attention notifications? An ambiguous prior email delivery may be duplicated.",
        },
        {
          id: "shop-cart-cleanup",
          label: "Clean expired carts",
          actionId: "cleanupExpiredCarts",
          confirm: "Delete expired Shop carts for this site?",
        },
        {
          id: "shop-checkout-cleanup",
          label: "Clean expired checkout intents",
          actionId: "cleanupExpiredCheckoutIntents",
          confirm: "Delete expired Shop checkout intents for this site?",
        },
        {
          id: "shop-order-draft-cleanup",
          label: "Clean expired private order drafts",
          actionId: "cleanupExpiredOrderDrafts",
          confirm:
            "Permanently delete expired Shop order drafts and their private customer/shipping data for this site?",
        },
        {
          id: "shop-order-maintenance",
          label: "Maintain pending orders",
          actionId: "maintainOrders",
          confirm:
            "Cancel expired pending orders, permanently delete their private data, and purge commercial snapshots past 365 days?",
        },
      ],
      tables: [
        {
          id: "shop-order-notifications",
          label: "Recent order notifications (recipient withheld)",
          columns: [
            { name: "eventId", label: "Event" },
            { name: "orderId", label: "Order" },
            { name: "kind", label: "Kind" },
            { name: "status", label: "Status" },
            { name: "inboxStatus", label: "Inbox" },
            { name: "emailStatus", label: "Email" },
            { name: "attempts", label: "Attempts" },
            { name: "occurredAt", label: "Occurred" },
            { name: "lastErrorCode", label: "Error" },
          ],
          rowsActionId: "recentOrderNotifications",
          emptyMessage: "No Shop order notification event exists for this site.",
        },
        {
          id: "shop-product-reviews",
          label: "Recent verified-purchase reviews",
          columns: [
            { name: "title", label: "Review" },
            { name: "productId", label: "Product" },
            { name: "rating", label: "Rating" },
            { name: "state", label: "State" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentProductReviews",
          rowActions: [
            {
              id: "hide-review",
              label: "Hide",
              actionId: "hideProductReview",
              rowFields: ["id", "title"],
              visibleWhen: { field: "state", oneOf: ["published"] },
              fields: [
                {
                  name: "reason",
                  label: "Moderation reason",
                  type: "textarea",
                  required: true,
                  placeholder: "PII-free reason, 1–1000 characters",
                },
              ],
              confirm: "Hide this verified-purchase review from every public aggregate and list?",
            },
            {
              id: "restore-review",
              label: "Restore",
              actionId: "restoreProductReview",
              rowFields: ["id", "title"],
              visibleWhen: { field: "state", oneOf: ["hidden"] },
              confirm: "Restore this review to the public aggregate and list?",
            },
          ],
          emptyMessage: "No verified-purchase product reviews exist for this site.",
        },
        {
          id: "shop-recent-orders",
          label: "Recent orders (private values withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "revision", label: "Revision" },
            { name: "status", label: "Status" },
            { name: "total", label: "Total" },
            { name: "units", label: "Units" },
            { name: "privateData", label: "Private data" },
            { name: "inventory", label: "Inventory" },
            { name: "fulfillment", label: "Fulfillment" },
            { name: "refund", label: "Refund" },
            { name: "returnRequest", label: "Return" },
            { name: "createdAt", label: "Created" },
          ],
          rowsActionId: "recentOrders",
          rowActions: runtime.paymentRefundAdapter
            ? [
                {
                  id: "full-refund",
                  label: "Full refund",
                  actionId: "refundOrder",
                  rowFields: ["id", "revision"],
                  visibleWhen: { field: "status", oneOf: ["paid"] },
                  fields: [
                    {
                      name: "reason",
                      label: "Refund reason",
                      type: "textarea" as const,
                      required: true,
                      placeholder: "PII-free provider cancellation reason",
                    },
                  ],
                  confirm:
                    "Cancel the entire provider payment? Unshipped tracked inventory is restored only when the exact catalog rows still match.",
                  description:
                    "This action refunds the complete payment. Use a received return for the bounded partial-refund flow.",
                },
              ]
            : [],
          emptyMessage: "No durable Shop orders exist for this site.",
        },
        {
          id: "shop-fulfillments",
          label: "Paid order fulfillment (private values withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "status", label: "Status" },
            { name: "fulfillmentRevision", label: "Revision" },
            { name: "parcels", label: "Parcels" },
            { name: "parcelRevision", label: "Parcel revision" },
            { name: "privateData", label: "Private data" },
            { name: "carrier", label: "Carrier" },
            { name: "trackingNumber", label: "Tracking" },
            { name: "operatorNote", label: "Operations note" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentFulfillments",
          rowActions: [
            {
              id: "read-private",
              label: "View shipping data",
              actionId: "readFulfillmentPrivate",
              rowFields: ["id", "fulfillmentRevision"],
              visibleWhen: { field: "privateData", oneOf: ["retained"] },
              result: "details",
              confirm: "View retained customer and shipping data? This access is audited.",
              description:
                "Available only before shipment and the 30-day maximum retention deadline.",
            },
            {
              id: "process",
              label: "Start processing",
              actionId: "processFulfillment",
              rowFields: ["id", "fulfillmentRevision"],
              visibleWhen: { field: "status", oneOf: ["awaiting"] },
              fields: [
                {
                  name: "operatorNote",
                  label: "Operations note",
                  type: "textarea",
                  placeholder: "Optional PII-free internal note",
                },
              ],
              confirm: "Move this fulfillment to processing?",
            },
            {
              id: "save-parcels",
              label: "Save parcel snapshot",
              actionId: "saveFulfillmentParcels",
              rowFields: ["id", "fulfillmentRevision", "parcelRevision"],
              visibleWhen: { field: "status", oneOf: ["processing"] },
              fields: [
                {
                  name: "parcels",
                  label: "Parcels JSON",
                  type: "textarea",
                  required: true,
                  placeholder:
                    '[{"id":"parcel-1","lengthMm":300,"widthMm":200,"heightMm":100,"weightGrams":1500,"items":[{"lineKey":"…","quantity":1}]}]',
                },
              ],
              confirm:
                "Save this exact PII-free parcel allocation? Every immutable order line and quantity must be covered.",
              description:
                "Editable until carrier booking starts; parcel-aware carriers lock this snapshot to the durable shipment UUID.",
            },
            ...(runtime.carrierAdapter
              ? [
                  {
                    id: "book-carrier",
                    label: "Book carrier shipment",
                    actionId: "bookCarrierShipment",
                    rowFields: ["id", "fulfillmentRevision"],
                    visibleWhen: { field: "status", oneOf: ["processing"] },
                    fields: [
                      {
                        name: "operatorNote",
                        label: "Operations note",
                        type: "textarea" as const,
                        placeholder: "Optional PII-free internal note",
                      },
                    ],
                    confirm:
                      "Send the retained shipping destination to the configured carrier, then mark the fulfillment shipped and permanently delete private data?",
                  },
                ]
              : [
                  {
                    id: "ship",
                    label: "Mark shipped",
                    actionId: "shipFulfillment",
                    rowFields: ["id", "fulfillmentRevision"],
                    visibleWhen: { field: "status", oneOf: ["awaiting", "processing"] },
                    fields: [
                      { name: "carrier", label: "Carrier", type: "text" as const, required: true },
                      {
                        name: "trackingNumber",
                        label: "Tracking number",
                        type: "text" as const,
                        required: true,
                      },
                      {
                        name: "operatorNote",
                        label: "Operations note",
                        type: "textarea" as const,
                        placeholder: "Optional PII-free internal note",
                      },
                    ],
                    confirm:
                      "Mark this fulfillment shipped and permanently delete retained customer and shipping data?",
                  },
                ]),
          ],
          emptyMessage: "No paid order fulfillment records exist for this site.",
        },
        {
          id: "shop-fulfillment-parcels",
          label: "Fulfillment parcels (PII-free)",
          columns: [
            { name: "id", label: "Order" },
            { name: "fulfillmentRevision", label: "Fulfillment revision" },
            { name: "parcelRevision", label: "Parcel revision" },
            { name: "status", label: "Status" },
            { name: "parcelCount", label: "Parcels" },
            { name: "units", label: "Units" },
            { name: "weightGrams", label: "Weight (g)" },
            { name: "shipmentId", label: "Locked shipment" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentFulfillmentParcels",
          emptyMessage: "No fulfillment parcel snapshots exist for this site.",
        },
        {
          id: "shop-carrier-bookings",
          label: "Carrier shipment bookings (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "shipmentId", label: "Shipment" },
            { name: "provider", label: "Provider" },
            { name: "status", label: "Status" },
            { name: "fulfillmentRevision", label: "Fulfillment revision" },
            { name: "carrier", label: "Carrier" },
            { name: "trackingNumber", label: "Tracking" },
            { name: "providerError", label: "Closed error" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentCarrierBookings",
          rowActions: [
            {
              id: "resume-carrier-booking",
              label: "Resume booking",
              actionId: "bookCarrierShipment",
              rowFields: ["id", "fulfillmentRevision"],
              visibleWhen: { field: "status", oneOf: ["pending", "provider-confirmed"] },
              fields: [
                {
                  name: "operatorNote",
                  label: "Operations note",
                  type: "textarea",
                  placeholder: "Optional PII-free internal note",
                },
              ],
              confirm:
                "Resume this durable shipment? Provider-confirmed rows perform only local completion.",
            },
            ...(runtime.carrierTrackingPollAdapter
              ? [
                  {
                    id: "poll-carrier-tracking",
                    label: "Poll tracking now",
                    actionId: "reconcileCarrierTracking",
                    rowFields: ["id", "shipmentId"],
                    visibleWhen: { field: "status", oneOf: ["completed"] },
                    confirm:
                      "Read this shipment from the configured carrier now? The provider call and staff action are audited without shipping PII.",
                  },
                ]
              : []),
            ...(runtime.carrierLabelAdapter
              ? [
                  {
                    type: "download" as const,
                    id: "download-shipping-label",
                    label: "Download label",
                    routePath: "/carrier/shipping-label",
                    query: [
                      { name: "orderId", rowField: "id" },
                      { name: "shipmentId", rowField: "shipmentId" },
                    ],
                    visibleWhen: runtime.carrierLabelAcquisitionAdapter
                      ? { field: "labelAction", oneOf: ["regenerate"] }
                      : { field: "status", oneOf: ["completed"] },
                    description:
                      "Retrieve the current label from the carrier without storing its bytes in NexPress.",
                  },
                ]
              : []),
            ...(runtime.carrierLabelAcquisitionAdapter
              ? [
                  {
                    id: "purchase-shipping-label",
                    label: "Purchase label",
                    actionId: "acquireCarrierShippingLabel",
                    rowFields: ["id", "shipmentId", "target", "exchangeId", "expectedRevision"],
                    visibleWhen: { field: "labelAction", oneOf: ["purchase"] },
                    confirm:
                      "Purchase the first label for this exact booking? Provider charges remain provider-owned.",
                  },
                  {
                    id: "regenerate-shipping-label",
                    label: "Regenerate label",
                    actionId: "acquireCarrierShippingLabel",
                    rowFields: ["id", "shipmentId", "target", "exchangeId", "expectedRevision"],
                    visibleWhen: { field: "labelAction", oneOf: ["regenerate"] },
                    confirm:
                      "Atomically replace the current provider label? The previous label reference will no longer be current.",
                  },
                  {
                    id: "resume-shipping-label",
                    label: "Resume label acquisition",
                    actionId: "acquireCarrierShippingLabel",
                    rowFields: ["id", "shipmentId", "target", "exchangeId", "expectedRevision"],
                    visibleWhen: { field: "labelAction", oneOf: ["resume"] },
                    confirm:
                      "Resume this stable label acquisition? Provider-confirmed rows perform only local completion.",
                  },
                ]
              : []),
            ...(runtime.carrierPickupAdapter && runtime.carrierParcelAdapter
              ? [
                  {
                    id: runtime.carrierPickupAvailabilityAdapter
                      ? "list-carrier-pickup-windows"
                      : "schedule-carrier-pickup",
                    label: runtime.carrierPickupAvailabilityAdapter
                      ? "Load pickup windows"
                      : "Schedule pickup",
                    actionId: runtime.carrierPickupAvailabilityAdapter
                      ? "listCarrierPickupWindows"
                      : "scheduleCarrierPickup",
                    rowFields: ["id", "shipmentId", "pickupTarget", "exchangeId", "pickupRevision"],
                    visibleWhen: { field: "pickupAction", oneOf: ["schedule"] },
                    ...(runtime.carrierPickupAvailabilityAdapter
                      ? {}
                      : {
                          fields: [
                            {
                              name: "readyAt",
                              label: "Ready at (UTC ISO)",
                              type: "text" as const,
                              required: true,
                              placeholder: "YYYY-MM-DDTHH:mm:ss.sssZ",
                            },
                            {
                              name: "closeAt",
                              label: "Close at (UTC ISO)",
                              type: "text" as const,
                              required: true,
                              placeholder: "YYYY-MM-DDTHH:mm:ss.sssZ",
                            },
                          ],
                        }),
                    confirm: runtime.carrierPickupAvailabilityAdapter
                      ? "Load live provider pickup windows for this exact shipment and parcel snapshot?"
                      : "Schedule carrier pickup for the exact shipment parcel snapshot in this UTC window?",
                  },
                ]
              : []),
          ],
          emptyMessage: "No carrier shipment booking exists for this site.",
        },
        {
          id: "shop-carrier-label-acquisitions",
          label: "Carrier label acquisitions (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "acquisitionId", label: "Acquisition" },
            { name: "shipmentId", label: "Shipment" },
            { name: "target", label: "Shipment kind" },
            { name: "exchangeId", label: "Exchange" },
            { name: "provider", label: "Provider" },
            { name: "status", label: "Status" },
            { name: "operation", label: "Operation" },
            { name: "generation", label: "Generation" },
            { name: "labelReference", label: "Opaque label reference" },
            { name: "providerError", label: "Closed error" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentCarrierLabelAcquisitions",
          rowActions: runtime.carrierLabelAcquisitionAdapter
            ? [
                {
                  id: "resume-carrier-label-acquisition",
                  label: "Resume acquisition",
                  actionId: "acquireCarrierShippingLabel",
                  rowFields: ["id", "shipmentId", "target", "exchangeId", "expectedRevision"],
                  visibleWhen: { field: "status", oneOf: ["pending", "provider-confirmed"] },
                  confirm:
                    "Resume this stable label acquisition? Provider-confirmed rows perform only local completion.",
                },
              ]
            : [],
          emptyMessage: "No durable carrier label acquisition exists for this site.",
        },
        {
          id: "shop-carrier-pickup-availability",
          label: "Carrier pickup windows (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "shipmentId", label: "Shipment" },
            { name: "pickupTarget", label: "Shipment kind" },
            { name: "exchangeId", label: "Exchange" },
            { name: "provider", label: "Provider" },
            { name: "windowId", label: "Provider window" },
            { name: "window", label: "UTC window" },
            { name: "packages", label: "Packages" },
            { name: "weightGrams", label: "Weight (g)" },
            { name: "expiresAt", label: "Selection expires" },
          ],
          rowsActionId: "recentCarrierPickupAvailability",
          rowActions: runtime.carrierPickupAvailabilityAdapter
            ? [
                {
                  id: "schedule-carrier-pickup-window",
                  label: "Schedule this window",
                  actionId: "scheduleCarrierPickupWindow",
                  rowFields: [
                    "id",
                    "shipmentId",
                    "pickupTarget",
                    "exchangeId",
                    "pickupRevision",
                    "availabilityId",
                    "availabilityRevision",
                    "windowId",
                  ],
                  confirm:
                    "Schedule pickup using this exact short-lived provider window and parcel snapshot?",
                },
              ]
            : [],
          emptyMessage: "No live carrier pickup window exists for this site.",
        },
        {
          id: "shop-carrier-pickups",
          label: "Carrier pickup attempts (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "pickupId", label: "Pickup" },
            { name: "shipmentId", label: "Shipment" },
            { name: "pickupTarget", label: "Shipment kind" },
            { name: "exchangeId", label: "Exchange" },
            { name: "provider", label: "Provider" },
            { name: "status", label: "Status" },
            { name: "window", label: "UTC window" },
            { name: "packages", label: "Packages" },
            { name: "weightGrams", label: "Weight (g)" },
            { name: "providerError", label: "Closed error" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentCarrierPickups",
          rowActions: runtime.carrierPickupAdapter
            ? [
                {
                  id: "resume-carrier-pickup",
                  label: "Resume pickup",
                  actionId: "resumeCarrierPickup",
                  rowFields: [
                    "id",
                    "shipmentId",
                    "pickupTarget",
                    "exchangeId",
                    "pickupId",
                    "pickupRevision",
                  ],
                  visibleWhen: {
                    field: "status",
                    oneOf: ["pending", "provider-confirmed"],
                  },
                  confirm:
                    "Resume this pickup? Provider-confirmed rows perform only local completion.",
                },
                {
                  id: "cancel-carrier-pickup",
                  label: "Cancel pickup",
                  actionId: "cancelCarrierPickup",
                  rowFields: [
                    "id",
                    "shipmentId",
                    "pickupTarget",
                    "exchangeId",
                    "pickupId",
                    "pickupRevision",
                  ],
                  visibleWhen: {
                    field: "status",
                    oneOf: ["scheduled", "cancel-pending", "cancel-confirmed"],
                  },
                  confirm:
                    "Cancel this pickup? Cancellation is blocked after verified tracking begins.",
                },
              ]
            : [],
          emptyMessage: "No carrier pickup attempt exists for this site.",
        },
        {
          id: "shop-tracking-events",
          label: "Recent verified carrier tracking events (PII withheld)",
          columns: [
            { name: "provider", label: "Provider" },
            { name: "shipment", label: "Shipment kind" },
            { name: "eventId", label: "Event" },
            { name: "shipmentId", label: "Shipment" },
            { name: "orderId", label: "Order" },
            { name: "status", label: "Status" },
            { name: "outcome", label: "Outcome" },
            { name: "occurredAt", label: "Occurred" },
            { name: "processedAt", label: "Processed" },
          ],
          rowsActionId: "recentTrackingEvents",
          emptyMessage: "No verified carrier tracking event exists for this site.",
        },
        {
          id: "shop-tracking-polls",
          label: "Carrier tracking poll state (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "shipmentId", label: "Shipment" },
            { name: "shipment", label: "Shipment kind" },
            { name: "provider", label: "Provider" },
            { name: "failures", label: "Failures" },
            { name: "lastAttemptAt", label: "Last attempt" },
            { name: "lastSuccessAt", label: "Last success" },
            { name: "nextAttemptAt", label: "Next attempt" },
            { name: "lastError", label: "Closed error" },
            { name: "lease", label: "Lease" },
          ],
          rowsActionId: "recentTrackingPolls",
          rowActions: runtime.carrierTrackingPollAdapter
            ? [
                {
                  id: "retry-tracking-poll",
                  label: "Poll now",
                  actionId: "reconcileCarrierTracking",
                  rowFields: ["id", "shipmentId"],
                  confirm:
                    "Bypass this shipment's backoff and read it from the configured carrier now?",
                },
              ]
            : [],
          emptyMessage: "No carrier tracking poll attempt exists for this site.",
        },
        {
          id: "shop-return-tracking-events",
          label: "Recent verified return tracking events (PII withheld)",
          columns: [
            { name: "provider", label: "Provider" },
            { name: "eventId", label: "Event" },
            { name: "logisticsId", label: "Logistics" },
            { name: "returnId", label: "Return" },
            { name: "orderId", label: "Order" },
            { name: "status", label: "Status" },
            { name: "outcome", label: "Outcome" },
            { name: "occurredAt", label: "Occurred" },
            { name: "processedAt", label: "Processed" },
          ],
          rowsActionId: "recentReturnTrackingEvents",
          emptyMessage: "No verified return tracking event exists for this site.",
        },
        {
          id: "shop-return-tracking-polls",
          label: "Return tracking poll state (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "returnId", label: "Return" },
            { name: "logisticsId", label: "Logistics" },
            { name: "provider", label: "Provider" },
            { name: "failures", label: "Failures" },
            { name: "lastAttemptAt", label: "Last attempt" },
            { name: "lastSuccessAt", label: "Last success" },
            { name: "nextAttemptAt", label: "Next attempt" },
            { name: "lastError", label: "Closed error" },
            { name: "lease", label: "Lease" },
          ],
          rowsActionId: "recentReturnTrackingPolls",
          rowActions: runtime.carrierReturnTrackingPollAdapter
            ? [
                {
                  id: "retry-return-tracking-poll",
                  label: "Poll now",
                  actionId: "reconcileCarrierReturnTracking",
                  rowFields: ["id", "returnId", "logisticsId"],
                  confirm:
                    "Bypass this return shipment's backoff and read it from the configured carrier now?",
                },
              ]
            : [],
          emptyMessage: "No return tracking poll attempt exists for this site.",
        },
        {
          id: "shop-inventory-reservations",
          label: "Active inventory reservations (PII withheld)",
          columns: [
            { name: "orderId", label: "Order" },
            { name: "productId", label: "Product" },
            { name: "variantSku", label: "Variant SKU" },
            { name: "quantity", label: "Quantity" },
            { name: "expiresAt", label: "Expires" },
          ],
          rowsActionId: "recentInventoryReservations",
          emptyMessage: "No active tracked-inventory reservations exist for this site.",
        },
        {
          id: "shop-payment-events",
          label: "Recent verified payment events (PII withheld)",
          columns: [
            { name: "provider", label: "Provider" },
            { name: "eventId", label: "Event" },
            { name: "type", label: "Type" },
            { name: "orderId", label: "Order" },
            { name: "outcome", label: "Outcome" },
            { name: "orderStatus", label: "Order status" },
            { name: "processedAt", label: "Processed" },
          ],
          rowsActionId: "recentPaymentEvents",
          emptyMessage: "No verified Shop payment events exist for this site.",
        },
        {
          id: "shop-payment-adjustments",
          label: "Recent provider payment adjustments (PII withheld)",
          columns: [
            { name: "provider", label: "Provider" },
            { name: "eventId", label: "Event" },
            { name: "orderId", label: "Order" },
            { name: "reversed", label: "Reversed" },
            { name: "remaining", label: "Remaining" },
            { name: "cancellations", label: "Cancellations" },
            { name: "outcome", label: "Outcome" },
            { name: "orderStatus", label: "Order status" },
            { name: "processedAt", label: "Processed" },
          ],
          rowsActionId: "recentPaymentAdjustments",
          emptyMessage: "No provider-initiated Shop payment adjustment exists for this site.",
        },
        {
          id: "shop-refunds",
          label: "Full refunds and compensation (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "refundId", label: "Refund" },
            { name: "revision", label: "Order revision" },
            { name: "provider", label: "Provider" },
            { name: "status", label: "Status" },
            { name: "total", label: "Amount" },
            { name: "inventory", label: "Inventory" },
            { name: "fulfillment", label: "Fulfillment" },
            { name: "providerError", label: "Provider error" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentRefunds",
          rowActions: [
            {
              id: "resume-full-refund",
              label: "Resume reconciliation",
              actionId: "refundOrder",
              rowFields: ["id", "revision"],
              visibleWhen: { field: "status", oneOf: ["pending", "provider-confirmed"] },
              fields: [
                {
                  name: "reason",
                  label: "Original refund reason",
                  type: "textarea",
                  required: true,
                  placeholder: "Re-enter the PII-free reason; the durable original is preserved",
                },
              ],
              confirm:
                "Resume this durable full refund? A provider-confirmed row performs only local reconciliation.",
            },
          ],
          emptyMessage: "No Shop full-refund attempt exists for this site.",
        },
        {
          id: "shop-partial-refunds",
          label: "Return-linked partial refunds (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "refundId", label: "Refund" },
            { name: "returnId", label: "Return" },
            { name: "orderRevision", label: "Order revision" },
            { name: "provider", label: "Provider" },
            { name: "status", label: "Status" },
            { name: "itemAmount", label: "Items" },
            { name: "shippingAmount", label: "Shipping" },
            { name: "taxAmount", label: "Tax" },
            { name: "responsibility", label: "Return postage responsibility" },
            { name: "returnPostage", label: "Quoted return postage" },
            { name: "postageDeduction", label: "Postage deduction" },
            { name: "total", label: "Total" },
            { name: "providerError", label: "Provider error" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentPartialRefunds",
          rowActions: [
            {
              id: "resume-partial-refund",
              label: "Resume reconciliation",
              actionId: "partialRefundReturn",
              rowFields: ["id", "orderRevision", "returnId", "returnRevision"],
              visibleWhen: {
                field: "actionKind",
                oneOf: ["partial-refund"],
              },
              fields: [
                {
                  name: "shippingMinor",
                  label: "Original shipping refund",
                  type: "text" as const,
                  required: true,
                  placeholder: "Re-enter the original minor-unit amount",
                },
                {
                  name: "taxMinor",
                  label: "Original tax refund",
                  type: "text" as const,
                  required: true,
                  placeholder: "Re-enter the original minor-unit amount",
                },
                {
                  name: "reason",
                  label: "Original refund reason",
                  type: "textarea" as const,
                  required: true,
                  placeholder: "The durable original is preserved",
                },
              ],
              confirm:
                "Resume this durable partial refund? A provider-confirmed row performs only local reconciliation; a pending row still requires its original adapter.",
            },
            ...(runtime.paymentReturnSettlementAdapter
              ? [
                  {
                    id: "resume-return-postage-settlement-refund",
                    label: "Resume postage settlement refund",
                    actionId: "returnPostageSettlementRefund",
                    rowFields: ["id", "orderRevision", "returnId", "returnRevision"],
                    visibleWhen: {
                      field: "actionKind",
                      oneOf: ["return-postage-settlement"],
                    },
                    fields: [
                      {
                        name: "responsibility",
                        label: "Original postage responsibility",
                        type: "select" as const,
                        required: true,
                        options: [
                          { label: "Merchant absorbs postage", value: "merchant" },
                          { label: "Deduct postage from customer refund", value: "customer" },
                        ],
                      },
                      {
                        name: "shippingMinor",
                        label: "Original outbound shipping refund",
                        type: "text" as const,
                        required: true,
                        placeholder: "Re-enter the original minor-unit amount",
                      },
                      {
                        name: "taxMinor",
                        label: "Original additional-tax refund",
                        type: "text" as const,
                        required: true,
                        placeholder: "Re-enter the original minor-unit amount",
                      },
                      {
                        name: "reason",
                        label: "Original refund reason",
                        type: "textarea" as const,
                        required: true,
                        placeholder: "The durable original is preserved",
                      },
                    ],
                    confirm:
                      "Resume this exact quote-backed postage settlement refund? The durable responsibility and quote remain authoritative.",
                  },
                ]
              : []),
          ],
          emptyMessage: "No return-linked partial refund exists for this site.",
        },
        {
          id: "shop-returns",
          label: "Physical returns and receipt inventory (shipping/payment PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "returnId", label: "Return" },
            { name: "status", label: "Status" },
            { name: "returnRevision", label: "Return revision" },
            { name: "orderRevision", label: "Order revision" },
            { name: "reason", label: "Reason" },
            { name: "detail", label: "Request detail" },
            { name: "units", label: "Units" },
            { name: "inventory", label: "Inventory" },
            { name: "operatorNote", label: "Operations note" },
            { name: "postageSettlement", label: "Postage settlement" },
            { name: "exchange", label: "Same-item exchange" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentReturns",
          rowActions: [
            {
              id: "approve-return",
              label: "Approve return",
              actionId: "approveReturn",
              rowFields: ["id", "returnRevision"],
              visibleWhen: { field: "status", oneOf: ["requested"] },
              fields: [
                {
                  name: "operatorNote",
                  label: "Operations note",
                  type: "textarea",
                  placeholder: "Optional PII-free receiving instructions",
                },
              ],
              confirm: "Approve this physical return request without issuing a payment refund?",
            },
            {
              id: "reject-return",
              label: "Reject return",
              actionId: "rejectReturn",
              rowFields: ["id", "returnRevision"],
              visibleWhen: { field: "status", oneOf: ["requested"] },
              fields: [
                {
                  name: "operatorNote",
                  label: "Rejection reason",
                  type: "textarea",
                  required: true,
                  placeholder: "Required PII-free reason",
                },
              ],
              confirm: "Reject this return request?",
            },
            {
              id: "receive-return",
              label: "Confirm receipt",
              actionId: "receiveReturn",
              rowFields: ["id", "returnRevision"],
              visibleWhen: { field: "status", oneOf: ["approved"] },
              fields: [
                {
                  name: "operatorNote",
                  label: "Receipt note",
                  type: "textarea",
                  placeholder: "Optional PII-free inspection note",
                },
              ],
              confirm:
                "Confirm every requested unit was received? Tracked inventory is restored atomically only when all exact catalog rows still match.",
            },
            {
              id: "create-exchange",
              label: "Create same-item exchange",
              actionId: "createExchange",
              rowFields: ["id", "orderRevision", "returnId", "returnRevision"],
              visibleWhen: { field: "exchange", oneOf: ["eligible"] },
              fields: [
                {
                  name: "operatorNote",
                  label: "Operations note",
                  type: "textarea",
                  placeholder: "Optional PII-free replacement note",
                },
              ],
              confirm:
                "Consume the exact same tracked item and quantity for one replacement? No refund, payment difference, address, or carrier booking is created.",
            },
            ...(runtime.paymentPartialRefundAdapter
              ? [
                  {
                    id: "partial-refund-return",
                    label: "Refund returned items",
                    actionId: "partialRefundReturn",
                    rowFields: ["id", "orderRevision", "returnId", "returnRevision"],
                    visibleWhen: { field: "status", oneOf: ["received"] },
                    fields: [
                      {
                        name: "shippingMinor",
                        label: "Shipping refund (minor units)",
                        type: "text" as const,
                        required: true,
                        placeholder: "0",
                      },
                      {
                        name: "taxMinor",
                        label: "Additional-tax refund (minor units)",
                        type: "text" as const,
                        required: true,
                        placeholder: "0",
                      },
                      {
                        name: "reason",
                        label: "Provider refund reason",
                        type: "textarea" as const,
                        required: true,
                        placeholder: "PII-free reason, at most 200 characters",
                      },
                    ],
                    confirm:
                      "Refund the original price of every received return line plus the explicit shipping and tax amounts? This does not change fulfillment or inventory.",
                    description:
                      "The computed total must remain smaller than the complete order payment.",
                  },
                ]
              : []),
            ...(runtime.paymentReturnSettlementAdapter
              ? [
                  {
                    id: "return-postage-settlement-refund",
                    label: "Settle return postage and refund",
                    actionId: "returnPostageSettlementRefund",
                    rowFields: ["id", "orderRevision", "returnId", "returnRevision"],
                    visibleWhen: { field: "postageSettlement", oneOf: ["eligible"] },
                    fields: [
                      {
                        name: "responsibility",
                        label: "Return-postage responsibility",
                        type: "select" as const,
                        required: true,
                        options: [
                          { label: "Merchant absorbs exact quoted postage", value: "merchant" },
                          {
                            label: "Deduct exact quoted postage from customer refund",
                            value: "customer",
                          },
                        ],
                      },
                      {
                        name: "shippingMinor",
                        label: "Refund outbound shipping (minor units)",
                        type: "text" as const,
                        required: true,
                        placeholder: "0",
                      },
                      {
                        name: "taxMinor",
                        label: "Refund additional tax (minor units)",
                        type: "text" as const,
                        required: true,
                        placeholder: "0",
                      },
                      {
                        name: "reason",
                        label: "Provider refund reason",
                        type: "textarea" as const,
                        required: true,
                        placeholder: "PII-free reason, at most 200 characters",
                      },
                    ],
                    confirm:
                      "Use the immutable carrier quote to settle return-postage responsibility and issue one net provider refund? This never creates a separate charge.",
                    description:
                      "Merchant responsibility deducts nothing; customer responsibility deducts the exact quote. The resulting refund must remain positive and below the full payment.",
                  },
                ]
              : []),
          ],
          emptyMessage: "No Shop physical return exists for this site.",
        },
        {
          id: "shop-exchanges",
          label: "Same-item replacement exchanges (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "exchangeId", label: "Exchange" },
            { name: "returnId", label: "Return" },
            { name: "status", label: "Status" },
            { name: "exchangeRevision", label: "Exchange revision" },
            { name: "orderRevision", label: "Order revision" },
            { name: "destination", label: "Replacement destination" },
            { name: "destinationRevision", label: "Destination revision" },
            { name: "destinationExpiresAt", label: "Destination expires" },
            { name: "carrierBooking", label: "Carrier booking" },
            { name: "bookingId", label: "Shipment" },
            { name: "bookingRevision", label: "Booking revision" },
            { name: "pickupStatus", label: "Replacement pickup" },
            { name: "provider", label: "Provider" },
            { name: "parcels", label: "Replacement parcels" },
            { name: "parcelRevision", label: "Parcel revision" },
            { name: "units", label: "Units" },
            { name: "inventory", label: "Inventory" },
            { name: "carrier", label: "Carrier" },
            { name: "trackingNumber", label: "Tracking" },
            { name: "trackingStatus", label: "Tracking status" },
            { name: "trackingShipmentId", label: "Tracked shipment" },
            { name: "operatorNote", label: "Operations note" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentExchanges",
          rowActions: [
            {
              id: "read-exchange-destination",
              label: "View replacement address",
              actionId: "readExchangeDestination",
              rowFields: [
                "id",
                "exchangeId",
                "orderRevision",
                "exchangeRevision",
                "destinationRevision",
              ],
              visibleWhen: { field: "destination", oneOf: ["submitted", "accessed"] },
              result: "details",
              confirm: "View this short-lived replacement address? Direct staff access is audited.",
              description:
                "The address is withheld from this table and deleted when processing begins or its 24-hour limit expires.",
            },
            {
              id: "process-exchange",
              label: "Start replacement",
              actionId: "processExchange",
              rowFields: ["id", "exchangeId", "exchangeRevision", "orderRevision"],
              visibleWhen: { field: "destination", oneOf: ["accessed"] },
              fields: [
                {
                  name: "operatorNote",
                  label: "Operations note",
                  type: "textarea",
                  placeholder: "Optional PII-free preparation note",
                },
              ],
              confirm: "Mark this exact replacement as processing?",
            },
            ...(runtime.carrierExchangeAdapter
              ? [
                  ...(runtime.carrierExchangeParcelAdapter
                    ? [
                        {
                          id: "save-exchange-parcels",
                          label: "Save replacement parcels",
                          actionId: "saveExchangeParcels",
                          rowFields: ["id", "exchangeId", "exchangeRevision", "parcelRevision"],
                          visibleWhen: { field: "destination", oneOf: ["accessed"] },
                          fields: [
                            {
                              name: "parcels",
                              label: "Parcels JSON",
                              type: "textarea" as const,
                              required: true,
                              placeholder:
                                '[{"id":"parcel-1","lengthMm":300,"widthMm":200,"heightMm":100,"weightGrams":1500,"items":[{"lineKey":"…","quantity":1}]}]',
                            },
                          ],
                          confirm:
                            "Save this exact PII-free replacement parcel allocation? Every immutable exchange line and quantity must be covered.",
                        },
                      ]
                    : []),
                  {
                    id: "book-exchange-carrier",
                    label: "Book replacement carrier",
                    actionId: "bookExchangeCarrier",
                    rowFields: [
                      "id",
                      "exchangeId",
                      "orderRevision",
                      "exchangeRevision",
                      "destinationRevision",
                    ],
                    visibleWhen: { field: "destination", oneOf: ["accessed"] },
                    fields: [
                      {
                        name: "operatorNote",
                        label: "Operations note",
                        type: "textarea" as const,
                        placeholder: "Optional PII-free provider booking note",
                      },
                    ],
                    confirm:
                      "Book this exact replacement with the configured carrier? The private address is deleted only after durable provider confirmation.",
                  },
                  {
                    id: "resume-exchange-carrier",
                    label: "Resume carrier booking",
                    actionId: "resumeExchangeCarrier",
                    rowFields: [
                      "id",
                      "exchangeId",
                      "orderRevision",
                      "exchangeRevision",
                      "bookingId",
                      "bookingRevision",
                    ],
                    visibleWhen: {
                      field: "carrierBooking",
                      oneOf: ["pending", "provider-confirmed"],
                    },
                    fields: [
                      {
                        name: "operatorNote",
                        label: "Operations note",
                        type: "textarea" as const,
                        placeholder: "Optional PII-free reconciliation note",
                      },
                    ],
                    confirm: "Resume this exact durable replacement booking?",
                  },
                  {
                    id: "ship-booked-exchange",
                    label: "Mark booked replacement shipped",
                    actionId: "shipBookedExchange",
                    rowFields: [
                      "id",
                      "exchangeId",
                      "orderRevision",
                      "exchangeRevision",
                      "bookingId",
                      "bookingRevision",
                    ],
                    visibleWhen: { field: "carrierBooking", oneOf: ["completed"] },
                    fields: [
                      {
                        name: "operatorNote",
                        label: "Shipment note",
                        type: "textarea" as const,
                        placeholder: "Optional PII-free handoff note",
                      },
                    ],
                    confirm:
                      "Mark this replacement shipped with the exact provider carrier and tracking number?",
                  },
                  ...(runtime.carrierPickupAdapter && runtime.carrierExchangeParcelAdapter
                    ? [
                        {
                          id: runtime.carrierPickupAvailabilityAdapter
                            ? "list-exchange-carrier-pickup-windows"
                            : "schedule-exchange-carrier-pickup",
                          label: runtime.carrierPickupAvailabilityAdapter
                            ? "Load replacement pickup windows"
                            : "Schedule replacement pickup",
                          actionId: runtime.carrierPickupAvailabilityAdapter
                            ? "listCarrierPickupWindows"
                            : "scheduleCarrierPickup",
                          rowFields: [
                            "id",
                            "shipmentId",
                            "pickupTarget",
                            "exchangeId",
                            "pickupRevision",
                          ],
                          visibleWhen: { field: "pickupAction", oneOf: ["schedule"] },
                          ...(runtime.carrierPickupAvailabilityAdapter
                            ? {}
                            : {
                                fields: [
                                  {
                                    name: "readyAt",
                                    label: "Ready at (UTC ISO)",
                                    type: "text" as const,
                                    required: true,
                                    placeholder: "YYYY-MM-DDTHH:mm:ss.sssZ",
                                  },
                                  {
                                    name: "closeAt",
                                    label: "Close at (UTC ISO)",
                                    type: "text" as const,
                                    required: true,
                                    placeholder: "YYYY-MM-DDTHH:mm:ss.sssZ",
                                  },
                                ],
                              }),
                          confirm: runtime.carrierPickupAvailabilityAdapter
                            ? "Load live provider pickup windows for this exact replacement parcel snapshot?"
                            : "Schedule carrier pickup for this exact replacement parcel snapshot?",
                        },
                      ]
                    : []),
                  {
                    id: "cancel-booked-exchange",
                    label: "Cancel booked replacement",
                    actionId: "cancelExchangeCarrier",
                    rowFields: [
                      "id",
                      "exchangeId",
                      "orderRevision",
                      "exchangeRevision",
                      "bookingId",
                      "bookingRevision",
                    ],
                    visibleWhen: {
                      field: "carrierBooking",
                      oneOf: ["completed", "cancel-pending", "cancel-confirmed"],
                    },
                    fields: [
                      {
                        name: "operatorNote",
                        label: "Cancellation note",
                        type: "textarea" as const,
                        placeholder: "Optional PII-free cancellation note",
                      },
                    ],
                    confirm:
                      "Cancel the provider shipment, then cancel the exchange and restore exact tracked inventory? Any verified tracking state blocks this action.",
                  },
                  ...(runtime.carrierTrackingPollAdapter
                    ? [
                        {
                          id: "poll-exchange-tracking",
                          label: "Poll replacement tracking",
                          actionId: "reconcileCarrierTracking",
                          rowFields: ["id", "shipmentId"],
                          visibleWhen: {
                            field: "carrierBooking",
                            oneOf: ["completed", "shipped"],
                          },
                          confirm:
                            "Read the latest state for this exact replacement shipment from the configured carrier?",
                        },
                      ]
                    : []),
                ]
              : []),
            ...(runtime.carrierLabelAcquisitionAdapter
              ? [
                  {
                    id: "purchase-exchange-shipping-label",
                    label: "Purchase replacement label",
                    actionId: "acquireCarrierShippingLabel",
                    rowFields: ["id", "shipmentId", "target", "exchangeId", "expectedRevision"],
                    visibleWhen: { field: "labelAction", oneOf: ["purchase"] },
                    confirm: "Purchase the first label for this exact replacement booking?",
                  },
                  {
                    id: "regenerate-exchange-shipping-label",
                    label: "Regenerate replacement label",
                    actionId: "acquireCarrierShippingLabel",
                    rowFields: ["id", "shipmentId", "target", "exchangeId", "expectedRevision"],
                    visibleWhen: { field: "labelAction", oneOf: ["regenerate"] },
                    confirm: "Atomically replace the current replacement label at the provider?",
                  },
                  {
                    id: "resume-exchange-shipping-label",
                    label: "Resume replacement label",
                    actionId: "acquireCarrierShippingLabel",
                    rowFields: ["id", "shipmentId", "target", "exchangeId", "expectedRevision"],
                    visibleWhen: { field: "labelAction", oneOf: ["resume"] },
                    confirm:
                      "Resume this stable replacement-label acquisition? Provider-confirmed rows perform only local completion.",
                  },
                ]
              : []),
            ...(runtime.carrierLabelAdapter
              ? [
                  {
                    type: "download" as const,
                    id: "download-exchange-shipping-label",
                    label: "Download replacement label",
                    routePath: "/carrier/shipping-label",
                    query: [
                      { name: "orderId", rowField: "id" },
                      { name: "shipmentId", rowField: "bookingId" },
                    ],
                    visibleWhen: runtime.carrierLabelAcquisitionAdapter
                      ? { field: "labelAction", oneOf: ["regenerate"] }
                      : { field: "carrierBooking", oneOf: ["completed", "shipped"] },
                    description:
                      "Retrieve the current replacement label from the carrier without storing its bytes in NexPress.",
                  },
                ]
              : []),
            {
              id: "ship-exchange",
              label: "Ship replacement",
              actionId: "shipExchange",
              rowFields: ["id", "exchangeId", "exchangeRevision", "orderRevision"],
              visibleWhen: { field: "status", oneOf: ["processing"] },
              fields: [
                { name: "carrier", label: "Carrier", type: "text", required: true },
                {
                  name: "trackingNumber",
                  label: "Tracking number",
                  type: "text",
                  required: true,
                },
                {
                  name: "operatorNote",
                  label: "Operations note",
                  type: "textarea",
                  placeholder: "Optional PII-free shipment note",
                },
              ],
              confirm:
                "Mark the replacement shipped with this manually verified carrier and tracking number?",
            },
            {
              id: "cancel-exchange",
              label: "Cancel replacement",
              actionId: "cancelExchange",
              rowFields: ["id", "exchangeId", "exchangeRevision", "orderRevision"],
              visibleWhen: { field: "status", oneOf: ["awaiting", "processing"] },
              fields: [
                {
                  name: "operatorNote",
                  label: "Cancellation note",
                  type: "textarea",
                  required: true,
                },
              ],
              confirm:
                "Cancel this unshipped replacement and restore every exact tracked unit atomically?",
            },
          ],
          emptyMessage: "No same-item exchange exists for this site.",
        },
        {
          id: "shop-return-logistics",
          label: "Return shipments and pickup (PII withheld)",
          columns: [
            { name: "id", label: "Order" },
            { name: "logisticsId", label: "Logistics" },
            { name: "returnId", label: "Return" },
            { name: "provider", label: "Provider" },
            { name: "mode", label: "Mode" },
            { name: "status", label: "Status" },
            { name: "carrier", label: "Carrier" },
            { name: "trackingNumber", label: "Tracking" },
            { name: "providerError", label: "Closed error" },
            { name: "privateOrigin", label: "Private origin" },
            { name: "updatedAt", label: "Updated" },
          ],
          rowsActionId: "recentReturnLogistics",
          emptyMessage: "No provider-backed return shipment exists for this site.",
        },
        {
          id: "shop-return-postage",
          label: "Recent return-postage quotes (PII withheld)",
          columns: [
            { name: "quoteId", label: "Quote" },
            { name: "returnId", label: "Return" },
            { name: "provider", label: "Provider" },
            { name: "status", label: "Status" },
            { name: "currency", label: "Currency" },
            { name: "amount", label: "Selected amount" },
            { name: "privateOrigin", label: "Private origin" },
            { name: "expiresAt", label: "Expires" },
          ],
          rowsActionId: "recentReturnPostage",
          emptyMessage: "No return-postage quote exists for this site.",
        },
        ...(paymentAttemptApiHandler
          ? [
              {
                id: "shop-payment-attempts",
                label: "Recent payment attempts (owner and handoff withheld)",
                columns: [
                  { name: "provider", label: "Provider" },
                  { name: "attemptId", label: "Attempt" },
                  { name: "orderId", label: "Order" },
                  { name: "status", label: "Status" },
                  { name: "total", label: "Total" },
                  { name: "createdAt", label: "Created" },
                ],
                rowsActionId: "recentPaymentAttempts",
                emptyMessage: "No Shop payment attempts exist for this site.",
              },
            ]
          : []),
      ],
    },
    actions: {
      countShippingPolicies: {
        kind: "metric",
        handler: async () => {
          try {
            const definitions = await npListShopShippingPolicies(runtime);
            return { ok: true, data: { value: definitions.length, delta: "published" } };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      shippingPolicyHealth: {
        kind: "status",
        handler: async () => {
          try {
            const inspection = await npInspectShopShippingPolicies(runtime);
            if (inspection.surchargeOnlyMethodCodes.length > 0) {
              return npAdminStatus(
                "error",
                `Shipping surcharge method(s) have no base rule: ${inspection.surchargeOnlyMethodCodes.join(", ")}.`,
              );
            }
            if (runtime.shippingAdapter && inspection.published > 0) {
              return npAdminStatus(
                "warn",
                `${inspection.published.toString()} local rule(s) are inactive while external provider ${runtime.shippingAdapter.id} is configured.`,
              );
            }
            if (inspection.published === 0) {
              return npAdminStatus(
                "ok",
                runtime.shippingAdapter
                  ? `External shipping provider ${runtime.shippingAdapter.id} is active.`
                  : "No shipping policies are published; checkout keeps the zero-shipping fallback.",
              );
            }
            return npAdminStatus(
              "ok",
              `${inspection.baseRules.toString()} base and ${inspection.surchargeRules.toString()} surcharge rule(s) across ${inspection.methodCodes.toString()} method(s).`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Shipping policy health check failed.",
            );
          }
        },
      },
      countPromotions: {
        kind: "metric",
        handler: async (_data, ctx) => {
          try {
            const result = await ctx.content.find(runtime.collections.promotions, {
              where: { status: "published", visibility: "*" },
              page: 1,
              limit: 1,
            });
            return { ok: true, data: { value: result.totalDocs, delta: "published" } };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      promotionHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopPromotionUsage();
            return counts.invalid > 0
              ? npAdminStatus(
                  "error",
                  `${counts.invalid.toString()} invalid promotion usage row(s).`,
                )
              : counts.truncated
                ? npAdminStatus(
                    "warn",
                    `Promotion usage diagnostics reached the ${npShopPromotionLimits.diagnosticSampleSize.toString()}-row sample bound.`,
                  )
                : npAdminStatus(
                    "ok",
                    `${counts.reserved.toString()} reserved, ${counts.redeemed.toString()} redeemed use(s) across ${counts.campaigns.toString()} campaign(s).`,
                  );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Promotion health check failed.",
            );
          }
        },
      },
      countProductReviews: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npInspectShopProductReviews(runtime);
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: `${counts.published.toString()} published, ${counts.hidden.toString()} hidden`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      productReviewHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npInspectShopProductReviews(runtime);
            return counts.invalid > 0
              ? npAdminStatus(
                  "error",
                  `${counts.invalid.toString()} malformed review row(s) fail the verified-purchase contract.`,
                )
              : counts.pending > 0
                ? npAdminStatus(
                    "warn",
                    `${counts.pending.toString()} review(s) await moderation; ${counts.hidden.toString()} are hidden.`,
                  )
                : npAdminStatus(
                    "ok",
                    `${counts.published.toString()} published verified-purchase review(s).`,
                  );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Product review health check failed.",
            );
          }
        },
      },
      recentProductReviews: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopProductReviews(runtime);
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      hideProductReview: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Review moderation requires a direct staff action." };
            }
            const input = npRequireShopProductReviewModerationActionInput(data, { reason: true });
            await npHideShopProductReview(
              runtime,
              input.reviewId,
              input.reason as string,
              ctx.actionInvocation.userId,
            );
            return { ok: true, data: "The review is hidden from public lists and aggregates." };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      restoreProductReview: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Review moderation requires a direct staff action." };
            }
            const input = npRequireShopProductReviewModerationActionInput(data, {
              reason: false,
            });
            await npRestoreShopProductReview(runtime, input.reviewId, ctx.actionInvocation.userId);
            return { ok: true, data: "The review is restored to public lists and aggregates." };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countProductWishlistSaves: {
        kind: "metric",
        handler: async () => {
          try {
            const total = await npCountShopWishlistSaves(runtime);
            return { ok: true, data: { value: total, delta: "member saves" } };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      wishlistHealth: {
        kind: "status",
        handler: async () => {
          try {
            const total = await npCountShopWishlistSaves(runtime);
            return npAdminStatus(
              "ok",
              `${total.toString()} site-scoped saved-product relation(s); generic follow integrity remains covered by plugin Doctor.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Wishlist health check failed.",
            );
          }
        },
      },
      countActiveRestockAlerts: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npInspectShopRestockAlerts(runtime);
            return {
              ok: true,
              data: {
                value: counts.active + counts.claimed,
                delta: `${counts.completed.toString()} completion receipt(s)`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      restockAlertHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npInspectShopRestockAlerts(runtime);
            if (counts.invalidSample > 0 || counts.orphanSample > 0) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed and ${counts.orphanSample.toString()} orphaned restock alert row(s) in the newest bounded sample.`,
              );
            }
            if (
              counts.readySample > 0 ||
              counts.staleClaimSample > 0 ||
              counts.expired > 0 ||
              counts.sampleBoundReached
            ) {
              return npAdminStatus(
                "warn",
                `${counts.readySample.toString()} ready, ${counts.staleClaimSample.toString()} stale-claimed, and ${counts.expired.toString()} expired row(s) await bounded reconciliation${counts.sampleBoundReached ? "; diagnostic sample bound reached" : ""}.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.active.toString()} active, ${counts.claimed.toString()} claimed, and ${counts.completed.toString()} retained completion receipt(s).`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Restock alert health check failed.",
            );
          }
        },
      },
      reconcileRestockAlerts: {
        kind: "action",
        handler: async () => {
          try {
            const result = await npProcessShopRestockAlerts(runtime);
            return {
              ok: true,
              data: `Inspected ${result.inspected.toString()}, notified ${result.notified.toString()}, suppressed ${result.suppressed.toString()}, retained ${result.unavailable.toString()} unavailable, removed ${result.orphaned.toString()} orphaned, found ${result.invalid.toString()} malformed, and cleaned ${result.cleaned.toString()} expired restock alert row(s).`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countActivePriceAlerts: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npInspectShopPriceAlerts(runtime);
            return {
              ok: true,
              data: {
                value: counts.active + counts.claimed,
                delta: `${counts.completed.toString()} completion receipt(s)`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      priceAlertHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npInspectShopPriceAlerts(runtime);
            if (counts.invalidSample > 0 || counts.orphanSample > 0) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed and ${counts.orphanSample.toString()} orphaned price alert row(s) in the newest bounded sample.`,
              );
            }
            if (
              counts.readySample > 0 ||
              counts.currencyMismatchSample > 0 ||
              counts.staleClaimSample > 0 ||
              counts.expired > 0 ||
              counts.sampleBoundReached
            ) {
              return npAdminStatus(
                "warn",
                `${counts.readySample.toString()} ready, ${counts.currencyMismatchSample.toString()} currency-mismatched, ${counts.staleClaimSample.toString()} stale-claimed, and ${counts.expired.toString()} expired row(s) await bounded reconciliation${counts.sampleBoundReached ? "; diagnostic sample bound reached" : ""}.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.active.toString()} active, ${counts.claimed.toString()} claimed, and ${counts.completed.toString()} retained completion receipt(s).`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Price alert health check failed.",
            );
          }
        },
      },
      reconcilePriceAlerts: {
        kind: "action",
        handler: async () => {
          try {
            const result = await npProcessShopPriceAlerts(runtime);
            return {
              ok: true,
              data: `Inspected ${result.inspected.toString()}, notified ${result.notified.toString()}, suppressed ${result.suppressed.toString()}, retained ${result.unchanged.toString()} unchanged and ${result.currencyMismatch.toString()} currency-mismatched, removed ${result.orphaned.toString()} orphaned, found ${result.invalid.toString()} malformed, and cleaned ${result.cleaned.toString()} expired price alert row(s).`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countOrderNotifications: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npInspectShopOrderNotifications();
            return {
              ok: true,
              data: {
                value: counts.pending + counts.claimed + counts.completed + counts.attention,
                delta: `${counts.pending.toString()} pending, ${counts.attention.toString()} attention`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      orderNotificationHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npInspectShopOrderNotifications();
            if (
              counts.invalidSample > 0 ||
              counts.invalidPrivateSample > 0 ||
              counts.orphanPrivateSample > 0 ||
              counts.attention > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed event(s), ${counts.invalidPrivateSample.toString()} malformed and ${counts.orphanPrivateSample.toString()} orphaned private row(s), and ${counts.attention.toString()} attention event(s).`,
              );
            }
            if (
              counts.pending > 0 ||
              counts.claimed > 0 ||
              counts.staleClaimSample > 0 ||
              counts.expiredPrivate > 0 ||
              counts.sampleBoundReached
            ) {
              return npAdminStatus(
                "warn",
                `${counts.pending.toString()} pending, ${counts.claimed.toString()} claimed, ${counts.staleClaimSample.toString()} stale lease(s), and ${counts.expiredPrivate.toString()} expired private recipient row(s) await bounded reconciliation${counts.sampleBoundReached ? "; diagnostic sample bound reached" : ""}.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.completed.toString()} completed order notification event(s).`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Order notification health check failed.",
            );
          }
        },
      },
      recentOrderNotifications: {
        kind: "table",
        handler: async () => {
          try {
            const rows = await npListRecentShopOrderNotifications();
            return npAdminTable(rows, rows.length);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      reconcileOrderNotifications: {
        kind: "action",
        handler: async () => {
          try {
            const result = await npProcessShopOrderNotifications(runtime.basePath);
            return {
              ok: true,
              data: `Inspected ${result.inspected.toString()}, completed ${result.completed.toString()}, deferred ${result.deferred.toString()}, moved ${result.attention.toString()} to attention, found ${result.invalid.toString()} malformed, and cleaned ${result.cleaned.toString()} expired row(s).`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      retryOrderNotifications: {
        kind: "action",
        handler: async (_data, ctx) => {
          if (ctx.actionInvocation?.kind !== "staff") {
            return { ok: false, error: "Order notification retry requires a direct staff action." };
          }
          try {
            const count = await npRetryShopOrderNotifications();
            return { ok: true, data: `Reset ${count.toString()} attention event(s).` };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countProducts: {
        kind: "metric",
        handler: async (_data, ctx) => {
          try {
            const total = await ctx.content.count(runtime.collections.products);
            return { ok: true, data: { value: total, delta: "all states" } };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      countLowStockProducts: {
        kind: "metric",
        handler: async (_data, ctx) => {
          try {
            const result = await ctx.content.find(runtime.collections.products, {
              where: { status: "published", inventoryState: "low-stock" },
              page: 1,
              limit: 1,
            });
            return { ok: true, data: { value: result.totalDocs, delta: "published" } };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      countActiveCarts: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopCarts();
            return {
              ok: true,
              data: { value: counts.active, delta: `${counts.expired.toString()} expired` },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      cartHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopCarts();
            return counts.invalid > 0
              ? npAdminStatus(
                  "error",
                  `${counts.invalid.toString()} invalid cart row(s); inspect storage before cleanup.`,
                )
              : counts.expired > 0
                ? npAdminStatus(
                    "warn",
                    `${counts.active.toString()} active, ${counts.expired.toString()} expired cart(s).`,
                  )
                : npAdminStatus("ok", `${counts.active.toString()} active cart(s).`);
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Cart health check failed.",
            );
          }
        },
      },
      cleanupExpiredCarts: {
        kind: "action",
        handler: async () => {
          try {
            const deleted = await npCleanupExpiredShopCarts();
            return { ok: true, data: `Deleted ${deleted.toString()} expired cart(s).` };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countActiveCheckoutIntents: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopCheckoutIntents();
            return {
              ok: true,
              data: { value: counts.active, delta: `${counts.expired.toString()} expired` },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      checkoutIntentHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopCheckoutIntents();
            return counts.invalid > 0
              ? npAdminStatus(
                  "error",
                  `${counts.invalid.toString()} invalid checkout intent row(s).`,
                )
              : counts.expired > 0
                ? npAdminStatus(
                    "warn",
                    `${counts.active.toString()} active, ${counts.cancelled.toString()} cancelled, ${counts.expired.toString()} expired intent(s).`,
                  )
                : npAdminStatus(
                    "ok",
                    `${counts.active.toString()} active, ${counts.cancelled.toString()} cancelled intent(s).`,
                  );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Checkout intent health check failed.",
            );
          }
        },
      },
      cleanupExpiredCheckoutIntents: {
        kind: "action",
        handler: async () => {
          try {
            const deleted = await npCleanupExpiredShopCheckoutIntents();
            return {
              ok: true,
              data: `Deleted ${deleted.toString()} expired checkout intent(s).`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countActiveOrderDrafts: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopOrderDrafts();
            return {
              ok: true,
              data: {
                value: counts.collecting + counts.shippingSelectionRequired + counts.reviewable,
                delta: `${counts.shippingSelectionRequired.toString()} awaiting delivery selection; ${counts.expired.toString()} expired; shipping ${shippingMode}; tax ${runtime.taxAdapter?.id ?? "disabled"}`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      orderDraftHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopOrderDrafts();
            const shippingHealth = runtime.shippingAdapter
              ? await npReadShopShippingHealth()
              : null;
            const taxHealth = runtime.taxAdapter ? await npReadShopTaxHealth() : null;
            if (
              shippingHealth &&
              (shippingHealth.providerId !== runtime.shippingAdapter?.id ||
                shippingHealth.status === "error")
            ) {
              return npAdminStatus(
                "error",
                `Shipping quote provider ${runtime.shippingAdapter?.id ?? "disabled"} last reported ${shippingHealth.errorCode ?? "provider mismatch"} at ${shippingHealth.attemptedAt}; no PII is retained in this diagnostic.`,
              );
            }
            if (
              taxHealth &&
              (taxHealth.providerId !== runtime.taxAdapter?.id || taxHealth.status === "error")
            ) {
              return npAdminStatus(
                "error",
                `Tax quote provider ${runtime.taxAdapter?.id ?? "disabled"} last reported ${taxHealth.errorCode ?? "provider mismatch"} at ${taxHealth.attemptedAt}; no PII is retained in this diagnostic.`,
              );
            }
            return counts.invalid > 0
              ? npAdminStatus(
                  "error",
                  `${counts.invalid.toString()} invalid private order draft row(s); values are withheld.`,
                )
              : counts.expired > 0
                ? npAdminStatus(
                    "warn",
                    `${counts.collecting.toString()} collecting, ${counts.shippingSelectionRequired.toString()} awaiting delivery selection, ${counts.reviewable.toString()} reviewable, ${counts.expired.toString()} expired draft(s); shipping ${shippingMode}; tax ${runtime.taxAdapter?.id ?? "disabled"}; values are withheld.`,
                  )
                : npAdminStatus(
                    "ok",
                    `${counts.collecting.toString()} collecting, ${counts.shippingSelectionRequired.toString()} awaiting delivery selection, ${counts.reviewable.toString()} reviewable private draft(s); shipping ${shippingMode}; tax ${runtime.taxAdapter?.id ?? "disabled"}; values are withheld.`,
                  );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Order draft health check failed.",
            );
          }
        },
      },
      cleanupExpiredOrderDrafts: {
        kind: "action",
        handler: async () => {
          try {
            const deleted = await npCleanupExpiredShopOrderDrafts();
            return {
              ok: true,
              data: `Permanently deleted ${deleted.toString()} expired private order draft(s).`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countOrders: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopOrders();
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: `${counts.pending.toString()} pending, ${counts.paid.toString()} paid, ${counts.paymentFailed.toString()} failed`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      orderHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopOrders();
            return counts.invalidSample > 0 || counts.invalidMetadata > 0
              ? npAdminStatus(
                  "error",
                  `${counts.invalidSample.toString()} malformed commercial row(s) in the newest bounded sample and ${counts.invalidMetadata.toString()} storage metadata issue(s); private values are withheld.`,
                )
              : counts.due > 0
                ? npAdminStatus(
                    "warn",
                    `${counts.pending.toString()} pending, ${counts.paid.toString()} paid, ${counts.paymentFailed.toString()} failed, ${counts.cancelled.toString()} cancelled, ${counts.due.toString()} due for maintenance; private values are withheld.`,
                  )
                : npAdminStatus(
                    "ok",
                    `${counts.pending.toString()} pending, ${counts.paid.toString()} paid, ${counts.paymentFailed.toString()} failed, ${counts.cancelled.toString()} cancelled order(s); private values are withheld.`,
                  );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Order health check failed.",
            );
          }
        },
      },
      countActiveInventoryReservations: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopInventoryReservations();
            return {
              ok: true,
              data: {
                value: counts.active,
                delta: `${counts.expired.toString()} expired`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      inventoryReservationHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopInventoryReservations();
            return counts.invalidSample > 0 || counts.orphanSample > 0 || counts.missingSample > 0
              ? npAdminStatus(
                  "error",
                  `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, and ${counts.missingSample.toString()} missing reservation row(s) in the newest bounded samples; owner and private values are withheld.`,
                )
              : counts.expired > 0
                ? npAdminStatus(
                    "warn",
                    `${counts.active.toString()} active and ${counts.expired.toString()} expired reservation(s) awaiting maintenance.`,
                  )
                : npAdminStatus(
                    "ok",
                    `${counts.active.toString()} active tracked-inventory reservation(s).`,
                  );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Inventory reservation health check failed.",
            );
          }
        },
      },
      recentInventoryReservations: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopInventoryReservations();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      recentOrders: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopOrders();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countRefunds: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopRefunds();
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: `${counts.refunded.toString()} completed, ${(counts.pending + counts.providerConfirmed).toString()} pending reconciliation`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countPartialRefunds: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopPartialRefunds();
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: `${counts.refunded.toString()} completed, ${(counts.pending + counts.providerConfirmed).toString()} pending reconciliation`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      refundHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopRefunds();
            if (counts.invalidSample > 0 || counts.orphanSample > 0) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed and ${counts.orphanSample.toString()} orphan refund row(s) in bounded samples.`,
              );
            }
            if (
              counts.manualReview > 0 ||
              counts.manualInventory > 0 ||
              counts.pending > 0 ||
              counts.providerConfirmed > 0
            ) {
              return npAdminStatus(
                "warn",
                `${counts.pending.toString()} provider-pending, ${counts.providerConfirmed.toString()} provider-confirmed awaiting local reconciliation, ${counts.manualReview.toString()} provider review, and ${counts.manualInventory.toString()} manual inventory compensation refund(s).`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.refunded.toString()} completed full refund(s); ${runtime.paymentRefundAdapter ? `provider "${runtime.paymentRefundAdapter.id}" is enabled` : "no refund-capable provider is configured"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Refund health check failed.",
            );
          }
        },
      },
      partialRefundHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopPartialRefunds();
            if (counts.invalidSample > 0 || counts.orphanSample > 0) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed and ${counts.orphanSample.toString()} orphan partial refund row(s) in bounded samples.`,
              );
            }
            if (counts.manualReview > 0 || counts.pending > 0 || counts.providerConfirmed > 0) {
              return npAdminStatus(
                "warn",
                `${counts.pending.toString()} provider-pending, ${counts.providerConfirmed.toString()} provider-confirmed awaiting local reconciliation, and ${counts.manualReview.toString()} requiring manual review.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.refunded.toString()} completed return-linked refund(s), including ${counts.merchantResponsibility.toString()} merchant-responsibility and ${counts.customerResponsibility.toString()} customer-responsibility postage settlement(s); ${runtime.paymentPartialRefundAdapter ? `partial-refund provider "${runtime.paymentPartialRefundAdapter.id}" is enabled` : "no general partial-refund provider is configured"}; ${runtime.paymentReturnSettlementAdapter ? `postage-settlement provider "${runtime.paymentReturnSettlementAdapter.id}" is enabled` : "no postage-settlement provider is configured"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Partial refund health check failed.",
            );
          }
        },
      },
      recentRefunds: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopRefunds();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      recentPartialRefunds: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopPartialRefunds();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      refundOrder: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Refunds require a direct staff action." };
            }
            const result = await npRefundShopOrder(
              runtime,
              npRequireShopRefundActionInput(data),
              ctx.actionInvocation.userId,
            );
            return {
              ok: true,
              data: `Full refund ${result.duplicate ? "already reconciled" : "completed"}; inventory ${result.refund.inventoryOutcome}, fulfillment ${result.refund.fulfillmentOutcome}.`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      partialRefundReturn: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Partial refunds require a direct staff action." };
            }
            const result = await npPartiallyRefundShopReturn(
              runtime,
              npRequireShopPartialRefundActionInput(data),
              ctx.actionInvocation.userId,
            );
            return {
              ok: true,
              data: `Return-linked partial refund ${result.duplicate ? "already reconciled" : "completed"}; ${result.refund.currency} ${result.refund.amountMinor.toString()} allocated without another inventory or fulfillment transition.`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      returnPostageSettlementRefund: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return {
                ok: false,
                error: "Return-postage settlement refunds require a direct staff action.",
              };
            }
            const result = await npSettleShopReturnPostageRefund(
              runtime,
              npRequireShopReturnSettlementRefundActionInput(data),
              ctx.actionInvocation.userId,
            );
            const settlement = result.refund.postageSettlement;
            return {
              ok: true,
              data: `Quote-backed return refund ${result.duplicate ? "already reconciled" : "completed"}; ${result.refund.currency} ${result.refund.amountMinor.toString()} net with ${settlement?.responsibility ?? "unknown"} postage responsibility and ${settlement?.deductionMinor.toString() ?? "0"} minor units deducted.`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countReturns: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopReturns();
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: `${counts.requested.toString()} requested, ${counts.approved.toString()} approved, ${counts.received.toString()} received`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      returnHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopReturns();
            if (counts.invalidSample > 0 || counts.orphanSample > 0) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed and ${counts.orphanSample.toString()} orphan return row(s) in bounded samples.`,
              );
            }
            if (counts.manualInventory > 0 || counts.requested > 0 || counts.approved > 0) {
              return npAdminStatus(
                "warn",
                `${counts.requested.toString()} awaiting review, ${counts.approved.toString()} awaiting receipt, and ${counts.manualInventory.toString()} requiring manual inventory reconciliation.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.received.toString()} received, ${counts.rejected.toString()} rejected, and ${counts.cancelled.toString()} owner-cancelled return(s).`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Return health check failed.",
            );
          }
        },
      },
      recentReturns: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopReturns();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countExchanges: {
        kind: "metric",
        handler: async () => {
          try {
            const [counts, carrier, parcels] = await Promise.all([
              npCountShopExchanges(),
              npCountShopExchangeCarrierBookings(runtime.carrierExchangeAdapter?.id),
              npCountShopExchangeParcels(),
            ]);
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: `${counts.awaiting.toString()} awaiting, ${counts.processing.toString()} processing, ${counts.shipped.toString()} shipped; ${carrier.total.toString()} provider booking(s), ${parcels.total.toString()} parcel snapshot(s)`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      exchangeHealth: {
        kind: "status",
        handler: async () => {
          try {
            const [counts, carrier, parcels] = await Promise.all([
              npCountShopExchanges(),
              npCountShopExchangeCarrierBookings(runtime.carrierExchangeAdapter?.id),
              npCountShopExchangeParcels(),
            ]);
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.invalidPrivateSample > 0 ||
              counts.orphanPrivateSample > 0 ||
              carrier.invalidSample > 0 ||
              carrier.orphanSample > 0 ||
              carrier.providerMismatchSample > 0 ||
              parcels.invalidSample > 0 ||
              parcels.orphanSample > 0 ||
              parcels.allocationMismatchSample > 0 ||
              parcels.lockMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed and ${counts.orphanSample.toString()} orphan exchange row(s), ${counts.invalidPrivateSample.toString()} malformed/mismatched and ${counts.orphanPrivateSample.toString()} orphan private destination row(s), ${carrier.invalidSample.toString()} invalid, ${carrier.orphanSample.toString()} orphan, and ${carrier.providerMismatchSample.toString()} provider-mismatched carrier booking row(s), plus ${parcels.invalidSample.toString()} invalid, ${parcels.orphanSample.toString()} orphan, ${parcels.allocationMismatchSample.toString()} allocation-mismatched, and ${parcels.lockMismatchSample.toString()} lock-mismatched parcel row(s) in bounded samples.`,
              );
            }
            if (
              counts.manualInventory > 0 ||
              counts.awaiting > 0 ||
              counts.processing > 0 ||
              counts.destinationExpiredSample > 0 ||
              counts.expiredPrivateSample > 0 ||
              carrier.pending > 0 ||
              carrier.providerConfirmed > 0 ||
              carrier.cancelling > 0 ||
              carrier.manualReview > 0
            ) {
              return npAdminStatus(
                "warn",
                `${counts.awaiting.toString()} awaiting (${counts.destinationAwaitingSample.toString()} destination submissions, ${counts.destinationSubmittedSample.toString()} staff reads, ${counts.destinationAccessedSample.toString()} ready, ${counts.destinationExpiredSample.toString()} expired), ${counts.expiredPrivateSample.toString()} expired private row(s), ${counts.processing.toString()} processing, ${counts.manualInventory.toString()} manual inventory; carrier has ${carrier.pending.toString()} pending, ${carrier.providerConfirmed.toString()} provider-confirmed, ${carrier.cancelling.toString()} cancelling, and ${carrier.manualReview.toString()} manual-review row(s).`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.shipped.toString()} shipped and ${counts.cancelled.toString()} cancelled same-item exchange(s); ${carrier.completed.toString()} completed and ${carrier.cancelled.toString()} cancelled provider booking(s), ${parcels.unlocked.toString()} unlocked and ${parcels.locked.toString()} locked parcel snapshot(s), provider "${runtime.carrierExchangeAdapter?.id ?? "disabled"}".`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Exchange health check failed.",
            );
          }
        },
      },
      recentExchanges: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopExchanges();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      ...(runtime.carrierExchangeParcelAdapter
        ? {
            saveExchangeParcels: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Replacement parcel preparation requires a direct staff action.",
                    };
                  }
                  const result = await npSaveShopExchangeParcels(
                    npRequireShopExchangeParcelsSaveInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Saved replacement parcel revision ${result.revision.toString()} with ${result.parcels.length.toString()} package(s).`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
          }
        : {}),
      readExchangeDestination: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return {
                ok: false,
                error: "Replacement destination access requires a direct staff action.",
              };
            }
            return {
              ok: true,
              data: await npReadShopExchangeDestination(
                npRequireShopExchangeDestinationReadInput(data),
                ctx.actionInvocation.userId,
              ),
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countReturnLogistics: {
        kind: "metric" as const,
        handler: async () => {
          try {
            const counts = await npCountShopReturnLogistics(
              runtime.carrierReturnLogisticsAdapter?.id,
            );
            return {
              ok: true as const,
              data: {
                value: counts.total,
                delta: `${counts.active.toString()} active, ${counts.cancelled.toString()} cancelled, ${(counts.pending + counts.cancelling).toString()} reconciling`,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      returnLogisticsHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const counts = await npCountShopReturnLogistics(
              runtime.carrierReturnLogisticsAdapter?.id,
            );
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.providerMismatchSample > 0 ||
              counts.privateMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, ${counts.providerMismatchSample.toString()} provider-mismatched, and ${counts.privateMismatchSample.toString()} private-sidecar-mismatched return logistics row(s) in bounded samples.`,
              );
            }
            const reconciling = counts.pending + counts.cancelling;
            if (!runtime.carrierReturnLogisticsAdapter && reconciling > 0) {
              return npAdminStatus(
                "error",
                `${reconciling.toString()} return logistics row(s) require their original carrier adapter.`,
              );
            }
            if (!runtime.carrierReturnLogisticsAdapter && counts.active > 0) {
              return npAdminStatus(
                "warn",
                `${counts.active.toString()} active return shipment(s) cannot be cancelled or read through their original adapter.`,
              );
            }
            if (counts.manualReview > 0 || reconciling > 0) {
              return npAdminStatus(
                "warn",
                `${reconciling.toString()} return logistics row(s) await reconciliation and ${counts.manualReview.toString()} require manual review.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.active.toString()} active and ${counts.cancelled.toString()} cancelled return shipment(s); provider "${runtime.carrierReturnLogisticsAdapter?.id ?? "disabled"}" is configured${runtime.carrierReturnLabelAdapter ? " with transient owner label retrieval" : " without label retrieval"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Return logistics health check failed.",
            );
          }
        },
      },
      recentReturnLogistics: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListRecentShopReturnLogistics();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      countReturnPostage: {
        kind: "metric" as const,
        handler: async () => {
          try {
            const counts = await npCountShopReturnPostage(runtime.carrierReturnPostageAdapter?.id);
            return {
              ok: true as const,
              data: {
                value: counts.total,
                delta: `${counts.selected.toString()} selected, ${counts.quoted.toString()} awaiting selection`,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      returnPostageHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const [counts, health] = await Promise.all([
              npCountShopReturnPostage(runtime.carrierReturnPostageAdapter?.id),
              runtime.carrierReturnPostageAdapter
                ? npReadShopReturnPostageHealth()
                : Promise.resolve(null),
            ]);
            if (
              counts.invalidSample > 0 ||
              counts.privateMismatchSample > 0 ||
              counts.providerMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.privateMismatchSample.toString()} private-sidecar-mismatched, and ${counts.providerMismatchSample.toString()} provider-mismatched return-postage row(s).`,
              );
            }
            if (
              health &&
              (health.status === "error" ||
                health.providerId !== runtime.carrierReturnPostageAdapter?.id)
            ) {
              return npAdminStatus(
                "error",
                `Return-postage provider last reported ${health.errorCode ?? "provider mismatch"} at ${health.attemptedAt}; no PII is retained in this diagnostic.`,
              );
            }
            if (counts.expired > 0) {
              return npAdminStatus(
                "warn",
                `${counts.expired.toString()} expired return-postage quote(s) await bounded cleanup.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.selected.toString()} selected and ${counts.quoted.toString()} open return-postage quote(s); provider "${runtime.carrierReturnPostageAdapter?.id ?? "disabled"}" is configured.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Return-postage health check failed.",
            );
          }
        },
      },
      recentReturnPostage: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListRecentShopReturnPostage();
            return npAdminTable(
              result.rows,
              result.truncated ? result.rows.length + 1 : result.rows.length,
            );
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      approveReturn: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Return operations require a direct staff action." };
            }
            const result = await npApproveShopReturn(
              npRequireShopReturnApproveInput(data),
              ctx.actionInvocation.userId,
            );
            return {
              ok: true,
              data: `Return approved at revision ${result.revision.toString()}; payment and inventory are unchanged.`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      rejectReturn: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Return operations require a direct staff action." };
            }
            const result = await npRejectShopReturn(
              npRequireShopReturnRejectInput(data),
              ctx.actionInvocation.userId,
            );
            return {
              ok: true,
              data: `Return rejected at revision ${result.revision.toString()}; payment and inventory are unchanged.`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      receiveReturn: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Return operations require a direct staff action." };
            }
            const result = await npReceiveShopReturn(
              runtime,
              npRequireShopReturnReceiveInput(data),
              ctx.actionInvocation.userId,
            );
            return {
              ok: true,
              data: `Return received at revision ${result.revision.toString()}; inventory ${result.inventoryOutcome}.`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      createExchange: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Exchange operations require a direct staff action." };
            }
            const result = await npCreateShopExchange(
              runtime,
              npRequireShopExchangeCreateInput(data),
              ctx.actionInvocation.userId,
            );
            return {
              ok: true,
              data: `Same-item exchange created at revision ${result.revision.toString()}; inventory ${result.inventoryOutcome}.`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      processExchange: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Exchange operations require a direct staff action." };
            }
            const result = await npProcessShopExchange(
              runtime,
              npRequireShopExchangeUpdateInput(data),
              ctx.actionInvocation.userId,
            );
            return { ok: true, data: `Exchange is ${result.status}.` };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      shipExchange: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Exchange operations require a direct staff action." };
            }
            const result = await npShipShopExchange(
              runtime,
              npRequireShopExchangeShipInput(data),
              ctx.actionInvocation.userId,
            );
            return { ok: true, data: `Exchange shipped with ${result.carrier ?? "carrier"}.` };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      cancelExchange: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Exchange operations require a direct staff action." };
            }
            const result = await npCancelShopExchange(
              runtime,
              npRequireShopExchangeUpdateInput(data),
              ctx.actionInvocation.userId,
            );
            return { ok: true, data: `Exchange cancelled; inventory ${result.inventoryOutcome}.` };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      ...(runtime.carrierExchangeAdapter
        ? {
            bookExchangeCarrier: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Replacement carrier booking requires a direct staff action.",
                    };
                  }
                  const result = await npBookShopExchangeCarrierShipment(
                    runtime,
                    npRequireShopExchangeCarrierBookActionInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Replacement carrier booking ${result.booking.status}; shipment ${result.booking.id}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
            resumeExchangeCarrier: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Replacement carrier reconciliation requires a direct staff action.",
                    };
                  }
                  const result = await npBookShopExchangeCarrierShipment(
                    runtime,
                    npRequireShopExchangeCarrierExistingActionInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Replacement carrier booking ${result.booking.status}; shipment ${result.booking.id}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
            shipBookedExchange: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Replacement shipment handoff requires a direct staff action.",
                    };
                  }
                  const result = await npShipBookedShopExchange(
                    runtime,
                    npRequireShopExchangeCarrierExistingActionInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Exchange shipped with ${result.carrier ?? "provider carrier"}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
            cancelExchangeCarrier: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Replacement carrier cancellation requires a direct staff action.",
                    };
                  }
                  const result = await npCancelShopExchangeCarrierShipment(
                    runtime,
                    npRequireShopExchangeCarrierExistingActionInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Replacement carrier booking ${result.booking.status}; exchange ${result.exchange.status}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
          }
        : {}),
      countFulfillments: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopFulfillments();
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: `${counts.awaiting.toString()} awaiting, ${counts.processing.toString()} processing, ${counts.shipped.toString()} shipped, ${counts.cancelled.toString()} refunded`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      fulfillmentHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopFulfillments();
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.missingPaidSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, and ${counts.missingPaidSample.toString()} paid-without-fulfillment row(s) in bounded samples; private values are withheld.`,
              );
            }
            if (counts.privateDue > 0) {
              return npAdminStatus(
                "warn",
                `${counts.privateDue.toString()} fulfillment private sidecar(s) await deletion maintenance.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.awaiting.toString()} awaiting, ${counts.processing.toString()} processing, ${counts.shipped.toString()} shipped, and ${counts.cancelled.toString()} refund-cancelled fulfillment(s).`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Fulfillment health check failed.",
            );
          }
        },
      },
      recentFulfillments: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopFulfillments();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countFulfillmentParcels: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopFulfillmentParcels();
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: `${counts.unlocked.toString()} unlocked, ${counts.locked.toString()} shipment-locked`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      fulfillmentParcelHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopFulfillmentParcels();
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.allocationMismatchSample > 0 ||
              counts.lockMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, ${counts.allocationMismatchSample.toString()} allocation-mismatched, and ${counts.lockMismatchSample.toString()} shipment-lock-mismatched row(s) in bounded samples.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.unlocked.toString()} unlocked and ${counts.locked.toString()} shipment-locked PII-free parcel snapshot(s).`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Fulfillment parcel health check failed.",
            );
          }
        },
      },
      recentFulfillmentParcels: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopFulfillmentParcels();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      saveFulfillmentParcels: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Parcel preparation requires a direct staff action." };
            }
            const result = await npSaveShopFulfillmentParcels(
              npRequireShopFulfillmentParcelsSaveInput(data),
              ctx.actionInvocation.userId,
            );
            const parcelCount = result.parcels.length;
            return {
              ok: true,
              data: `Saved parcel revision ${result.revision.toString()} with ${parcelCount.toString()} package(s).`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      processFulfillment: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Fulfillment operations require a direct staff action." };
            }
            const result = await npProcessShopFulfillment(
              npRequireShopFulfillmentProcessInput(data),
              ctx.actionInvocation.userId,
            );
            return {
              ok: true,
              data: `Fulfillment moved to ${result.status} at revision ${result.revision.toString()}.`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countCarrierBookings: {
        kind: "metric" as const,
        handler: async () => {
          try {
            const counts = await npCountShopCarrierBookings(runtime.carrierAdapter?.id);
            return {
              ok: true as const,
              data: {
                value: counts.total,
                delta: `${counts.completed.toString()} completed, ${(counts.pending + counts.providerConfirmed).toString()} pending reconciliation`,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      carrierBookingHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const counts = await npCountShopCarrierBookings(runtime.carrierAdapter?.id);
            if (!runtime.carrierAdapter && (counts.pending > 0 || counts.providerConfirmed > 0)) {
              return npAdminStatus(
                "error",
                `${counts.pending.toString()} pending and ${counts.providerConfirmed.toString()} provider-confirmed carrier booking(s) require their original adapter or local reconciliation.`,
              );
            }
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.providerMismatchSample > 0 ||
              counts.stateMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, ${counts.providerMismatchSample.toString()} provider-mismatched, and ${counts.stateMismatchSample.toString()} state-mismatched carrier row(s) in bounded samples.`,
              );
            }
            if (counts.pending > 0 || counts.providerConfirmed > 0 || counts.manualReview > 0) {
              return npAdminStatus(
                "warn",
                `${counts.pending.toString()} provider-pending, ${counts.providerConfirmed.toString()} provider-confirmed awaiting local completion, and ${counts.manualReview.toString()} requiring manual review.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.completed.toString()} completed carrier booking(s); ${runtime.carrierAdapter ? `provider "${runtime.carrierAdapter.id}" is enabled${runtime.carrierLabelAdapter ? " with transient label retrieval" : " without label retrieval"}` : "no carrier adapter is configured"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Carrier booking health check failed.",
            );
          }
        },
      },
      recentCarrierBookings: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListRecentShopCarrierBookings();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      countCarrierLabelAcquisitions: {
        kind: "metric" as const,
        handler: async () => {
          try {
            const counts = await npCountShopCarrierLabelAcquisitions(
              runtime.carrierLabelAcquisitionAdapter?.id,
            );
            return {
              ok: true as const,
              data: {
                value: counts.total,
                delta: `${counts.completed.toString()} completed, ${(counts.pending + counts.providerConfirmed).toString()} pending reconciliation`,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      carrierLabelAcquisitionHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const counts = await npCountShopCarrierLabelAcquisitions(
              runtime.carrierLabelAcquisitionAdapter?.id,
            );
            if (
              !runtime.carrierLabelAcquisitionAdapter &&
              (counts.pending > 0 || counts.providerConfirmed > 0)
            ) {
              return npAdminStatus(
                "error",
                `${counts.pending.toString()} pending and ${counts.providerConfirmed.toString()} provider-confirmed label acquisition(s) require their original adapter.`,
              );
            }
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.bookingMismatchSample > 0 ||
              counts.providerMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, ${counts.bookingMismatchSample.toString()} booking-mismatched, and ${counts.providerMismatchSample.toString()} provider-mismatched label row(s) in bounded samples.`,
              );
            }
            if (counts.pending > 0 || counts.providerConfirmed > 0 || counts.manualReview > 0) {
              return npAdminStatus(
                "warn",
                `${counts.pending.toString()} provider-pending, ${counts.providerConfirmed.toString()} provider-confirmed awaiting local completion, and ${counts.manualReview.toString()} label acquisition(s) requiring manual review.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.completed.toString()} completed acquisition(s) across ${counts.outbound.toString()} outbound and ${counts.replacement.toString()} replacement shipment(s); ${runtime.carrierLabelAcquisitionAdapter ? `provider "${runtime.carrierLabelAcquisitionAdapter.id}" is enabled` : "label purchase and regeneration are disabled"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Carrier label acquisition health failed.",
            );
          }
        },
      },
      recentCarrierLabelAcquisitions: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListRecentShopCarrierLabelAcquisitions();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      ...(runtime.carrierLabelAcquisitionAdapter
        ? {
            acquireCarrierShippingLabel: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Carrier label acquisition requires a direct staff action.",
                    };
                  }
                  const result = await npAcquireShopCarrierShippingLabel(
                    runtime,
                    npRequireShopCarrierLabelAcquisitionActionInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Carrier label ${result.duplicate ? "already reconciled" : result.acquisition.operation === "purchase" ? "purchased" : "regenerated"} at generation ${result.acquisition.generation.toString()} and revision ${result.acquisition.revision.toString()}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
          }
        : {}),
      countCarrierPickupAvailability: {
        kind: "metric" as const,
        handler: async () => {
          try {
            const counts = await npCountShopCarrierPickupAvailability(runtime);
            return {
              ok: true as const,
              data: {
                value: counts.total,
                delta: `${counts.windows.toString()} window(s) and ${counts.expired.toString()} expired snapshot(s) in the recent bounded sample`,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      carrierPickupAvailabilityHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const [counts, health] = await Promise.all([
              npCountShopCarrierPickupAvailability(runtime),
              npReadShopCarrierPickupAvailabilityHealth(),
            ]);
            if (
              counts.invalidSample > 0 ||
              counts.providerMismatchSample > 0 ||
              counts.stateMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.providerMismatchSample.toString()} provider-mismatched, and ${counts.stateMismatchSample.toString()} booking/parcel-mismatched availability snapshot(s) in bounded samples.`,
              );
            }
            if (!runtime.carrierPickupAvailabilityAdapter && counts.total > 0) {
              return npAdminStatus(
                "error",
                `${counts.total.toString()} pickup availability snapshot(s) remain without their original adapter.`,
              );
            }
            if (
              runtime.carrierPickupAvailabilityAdapter &&
              health &&
              (health.status === "error" ||
                health.providerId !== runtime.carrierPickupAvailabilityAdapter.id)
            ) {
              return npAdminStatus(
                "error",
                `Pickup availability provider last reported ${health.errorCode ?? "provider mismatch"} at ${health.attemptedAt}; no PII is retained.`,
              );
            }
            if (counts.expired > 0) {
              return npAdminStatus(
                "warn",
                `${counts.expired.toString()} expired pickup availability snapshot(s) await bounded cleanup.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.windows.toString()} provider window(s) in the recent bounded sample across ${counts.total.toString()} total snapshot(s); ${runtime.carrierPickupAvailabilityAdapter ? `provider "${runtime.carrierPickupAvailabilityAdapter.id}" is enabled` : "availability lookup is disabled"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error
                ? error.message
                : "Carrier pickup availability health check failed.",
            );
          }
        },
      },
      recentCarrierPickupAvailability: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListRecentShopCarrierPickupAvailability();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      ...(runtime.carrierPickupAvailabilityAdapter
        ? {
            listCarrierPickupWindows: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Carrier pickup availability requires a direct staff action.",
                    };
                  }
                  const result = await npListShopCarrierPickupWindows(
                    runtime,
                    npRequireShopCarrierPickupAvailabilityQueryInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Loaded ${result.windows.length.toString()} provider pickup window(s), valid until ${result.expiresAt}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
            scheduleCarrierPickupWindow: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Carrier pickup window selection requires a direct staff action.",
                    };
                  }
                  const result = await npScheduleShopCarrierPickupWindow(
                    runtime,
                    npRequireShopCarrierPickupAvailabilitySelectionInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Carrier pickup ${result.duplicate ? "already reconciled" : "scheduled"} from the selected provider window at revision ${result.pickup.revision.toString()}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
          }
        : {}),
      countCarrierPickups: {
        kind: "metric" as const,
        handler: async () => {
          try {
            const counts = await npCountShopCarrierPickups(runtime.carrierPickupAdapter?.id);
            return {
              ok: true as const,
              data: {
                value: counts.total,
                delta: `${counts.scheduled.toString()} scheduled, ${counts.cancelled.toString()} cancelled, ${(counts.pending + counts.providerConfirmed + counts.cancelling).toString()} pending reconciliation; ${counts.replacement.toString()} replacement`,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      carrierPickupHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const counts = await npCountShopCarrierPickups(runtime.carrierPickupAdapter?.id);
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.bookingMismatchSample > 0 ||
              counts.parcelMismatchSample > 0 ||
              counts.providerMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, ${counts.bookingMismatchSample.toString()} booking-mismatched, ${counts.parcelMismatchSample.toString()} parcel-mismatched, and ${counts.providerMismatchSample.toString()} provider-mismatched pickup row(s) in bounded samples.`,
              );
            }
            const reconciling = counts.pending + counts.providerConfirmed + counts.cancelling;
            if (!runtime.carrierPickupAdapter && reconciling > 0) {
              return npAdminStatus(
                "error",
                `${reconciling.toString()} pickup row(s) require their original carrier pickup adapter.`,
              );
            }
            if (counts.manualReview > 0 || reconciling > 0) {
              return npAdminStatus(
                "warn",
                `${reconciling.toString()} pickup row(s) await reconciliation and ${counts.manualReview.toString()} require manual review.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.scheduled.toString()} scheduled and ${counts.cancelled.toString()} cancelled pickup(s) across ${counts.outbound.toString()} outbound and ${counts.replacement.toString()} replacement shipment(s); ${runtime.carrierPickupAdapter ? `provider "${runtime.carrierPickupAdapter.id}" is enabled with a server-only location reference` : "pickup scheduling is disabled"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Carrier pickup health check failed.",
            );
          }
        },
      },
      recentCarrierPickups: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListRecentShopCarrierPickups();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      ...(runtime.carrierPickupAdapter
        ? {
            scheduleCarrierPickup: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Carrier pickup scheduling requires a direct staff action.",
                    };
                  }
                  const result = await npScheduleShopCarrierPickup(
                    runtime,
                    npRequireShopCarrierPickupScheduleInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Carrier pickup ${result.duplicate ? "already reconciled" : "scheduled"} at revision ${result.pickup.revision.toString()}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
            resumeCarrierPickup: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Carrier pickup reconciliation requires a direct staff action.",
                    };
                  }
                  const result = await npResumeShopCarrierPickup(
                    runtime,
                    npRequireShopCarrierPickupResumeInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Carrier pickup ${result.duplicate ? "already reconciled" : "scheduled"} at revision ${result.pickup.revision.toString()}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
            cancelCarrierPickup: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Carrier pickup cancellation requires a direct staff action.",
                    };
                  }
                  const result = await npCancelShopCarrierPickup(
                    runtime,
                    npRequireShopCarrierPickupCancelInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Carrier pickup ${result.duplicate ? "was already cancelled" : "cancelled"} at revision ${result.pickup.revision.toString()}.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
          }
        : {}),
      countTrackingEvents: {
        kind: "metric" as const,
        handler: async () => {
          try {
            const counts = await npCountShopTrackingEvents(
              runtime.carrierTrackingAdapter?.id ?? runtime.carrierTrackingPollAdapter?.id,
            );
            return {
              ok: true as const,
              data: {
                value: counts.total,
                delta: `${counts.states.toString()} shipments, ${counts.delivered.toString()} delivered, ${counts.exceptions.toString()} exceptions`,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      trackingEventHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const counts = await npCountShopTrackingEvents(
              runtime.carrierTrackingAdapter?.id ?? runtime.carrierTrackingPollAdapter?.id,
            );
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.providerMismatchSample > 0 ||
              counts.stateMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, ${counts.providerMismatchSample.toString()} provider-mismatched, and ${counts.stateMismatchSample.toString()} state-mismatched tracking row(s) in bounded samples.`,
              );
            }
            if (
              !runtime.carrierTrackingAdapter &&
              !runtime.carrierTrackingPollAdapter &&
              counts.active > 0
            ) {
              return npAdminStatus(
                "warn",
                `${counts.active.toString()} active shipment tracking state(s) cannot advance while webhook and polling capabilities are disabled.`,
              );
            }
            if (counts.exceptions > 0) {
              return npAdminStatus(
                "warn",
                `${counts.exceptions.toString()} shipment(s) currently report a delivery exception.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.total.toString()} verified event receipt(s), ${counts.delivered.toString()} delivered shipment(s); webhook ${runtime.carrierTrackingAdapter ? "enabled" : "disabled"}, polling ${runtime.carrierTrackingPollAdapter ? "enabled" : "disabled"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Tracking event health check failed.",
            );
          }
        },
      },
      recentTrackingEvents: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListRecentShopTrackingEvents();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      trackingPollHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const counts = await npCountShopTrackingPolls(runtime.carrierTrackingPollAdapter?.id);
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.providerMismatchSample > 0 ||
              counts.stateMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, ${counts.providerMismatchSample.toString()} provider-mismatched, and ${counts.stateMismatchSample.toString()} booking-mismatched poll row(s) in bounded samples.`,
              );
            }
            if (counts.expiredLeases > 0 || counts.failed > 0) {
              return npAdminStatus(
                "warn",
                `${counts.failed.toString()} poll row(s) are backing off and ${counts.expiredLeases.toString()} expired lease(s) await reclaim.`,
              );
            }
            if (!runtime.carrierTrackingPollAdapter && counts.due > 0) {
              return npAdminStatus(
                "warn",
                `${counts.due.toString()} due poll row(s) cannot run while polling is disabled.`,
              );
            }
            if (runtime.carrierTrackingPollAdapter && counts.unpolledBookingSample > 0) {
              return npAdminStatus(
                "warn",
                `${counts.unpolledBookingSample.toString()} active completed booking(s) in the bounded sample have not been polled yet.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.total.toString()} poll state row(s), ${counts.due.toString()} due, ${counts.leased.toString()} leased; ${runtime.carrierTrackingPollAdapter ? `provider "${runtime.carrierTrackingPollAdapter.id}" polling is enabled` : "tracking polling is disabled"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Tracking polling health check failed.",
            );
          }
        },
      },
      recentTrackingPolls: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListShopTrackingPolls();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      ...(runtime.carrierTrackingPollAdapter
        ? {
            reconcileCarrierTracking: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Carrier tracking reconciliation requires a direct staff action.",
                    };
                  }
                  const input = npRequireShopTrackingReconcileActionInput(data);
                  const result = await npReconcileShopTracking(
                    runtime.carrierTrackingPollAdapter!,
                    {
                      orderId: input.orderId,
                      expectedShipmentId: input.shipmentId,
                      force: true,
                      staffUserId: ctx.actionInvocation.userId,
                    },
                  );
                  if (result.failed > 0) {
                    return {
                      ok: false as const,
                      error: `Carrier tracking poll failed for ${result.failed.toString()} shipment(s); the closed failure and retry backoff were persisted.`,
                    };
                  }
                  if (result.claimed === 0) {
                    return {
                      ok: false as const,
                      error:
                        "The shipment is no longer eligible for tracking reconciliation or already has an active lease.",
                    };
                  }
                  return {
                    ok: true as const,
                    data: `Polled ${result.claimed.toString()} shipment(s): ${result.advanced.toString()} advanced, ${result.unchanged.toString()} unchanged, ${result.failed.toString()} failed, and ${result.skipped.toString()} skipped.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
          }
        : {}),
      countReturnTrackingEvents: {
        kind: "metric" as const,
        handler: async () => {
          try {
            const counts = await npCountShopReturnTrackingEvents(
              runtime.carrierReturnTrackingAdapter?.id ??
                runtime.carrierReturnTrackingPollAdapter?.id,
            );
            return {
              ok: true as const,
              data: {
                value: counts.total,
                delta: `${counts.states.toString()} returns, ${counts.delivered.toString()} delivered, ${counts.exceptions.toString()} exceptions`,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      returnTrackingEventHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const counts = await npCountShopReturnTrackingEvents(
              runtime.carrierReturnTrackingAdapter?.id ??
                runtime.carrierReturnTrackingPollAdapter?.id,
            );
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.providerMismatchSample > 0 ||
              counts.stateMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, ${counts.providerMismatchSample.toString()} provider-mismatched, and ${counts.stateMismatchSample.toString()} logistics-mismatched return-tracking row(s) in bounded samples.`,
              );
            }
            if (
              !runtime.carrierReturnTrackingAdapter &&
              !runtime.carrierReturnTrackingPollAdapter &&
              counts.active > 0
            ) {
              return npAdminStatus(
                "warn",
                `${counts.active.toString()} active return-tracking state(s) cannot advance while webhook and polling capabilities are disabled.`,
              );
            }
            if (counts.exceptions > 0)
              return npAdminStatus(
                "warn",
                `${counts.exceptions.toString()} return shipment(s) currently report a carrier exception.`,
              );
            return npAdminStatus(
              "ok",
              `${counts.total.toString()} verified return event receipt(s), ${counts.delivered.toString()} carrier-delivered return shipment(s); webhook ${runtime.carrierReturnTrackingAdapter ? "enabled" : "disabled"}, polling ${runtime.carrierReturnTrackingPollAdapter ? "enabled" : "disabled"}. Carrier delivery never marks the physical return received.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Return tracking health check failed.",
            );
          }
        },
      },
      recentReturnTrackingEvents: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListRecentShopReturnTrackingEvents();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      returnTrackingPollHealth: {
        kind: "status" as const,
        handler: async () => {
          try {
            const counts = await npCountShopReturnTrackingPolls(
              runtime.carrierReturnTrackingPollAdapter?.id,
            );
            if (
              counts.invalidSample > 0 ||
              counts.orphanSample > 0 ||
              counts.providerMismatchSample > 0 ||
              counts.stateMismatchSample > 0
            ) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed, ${counts.orphanSample.toString()} orphan, ${counts.providerMismatchSample.toString()} provider-mismatched, and ${counts.stateMismatchSample.toString()} logistics-mismatched return poll row(s) in bounded samples.`,
              );
            }
            if (counts.expiredLeases > 0 || counts.failed > 0)
              return npAdminStatus(
                "warn",
                `${counts.failed.toString()} return poll row(s) are backing off and ${counts.expiredLeases.toString()} expired lease(s) await reclaim.`,
              );
            if (!runtime.carrierReturnTrackingPollAdapter && counts.due > 0)
              return npAdminStatus(
                "warn",
                `${counts.due.toString()} due return poll row(s) cannot run while polling is disabled.`,
              );
            if (runtime.carrierReturnTrackingPollAdapter && counts.unpolledLogisticsSample > 0)
              return npAdminStatus(
                "warn",
                `${counts.unpolledLogisticsSample.toString()} active return shipment(s) in the bounded sample have not been polled yet.`,
              );
            return npAdminStatus(
              "ok",
              `${counts.total.toString()} return poll state row(s), ${counts.due.toString()} due, ${counts.leased.toString()} leased; ${runtime.carrierReturnTrackingPollAdapter ? `provider "${runtime.carrierReturnTrackingPollAdapter.id}" polling is enabled` : "return tracking polling is disabled"}.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error
                ? error.message
                : "Return tracking polling health check failed.",
            );
          }
        },
      },
      recentReturnTrackingPolls: {
        kind: "table" as const,
        handler: async () => {
          try {
            const result = await npListShopReturnTrackingPolls();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      ...(runtime.carrierReturnTrackingPollAdapter
        ? {
            reconcileCarrierReturnTracking: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff")
                    return {
                      ok: false as const,
                      error: "Return tracking reconciliation requires a direct staff action.",
                    };
                  const input = npRequireShopReturnTrackingReconcileActionInput(data);
                  const result = await npReconcileShopReturnTracking(
                    runtime.carrierReturnTrackingPollAdapter!,
                    {
                      orderId: input.orderId,
                      expectedReturnId: input.returnId,
                      expectedLogisticsId: input.logisticsId,
                      force: true,
                      staffUserId: ctx.actionInvocation.userId,
                    },
                  );
                  if (result.failed > 0)
                    return {
                      ok: false as const,
                      error: `Return tracking poll failed for ${result.failed.toString()} shipment(s); the closed failure and retry backoff were persisted.`,
                    };
                  if (result.claimed === 0)
                    return {
                      ok: false as const,
                      error:
                        "The return shipment is no longer eligible for tracking reconciliation or already has an active lease.",
                    };
                  return {
                    ok: true as const,
                    data: `Polled ${result.claimed.toString()} return shipment(s): ${result.advanced.toString()} advanced, ${result.unchanged.toString()} unchanged, and ${result.skipped.toString()} skipped.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
          }
        : {}),
      bookCarrierShipment: {
        kind: "action" as const,
        handler: async (data: unknown, ctx: NpPluginContext) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return {
                ok: false as const,
                error: "Carrier booking requires a direct staff action.",
              };
            }
            const result = await npBookShopCarrierShipment(
              runtime,
              npRequireShopCarrierBookingActionInput(data),
              ctx.actionInvocation.userId,
            );
            return {
              ok: true as const,
              data: `Carrier shipment ${result.duplicate ? "already reconciled" : "completed"}; fulfillment revision ${result.fulfillment.revision.toString()} and retained private data deleted.`,
            };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
      ...(runtime.carrierAdapter
        ? {}
        : {
            shipFulfillment: {
              kind: "action" as const,
              handler: async (data: unknown, ctx: NpPluginContext) => {
                try {
                  if (ctx.actionInvocation?.kind !== "staff") {
                    return {
                      ok: false as const,
                      error: "Fulfillment operations require a direct staff action.",
                    };
                  }
                  const result = await npShipShopFulfillment(
                    npRequireShopFulfillmentShipInput(data),
                    ctx.actionInvocation.userId,
                  );
                  return {
                    ok: true as const,
                    data: `Fulfillment shipped at revision ${result.revision.toString()}; retained private data was deleted.`,
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
          }),
      readFulfillmentPrivate: {
        kind: "action",
        handler: async (data, ctx) => {
          try {
            if (ctx.actionInvocation?.kind !== "staff") {
              return { ok: false, error: "Private order data requires a direct staff action." };
            }
            return {
              ok: true,
              data: await npReadShopFulfillmentPrivate(
                npRequireShopFulfillmentPrivateReadInput(data),
                ctx.actionInvocation.userId,
              ),
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countPaymentEvents: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopPaymentEvents();
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: runtime.paymentAdapter?.id ?? "webhook disabled",
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      paymentEventHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopPaymentEvents();
            if (counts.invalidSample > 0 || counts.orphanSample > 0) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed and ${counts.orphanSample.toString()} orphan payment receipt(s) in the newest bounded sample; raw callbacks and private values are never retained.`,
              );
            }
            if (!runtime.paymentAdapter) {
              return npAdminStatus(
                "ok",
                `${counts.total.toString()} retained receipt(s); no payment adapter is configured and the webhook route is disabled.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.total.toString()} valid receipt(s); provider "${runtime.paymentAdapter.id}" is configured.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Payment event health check failed.",
            );
          }
        },
      },
      recentPaymentEvents: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopPaymentEvents();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      countPaymentAdjustments: {
        kind: "metric",
        handler: async () => {
          try {
            const counts = await npCountShopPaymentAdjustments();
            return {
              ok: true,
              data: {
                value: counts.total,
                delta: `${counts.manualReview.toString()} requiring manual reconciliation`,
              },
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      paymentAdjustmentHealth: {
        kind: "status",
        handler: async () => {
          try {
            const counts = await npCountShopPaymentAdjustments();
            if (counts.invalidSample > 0 || counts.orphanSample > 0) {
              return npAdminStatus(
                "error",
                `${counts.invalidSample.toString()} malformed and ${counts.orphanSample.toString()} orphan payment adjustment row(s) in the newest bounded sample.`,
              );
            }
            if (counts.manualReview > 0) {
              return npAdminStatus(
                "warn",
                `${counts.manualReview.toString()} provider-initiated adjustment(s) block fulfillment and further refunds pending reconciliation.`,
              );
            }
            return npAdminStatus(
              "ok",
              `${counts.total.toString()} provider adjustment(s) are reconciled with Shop order and refund state.`,
            );
          } catch (error) {
            return npAdminStatus(
              "error",
              error instanceof Error ? error.message : "Payment adjustment health check failed.",
            );
          }
        },
      },
      recentPaymentAdjustments: {
        kind: "table",
        handler: async () => {
          try {
            const result = await npListRecentShopPaymentAdjustments();
            return npAdminTable(result.rows, result.total);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
      ...(paymentAttemptApiHandler
        ? {
            countPaymentAttempts: {
              kind: "metric" as const,
              handler: async () => {
                try {
                  const counts = await npCountShopPaymentAttempts();
                  return {
                    ok: true as const,
                    data: {
                      value: counts.total,
                      delta: `${counts.prepared.toString()} prepared, ${counts.confirmed.toString()} confirmed, ${counts.expired.toString()} expired`,
                    },
                  };
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
            paymentAttemptHealth: {
              kind: "status" as const,
              handler: async () => {
                try {
                  const counts = await npCountShopPaymentAttempts();
                  if (counts.invalidSample > 0) {
                    return npAdminStatus(
                      "error",
                      `${counts.invalidSample.toString()} malformed payment attempt row(s) in the newest bounded sample; owner, handoff, and private values are withheld.`,
                    );
                  }
                  if (counts.expired > 0) {
                    return npAdminStatus(
                      "warn",
                      `${counts.prepared.toString()} prepared, ${counts.confirmed.toString()} confirmed, and ${counts.expired.toString()} expired attempt(s); provider "${runtime.paymentInitiationAdapter!.id}" is configured.`,
                    );
                  }
                  return npAdminStatus(
                    "ok",
                    `${counts.prepared.toString()} prepared and ${counts.confirmed.toString()} confirmed attempt(s); provider "${runtime.paymentInitiationAdapter!.id}" is configured.`,
                  );
                } catch (error) {
                  return npAdminStatus(
                    "error",
                    error instanceof Error ? error.message : "Payment attempt health check failed.",
                  );
                }
              },
            },
            recentPaymentAttempts: {
              kind: "table" as const,
              handler: async () => {
                try {
                  const result = await npListRecentShopPaymentAttempts();
                  return npAdminTable(result.rows, result.total);
                } catch (error) {
                  return {
                    ok: false as const,
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                }
              },
            },
          }
        : {}),
      maintainOrders: {
        kind: "action",
        handler: async () => {
          try {
            const result = await npMaintainShopOrders();
            return {
              ok: true,
              data: `Cancelled ${result.cancelled.toString()} expired pending order(s), deleted ${result.privateRedacted.toString()} overdue fulfillment and ${result.exchangeDestinationsCleaned.toString()} expired exchange-destination private sidecar(s), purged ${result.purged.toString()} expired commercial snapshot(s), and removed ${result.reservationsCleaned.toString()} leftover expired reservation row(s).`,
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
          }
        },
      },
    },
    routes: [
      {
        method: "GET",
        path: "/cart",
        description: "Read or merge the current site cart.",
        handler: cartApiHandler,
      },
      {
        method: "GET",
        path: "/reviews",
        description: "Read one exact public product-review page and current member eligibility.",
        handler: reviewApiHandler,
      },
      {
        method: "POST",
        path: "/reviews",
        description: "Create one verified-purchase product review.",
        handler: reviewApiHandler,
      },
      {
        method: "PATCH",
        path: "/reviews",
        description: "Update one member-owned product review.",
        handler: reviewApiHandler,
      },
      {
        method: "DELETE",
        path: "/reviews",
        description: "Delete one member-owned product review.",
        handler: reviewApiHandler,
      },
      {
        method: "GET",
        path: "/restock-alerts",
        description: "Read one member's active alerts for an exact Shop product.",
        handler: restockAlertApiHandler,
      },
      {
        method: "POST",
        path: "/restock-alerts",
        description:
          "Request one member-owned, time-bounded, one-shot alert for an out-of-stock product or option.",
        handler: restockAlertApiHandler,
      },
      {
        method: "DELETE",
        path: "/restock-alerts",
        description: "Cancel one member-owned active Shop restock alert.",
        handler: restockAlertApiHandler,
      },
      {
        method: "GET",
        path: "/price-alerts",
        description: "Read one member's active catalog price alerts for an exact Shop product.",
        handler: priceAlertApiHandler,
      },
      {
        method: "POST",
        path: "/price-alerts",
        description:
          "Request one member-owned, time-bounded, one-shot alert from the current catalog price baseline.",
        handler: priceAlertApiHandler,
      },
      {
        method: "DELETE",
        path: "/price-alerts",
        description: "Cancel one member-owned active Shop price-drop alert.",
        handler: priceAlertApiHandler,
      },
      {
        method: "POST",
        path: "/cart",
        description: "Add a published product or variant to the current cart.",
        handler: cartApiHandler,
      },
      {
        method: "PATCH",
        path: "/cart",
        description: "Change one cart line quantity with revision protection.",
        handler: cartApiHandler,
      },
      {
        method: "PUT",
        path: "/cart",
        description: "Replace canonical coupon codes with revision protection.",
        handler: cartApiHandler,
      },
      {
        method: "DELETE",
        path: "/cart",
        description: "Remove one cart line or clear the current cart.",
        handler: cartApiHandler,
      },
      {
        method: "GET",
        path: "/checkout",
        description: "Read one owner-scoped checkout intent and revalidate its cart snapshot.",
        handler: checkoutApiHandler,
      },
      {
        method: "POST",
        path: "/checkout",
        description: "Create one idempotent short-lived checkout intent from a current cart quote.",
        handler: checkoutApiHandler,
      },
      {
        method: "DELETE",
        path: "/checkout",
        description: "Cancel one owner-scoped checkout intent.",
        handler: checkoutApiHandler,
      },
      {
        method: "GET",
        path: "/order-drafts",
        description: "Read one owner-scoped private order draft.",
        handler: orderDraftApiHandler,
      },
      {
        method: "POST",
        path: "/order-drafts",
        description: "Create one idempotent private order draft from an open checkout intent.",
        handler: orderDraftApiHandler,
      },
      {
        method: "PATCH",
        path: "/order-drafts",
        description:
          "Replace one private order draft's bounded customer and shipping details and refresh delivery quotes.",
        handler: orderDraftApiHandler,
      },
      {
        method: "PUT",
        path: "/order-drafts",
        description: "Select one current quoted delivery method with revision protection.",
        handler: orderDraftApiHandler,
      },
      {
        method: "DELETE",
        path: "/order-drafts",
        description: "Permanently delete one owner-scoped private order draft.",
        handler: orderDraftApiHandler,
      },
      {
        method: "GET",
        path: "/orders",
        description: "Read one owner-scoped order or the bounded owner order history.",
        handler: orderApiHandler,
      },
      {
        method: "POST",
        path: "/orders",
        description:
          "Atomically create one idempotent pending-payment order from a reviewable private draft.",
        handler: orderApiHandler,
      },
      {
        method: "DELETE",
        path: "/orders",
        description:
          "Cancel one owner-scoped pending order and permanently delete its private sidecar.",
        handler: orderApiHandler,
      },
      {
        method: "POST",
        path: "/returns",
        description:
          "Request one item-level physical return for an owner-scoped shipped order without changing payment or inventory.",
        handler: returnApiHandler,
      },
      {
        method: "DELETE",
        path: "/returns",
        description: "Cancel one owner-scoped return while it still awaits staff review.",
        handler: returnApiHandler,
      },
      {
        method: "POST",
        path: "/exchanges/destination",
        description:
          "Submit one short-lived owner-scoped replacement destination under a revision-bound authority.",
        handler: exchangeDestinationApiHandler,
      },
      ...(paymentAttemptApiHandler
        ? [
            {
              method: "GET" as const,
              path: "/payments/attempts",
              description: "Read one owner-scoped payment attempt or acquire its mutation token.",
              handler: paymentAttemptApiHandler,
            },
            {
              method: "POST" as const,
              path: "/payments/attempts",
              description:
                "Prepare one idempotent, provider-owned payment handoff for an exact pending order.",
              handler: paymentAttemptApiHandler,
            },
            {
              method: "PATCH" as const,
              path: "/payments/attempts",
              description:
                "Server-confirm one provider return without trusting browser amount or success state.",
              handler: paymentAttemptApiHandler,
            },
          ]
        : []),
      ...(paymentApiHandler
        ? [
            {
              method: "POST" as const,
              path: "/payments/webhook",
              description:
                "Verify one exact provider callback and idempotently resolve its payment or cumulative cancellation snapshot.",
              auth: false,
              bodyMode: "raw" as const,
              handler: paymentApiHandler,
            },
          ]
        : []),
      ...(trackingApiHandler
        ? [
            {
              method: "POST" as const,
              path: "/carrier/tracking/webhook",
              description:
                "Verify one exact carrier callback and idempotently advance its separate PII-free outbound or replacement shipment tracking state.",
              auth: false,
              bodyMode: "raw" as const,
              handler: trackingApiHandler,
            },
          ]
        : []),
      ...(returnTrackingApiHandler
        ? [
            {
              method: "POST" as const,
              path: "/carrier/return-tracking/webhook",
              description:
                "Verify one exact carrier callback and idempotently advance its PII-free return-shipment tracking state.",
              auth: false,
              bodyMode: "raw" as const,
              handler: returnTrackingApiHandler,
            },
          ]
        : []),
      ...(carrierLabelApiHandler
        ? [
            {
              method: "GET" as const,
              path: "/carrier/shipping-label",
              description:
                "Retrieve one completed outbound or replacement carrier booking label as bounded transient bytes.",
              auth: true,
              responseMode: "binary" as const,
              handler: carrierLabelApiHandler,
            },
          ]
        : []),
      ...(returnLogisticsApiHandler
        ? [
            {
              method: "POST" as const,
              path: "/returns/logistics",
              description:
                "Create one owner-scoped provider return shipment from an approved physical return.",
              auth: false,
              handler: returnLogisticsApiHandler,
            },
            {
              method: "PATCH" as const,
              path: "/returns/logistics",
              description:
                "Resume one owner-scoped pending or provider-confirmed return shipment with its stable idempotency key.",
              auth: false,
              handler: returnLogisticsApiHandler,
            },
            {
              method: "DELETE" as const,
              path: "/returns/logistics",
              description: "Cancel one owner-scoped active provider return shipment.",
              auth: false,
              handler: returnLogisticsApiHandler,
            },
          ]
        : []),
      ...(returnPostageApiHandler
        ? [
            {
              method: "POST" as const,
              path: "/returns/postage",
              description:
                "Quote exact owner-scoped return-postage methods from one short-lived private origin.",
              auth: false,
              handler: returnPostageApiHandler,
            },
            {
              method: "PATCH" as const,
              path: "/returns/postage",
              description:
                "Freeze one revision-safe PII-free return-postage method for logistics creation.",
              auth: false,
              handler: returnPostageApiHandler,
            },
          ]
        : []),
      ...(returnLogisticsLabelApiHandler
        ? [
            {
              method: "GET" as const,
              path: "/returns/logistics/label",
              description:
                "Retrieve one owner-scoped active return label as bounded transient bytes.",
              auth: false,
              responseMode: "binary" as const,
              handler: returnLogisticsLabelApiHandler,
            },
          ]
        : []),
    ],
    scheduled: [
      {
        id: "process-order-notifications",
        cron: "* * * * *",
        description:
          "Deliver one bounded batch of durable order notifications and expire private recipient sidecars.",
        handler: async () => {
          await npProcessShopOrderNotifications(runtime.basePath);
        },
      },
      {
        id: "reconcile-restock-alerts",
        cron: "*/5 * * * *",
        description:
          "Reconcile one bounded oldest-first batch of member restock alerts and retain one-shot completion receipts.",
        handler: async () => {
          await npProcessShopRestockAlerts(runtime);
        },
      },
      {
        id: "reconcile-price-alerts",
        cron: "*/5 * * * *",
        description:
          "Reconcile one bounded oldest-first batch of catalog price alerts and retain one-shot completion receipts.",
        handler: async () => {
          await npProcessShopPriceAlerts(runtime);
        },
      },
      {
        id: "cleanup-expired-carts",
        cron: "17 * * * *",
        description: "Delete one bounded batch of expired cart rows for each active site.",
        handler: async () => {
          await npCleanupExpiredShopCarts();
        },
      },
      {
        id: "cleanup-expired-checkout-intents",
        cron: "23 * * * *",
        description: "Delete one bounded batch of expired checkout intents for each active site.",
        handler: async () => {
          await npCleanupExpiredShopCheckoutIntents();
        },
      },
      {
        id: "cleanup-expired-order-drafts",
        cron: "29 * * * *",
        description:
          "Permanently delete one bounded oldest-first batch of expired private order drafts for each active site.",
        handler: async () => {
          await npCleanupExpiredShopOrderDrafts();
        },
      },
      {
        id: "cleanup-expired-return-logistics-private",
        cron: "41 * * * *",
        description:
          "Permanently delete one bounded oldest-first batch of expired return-origin sidecars for each active site.",
        handler: async () => {
          await npCleanupExpiredShopReturnLogisticsPrivate();
        },
      },
      {
        id: "cleanup-expired-return-postage",
        cron: "47 * * * *",
        description:
          "Permanently delete one bounded batch of expired return-postage quotes and private origins.",
        handler: async () => {
          await npCleanupExpiredShopReturnPostage();
        },
      },
      {
        id: "cleanup-expired-carrier-pickup-availability",
        cron: "53 * * * *",
        description:
          "Permanently delete one bounded oldest-first batch of expired PII-free carrier pickup windows.",
        handler: async () => {
          await npCleanupExpiredShopCarrierPickupAvailability();
        },
      },
      ...(runtime.carrierTrackingPollAdapter
        ? [
            {
              id: "reconcile-carrier-tracking",
              cron: "*/10 * * * *",
              description:
                "Lease and reconcile one bounded cursor-fair batch of due PII-free outbound and replacement carrier tracking reads for each active site.",
              handler: async () => {
                await npReconcileShopTracking(runtime.carrierTrackingPollAdapter!);
              },
            },
          ]
        : []),
      ...(runtime.carrierReturnTrackingPollAdapter
        ? [
            {
              id: "reconcile-carrier-return-tracking",
              cron: "5-59/10 * * * *",
              description:
                "Lease and reconcile one bounded cursor-fair batch of due PII-free return tracking reads for each active site.",
              handler: async () => {
                await npReconcileShopReturnTracking(runtime.carrierReturnTrackingPollAdapter!);
              },
            },
          ]
        : []),
      {
        id: "maintain-orders",
        cron: "31 * * * *",
        description:
          "Cancel expired pending orders, release inventory, redact private sidecars, remove leftover expired reservations, and purge old commercial snapshots in bounded batches.",
        handler: async () => {
          await npMaintainShopOrders();
        },
      },
    ],
    pageRoutes,
  });
  return { plugin, collections, runtime } as const;
}

const defaultShop = createShop();

export const shopPlugin = defaultShop.plugin;
export const shopCollections = defaultShop.collections;

export { classicShopSkin } from "./skins/classic.js";
export { storefrontFullShopSkin } from "./skins/storefront-full.js";
export { createShopHomeBlocks, shopHomePatterns } from "./home-blocks.js";
export {
  buildShopCatalogHref,
  normalizeShopCategoryIds,
  normalizeShopGalleryIds,
  normalizeShopVariants,
  getShopStockQuantity,
  npRequireShopCurrency,
  npShopCatalogLimits,
  npShopSkuPattern,
  npShopSlugPattern,
  parseShopCatalogQuery,
} from "./runtime.js";
export {
  npShopCheckoutIntentStatuses,
  npShopCurrencies,
  npShopInventoryReservationStatuses,
  npShopFulfillmentStatuses,
  npShopOrderCancellationReasons,
  npShopOrderDraftStatuses,
  npShopOrderPrivateDataStatuses,
  npShopOrderStatuses,
} from "./types.js";
export {
  NP_SHOP_INVENTORY_RESERVATION_CONTRACT,
  npAnalyzeShopInventoryReservation,
  npRequireShopInventoryReservation,
  npShopInventoryReservationLimits,
  npShopInventoryReservationStorageKey,
  npShopInventoryStockKey,
} from "./inventory-reservation-contract.js";
export type { NpShopInventoryReservation } from "./inventory-reservation-contract.js";
export {
  NP_SHOP_PAYMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_RECEIPT_CONTRACT,
  NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT,
  NpShopPaymentConflictError,
  NpShopPaymentContractError,
  NpShopPaymentVerificationError,
  npAnalyzeShopPaymentEvent,
  npAnalyzeStoredShopPaymentReceipt,
  npRequireFreshShopPaymentEvent,
  npIsIgnoredPaymentWebhook,
  npRequireShopPaymentEvent,
  npRequireShopPaymentProviderId,
  npRequireStoredShopPaymentReceipt,
  npShopPaymentEventDigest,
  npShopPaymentEventTypes,
  npShopPaymentLimits,
  npShopPaymentReceiptOutcomes,
  npShopPaymentReceiptStorageKey,
} from "./payment-contract.js";
export type {
  NpShopPaymentAdapter,
  NpShopPaymentInitiationAdapter,
  NpShopPaymentPartialRefundAdapter,
  NpShopPaymentReturnSettlementAdapter,
  NpShopPaymentRefundAdapter,
  NpShopPaymentEventType,
  NpShopIgnoredPaymentWebhook,
  NpShopPaymentReceiptOutcome,
  NpShopPaymentWebhookResult,
  NpShopPaymentWebhookInput,
  NpShopStoredPaymentReceipt,
  NpShopVerifiedPaymentEvent,
} from "./payment-contract.js";
export {
  NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_ADJUSTMENT_CONTRACT,
  NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT,
  NP_SHOP_PAYMENT_ADJUSTMENT_STORAGE_CONTRACT,
  NpShopPaymentAdjustmentConflictError,
  NpShopPaymentAdjustmentContractError,
  NpShopPaymentAdjustmentVerificationError,
  npAnalyzeShopPaymentAdjustmentEvent,
  npAnalyzeShopPaymentAdjustment,
  npIsShopPaymentAdjustmentEvent,
  npRequireFreshShopPaymentAdjustmentEvent,
  npRequireShopPaymentAdjustmentEvent,
  npRequireStoredShopPaymentAdjustment,
  npRequireStoredShopPaymentAdjustmentReceipt,
  npShopPaymentAdjustmentEventDigest,
  npProjectShopPaymentAdjustment,
  npShopPaymentAdjustmentLimits,
  npShopPaymentAdjustmentOutcomes,
  npShopPaymentAdjustmentReceiptStorageKey,
  npShopPaymentAdjustmentStatuses,
  npShopPaymentAdjustmentStorageKey,
} from "./payment-adjustment-contract.js";
export type {
  NpShopPaymentAdjustmentOutcome,
  NpShopPaymentAdjustment,
  NpShopPaymentAdjustmentStatus,
  NpShopPaymentCancellation,
  NpShopStoredPaymentAdjustment,
  NpShopStoredPaymentAdjustmentReceipt,
  NpShopVerifiedPaymentAdjustmentEvent,
} from "./payment-adjustment-contract.js";
export {
  NP_SHOP_REFUND_CONTRACT,
  NP_SHOP_REFUND_RESULT_CONTRACT,
  NP_SHOP_REFUND_STORAGE_CONTRACT,
  NpShopRefundConflictError,
  NpShopRefundContractError,
  npAnalyzeStoredShopRefund,
  npProjectShopRefund,
  npRequireShopPaymentRefundResult,
  npRequireShopRefundActionInput,
  npRequireStoredShopRefund,
  npShopRefundFulfillmentOutcomes,
  npShopRefundInventoryOutcomes,
  npShopRefundLimits,
  npShopRefundStatuses,
} from "./refund-contract.js";
export {
  NP_SHOP_PARTIAL_REFUND_CONTRACT,
  NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT,
  NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_SETTLEMENT_CONTRACT,
  NpShopPartialRefundConflictError,
  NpShopPartialRefundContractError,
  npAnalyzeShopPartialRefund,
  npAnalyzeStoredShopPartialRefund,
  npProjectShopPartialRefund,
  npRequireShopPartialRefund,
  npRequireShopPartialRefundActionInput,
  npRequireShopPaymentPartialRefundResult,
  npRequireShopReturnSettlementRefundActionInput,
  npRequireStoredShopPartialRefund,
  npShopPartialRefundLimits,
  npShopPartialRefundStatuses,
  npShopReturnPostageResponsibilities,
} from "./partial-refund-contract.js";
export type {
  NpShopPartialRefund,
  NpShopPartialRefundActionInput,
  NpShopPartialRefundAllocation,
  NpShopPartialRefundLine,
  NpShopPartialRefundStatus,
  NpShopPaymentPartialRefundInput,
  NpShopPaymentPartialRefundResult,
  NpShopPaymentReturnSettlementRefundInput,
  NpShopReturnPostageResponsibility,
  NpShopReturnPostageSettlement,
  NpShopReturnSettlementRefundActionInput,
  NpShopStoredPartialRefund,
} from "./partial-refund-contract.js";
export type {
  NpShopPaymentRefundInput,
  NpShopPaymentRefundResult,
  NpShopRefund,
  NpShopRefundActionInput,
  NpShopRefundFulfillmentOutcome,
  NpShopRefundInventoryOutcome,
  NpShopRefundStatus,
  NpShopStoredRefund,
} from "./refund-contract.js";
export {
  NP_SHOP_PAYMENT_ATTEMPT_CONTRACT,
  NP_SHOP_PAYMENT_HANDOFF_CONTRACT,
  NpShopPaymentAttemptConflictError,
  NpShopPaymentAttemptContractError,
  NpShopPaymentAttemptNotFoundError,
  NpShopPaymentProviderError,
  npAnalyzeStoredShopPaymentAttempt,
  npProjectShopPaymentAttempt,
  npRequireShopPaymentAttemptConfirmInput,
  npRequireShopPaymentAttemptCreateInput,
  npRequireShopPaymentPrepareResult,
  npRequireStoredShopPaymentAttempt,
  npShopPaymentAttemptLimits,
  npShopPaymentAttemptStoredStatuses,
  npShopPaymentHandoffKinds,
} from "./payment-attempt-contract.js";
export {
  NP_SHOP_DELIVERY_METHOD_CONTRACT,
  NP_SHOP_SHIPPING_QUOTE_CONTRACT,
  NP_SHOP_SHIPPING_QUOTE_REQUEST_CONTRACT,
  NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT,
  NP_SHOP_SHIPPING_HEALTH_CONTRACT,
  NpShopShippingContractError,
  NpShopShippingUnavailableError,
  npAnalyzeShopDeliveryMethod,
  npAnalyzeShopShippingQuote,
  npAnalyzeShopShippingQuoteRequest,
  npAnalyzeShopShippingHealth,
  npRequireShopDeliveryMethod,
  npRequireShopShippingMethodSelectInput,
  npRequireShopShippingProviderId,
  npRequireShopShippingQuote,
  npRequireShopShippingQuoteRequest,
  npRequireShopShippingQuoteResult,
  npRequireShopShippingHealth,
  npShopShippingLimits,
} from "./shipping-contract.js";
export type {
  NpShopDeliveryMethod,
  NpShopShippingAdapter,
  NpShopShippingEstimate,
  NpShopShippingMethod,
  NpShopShippingMethodSelectInput,
  NpShopShippingQuote,
  NpShopShippingQuoteRequest,
  NpShopShippingQuoteResult,
  NpShopShippingHealth,
} from "./shipping-contract.js";
export {
  NP_SHOP_TAX_HEALTH_CONTRACT,
  NP_SHOP_TAX_QUOTE_CONTRACT,
  NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT,
  NP_SHOP_TAX_QUOTE_RESULT_CONTRACT,
  NpShopTaxContractError,
  NpShopTaxUnavailableError,
  npAnalyzeShopTaxHealth,
  npAnalyzeShopTaxQuote,
  npAnalyzeShopTaxQuoteRequest,
  npRequireShopTaxHealth,
  npRequireShopTaxProviderId,
  npRequireShopTaxQuote,
  npRequireShopTaxQuoteRequest,
  npRequireShopTaxQuoteResult,
  npShopTaxLimits,
  npShopTaxMaximumExpiry,
} from "./tax-contract.js";
export type {
  NpShopTaxAdapter,
  NpShopTaxComponent,
  NpShopTaxHealth,
  NpShopTaxQuote,
  NpShopTaxQuoteRequest,
  NpShopTaxQuoteResult,
} from "./tax-contract.js";
export type {
  NpShopPaymentAttempt,
  NpShopPaymentAttemptConfirmInput,
  NpShopPaymentAttemptCreateInput,
  NpShopPaymentAttemptStatus,
  NpShopPaymentConfirmAdapterInput,
  NpShopPaymentHandoff,
  NpShopPaymentHandoffKind,
  NpShopPaymentJson,
  NpShopPaymentLauncher,
  NpShopPaymentLauncherProps,
  NpShopPaymentPrepareInput,
  NpShopPaymentPrepareResult,
  NpShopStoredPaymentAttempt,
} from "./payment-attempt-contract.js";
export {
  NP_SHOP_CART_QUOTE_CONTRACT,
  NP_SHOP_CART_STORAGE_CONTRACT,
  npAnalyzeShopCartStorageValue,
  npAnalyzeShopCartQuote,
  npIsShopCartIssueCode,
  npRequireShopCartAddInput,
  npRequireShopCartDeleteInput,
  npRequireShopCartSetQuantityInput,
  npRequireShopCartSetCouponsInput,
  npRequireShopCartQuote,
  npRequireShopCartStorageValue,
  npShopCartLimits,
  npShopCartLineKey,
} from "./cart-contract.js";
export type {
  NpShopCartAddInput,
  NpShopCartDeleteInput,
  NpShopCartSetQuantityInput,
  NpShopCartSetCouponsInput,
  NpShopCartStorageValue,
  NpShopCartStoredLine,
} from "./cart-contract.js";
export {
  NP_SHOP_CHECKOUT_INTENT_CONTRACT,
  npAnalyzeShopCheckoutIntent,
  npIsShopCheckoutIntentStatus,
  npRequireShopCheckoutCancelInput,
  npRequireShopCheckoutCreateInput,
  npRequireShopCheckoutIntent,
  npRequireShopCheckoutIntentId,
  npRequireShopCheckoutReadQuery,
  npShopCheckoutLimits,
} from "./checkout-contract.js";
export type { NpShopCheckoutCancelInput, NpShopCheckoutCreateInput } from "./checkout-contract.js";
export {
  NP_SHOP_ORDER_DRAFT_CONTRACT,
  npAnalyzeShopOrderDraft,
  npIsShopOrderDraftStatus,
  npRequireShopOrderDraft,
  npRequireShopOrderDraftCreateInput,
  npRequireShopOrderDraftDeleteInput,
  npRequireShopOrderDraftId,
  npRequireShopOrderDraftReadQuery,
  npRequireShopOrderDraftUpdateInput,
  npShopOrderDraftLimits,
} from "./order-draft-contract.js";
export {
  NP_SHOP_ORDER_CONTRACT,
  NP_SHOP_ORDER_LIST_CONTRACT,
  NP_SHOP_ORDER_PRIVATE_CONTRACT,
  NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT,
  NP_SHOP_ORDER_STORAGE_CONTRACT,
  npAnalyzeShopOrder,
  npAnalyzeStoredShopOrder,
  npAnalyzeStoredShopOrderPrivate,
  npRequireShopOrder,
  npRequireShopOrderCancelInput,
  npRequireShopOrderCreateInput,
  npRequireShopOrderId,
  npRequireShopOrderList,
  npShopOrderLimits,
} from "./order-contract.js";
export type { NpShopOrderCancelInput, NpShopOrderCreateInput } from "./order-contract.js";
export { createShopProductInquiryContextSource } from "./inquiry-context.js";
export {
  NP_SHOP_PRODUCT_REVIEW_CONTRACT,
  NP_SHOP_PRODUCT_REVIEW_PAGE_CONTRACT,
  NpShopProductReviewContractError,
  npEmptyShopProductReviewAggregate,
  npRequireShopProductReviewCreateInput,
  npRequireShopProductReviewModerationActionInput,
  npRequireShopProductReviewUpdateInput,
  npShopProductReviewLimits,
} from "./review-contract.js";
export type {
  NpShopProductReview,
  NpShopProductReviewAggregate,
  NpShopProductReviewAuthor,
  NpShopProductReviewCreateInput,
  NpShopProductReviewModerationActionInput,
  NpShopProductReviewEligibility,
  NpShopProductReviewPage,
  NpShopProductReviewPhoto,
  NpShopProductReviewUpdateInput,
} from "./review-contract.js";
export {
  npAttachShopProductReviewAggregates,
  npCountShopProductReviewRows,
  npGetShopProductReviewPage,
  npListShopProductReviewEligibility,
  npListShopProductReviews,
  npReadShopProductReviewAggregate,
} from "./review-service.js";
export {
  NP_SHOP_FULFILLMENT_CONTRACT,
  NP_SHOP_FULFILLMENT_STORAGE_CONTRACT,
  NpShopFulfillmentConflictError,
  NpShopFulfillmentContractError,
  npAnalyzeShopFulfillment,
  npAnalyzeStoredShopFulfillment,
  npProjectShopFulfillment,
  npRequireShopFulfillmentPrivateReadInput,
  npRequireShopFulfillmentProcessInput,
  npRequireShopFulfillmentShipInput,
  npRequireStoredShopFulfillment,
  npShopFulfillmentLimits,
} from "./fulfillment-contract.js";
export {
  NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT,
  NpShopFulfillmentParcelConflictError,
  NpShopFulfillmentParcelContractError,
  npAnalyzeShopFulfillmentParcels,
  npAnalyzeStoredShopFulfillmentParcels,
  npRequireShopFulfillmentParcelsSaveInput,
  npRequireStoredShopFulfillmentParcels,
  npShopFulfillmentParcelLimits,
  npShopFulfillmentParcelTotals,
} from "./parcel-contract.js";
export type {
  NpShopFulfillmentParcel,
  NpShopFulfillmentParcelItem,
  NpShopFulfillmentParcelsSaveInput,
  NpShopStoredFulfillmentParcels,
} from "./parcel-contract.js";
export {
  NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT,
  NpShopExchangeParcelConflictError,
  NpShopExchangeParcelContractError,
  npAnalyzeStoredShopExchangeParcels,
  npRequireShopExchangeParcelsSaveInput,
  npRequireStoredShopExchangeParcels,
} from "./exchange-parcel-contract.js";
export type {
  NpShopExchangeParcelsSaveInput,
  NpShopStoredExchangeParcels,
} from "./exchange-parcel-contract.js";
export {
  NP_SHOP_RETURN_CONTRACT,
  NP_SHOP_RETURN_STORAGE_CONTRACT,
  NpShopReturnConflictError,
  NpShopReturnContractError,
  npAnalyzeShopReturn,
  npAnalyzeStoredShopReturn,
  npProjectShopReturn,
  npRequireShopReturn,
  npRequireShopReturnApproveInput,
  npRequireShopReturnCancelInput,
  npRequireShopReturnReceiveInput,
  npRequireShopReturnRejectInput,
  npRequireShopReturnRequestInput,
  npRequireStoredShopReturn,
  npShopReturnInventoryOutcomes,
  npShopReturnLimits,
  npShopReturnReasons,
  npShopReturnStatuses,
} from "./return-contract.js";
export {
  NP_SHOP_EXCHANGE_DESTINATION_AUTHORITY_CONTRACT,
  NP_SHOP_EXCHANGE_DESTINATION_PRIVATE_CONTRACT,
  NpShopExchangeDestinationConflictError,
  NpShopExchangeDestinationContractError,
  npAnalyzeShopExchangeDestinationAuthority,
  npAnalyzeStoredShopExchangeDestinationPrivate,
  npRequireShopExchangeDestinationAuthority,
  npRequireShopExchangeDestinationReadInput,
  npRequireShopExchangeDestinationSubmitInput,
  npRequireStoredShopExchangeDestinationPrivate,
  npShopExchangeDestinationLimits,
} from "./exchange-destination-contract.js";
export {
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_REQUEST_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_RESULT_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_CANCEL_RESULT_CONTRACT,
  NpShopExchangeCarrierConflictError,
  NpShopExchangeCarrierContractError,
  npAnalyzeShopExchangeCarrierBookingRequest,
  npAnalyzeShopExchangeCarrierParcelBookingRequest,
  npAnalyzeStoredShopExchangeCarrierBooking,
  npRequireShopExchangeCarrierBookActionInput,
  npRequireShopExchangeCarrierBookingRequest,
  npRequireShopExchangeCarrierParcelBookingRequest,
  npRequireShopExchangeCarrierBookingResult,
  npRequireShopExchangeCarrierCancelRequest,
  npRequireShopExchangeCarrierCancelResult,
  npRequireShopExchangeCarrierExistingActionInput,
  npRequireStoredShopExchangeCarrierBooking,
  npShopExchangeCarrierBookingStatuses,
} from "./exchange-carrier-contract.js";
export type {
  NpShopExchangeCarrierBookActionInput,
  NpShopExchangeCarrierBookingRequest,
  NpShopExchangeCarrierParcelBookingRequest,
  NpShopExchangeCarrierBookingResult,
  NpShopExchangeCarrierBookingStatus,
  NpShopExchangeCarrierCancelRequest,
  NpShopExchangeCarrierCancelResult,
  NpShopExchangeCarrierExistingActionInput,
  NpShopStoredExchangeCarrierBooking,
} from "./exchange-carrier-contract.js";
export type {
  NpShopExchangeDestinationAuthority,
  NpShopExchangeDestinationReadInput,
  NpShopExchangeDestinationSubmitInput,
  NpShopStoredExchangeDestinationPrivate,
} from "./exchange-destination-contract.js";
export {
  NP_SHOP_EXCHANGE_CONTRACT,
  NP_SHOP_EXCHANGE_STORAGE_CONTRACT,
  NpShopExchangeConflictError,
  NpShopExchangeContractError,
  npAnalyzeShopExchange,
  npAnalyzeStoredShopExchange,
  npProjectShopExchange,
  npRequireShopExchange,
  npRequireShopExchangeCreateInput,
  npRequireShopExchangeShipInput,
  npRequireShopExchangeUpdateInput,
  npRequireStoredShopExchange,
  npShopExchangeDestinationStatuses,
  npShopExchangeInventoryOutcomes,
  npShopExchangeLimits,
  npShopExchangeLinesFromOrder,
  npShopExchangeStatuses,
} from "./exchange-contract.js";
export type {
  NpShopExchange,
  NpShopExchangeCreateInput,
  NpShopExchangeDestinationProjection,
  NpShopExchangeDestinationStatus,
  NpShopExchangeInventoryOutcome,
  NpShopExchangeLine,
  NpShopExchangeShipInput,
  NpShopExchangeStatus,
  NpShopExchangeUpdateInput,
  NpShopStoredExchange,
} from "./exchange-contract.js";
export {
  NP_SHOP_RETURN_LOGISTICS_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_CANCEL_RESULT_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_LABEL_REQUEST_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_LABEL_RESULT_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_PRIVATE_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_RESULT_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_STORAGE_CONTRACT,
  NpShopReturnLogisticsConflictError,
  NpShopReturnLogisticsContractError,
  NpShopReturnLogisticsProviderError,
  npAnalyzeShopReturnLogistics,
  npAnalyzeShopReturnLogisticsRequest,
  npAnalyzeShopReturnLogisticsResult,
  npAnalyzeStoredShopReturnLogistics,
  npAnalyzeStoredShopReturnLogisticsPrivate,
  npProjectShopReturnLogistics,
  npRequireShopReturnLocationReference,
  npRequireShopReturnLogistics,
  npRequireShopReturnLogisticsCancelRequest,
  npRequireShopReturnLogisticsCancelResult,
  npRequireShopReturnLogisticsCreateInput,
  npRequireShopReturnLogisticsExistingInput,
  npRequireShopReturnLogisticsLabelReadInput,
  npRequireShopReturnLogisticsLabelRequest,
  npRequireShopReturnLogisticsLabelResult,
  npRequireShopReturnLogisticsRequest,
  npRequireShopReturnLogisticsResult,
  npRequireStoredShopReturnLogistics,
  npRequireStoredShopReturnLogisticsPrivate,
  npShopReturnLogisticsLabelFormats,
  npShopReturnLogisticsLimits,
  npShopReturnLogisticsModes,
  npShopReturnLogisticsStatuses,
} from "./return-logistics-contract.js";
export {
  NP_SHOP_QUOTED_RETURN_LOGISTICS_REQUEST_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_HEALTH_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_PRIVATE_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_QUOTE_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_QUOTE_REQUEST_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_QUOTE_RESULT_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_STORAGE_CONTRACT,
  NpShopReturnPostageConflictError,
  NpShopReturnPostageContractError,
  NpShopReturnPostageUnavailableError,
  npAnalyzeShopReturnPostageHealth,
  npAnalyzeShopReturnPostageMethod,
  npAnalyzeShopReturnPostageQuote,
  npAnalyzeStoredShopReturnPostage,
  npAnalyzeStoredShopReturnPostagePrivate,
  npProjectShopReturnPostage,
  npRequireShopQuotedReturnLogisticsCreateInput,
  npRequireShopQuotedReturnLogisticsRequest,
  npRequireShopReturnPostageHealth,
  npRequireShopReturnPostageMethod,
  npRequireShopReturnPostageQuote,
  npRequireShopReturnPostageQuoteInput,
  npRequireShopReturnPostageQuoteRequest,
  npRequireShopReturnPostageQuoteResult,
  npRequireShopReturnPostageSelectInput,
  npRequireStoredShopReturnPostage,
  npRequireStoredShopReturnPostagePrivate,
  npShopReturnPostageLimits,
  npShopReturnPostageStatuses,
} from "./return-postage-contract.js";
export type {
  NpShopQuotedReturnLogisticsCreateInput,
  NpShopQuotedReturnLogisticsRequest,
  NpShopReturnPostageEstimate,
  NpShopReturnPostageHealth,
  NpShopReturnPostageMethod,
  NpShopReturnPostageQuote,
  NpShopReturnPostageQuoteInput,
  NpShopReturnPostageQuoteMethod,
  NpShopReturnPostageQuoteRequest,
  NpShopReturnPostageQuoteResult,
  NpShopReturnPostageSelectInput,
  NpShopReturnPostageStatus,
  NpShopStoredReturnPostage,
  NpShopStoredReturnPostagePrivate,
} from "./return-postage-contract.js";
export type {
  NpShopReturnLogistics,
  NpShopReturnLogisticsCancelRequest,
  NpShopReturnLogisticsCancelResult,
  NpShopReturnLogisticsCreateInput,
  NpShopReturnLogisticsExistingInput,
  NpShopReturnLogisticsItem,
  NpShopReturnLogisticsLabelFormat,
  NpShopReturnLogisticsLabelReadInput,
  NpShopReturnLogisticsLabelRequest,
  NpShopReturnLogisticsLabelResult,
  NpShopReturnLogisticsMode,
  NpShopReturnLogisticsRequest,
  NpShopReturnLogisticsResult,
  NpShopReturnLogisticsStatus,
  NpShopStoredReturnLogistics,
  NpShopStoredReturnLogisticsPrivate,
} from "./return-logistics-contract.js";
export type {
  NpShopReturn,
  NpShopReturnCancelInput,
  NpShopReturnInventoryOutcome,
  NpShopReturnLine,
  NpShopReturnReason,
  NpShopReturnRequestInput,
  NpShopReturnStaffInput,
  NpShopReturnStatus,
  NpShopStoredReturn,
} from "./return-contract.js";
export type {
  NpShopFulfillmentPrivateReadInput,
  NpShopFulfillmentProcessInput,
  NpShopFulfillmentShipInput,
  NpShopStoredFulfillment,
} from "./fulfillment-contract.js";
export {
  NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT,
  NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT,
  NP_SHOP_CARRIER_LABEL_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_LABEL_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT,
  NpShopCarrierConflictError,
  NpShopCarrierContractError,
  NpShopCarrierProviderError,
  NpShopCarrierUnavailableError,
  npAnalyzeShopCarrierBookingRequest,
  npAnalyzeShopCarrierBookingResult,
  npAnalyzeShopCarrierLabelRequest,
  npAnalyzeShopCarrierLabelResult,
  npAnalyzeShopCarrierParcelBookingRequest,
  npAnalyzeStoredShopCarrierBooking,
  npRequireShopCarrierBookingActionInput,
  npRequireShopCarrierBookingRequest,
  npRequireShopCarrierBookingResult,
  npRequireShopCarrierLabelReadInput,
  npRequireShopCarrierLabelRequest,
  npRequireShopCarrierLabelResult,
  npRequireShopCarrierParcelBookingRequest,
  npRequireShopCarrierProviderId,
  npRequireStoredShopCarrierBooking,
  npShopCarrierBookingStatuses,
  npShopCarrierLabelFormats,
  npShopCarrierLimits,
} from "./carrier-contract.js";
export type {
  NpShopCarrierAdapter,
  NpShopCarrierExchangeAdapter,
  NpShopCarrierExchangeParcelAdapter,
  NpShopCarrierLabelAcquisitionAdapter,
  NpShopCarrierLabelAdapter,
  NpShopCarrierLabelFormat,
  NpShopCarrierLabelReadInput,
  NpShopCarrierLabelRequest,
  NpShopCarrierLabelResult,
  NpShopCarrierParcelAdapter,
  NpShopCarrierPickupAvailabilityAdapter,
  NpShopCarrierPickupAdapter,
  NpShopCarrierReturnLabelAdapter,
  NpShopCarrierReturnLogisticsAdapter,
  NpShopCarrierReturnPostageAdapter,
  NpShopCarrierReturnTrackingAdapter,
  NpShopCarrierReturnTrackingPollAdapter,
  NpShopCarrierTrackingAdapter,
  NpShopCarrierTrackingPollAdapter,
  NpShopCarrierBookingActionInput,
  NpShopCarrierBookingItem,
  NpShopCarrierBookingRequest,
  NpShopCarrierBookingResult,
  NpShopCarrierParcelBookingRequest,
  NpShopCarrierBookingStatus,
  NpShopStoredCarrierBooking,
} from "./carrier-contract.js";
export {
  NP_SHOP_CARRIER_LABEL_ACQUISITION_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_LABEL_ACQUISITION_RESULT_CONTRACT,
  NP_SHOP_CARRIER_LABEL_ACQUISITION_STORAGE_CONTRACT,
  NpShopCarrierLabelAcquisitionConflictError,
  NpShopCarrierLabelAcquisitionContractError,
  npAnalyzeShopCarrierLabelAcquisitionRequest,
  npAnalyzeShopCarrierLabelAcquisitionResult,
  npAnalyzeStoredShopCarrierLabelAcquisition,
  npRequireShopCarrierLabelAcquisitionActionInput,
  npRequireShopCarrierLabelAcquisitionRequest,
  npRequireShopCarrierLabelAcquisitionResult,
  npRequireStoredShopCarrierLabelAcquisition,
  npShopCarrierLabelAcquisitionLimits,
  npShopCarrierLabelAcquisitionOperations,
  npShopCarrierLabelAcquisitionStatuses,
  npShopCarrierLabelAcquisitionTargets,
} from "./label-acquisition-contract.js";
export type {
  NpShopCarrierLabelAcquisitionActionInput,
  NpShopCarrierLabelAcquisitionOperation,
  NpShopCarrierLabelAcquisitionRequest,
  NpShopCarrierLabelAcquisitionResult,
  NpShopCarrierLabelAcquisitionStatus,
  NpShopCarrierLabelAcquisitionTarget,
  NpShopStoredCarrierLabelAcquisition,
} from "./label-acquisition-contract.js";
export {
  NP_SHOP_RETURN_TRACKING_CONTRACT,
  NP_SHOP_RETURN_TRACKING_EVENT_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_CURSOR_KEY,
  NP_SHOP_RETURN_TRACKING_POLL_REQUEST_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_STORAGE_CONTRACT,
  NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT,
  NP_SHOP_RETURN_TRACKING_STORAGE_CONTRACT,
  NpShopReturnTrackingConflictError,
  NpShopReturnTrackingContractError,
  NpShopReturnTrackingVerificationError,
  npAnalyzeShopReturnTracking,
  npAnalyzeShopReturnTrackingEvent,
  npIsIgnoredReturnTrackingWebhook,
  npProjectShopReturnTracking,
  npRequireFreshShopReturnTrackingEvent,
  npRequireShopReturnTrackingPollCursor,
  npRequireShopReturnTrackingPollRequest,
  npRequireShopReturnTrackingPollResult,
  npRequireShopReturnTrackingProviderId,
  npRequireShopReturnTrackingReconcileActionInput,
  npRequireStoredShopReturnTracking,
  npRequireStoredShopReturnTrackingPoll,
  npRequireStoredShopReturnTrackingReceipt,
  npShopReturnTrackingEventDigest,
  npShopReturnTrackingLimits,
  npShopReturnTrackingPollBackoffSeconds,
  npShopReturnTrackingPollErrorCodes,
  npShopReturnTrackingPollStorageKey,
  npShopReturnTrackingReceiptStorageKey,
  npShopReturnTrackingStorageKey,
} from "./return-tracking-contract.js";
export type {
  NpShopReturnTracking,
  NpShopReturnTrackingPollCurrent,
  NpShopReturnTrackingPollCursor,
  NpShopReturnTrackingPollErrorCode,
  NpShopReturnTrackingPollRequest,
  NpShopReturnTrackingPollResult,
  NpShopReturnTrackingReconcileActionInput,
  NpShopReturnTrackingWebhookResult,
  NpShopStoredReturnTracking,
  NpShopStoredReturnTrackingPoll,
  NpShopStoredReturnTrackingReceipt,
  NpShopVerifiedReturnTrackingEvent,
} from "./return-tracking-contract.js";
export {
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_HEALTH_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT,
  NpShopCarrierPickupAvailabilityConflictError,
  NpShopCarrierPickupAvailabilityContractError,
  NpShopCarrierPickupAvailabilityUnavailableError,
  npAnalyzeShopCarrierPickupAvailabilityHealth,
  npAnalyzeShopCarrierPickupAvailabilityRequest,
  npAnalyzeShopCarrierPickupAvailabilityResult,
  npAnalyzeStoredShopCarrierPickupAvailability,
  npRequireShopCarrierPickupAvailabilityHealth,
  npRequireShopCarrierPickupAvailabilityQueryInput,
  npRequireShopCarrierPickupAvailabilityRequest,
  npRequireShopCarrierPickupAvailabilityResult,
  npRequireShopCarrierPickupAvailabilitySelectionInput,
  npRequireStoredShopCarrierPickupAvailability,
  npShopCarrierPickupAvailabilityLimits,
} from "./pickup-availability-contract.js";
export type {
  NpShopCarrierPickupAvailabilityHealth,
  NpShopCarrierPickupAvailabilityQueryInput,
  NpShopCarrierPickupAvailabilityRequest,
  NpShopCarrierPickupAvailabilityResult,
  NpShopCarrierPickupAvailabilitySelectionInput,
  NpShopCarrierPickupAvailabilityWindow,
  NpShopStoredCarrierPickupAvailability,
} from "./pickup-availability-contract.js";
export {
  NP_SHOP_CARRIER_PICKUP_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT,
  NpShopCarrierPickupConflictError,
  NpShopCarrierPickupContractError,
  npAnalyzeShopCarrierPickupCancelRequest,
  npAnalyzeShopCarrierPickupCancelResult,
  npAnalyzeShopCarrierPickupRequest,
  npAnalyzeShopCarrierPickupResult,
  npAnalyzeStoredShopCarrierPickup,
  npRequireShopCarrierPickupCancelInput,
  npRequireShopCarrierPickupCancelRequest,
  npRequireShopCarrierPickupCancelResult,
  npRequireShopCarrierPickupLocationReference,
  npRequireShopCarrierPickupRequest,
  npRequireShopCarrierPickupResult,
  npRequireShopCarrierPickupResumeInput,
  npRequireShopCarrierPickupScheduleInput,
  npRequireStoredShopCarrierPickup,
  npShopCarrierPickupLimits,
  npShopCarrierPickupStatuses,
  npShopCarrierPickupTargets,
} from "./pickup-contract.js";
export type {
  NpShopCarrierPickupCancelRequest,
  NpShopCarrierPickupCancelResult,
  NpShopCarrierPickupExistingActionInput,
  NpShopCarrierPickupPackage,
  NpShopCarrierPickupRequest,
  NpShopCarrierPickupResult,
  NpShopCarrierPickupScheduleInput,
  NpShopCarrierPickupStatus,
  NpShopCarrierPickupTarget,
  NpShopStoredCarrierPickup,
} from "./pickup-contract.js";
export {
  NP_SHOP_TRACKING_CONTRACT,
  NP_SHOP_TRACKING_EVENT_CONTRACT,
  NP_SHOP_TRACKING_RECEIPT_CONTRACT,
  NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT,
  NP_SHOP_TRACKING_POLL_CURSOR_KEY,
  NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT,
  NP_SHOP_TRACKING_POLL_RESULT_CONTRACT,
  NP_SHOP_TRACKING_POLL_STORAGE_CONTRACT,
  NP_SHOP_TRACKING_STORAGE_CONTRACT,
  NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT,
  NpShopTrackingConflictError,
  NpShopTrackingContractError,
  NpShopTrackingVerificationError,
  npAnalyzeShopTracking,
  npAnalyzeShopTrackingEvent,
  npAnalyzeShopTrackingPollRequest,
  npAnalyzeStoredShopTracking,
  npAnalyzeStoredShopTrackingPoll,
  npAnalyzeStoredShopTrackingReceipt,
  npIsIgnoredTrackingWebhook,
  npProjectShopTracking,
  npRequireFreshShopTrackingEvent,
  npRequireShopTrackingProviderId,
  npRequireShopTrackingPollCursor,
  npRequireShopTrackingPollRequest,
  npRequireShopTrackingPollResult,
  npRequireShopTrackingReconcileActionInput,
  npRequireStoredShopTracking,
  npRequireStoredShopTrackingPoll,
  npRequireStoredShopTrackingReceipt,
  npShopTrackingEventDigest,
  npShopExchangeTrackingPollStorageKey,
  npShopExchangeTrackingStorageKey,
  npShopTrackingLimits,
  npShopTrackingPollBackoffSeconds,
  npShopTrackingPollErrorCodes,
  npShopTrackingPollStorageKey,
  npShopTrackingReceiptOutcomes,
  npShopTrackingReceiptStorageKey,
  npShopTrackingStatuses,
  npShopTrackingStorageKey,
} from "./tracking-contract.js";
export type {
  NpShopIgnoredTrackingWebhook,
  NpShopStoredTracking,
  NpShopStoredTrackingPoll,
  NpShopStoredTrackingReceipt,
  NpShopTracking,
  NpShopTrackingPollCurrent,
  NpShopTrackingPollCursor,
  NpShopTrackingPollErrorCode,
  NpShopTrackingPollRequest,
  NpShopTrackingPollResult,
  NpShopTrackingReconcileActionInput,
  NpShopTrackingReceiptOutcome,
  NpShopTrackingStatus,
  NpShopTrackingWebhookInput,
  NpShopTrackingWebhookResult,
  NpShopVerifiedTrackingEvent,
} from "./tracking-contract.js";
export type {
  NpShopOrderDraftCreateInput,
  NpShopOrderDraftDeleteInput,
  NpShopOrderDraftUpdateInput,
} from "./order-draft-contract.js";
export {
  NP_SHOP_PROMOTION_SNAPSHOT_CONTRACT,
  npAnalyzeShopPromotionSnapshot,
  npEvaluateShopPromotions,
  npNormalizeShopCouponCode,
  npNormalizeShopCouponCodes,
  npRequireShopPromotionSnapshot,
  npShopPromotionLimits,
} from "./promotion-contract.js";
export type {
  NpShopPromotionDefinition,
  NpShopPromotionEvaluationLine,
} from "./promotion-contract.js";
export {
  NP_SHOP_SHIPPING_POLICY_PROVIDER_ID,
  npEvaluateShopShippingPolicies,
  npNormalizeShopShippingPolicy,
  npShopShippingPolicyLimits,
} from "./shipping-policy-contract.js";
export type {
  NpShopShippingPolicyCartScope,
  NpShopShippingPolicyDefinition,
  NpShopShippingPolicyDestinationScope,
  NpShopShippingPolicyDocument,
  NpShopShippingPolicyEvaluation,
  NpShopShippingPolicyKind,
  NpShopShippingPolicyLine,
  NpShopShippingPolicyThresholdBasis,
} from "./shipping-policy-contract.js";
export type {
  NpShopAppliedPromotion,
  NpShopCartClientMessages,
  NpShopCartIssueCode,
  NpShopCartLine,
  NpShopCartQuote,
  NpShopCartSkinProps,
  NpShopCartTotal,
  NpShopCheckoutIntent,
  NpShopCheckoutIntentLine,
  NpShopCheckoutIntentStatus,
  NpShopCheckoutSkinProps,
  NpShopOrderDraft,
  NpShopOrderDraftCustomer,
  NpShopOrderDraftShipping,
  NpShopOrderDraftSkinProps,
  NpShopOrderDraftStatus,
  NpShopOrder,
  NpShopOrderCancellationReason,
  NpShopOrderList,
  NpShopOrderPrivateDataStatus,
  NpShopOrderSkinProps,
  NpShopOrdersSkinProps,
  NpShopOrderStatus,
  NpShopCatalogQuery,
  NpShopCatalogSkinProps,
  NpShopCategory,
  NpShopCategorySkinProps,
  NpShopCollectionSlugs,
  NpShopContextualQuestionsAdapter,
  NpShopCurrency,
  NpShopInventoryState,
  NpShopInventoryReservationStatus,
  NpShopFulfillment,
  NpShopFulfillmentStatus,
  NpShopMessages,
  NpShopProduct,
  NpShopProductInquiryContextSource,
  NpShopProductInquiryContextTarget,
  NpShopProductSkinProps,
  NpShopProductSummary,
  NpShopReviewClientMessages,
  NpShopPromotionKind,
  NpShopPromotionLineDiscount,
  NpShopPromotionSnapshot,
  NpShopPromotionTarget,
  NpShopSkin,
  NpShopVariant,
  NpShopWishlistPage,
  NpShopWishlistSkinProps,
} from "./types.js";
export type { NpShopProductInquiryContextSourceOptions } from "./inquiry-context.js";
export {
  npCountShopWishlistSaves,
  npGetShopWishlistPage,
  npListShopWishlistSavedProductIds,
  npShopWishlistLimits,
  parseShopWishlistPage,
} from "./wishlist-service.js";
export {
  NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT,
  NP_SHOP_RESTOCK_NOTIFICATION_KIND,
  NpShopRestockAlertContractError,
  npAnalyzeShopRestockAlertStorage,
  npRequireShopRestockAlertInput,
  npRequireShopRestockAlertListWire,
  npRequireShopRestockAlertMutationWire,
  npRequireShopRestockAlertStorage,
  npShopRestockAlertLimits,
  npToShopRestockAlertWire,
} from "./restock-alert-contract.js";
export type {
  NpShopRestockAlertInput,
  NpShopRestockAlertListWire,
  NpShopRestockAlertMutationWire,
  NpShopRestockAlertOutcome,
  NpShopRestockAlertStatus,
  NpShopRestockAlertStorage,
  NpShopRestockAlertWire,
} from "./restock-alert-contract.js";
export {
  npCancelShopRestockAlert,
  npCleanupShopRestockAlerts,
  npDeleteShopRestockAlertsForProduct,
  npInspectShopRestockAlerts,
  npListShopRestockAlerts,
  npProcessShopRestockAlerts,
  npResolveShopRestockTarget,
  npSubscribeShopRestockAlert,
} from "./restock-alert-service.js";
export {
  NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT,
  NP_SHOP_PRICE_DROP_NOTIFICATION_KIND,
  NpShopPriceAlertContractError,
  npAnalyzeShopPriceAlertStorage,
  npRequireShopPriceAlertInput,
  npRequireShopPriceAlertListWire,
  npRequireShopPriceAlertMutationWire,
  npRequireShopPriceAlertStorage,
  npShopPriceAlertLimits,
  npToShopPriceAlertWire,
} from "./price-alert-contract.js";
export type {
  NpShopPriceAlertInput,
  NpShopPriceAlertListWire,
  NpShopPriceAlertMutationWire,
  NpShopPriceAlertOutcome,
  NpShopPriceAlertStatus,
  NpShopPriceAlertStorage,
  NpShopPriceAlertWire,
} from "./price-alert-contract.js";
export {
  npCancelShopPriceAlert,
  npCleanupShopPriceAlerts,
  npDeleteShopPriceAlertsForProduct,
  npInspectShopPriceAlerts,
  npListShopPriceAlerts,
  npListShopPriceAlertsForProducts,
  npProcessShopPriceAlerts,
  npResolveShopPriceAlertTarget,
  npSubscribeShopPriceAlert,
} from "./price-alert-service.js";
export type {
  NpShopPriceAlertInspection,
  NpShopPriceAlertProcessResult,
  NpShopPriceAlertTargetState,
} from "./price-alert-service.js";
export {
  NP_SHOP_ORDER_NOTIFICATION_KIND,
  NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT,
  NP_SHOP_ORDER_NOTIFICATION_PRIVATE_CONTRACT,
  NP_SHOP_ORDER_NOTIFICATION_STORAGE_CONTRACT,
  NpShopOrderNotificationContractError,
  npAnalyzeShopOrderNotificationPrivate,
  npAnalyzeShopOrderNotificationStorage,
  npRequireShopOrderNotificationListWire,
  npRequireShopOrderNotificationPrivate,
  npRequireShopOrderNotificationStorage,
  npShopOrderNotificationKinds,
  npShopOrderNotificationLimits,
} from "./order-notification-contract.js";
export type {
  NpShopOrderNotificationChannelStatus,
  NpShopOrderNotificationKind,
  NpShopOrderNotificationListWire,
  NpShopOrderNotificationPrivate,
  NpShopOrderNotificationStatus,
  NpShopOrderNotificationStorage,
  NpShopOrderNotificationWire,
} from "./order-notification-contract.js";
export {
  npBuildShopOrderNotificationEmail,
  npCleanupShopOrderNotifications,
  npInspectShopOrderNotifications,
  npListRecentShopOrderNotifications,
  npListShopOrderNotifications,
  npProcessShopOrderNotifications,
  npRetryShopOrderNotifications,
} from "./order-notification-service.js";
export type {
  NpShopOrderNotificationAdminRow,
  NpShopOrderNotificationInspection,
  NpShopOrderNotificationProcessResult,
} from "./order-notification-service.js";
export type {
  NpShopRestockAlertInspection,
  NpShopRestockProcessResult,
  NpShopRestockTargetState,
} from "./restock-alert-service.js";

export default shopPlugin;
