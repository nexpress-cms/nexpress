import { findDocuments } from "@nexpress/core/collections";
import { getCurrentLocale, t } from "@nexpress/core/i18n";
import { getMediaUrl } from "@nexpress/core/media";

import {
  npShopCurrencies,
  type NpShopCatalogQuery,
  type NpShopCategory,
  type NpShopContextualQuestionsAdapter,
  type NpShopCurrency,
  type NpShopMessages,
  type NpShopProduct,
  type NpShopProductSummary,
  type NpShopSkin,
  type NpShopVariant,
  type NpShopCollectionSlugs,
} from "./types.js";
import type {
  NpShopPaymentAdapter,
  NpShopPaymentInitiationAdapter,
  NpShopPaymentPartialRefundAdapter,
  NpShopPaymentReturnSettlementAdapter,
  NpShopPaymentRefundAdapter,
} from "./payment-contract.js";
import type { NpShopShippingAdapter } from "./shipping-contract.js";
import type { NpShopTaxAdapter } from "./tax-contract.js";
import type {
  NpShopCarrierAdapter,
  NpShopCarrierExchangeAdapter,
  NpShopCarrierExchangeParcelAdapter,
  NpShopCarrierLabelAdapter,
  NpShopCarrierParcelAdapter,
  NpShopCarrierPickupAdapter,
  NpShopCarrierReturnLabelAdapter,
  NpShopCarrierReturnLogisticsAdapter,
  NpShopCarrierReturnPostageAdapter,
  NpShopCarrierReturnTrackingAdapter,
  NpShopCarrierReturnTrackingPollAdapter,
  NpShopCarrierTrackingAdapter,
  NpShopCarrierTrackingPollAdapter,
} from "./carrier-contract.js";
import {
  npNormalizeShopCouponCode,
  npShopPromotionLimits,
  type NpShopPromotionDefinition,
} from "./promotion-contract.js";
import { npEmptyShopProductReviewAggregate } from "./review-contract.js";

export const npShopSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const npShopSkuPattern = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;
export const npShopCatalogLimits = {
  pageSize: 24,
  maximumPage: 10_000,
  maximumSearchLength: 120,
  // Generated integer fields map to PostgreSQL int4. Keep the author and
  // persisted contracts on the same exact bound.
  maximumPriceMinor: 2_147_483_647,
  maximumStockQuantity: 999_999_999,
  maximumVariants: 100,
  maximumGalleryImages: 12,
} as const;

export interface NpShopRuntime {
  basePath: string;
  collections: NpShopCollectionSlugs;
  defaultSkinId: string;
  skins: ReadonlyMap<string, NpShopSkin>;
  paymentAdapter: NpShopPaymentAdapter | null;
  paymentInitiationAdapter: NpShopPaymentInitiationAdapter | null;
  paymentRefundAdapter: NpShopPaymentRefundAdapter | null;
  paymentPartialRefundAdapter: NpShopPaymentPartialRefundAdapter | null;
  paymentReturnSettlementAdapter: NpShopPaymentReturnSettlementAdapter | null;
  shippingAdapter: NpShopShippingAdapter | null;
  taxAdapter: NpShopTaxAdapter | null;
  carrierAdapter: NpShopCarrierAdapter | null;
  carrierExchangeAdapter: NpShopCarrierExchangeAdapter | null;
  carrierExchangeParcelAdapter: NpShopCarrierExchangeParcelAdapter | null;
  carrierLabelAdapter: NpShopCarrierLabelAdapter | null;
  carrierParcelAdapter: NpShopCarrierParcelAdapter | null;
  carrierPickupAdapter: NpShopCarrierPickupAdapter | null;
  carrierPickupLocationReference: string | null;
  carrierReturnLogisticsAdapter: NpShopCarrierReturnLogisticsAdapter | null;
  carrierReturnPostageAdapter: NpShopCarrierReturnPostageAdapter | null;
  carrierReturnLabelAdapter: NpShopCarrierReturnLabelAdapter | null;
  carrierReturnLocationReference: string | null;
  carrierReturnTrackingAdapter: NpShopCarrierReturnTrackingAdapter | null;
  carrierReturnTrackingPollAdapter: NpShopCarrierReturnTrackingPollAdapter | null;
  carrierTrackingAdapter: NpShopCarrierTrackingAdapter | null;
  carrierTrackingPollAdapter: NpShopCarrierTrackingPollAdapter | null;
  inquiryAdapter: NpShopContextualQuestionsAdapter | null;
}

