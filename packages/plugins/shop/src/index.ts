import {
  definePlugin,
  npAdminStatus,
  type NpPluginPageRouteRegistration,
} from "@nexpress/plugin-sdk";

import { createShopCartApiHandler } from "./cart-api.js";
import { npCleanupExpiredShopCarts, npCountShopCarts } from "./cart-service.js";
import { defineShopCategoriesCollection, defineShopProductsCollection } from "./collections.js";
import { createShopHomeBlocks, shopHomePatterns } from "./home-blocks.js";
import { createShopCatalogMetadata, createShopCatalogRoute } from "./routes/catalog.js";
import { createShopCartRoute } from "./routes/cart.js";
import { createShopCategoryMetadata, createShopCategoryRoute } from "./routes/category.js";
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
      typeof skin.renderProduct !== "function"
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
  return {
    basePath: requireBasePath(options.basePath ?? "/shop"),
    collections,
    defaultSkinId,
    skins,
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
    "shop.catalogOnly": "Catalog preview — checkout is not enabled.",
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
    "shop.cartReady": "The cart is ready for a checkout integration.",
    "shop.cartNotReady": "Resolve the cart issues before checkout.",
    "shop.cartCheckoutUnavailable": "Checkout and payment are not enabled by this plugin.",
    "shop.cartUpdateFailed": "The cart could not be updated.",
    "shop.selectVariant": "Select an option",
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
    "shop.catalogOnly": "카탈로그 체험 — 결제 기능은 아직 연결되지 않았습니다.",
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
    "shop.cartReady": "결제 연동을 연결할 수 있는 상태입니다.",
    "shop.cartNotReady": "결제 전에 장바구니 문제를 해결해 주세요.",
    "shop.cartCheckoutUnavailable": "이 플러그인은 주문과 결제를 제공하지 않습니다.",
    "shop.cartUpdateFailed": "장바구니를 갱신하지 못했습니다.",
    "shop.selectVariant": "옵션 선택",
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
  ] satisfies NpPluginPageRouteRegistration[];

  const plugin = definePlugin({
    manifest: {
      id: "shop",
      version: "0.4.2",
      name: "Shop",
      description:
        "Product catalog, bounded guest/member carts, public storefront routes, skins, and homepage blocks.",
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
        ],
        apiRoutes: ["/cart"],
        hooks: [],
      },
      agent: {
        description:
          "Catalog and bounded cart foundation for products, variants, categories, prices, and inventory. Checkout and payment are deliberately not implied.",
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
        "cart-action": "[data-np-shop-cart-action]",
        "cart-line": "[data-np-shop-cart-line]",
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
      ],
      widgets: [
        {
          id: "shop-cart-health",
          label: "Cart storage",
          kind: "status",
          actionId: "cartHealth",
        },
      ],
      actions: [
        {
          id: "shop-cart-cleanup",
          label: "Clean expired carts",
          actionId: "cleanupExpiredCarts",
          confirm: "Delete expired Shop carts for this site?",
        },
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
export { npShopCurrencies } from "./types.js";
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
export type {
  NpShopCartClientMessages,
  NpShopCartIssueCode,
  NpShopCartLine,
  NpShopCartQuote,
  NpShopCartSkinProps,
  NpShopCartTotal,
  NpShopCatalogQuery,
  NpShopCatalogSkinProps,
  NpShopCategory,
  NpShopCategorySkinProps,
  NpShopCollectionSlugs,
  NpShopCurrency,
  NpShopInventoryState,
  NpShopMessages,
  NpShopProduct,
  NpShopProductSkinProps,
  NpShopProductSummary,
  NpShopSkin,
  NpShopVariant,
} from "./types.js";

export default shopPlugin;
