import {
  definePlugin,
  npAdminStatus,
  npAdminTable,
  type NpPluginContext,
  type NpPluginPageRouteRegistration,
} from "@nexpress/plugin-sdk";

import { createShopCartApiHandler } from "./cart-api.js";
import { npCleanupExpiredShopCarts, npCountShopCarts } from "./cart-service.js";
import { createShopCheckoutApiHandler } from "./checkout-api.js";
import { createShopCarrierLabelApiHandler } from "./carrier-label-api.js";
import {
  npCleanupExpiredShopCheckoutIntents,
  npCountShopCheckoutIntents,
} from "./checkout-service.js";
import { defineShopCategoriesCollection, defineShopProductsCollection } from "./collections.js";
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
import {
  npRequireShopCarrierBookingActionInput,
  npRequireShopCarrierProviderId,
  type NpShopCarrierAdapter,
  type NpShopCarrierLabelAdapter,
  type NpShopCarrierParcelAdapter,
  type NpShopCarrierTrackingAdapter,
  type NpShopCarrierTrackingPollAdapter,
} from "./carrier-contract.js";
import {
  npBookShopCarrierShipment,
  npCountShopCarrierBookings,
  npCountShopOrders,
  npCountShopPaymentEvents,
  npCountShopFulfillments,
  npCountShopFulfillmentParcels,
  npCountShopRefunds,
  npCountShopReturns,
  npListRecentShopFulfillments,
  npListRecentShopFulfillmentParcels,
  npListRecentShopCarrierBookings,
  npListRecentShopOrders,
  npListRecentShopPaymentEvents,
  npListRecentShopRefunds,
  npListRecentShopReturns,
  npMaintainShopOrders,
  npProcessShopFulfillment,
  npReadShopFulfillmentPrivate,
  npRefundShopOrder,
  npApproveShopReturn,
  npReceiveShopReturn,
  npRejectShopReturn,
  npShipShopFulfillment,
  npSaveShopFulfillmentParcels,
} from "./order-service.js";
import {
  npRequireShopFulfillmentPrivateReadInput,
  npRequireShopFulfillmentProcessInput,
  npRequireShopFulfillmentShipInput,
} from "./fulfillment-contract.js";
import { npRequireShopFulfillmentParcelsSaveInput } from "./parcel-contract.js";
import { npRequireShopRefundActionInput } from "./refund-contract.js";
import { createShopReturnApiHandler } from "./return-api.js";
import {
  npRequireShopReturnApproveInput,
  npRequireShopReturnReceiveInput,
  npRequireShopReturnRejectInput,
} from "./return-contract.js";
import { createShopPaymentApiHandler } from "./payment-api.js";
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
import type { NpShopRuntime } from "./runtime.js";
import {
  npRequireShopShippingProviderId,
  type NpShopShippingAdapter,
} from "./shipping-contract.js";
import { npRequireShopTaxProviderId, type NpShopTaxAdapter } from "./tax-contract.js";
import { classicShopSkin } from "./skins/classic.js";
import { storefrontFullShopSkin } from "./skins/storefront-full.js";
import type { NpShopCollectionSlugs, NpShopSkin } from "./types.js";

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
  /** Optional server-only carrier booking and tracking provider. */
  carrier?: {
    adapter: NpShopCarrierAdapter;
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
  };
  if (!SAFE_SEGMENT.test(collections.categories) || !SAFE_SEGMENT.test(collections.products)) {
    throw new Error("Shop collection slugs must be lowercase literal segments.");
  }
  if (collections.categories === collections.products) {
    throw new Error("Shop category and product collection slugs must be different.");
  }
  const configuredPaymentAdapter = options.payment?.adapter ?? null;
  let paymentAdapter: NpShopPaymentAdapter | null = null;
  let paymentInitiationAdapter: NpShopPaymentInitiationAdapter | null = null;
  let paymentRefundAdapter: NpShopPaymentRefundAdapter | null = null;
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
  let carrierLabelAdapter: NpShopCarrierLabelAdapter | null = null;
  let carrierParcelAdapter: NpShopCarrierParcelAdapter | null = null;
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
  }
  return {
    basePath: requireBasePath(options.basePath ?? "/shop"),
    collections,
    defaultSkinId,
    skins,
    paymentAdapter,
    paymentInitiationAdapter,
    paymentRefundAdapter,
    shippingAdapter,
    taxAdapter,
    carrierAdapter,
    carrierLabelAdapter,
    carrierParcelAdapter,
    carrierTrackingAdapter,
    carrierTrackingPollAdapter,
  };
}