export interface ShopCategoryDocument extends Record<string, unknown> {
  id: string;
  slug: string;
  status: string;
  name: string;
  description?: string | null;
  image?: string | null;
  featured?: boolean | null;
  displayOrder?: number | null;
}

export interface ShopProductDocument extends Record<string, unknown> {
  id: string;
  slug: string;
  status: string;
  name: string;
  summary?: string | null;
  description?: unknown;
  currency: unknown;
  priceMinor: unknown;
  compareAtPriceMinor?: unknown;
  taxIncluded?: boolean | null;
  sku?: string | null;
  featured?: boolean | null;
  trackInventory?: boolean | null;
  stockQuantity?: unknown;
  lowStockThreshold?: unknown;
  primaryImage?: string | null;
  gallery?: unknown;
  categories?: unknown;
  variants?: unknown;
  skin?: unknown;
}

export interface ShopPromotionDocument extends Record<string, unknown> {
  id: string;
  status: string;
  name: unknown;
  code?: unknown;
  automatic?: unknown;
  kind: unknown;
  currency: unknown;
  value: unknown;
  maximumDiscountMinor?: unknown;
  minimumSubtotalMinor?: unknown;
  target: unknown;
  products?: unknown;
  categories?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  priority?: unknown;
  stackable?: unknown;
  totalUsageLimit?: unknown;
  perOwnerUsageLimit?: unknown;
}

function requireSafeInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(
      `Shop ${field} must be a safe integer between ${minimum.toString()} and ${maximum.toString()}.`,
    );
  }
  return value as number;
}

export function npRequireShopCurrency(value: unknown): NpShopCurrency {
  if ((npShopCurrencies as readonly unknown[]).includes(value)) return value as NpShopCurrency;
  throw new Error("Shop currency must be one of KRW, USD, EUR, or JPY.");
}

export function normalizeShopCategoryIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Shop product categories must be an array.");
  const ids = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`Shop product category ${index.toString()} must be an id.`);
    }
    return entry;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error("Shop product categories must not contain duplicates.");
  }
  return ids;
}

