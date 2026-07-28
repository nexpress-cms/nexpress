import { definePlugin, type NpPluginPageRouteRegistration } from "@nexpress/plugin-sdk";

import { defineShopCategoriesCollection, defineShopProductsCollection } from "./collections.js";
import { createShopHomeBlocks, shopHomePatterns } from "./home-blocks.js";
import { createShopCatalogMetadata, createShopCatalogRoute } from "./routes/catalog.js";
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
  ] satisfies NpPluginPageRouteRegistration[];

  const plugin = definePlugin({
    manifest: {
      id: "shop",
      version: "0.4.2",
      name: "Shop",
      description:
        "Product catalog, inventory projection, public storefront routes, skins, and homepage blocks.",
      author: { name: "NexPress" },
      license: "MIT",
      nexpress: { minVersion: "0.4.2" },
      capabilities: ["content:read", "admin:dashboard"],
      allowedHosts: [],
      provides: {
        blocks: [],
        collections: [runtime.collections.categories, runtime.collections.products],
        adminExtensions: ["dashboard:shop-products", "dashboard:shop-low-stock"],
        apiRoutes: [],
        hooks: [],
      },
      agent: {
        description:
          "Catalog foundation for products, variants, categories, prices, and inventory. Checkout and payment are deliberately not implied.",
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
    },
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
export type {
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