const messages = {
  en: {
    "shop.catalog": "Shop",
    "shop.products": "products",
    "shop.categories": "Categories",
    "shop.featuredProducts": "Featured products",
    "shop.featured": "Featured",
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
    "shop.orderExpires": "Pending order expires",
    "shop.orderCreated": "Created",
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
    "shop.orderExpires": "결제 대기 만료",
    "shop.orderCreated": "생성",
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
  const collections = [
    defineShopCategoriesCollection(runtime),
    defineShopProductsCollection(runtime),
  ] as const;
  const blocks = createShopHomeBlocks(runtime);
  const cartApiHandler = createShopCartApiHandler(runtime);
  const checkoutApiHandler = createShopCheckoutApiHandler(runtime);
  const orderDraftApiHandler = createShopOrderDraftApiHandler(runtime);
  const orderApiHandler = createShopOrderApiHandler(runtime);
  const returnApiHandler = createShopReturnApiHandler();
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
        "Product catalog, bounded carts, checkout intents, private order drafts, provider-neutral shipping and additional-tax quotes, durable orders, optional payment and carrier adapters, fulfillment parcels, tracking, and return operations, public storefront routes, skins, and homepage blocks.",
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
        collections: [runtime.collections.categories, runtime.collections.products],
        adminExtensions: [
          "dashboard:shop-products",
          "dashboard:shop-low-stock",
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
          "dashboard:shop-tracking-events",
          "widget:shop-tracking-event-health",
          "table:shop-tracking-events",
          "widget:shop-tracking-poll-health",
          "table:shop-tracking-polls",
          ...(runtime.carrierTrackingPollAdapter ? ["action:shop-tracking-poll"] : []),
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
          "dashboard:shop-returns",
          "widget:shop-return-health",
          "table:shop-returns",
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
          "/returns",
          ...(paymentApiHandler ? ["/payments/webhook"] : []),
          ...(trackingApiHandler ? ["/carrier/tracking/webhook"] : []),
          ...(carrierLabelApiHandler ? ["/carrier/shipping-label"] : []),
          ...(paymentAttemptApiHandler ? ["/payments/attempts"] : []),
        ],
        hooks: [],
      },
      agent: {
        description:
          "Catalog, bounded cart, checkout-intent, private order-draft, optional provider-neutral shipping and additional-tax quotes, exact order totals, durable orders, transaction-safe inventory reservations, optional provider-neutral payment initiation, verified payment events, full refunds with safe compensation, revision-safe fulfillment and parcel snapshots, carrier booking, transient shipping-label retrieval, verified or reconciled tracking, and physical return intake. Tax remittance/filing, exemptions, invoices, customs, provider settlement, reversals, partial refunds, exchanges, label purchase, pickup, and provider-specific carrier protocols remain external.",
        category: "ecommerce",
        tags: ["shop", "catalog", "product", "inventory", "storefront"],
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
        "fulfillment-status": "[data-np-shop-fulfillment-status]",
        "tracking-status": "[data-np-shop-tracking-status]",
        "return-status": "[data-np-shop-return-status]",
        "product-card": ".np-shop-product-card",
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
          id: "shop-tracking-events-total",
          label: "Tracking events",
          kind: "metric",
          actionId: "countTrackingEvents",
          description: "Verified PII-free carrier events retained with their shipments.",
          priority: 31,
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
          id: "shop-refunds-total",
          label: "Refunds",
          kind: "metric",
          actionId: "countRefunds",
          description: "Durable full-refund attempts and completed inventory compensation.",
          priority: 34,
        },
        {
          id: "shop-returns-total",
          label: "Returns",
          kind: "metric",
          actionId: "countReturns",
          description: "Durable item-level physical return requests for shipped orders.",
          priority: 35,
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
          id: "shop-payment-event-health",
          label: "Payment event contract",
          kind: "status",
          actionId: "paymentEventHealth",
        },
        {
          id: "shop-refund-health",
          label: "Refund contract",
          kind: "status",
          actionId: "refundHealth",
        },
        {
          id: "shop-return-health",
          label: "Return contract",
          kind: "status",
          actionId: "returnHealth",
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
                  description: "Partial refunds are not supported.",
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
                    visibleWhen: { field: "status", oneOf: ["completed"] },
                    description:
                      "Retrieve the current label from the carrier without storing its bytes in NexPress.",
                  },
                ]
              : []),
          ],
          emptyMessage: "No carrier shipment booking exists for this site.",
        },
        {
          id: "shop-tracking-events",
          label: "Recent verified carrier tracking events (PII withheld)",
          columns: [
            { name: "provider", label: "Provider" },
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
          ],
          emptyMessage: "No Shop physical return exists for this site.",
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
                delta: `${counts.shippingSelectionRequired.toString()} awaiting delivery selection; ${counts.expired.toString()} expired; shipping ${runtime.shippingAdapter?.id ?? "disabled"}; tax ${runtime.taxAdapter?.id ?? "disabled"}`,
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
                    `${counts.collecting.toString()} collecting, ${counts.shippingSelectionRequired.toString()} awaiting delivery selection, ${counts.reviewable.toString()} reviewable, ${counts.expired.toString()} expired draft(s); shipping ${runtime.shippingAdapter?.id ?? "disabled"}; tax ${runtime.taxAdapter?.id ?? "disabled"}; values are withheld.`,
                  )
                : npAdminStatus(
                    "ok",
                    `${counts.collecting.toString()} collecting, ${counts.shippingSelectionRequired.toString()} awaiting delivery selection, ${counts.reviewable.toString()} reviewable private draft(s); shipping ${runtime.shippingAdapter?.id ?? "disabled"}; tax ${runtime.taxAdapter?.id ?? "disabled"}; values are withheld.`,
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
      countTrackingEvents: {
        kind: "metric" as const,
        handler: async () => {
          try {
            const counts = await npCountShopTrackingEvents(runtime.carrierTrackingAdapter?.id);
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
            const counts = await npCountShopTrackingEvents(runtime.carrierTrackingAdapter?.id);
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
              data: `Cancelled ${result.cancelled.toString()} expired pending order(s), deleted ${result.privateRedacted.toString()} overdue fulfillment private sidecar(s), purged ${result.purged.toString()} expired commercial snapshot(s), and removed ${result.reservationsCleaned.toString()} leftover expired reservation row(s).`,
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
                "Verify one exact provider callback and idempotently resolve its pending order.",
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
                "Verify one exact carrier callback and idempotently advance its PII-free shipment tracking state.",
              auth: false,
              bodyMode: "raw" as const,
              handler: trackingApiHandler,
            },
          ]
        : []),
      ...(carrierLabelApiHandler
        ? [
            {
              method: "GET" as const,
              path: "/carrier/shipping-label",
              description:
                "Retrieve one completed carrier booking label as bounded transient bytes.",
              auth: true,
              responseMode: "binary" as const,
              handler: carrierLabelApiHandler,
            },
          ]
        : []),
    ],
    scheduled: [
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
      ...(runtime.carrierTrackingPollAdapter
        ? [
            {
              id: "reconcile-carrier-tracking",
              cron: "*/10 * * * *",
              description:
                "Lease and reconcile one bounded cursor-fair batch of due PII-free carrier tracking reads for each active site.",
              handler: async () => {
                await npReconcileShopTracking(runtime.carrierTrackingPollAdapter!);
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
  npRequireShopCartQuote,
  npRequireShopCartStorageValue,
  npShopCartLimits,
  npShopCartLineKey,
} from "./cart-contract.js";
export type {
  NpShopCartAddInput,
  NpShopCartDeleteInput,
  NpShopCartSetQuantityInput,
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
  NpShopCarrierLabelAdapter,
  NpShopCarrierLabelFormat,
  NpShopCarrierLabelReadInput,
  NpShopCarrierLabelRequest,
  NpShopCarrierLabelResult,
  NpShopCarrierParcelAdapter,
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
export type {
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
  NpShopCurrency,
  NpShopInventoryState,
  NpShopInventoryReservationStatus,
  NpShopFulfillment,
  NpShopFulfillmentStatus,
  NpShopMessages,
  NpShopProduct,
  NpShopProductSkinProps,
  NpShopProductSummary,
  NpShopSkin,
  NpShopVariant,
} from "./types.js";

export default shopPlugin;