function normalizePromotionRelationIds(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error(`Shop promotion ${field} must be an array of document ids.`);
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Shop promotion ${field} must not contain duplicates.`);
  }
  return [...ids].sort();
}

function normalizePromotionDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`Shop promotion ${field} must be a valid date.`);
  }
  return parsed.toISOString();
}

export function normalizeShopPromotion(document: ShopPromotionDocument): NpShopPromotionDefinition {
  if (typeof document.name !== "string" || !document.name.trim() || document.name.length > 120) {
    throw new Error("Shop promotion name must contain 1–120 characters.");
  }
  const automatic = document.automatic === true;
  const code =
    document.code === undefined || document.code === null || document.code === ""
      ? null
      : npNormalizeShopCouponCode(document.code);
  if (!automatic && code === null)
    throw new Error("A non-automatic promotion requires a coupon code.");
  if (document.kind !== "fixed" && document.kind !== "percentage") {
    throw new Error("Shop promotion kind must be fixed or percentage.");
  }
  const valueMaximum =
    document.kind === "percentage"
      ? npShopPromotionLimits.maximumBasisPoints
      : npShopPromotionLimits.maximumPriceMinor;
  const value = requireSafeInteger(document.value, "promotion value", 1, valueMaximum);
  const maximumDiscountMinor =
    document.maximumDiscountMinor === undefined || document.maximumDiscountMinor === null
      ? null
      : requireSafeInteger(
          document.maximumDiscountMinor,
          "promotion maximum discount",
          1,
          npShopPromotionLimits.maximumPriceMinor,
        );
  if (document.kind === "fixed" && maximumDiscountMinor !== null) {
    throw new Error("Fixed promotions cannot define a maximum discount.");
  }
  if (
    document.target !== "order" &&
    document.target !== "products" &&
    document.target !== "categories"
  ) {
    throw new Error("Shop promotion target is invalid.");
  }
  const productIds = normalizePromotionRelationIds(document.products, "products");
  const categoryIds = normalizePromotionRelationIds(document.categories, "categories");
  if (document.target === "products" && productIds.length === 0) {
    throw new Error("A product promotion requires at least one product.");
  }
  if (document.target === "categories" && categoryIds.length === 0) {
    throw new Error("A category promotion requires at least one category.");
  }
  const startsAt = normalizePromotionDate(document.startsAt, "start");
  const endsAt = normalizePromotionDate(document.endsAt, "end");
  if (startsAt && endsAt && startsAt >= endsAt)
    throw new Error("Promotion end must be after its start.");
  return {
    id: document.id,
    name: document.name.trim(),
    code,
    automatic,
    kind: document.kind,
    currency: npRequireShopCurrency(document.currency),
    value,
    maximumDiscountMinor,
    minimumSubtotalMinor: requireSafeInteger(
      document.minimumSubtotalMinor ?? 0,
      "promotion minimum subtotal",
      0,
      npShopPromotionLimits.maximumPriceMinor,
    ),
    target: document.target,
    productIds,
    categoryIds,
    startsAt,
    endsAt,
    priority: requireSafeInteger(
      document.priority ?? 0,
      "promotion priority",
      0,
      npShopPromotionLimits.maximumPriority,
    ),
    stackable: document.stackable === true,
    totalUsageLimit: requireSafeInteger(
      document.totalUsageLimit ?? 0,
      "promotion total usage limit",
      0,
      npShopPromotionLimits.maximumUsageLimit,
    ),
    perOwnerUsageLimit: requireSafeInteger(
      document.perOwnerUsageLimit ?? 0,
      "promotion per-owner usage limit",
      0,
      npShopPromotionLimits.maximumUsageLimit,
    ),
  };
}

export async function listShopPromotions(
  runtime: NpShopRuntime,
): Promise<NpShopPromotionDefinition[]> {
  const result = await findDocuments<ShopPromotionDocument>(runtime.collections.promotions, {
    where: { status: "published", visibility: "*" },
    page: 1,
    limit: npShopPromotionLimits.maximumDefinitions,
  });
  if (result.totalDocs > result.docs.length) {
    throw new Error(
      `Shop supports at most ${npShopPromotionLimits.maximumDefinitions.toString()} published promotions per site.`,
    );
  }
  return result.docs.map(normalizeShopPromotion);
}

export function normalizeShopGalleryIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Shop product gallery must be an array.");
  if (value.length > npShopCatalogLimits.maximumGalleryImages) {
    throw new Error(
      `Shop product gallery accepts at most ${npShopCatalogLimits.maximumGalleryImages.toString()} images.`,
    );
  }
  const ids = value.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => key !== "image") ||
      typeof (entry as { image?: unknown }).image !== "string"
    ) {
      throw new Error(`Shop gallery item ${index.toString()} must contain only an image id.`);
    }
    return (entry as { image: string }).image;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error("Shop product gallery images must not be duplicated.");
  }
  return ids;
}

export function normalizeShopVariants(value: unknown): NpShopVariant[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Shop variants must be an array.");
  if (value.length > npShopCatalogLimits.maximumVariants) {
    throw new Error(
      `Shop products accept at most ${npShopCatalogLimits.maximumVariants.toString()} variants.`,
    );
  }
  const seenSkus = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Shop variant ${index.toString()} must be an object.`);
    }
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const sku = typeof item.sku === "string" ? item.sku.trim().toUpperCase() : "";
    const optionSummary =
      typeof item.optionSummary === "string" && item.optionSummary.trim()
        ? item.optionSummary.trim()
        : null;
    if (name.length === 0 || name.length > 120) {
      throw new Error(`Shop variant ${index.toString()} has an invalid name.`);
    }
    if (!npShopSkuPattern.test(sku)) {
      throw new Error(`Shop variant ${index.toString()} has an invalid SKU.`);
    }
    if (seenSkus.has(sku)) {
      throw new Error(`Shop variant SKU "${sku}" is duplicated.`);
    }
    seenSkus.add(sku);
    const priceMinor =
      item.priceMinor === undefined || item.priceMinor === null
        ? null
        : requireSafeInteger(
            item.priceMinor,
            `variant ${index.toString()} price`,
            0,
            npShopCatalogLimits.maximumPriceMinor,
          );
    return {
      name,
      sku,
      optionSummary,
      priceMinor,
      stockQuantity: requireSafeInteger(
        item.stockQuantity ?? 0,
        `variant ${index.toString()} stock`,
        0,
        npShopCatalogLimits.maximumStockQuantity,
      ),
      enabled: item.enabled !== false,
    };
  });
}

