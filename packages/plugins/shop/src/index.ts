import {
  definePlugin,
  npAdminStatus,
  npAdminTable,
  type NpPluginPageRouteRegistration,
} from "@nexpress/plugin-sdk";

import { createShopCartApiHandler } from "./cart-api.js";
import { npCleanupExpiredShopCarts, npCountShopCarts } from "./cart-service.js";
import { createShopCheckoutApiHandler } from "./checkout-api.js";
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
import { npCleanupExpiredShopOrderDrafts, npCountShopOrderDrafts } from "./order-draft-service.js";
import { createShopOrderApiHandler } from "./order-api.js";
import {
  npCountShopOrders,
  npCountShopPaymentEvents,
  npListRecentShopOrders,
  npListRecentShopPaymentEvents,
  npMaintainShopOrders,
} from "./order-service.js";
import { createShopPaymentApiHandler } from "./payment-api.js";
import { createShopPaymentAttemptApiHandler } from "./payment-attempt-api.js";
import {
  npCountShopPaymentAttempts,
  npListRecentShopPaymentAttempts,
} from "./payment-attempt-service.js";
import {
  npRequireShopPaymentProviderId,
  type NpShopPaymentAdapter,
  type NpShopPaymentInitiationAdapter,
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
  if (configuredPaymentAdapter) {
    const id = npRequireShopPaymentProviderId(configuredPaymentAdapter.id);
    if (typeof configuredPaymentAdapter.verifyWebhook !== "function") {
      throw new Error("Shop payment adapter verifyWebhook must be a function.");
    }
    const verifyWebhook = configuredPaymentAdapter.verifyWebhook.bind(configuredPaymentAdapter);
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
  return {
    basePath: requireBasePath(options.basePath ?? "/shop"),
    collections,
    defaultSkinId,
    skins,
    paymentAdapter,
    paymentInitiationAdapter,
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
      "Saving these details does not place an order, reserve inventory, calculate shipping or tax, or take payment.",
    "shop.orderDraftFailed": "The order draft could not be updated.",
    "shop.order": "Order",
    "shop.orders": "Orders",
    "shop.orderCreate": "Create pending order",
    "shop.orderCreating": "Creating order…",
    "shop.orderPendingPayment": "Pending payment",
    "shop.orderPaid": "Paid",
    "shop.orderPaymentFailed": "Payment failed",
    "shop.orderCancelled": "Cancelled",
    "shop.orderPaymentVerified":
      "The provider callback was verified and this order was marked paid.",
    "shop.orderPaymentFailedDetail":
      "The provider reported a failed payment. Inventory was released and private details were deleted.",
    "shop.orderPrivateRetained":
      "Private delivery details are retained only until the original 24-hour privacy deadline.",
    "shop.orderPrivateRedacted": "Private delivery details were permanently deleted.",
    "shop.orderInventoryHeld": "Tracked inventory is reserved until this order expires.",
    "shop.orderInventoryConsumed": "Reserved tracked inventory was deducted.",
    "shop.orderInventoryReleased": "The inventory reservation was released.",
    "shop.orderInventoryNotRequired": "This order does not use tracked inventory.",
    "shop.orderExpires": "Pending order expires",
    "shop.orderCreated": "Created",
    "shop.orderCancel": "Cancel order and delete private details",
    "shop.orderHistory": "Order history",
    "shop.orderEmpty": "No orders have been created for this browser identity.",
    "shop.orderReference": "Order reference",
    "shop.orderPaymentUnavailable":
      "This order remains pending until an enabled provider supplies a verified callback. Tax, shipping rates, fulfillment, and refunds are not connected.",
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
      "정보를 저장해도 주문 생성, 재고 예약, 배송비·세금 계산 또는 결제가 실행되지 않습니다.",
    "shop.orderDraftFailed": "주문 초안을 갱신하지 못했습니다.",
    "shop.order": "주문",
    "shop.orders": "주문 내역",
    "shop.orderCreate": "결제 대기 주문 만들기",
    "shop.orderCreating": "주문 만드는 중…",
    "shop.orderPendingPayment": "결제 대기",
    "shop.orderPaid": "결제 완료",
    "shop.orderPaymentFailed": "결제 실패",
    "shop.orderCancelled": "취소됨",
    "shop.orderPaymentVerified": "결제사 콜백을 검증했고 주문을 결제 완료로 전환했습니다.",
    "shop.orderPaymentFailedDetail":
      "결제사가 실패를 알렸습니다. 재고 예약을 해제하고 배송 개인정보를 삭제했습니다.",
    "shop.orderPrivateRetained": "배송 개인정보는 최초 24시간 개인정보 보관 기한까지만 유지됩니다.",
    "shop.orderPrivateRedacted": "배송 개인정보가 영구 삭제되었습니다.",
    "shop.orderInventoryHeld": "재고 추적 상품은 이 주문이 만료될 때까지 예약됩니다.",
    "shop.orderInventoryConsumed": "예약된 추적 재고를 차감했습니다.",
    "shop.orderInventoryReleased": "재고 예약이 해제되었습니다.",
    "shop.orderInventoryNotRequired": "이 주문에는 재고 추적 상품이 없습니다.",
    "shop.orderExpires": "결제 대기 만료",
    "shop.orderCreated": "생성",
    "shop.orderCancel": "주문 취소 및 개인정보 삭제",
    "shop.orderHistory": "주문 내역",
    "shop.orderEmpty": "이 브라우저 식별자로 만든 주문이 없습니다.",
    "shop.orderReference": "주문 번호",
    "shop.orderPaymentUnavailable":
      "활성 결제사가 검증된 콜백을 보낼 때까지 결제 대기 상태입니다. 세금·배송비, 배송 처리 및 환불은 연결되지 않았습니다.",
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
  const paymentApiHandler = runtime.paymentAdapter ? createShopPaymentApiHandler(runtime) : null;
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
        "Product catalog, bounded carts, checkout intents, private order drafts, durable orders, optional payment initiation and verified events, public storefront routes, skins, and homepage blocks.",
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
          "dashboard:shop-inventory-reservations",
          "widget:shop-inventory-reservation-health",
          "table:shop-inventory-reservations",
          "action:shop-order-maintenance",
          "dashboard:shop-payment-events",
          "widget:shop-payment-event-health",
          "table:shop-payment-events",
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
          ...(paymentApiHandler ? ["/payments/webhook"] : []),
          ...(paymentAttemptApiHandler ? ["/payments/attempts"] : []),
        ],
        hooks: [],
      },
      agent: {
        description:
          "Catalog, bounded cart, checkout-intent, private order-draft, durable orders, transaction-safe inventory reservations, optional provider-neutral payment initiation, and verified payment events. Provider implementations, settlement, reversals, refunds, tax, shipping rates, and fulfillment remain external.",
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
          priority: 28,
        },
        {
          id: "shop-payment-events-total",
          label: "Payment events",
          kind: "metric",
          actionId: "countPaymentEvents",
          description:
            "Verified, PII-free provider event receipts retained with their commercial orders.",
          priority: 29,
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
                priority: 30,
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
          id: "shop-payment-event-health",
          label: "Payment event contract",
          kind: "status",
          actionId: "paymentEventHealth",
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
            { name: "status", label: "Status" },
            { name: "total", label: "Total" },
            { name: "units", label: "Units" },
            { name: "privateData", label: "Private data" },
            { name: "inventory", label: "Inventory" },
            { name: "createdAt", label: "Created" },
          ],
          rowsActionId: "recentOrders",
          emptyMessage: "No durable Shop orders exist for this site.",
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
                value: counts.collecting + counts.reviewable,
                delta: `${counts.expired.toString()} expired`,
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
            return counts.invalid > 0
              ? npAdminStatus(
                  "error",
                  `${counts.invalid.toString()} invalid private order draft row(s); values are withheld.`,
                )
              : counts.expired > 0
                ? npAdminStatus(
                    "warn",
                    `${counts.collecting.toString()} collecting, ${counts.reviewable.toString()} reviewable, ${counts.expired.toString()} expired draft(s); values are withheld.`,
                  )
                : npAdminStatus(
                    "ok",
                    `${counts.collecting.toString()} collecting, ${counts.reviewable.toString()} reviewable private draft(s); values are withheld.`,
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
              data: `Cancelled ${result.cancelled.toString()} expired pending order(s), purged ${result.purged.toString()} expired commercial snapshot(s), and removed ${result.reservationsCleaned.toString()} leftover expired reservation row(s).`,
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
        description: "Replace one private order draft's bounded customer and shipping details.",
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
  NpShopPaymentEventType,
  NpShopIgnoredPaymentWebhook,
  NpShopPaymentReceiptOutcome,
  NpShopPaymentWebhookResult,
  NpShopPaymentWebhookInput,
  NpShopStoredPaymentReceipt,
  NpShopVerifiedPaymentEvent,
} from "./payment-contract.js";
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
  NpShopMessages,
  NpShopProduct,
  NpShopProductSkinProps,
  NpShopProductSummary,
  NpShopSkin,
  NpShopVariant,
} from "./types.js";

export default shopPlugin;