export function getShopStockQuantity(document: ShopProductDocument): number {
  const baseStock = requireSafeInteger(
    document.stockQuantity ?? 0,
    "stock quantity",
    0,
    npShopCatalogLimits.maximumStockQuantity,
  );
  const enabledVariants = normalizeShopVariants(document.variants).filter(
    (variant) => variant.enabled,
  );
  const stock =
    enabledVariants.length === 0
      ? baseStock
      : enabledVariants.reduce((total, variant) => total + variant.stockQuantity, 0);
  return requireSafeInteger(
    stock,
    "aggregate stock quantity",
    0,
    npShopCatalogLimits.maximumStockQuantity,
  );
}

function inventoryState(document: ShopProductDocument) {
  if (document.trackInventory !== true) return "untracked" as const;
  const threshold = requireSafeInteger(
    document.lowStockThreshold ?? 0,
    "low-stock threshold",
    0,
    npShopCatalogLimits.maximumStockQuantity,
  );
  const stock = getShopStockQuantity(document);
  if (stock === 0) return "out-of-stock" as const;
  return stock <= threshold ? ("low-stock" as const) : ("in-stock" as const);
}

async function resolveImage(id: unknown, variant: string): Promise<string | null> {
  if (typeof id !== "string" || id.length === 0) return null;
  return getMediaUrl(id, { variant });
}

export async function normalizeShopCategory(
  document: ShopCategoryDocument,
): Promise<NpShopCategory> {
  return {
    id: document.id,
    slug: document.slug,
    name: document.name,
    description:
      typeof document.description === "string" && document.description.trim()
        ? document.description.trim()
        : null,
    imageUrl: await resolveImage(document.image, "medium"),
    featured: document.featured === true,
    displayOrder: Number.isSafeInteger(document.displayOrder)
      ? (document.displayOrder as number)
      : 0,
  };
}

export async function normalizeShopProductSummary(
  document: ShopProductDocument,
): Promise<NpShopProductSummary> {
  const priceMinor = requireSafeInteger(
    document.priceMinor,
    "price",
    0,
    npShopCatalogLimits.maximumPriceMinor,
  );
  const compareAtPriceMinor =
    document.compareAtPriceMinor === undefined || document.compareAtPriceMinor === null
      ? null
      : requireSafeInteger(
          document.compareAtPriceMinor,
          "compare-at price",
          0,
          npShopCatalogLimits.maximumPriceMinor,
        );
  if (compareAtPriceMinor !== null && compareAtPriceMinor <= priceMinor) {
    throw new Error("Shop compare-at price must be greater than the selling price.");
  }
  const reviewAggregate = npEmptyShopProductReviewAggregate();
  return {
    id: document.id,
    slug: document.slug,
    name: document.name,
    summary:
      typeof document.summary === "string" && document.summary.trim()
        ? document.summary.trim()
        : null,
    currency: npRequireShopCurrency(document.currency),
    priceMinor,
    compareAtPriceMinor,
    featured: document.featured === true,
    imageUrl: await resolveImage(document.primaryImage, "medium"),
    inventoryState: inventoryState(document),
    stockQuantity: getShopStockQuantity(document),
    categoryIds: normalizeShopCategoryIds(document.categories),
    reviewCount: reviewAggregate.count,
    reviewAverageBasisPoints: reviewAggregate.averageRatingBasisPoints,
  };
}

export async function normalizeShopProduct(document: ShopProductDocument): Promise<NpShopProduct> {
  const summary = await normalizeShopProductSummary(document);
  const galleryIds = normalizeShopGalleryIds(document.gallery);
  const galleryUrls = (await Promise.all(galleryIds.map((id) => resolveImage(id, "large")))).filter(
    (url): url is string => url !== null,
  );
  const sku =
    typeof document.sku === "string" && document.sku.trim()
      ? document.sku.trim().toUpperCase()
      : null;
  if (sku !== null && !npShopSkuPattern.test(sku)) {
    throw new Error("Shop product has an invalid persisted SKU.");
  }
  return {
    ...summary,
    skinId: typeof document.skin === "string" ? document.skin : "classic",
    description: document.description ?? null,
    galleryUrls,
    sku,
    variants: normalizeShopVariants(document.variants),
    taxIncluded: document.taxIncluded === true,
  };
}

export async function listShopCategories(runtime: NpShopRuntime): Promise<NpShopCategory[]> {
  const result = await findDocuments<ShopCategoryDocument>(runtime.collections.categories, {
    where: { status: "published" },
    sort: "displayOrder",
    page: 1,
    limit: 100,
  });
  return Promise.all(result.docs.map(normalizeShopCategory));
}

export async function findShopCategory(
  runtime: NpShopRuntime,
  slug: string,
): Promise<NpShopCategory | null> {
  if (!npShopSlugPattern.test(slug)) return null;
  const result = await findDocuments<ShopCategoryDocument>(runtime.collections.categories, {
    where: { slug, status: "published" },
    page: 1,
    limit: 1,
  });
  return result.docs[0] ? normalizeShopCategory(result.docs[0]) : null;
}

export async function findShopProduct(
  runtime: NpShopRuntime,
  slug: string,
): Promise<NpShopProduct | null> {
  if (!npShopSlugPattern.test(slug)) return null;
  const result = await findDocuments<ShopProductDocument>(runtime.collections.products, {
    where: { slug, status: "published" },
    page: 1,
    limit: 1,
  });
  return result.docs[0] ? normalizeShopProduct(result.docs[0]) : null;
}

export function parseShopCatalogQuery(
  searchParams: Record<string, string | string[] | undefined>,
): NpShopCatalogQuery | null {
  if (
    Array.isArray(searchParams.page) ||
    Array.isArray(searchParams.q) ||
    Array.isArray(searchParams.sort) ||
    Array.isArray(searchParams.stock)
  ) {
    return null;
  }
  const rawPage = searchParams.page;
  const page = rawPage === undefined ? 1 : Number(rawPage);
  const rawSearch = searchParams.q?.replace(/\s+/gu, " ").trim() ?? "";
  const rawSort = searchParams.sort;
  const sort =
    rawSort === undefined
      ? "newest"
      : rawSort === "price-asc" ||
          rawSort === "price-desc" ||
          rawSort === "name" ||
          rawSort === "newest"
        ? rawSort
        : null;
  const rawStock = searchParams.stock;
  if (
    (rawPage !== undefined && !/^[1-9][0-9]*$/u.test(rawPage)) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > npShopCatalogLimits.maximumPage ||
    rawSearch.length > npShopCatalogLimits.maximumSearchLength ||
    sort === null ||
    (rawStock !== undefined && rawStock !== "available")
  ) {
    return null;
  }
  return {
    page,
    search: rawSearch || null,
    sort,
    inStockOnly: rawStock === "available",
  };
}

export function shopCatalogSort(sort: NpShopCatalogQuery["sort"]): string {
  if (sort === "price-asc") return "priceMinor";
  if (sort === "price-desc") return "-priceMinor";
  if (sort === "name") return "name";
  return "-createdAt";
}

export function buildShopCatalogHref(
  basePath: string,
  query: NpShopCatalogQuery,
  patch: Partial<NpShopCatalogQuery> = {},
): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.page > 1) params.set("page", next.page.toString());
  if (next.search) params.set("q", next.search);
  if (next.sort !== "newest") params.set("sort", next.sort);
  if (next.inStockOnly) params.set("stock", "available");
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

export function resolveShopSkin(runtime: NpShopRuntime, id?: string | null): NpShopSkin {
  return (
    (id ? runtime.skins.get(id) : undefined) ??
    runtime.skins.get(runtime.defaultSkinId) ??
    (() => {
      throw new Error(`Shop default skin "${runtime.defaultSkinId}" is unavailable.`);
    })()
  );
}

export async function getShopMessages(): Promise<NpShopMessages> {
  const locale = getCurrentLocale();
  const read = (key: string) => t(`shop.${key}`, locale);
  const keys = [
    "catalog",
    "products",
    "categories",
    "featuredProducts",
    "featured",
    "reviewHeading",
    "reviewVerified",
    "reviewEmpty",
    "reviewWrite",
    "reviewEdit",
    "reviewLogin",
    "reviewUnavailable",
    "reviewPurchase",
    "reviewRating",
    "reviewTitle",
    "reviewBody",
    "reviewPhotos",
    "reviewUpload",
    "reviewRemove",
    "reviewSave",
    "reviewSaving",
    "reviewDelete",
    "reviewFailed",
    "wishlist",
    "wishlistSave",
    "wishlistSaved",
    "wishlistSaving",
    "wishlistSignIn",
    "wishlistFailed",
    "wishlistEmpty",
    "wishlistLogin",
    "wishlistBrowse",
    "restockHeading",
    "restockSelect",
    "restockSubscribe",
    "restockSubscribed",
    "restockSaving",
    "restockSignIn",
    "restockUnavailable",
    "restockFailed",
    "priceAlertHeading",
    "priceAlertSelect",
    "priceAlertSubscribe",
    "priceAlertSubscribed",
    "priceAlertSaving",
    "priceAlertSignIn",
    "priceAlertUnavailable",
    "priceAlertFailed",
    "search",
    "searchPlaceholder",
    "sort",
    "newest",
    "priceLow",
    "priceHigh",
    "name",
    "inStockOnly",
    "apply",
    "clear",
    "emptyProducts",
    "emptyCategories",
    "inventoryInStock",
    "inventoryLow",
    "inventoryOut",
    "inventoryUntracked",
    "compareAtPrice",
    "sku",
    "variants",
    "option",
    "price",
    "stock",
    "taxIncluded",
    "catalogOnly",
    "cart",
    "addToCart",
    "addingToCart",
    "addedToCart",
    "cartEmpty",
    "cartQuantity",
    "cartRemove",
    "cartClear",
    "cartSubtotal",
    "promotionDiscount",
    "couponCode",
    "couponPlaceholder",
    "couponApply",
    "couponRemove",
    "couponRejected",
    "cartUnavailable",
    "cartPriceChanged",
    "cartInsufficientStock",
    "cartMixedCurrency",
    "cartReady",
    "cartNotReady",
    "cartCheckoutUnavailable",
    "cartUpdateFailed",
    "selectVariant",
    "checkout",
    "checkoutCreating",
    "checkoutIntent",
    "checkoutOpen",
    "checkoutStale",
    "checkoutCancelled",
    "checkoutExpired",
    "checkoutCancel",
    "checkoutExpires",
    "checkoutPaymentUnavailable",
    "checkoutBackToCart",
    "checkoutFailed",
    "orderDraft",
    "orderDraftCreate",
    "orderDraftCreating",
    "orderDraftCollecting",
    "orderDraftReviewable",
    "orderDraftStale",
    "orderDraftExpires",
    "orderDraftCustomer",
    "orderDraftShipping",
    "orderDraftShippingMethods",
    "orderDraftShippingSelect",
    "orderDraftShippingSelecting",
    "orderDraftShippingRequired",
    "orderDraftShippingUnavailable",
    "orderDraftShippingDays",
    "orderDraftFullName",
    "orderDraftEmail",
    "orderDraftPhone",
    "orderDraftRecipientName",
    "orderDraftCountryCode",
    "orderDraftPostalCode",
    "orderDraftAddressLine1",
    "orderDraftAddressLine2",
    "orderDraftLocality",
    "orderDraftAdministrativeArea",
    "orderDraftSave",
    "orderDraftSaving",
    "orderDraftDelete",
    "orderDraftPrivacy",
    "orderDraftPaymentUnavailable",
    "orderDraftFailed",
    "shippingAmount",
    "taxAmount",
    "taxBreakdown",
    "orderTotal",
    "order",
    "orders",
    "orderCreate",
    "orderCreating",
    "orderPendingPayment",
    "orderPaid",
    "orderRefunded",
    "orderPaymentFailed",
    "orderCancelled",
    "orderPaymentVerified",
    "orderRefundedDetail",
    "orderPartialRefundedDetail",
    "orderPaymentFailedDetail",
    "orderPrivateRetained",
    "orderPrivateRedacted",
    "orderInventoryHeld",
    "orderInventoryConsumed",
    "orderInventoryReleased",
    "orderInventoryNotRequired",
    "orderRefundInventoryRestocked",
    "orderRefundInventoryManual",
    "orderRefundInventoryShipped",
    "orderFulfillmentAwaiting",
    "orderFulfillmentProcessing",
    "orderFulfillmentShipped",
    "orderFulfillmentCancelled",
    "orderFulfillmentTracking",
    "orderTrackingInTransit",
    "orderTrackingOutForDelivery",
    "orderTrackingDelivered",
    "orderTrackingException",
    "orderReturn",
    "orderReturnRequested",
    "orderReturnApproved",
    "orderReturnRejected",
    "orderReturnReceived",
    "orderReturnCancelled",
    "orderExchange",
    "orderExchangeAwaiting",
    "orderExchangeProcessing",
    "orderExchangeShipped",
    "orderExchangeCancelled",
    "orderExchangeInventoryRestocked",
    "orderExchangeInventoryManual",
    "orderExchangeTracking",
    "orderExchangeDestination",
    "orderExchangeDestinationAwaiting",
    "orderExchangeDestinationSubmitted",
    "orderExchangeDestinationAccessed",
    "orderExchangeDestinationExpired",
    "orderExchangeDestinationSubmit",
    "orderExchangeDestinationSubmitting",
    "orderExchangeDestinationPrivacy",
    "orderExchangeDestinationFailed",
    "orderReturnReason",
    "orderReturnReasonDamaged",
    "orderReturnReasonDefective",
    "orderReturnReasonWrongItem",
    "orderReturnReasonChangedMind",
    "orderReturnReasonOther",
    "orderReturnDetail",
    "orderReturnSubmit",
    "orderReturnSubmitting",
    "orderReturnSelectItem",
    "orderReturnCancel",
    "orderReturnPolicy",
    "orderReturnInventoryRestocked",
    "orderReturnInventoryManual",
    "orderReturnInventoryNotRequired",
    "orderReturnFailed",
    "orderReturnLogistics",
    "orderReturnLogisticsDropoff",
    "orderReturnLogisticsPickup",
    "orderReturnLogisticsCreate",
    "orderReturnLogisticsCreating",
    "orderReturnLogisticsPending",
    "orderReturnLogisticsActive",
    "orderReturnLogisticsCancelled",
    "orderReturnLogisticsResume",
    "orderReturnLogisticsCancel",
    "orderReturnLogisticsLabel",
    "orderReturnLogisticsReadyAt",
    "orderReturnLogisticsCloseAt",
    "orderReturnLogisticsPrivacy",
    "orderReturnLogisticsFailed",
    "orderReturnPostageQuote",
    "orderReturnPostageQuoting",
    "orderReturnPostageSelect",
    "orderReturnPostageSelecting",
    "orderReturnPostageSelected",
    "orderReturnPostageExpires",
    "orderReturnPostagePrivacy",
    "orderReturnPostageBoundary",
    "orderReturnPostageFailed",
    "orderReturnPostageResponsibility",
    "orderReturnPostageMerchant",
    "orderReturnPostageCustomer",
    "orderReturnPostageDeduction",
    "orderReturnRefundNet",
    "orderReturnTrackingInTransit",
    "orderReturnTrackingOutForDelivery",
    "orderReturnTrackingDelivered",
    "orderReturnTrackingException",
    "orderExpires",
    "orderCreated",
    "orderNotifications",
    "orderCancel",
    "orderHistory",
    "orderEmpty",
    "orderReference",
    "orderPaymentUnavailable",
    "orderFailed",
    "previous",
    "next",
    "backToCatalog",
    "viewProduct",
  ] as const;
  const values = await Promise.all(keys.map(read));
  const text = Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Omit<
    NpShopMessages,
    "locale" | "pageOf" | "formatMoney"
  >;
  return {
    locale,
    ...text,
    pageOf: (page, totalPages) => `${page.toString()} / ${totalPages.toString()}`,
    formatMoney: (amountMinor, currency) => {
      const fractionDigits = currency === "KRW" || currency === "JPY" ? 0 : 2;
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(amountMinor / (fractionDigits === 0 ? 1 : 100));
    },
  };
}
