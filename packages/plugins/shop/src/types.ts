import type { ReactNode } from "react";

export const npShopCurrencies = ["KRW", "USD", "EUR", "JPY"] as const;
export type NpShopCurrency = (typeof npShopCurrencies)[number];

export type NpShopInventoryState = "in-stock" | "low-stock" | "out-of-stock" | "untracked";

export interface NpShopCollectionSlugs {
  categories: string;
  products: string;
}

export interface NpShopCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  featured: boolean;
  displayOrder: number;
}

export interface NpShopVariant {
  name: string;
  sku: string;
  optionSummary: string | null;
  priceMinor: number | null;
  stockQuantity: number;
  enabled: boolean;
}

export interface NpShopProductSummary {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  currency: NpShopCurrency;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  featured: boolean;
  imageUrl: string | null;
  inventoryState: NpShopInventoryState;
  stockQuantity: number;
  categoryIds: string[];
}

export interface NpShopProduct extends NpShopProductSummary {
  skinId: string;
  description: unknown;
  galleryUrls: string[];
  sku: string | null;
  variants: NpShopVariant[];
  taxIncluded: boolean;
}

export interface NpShopCatalogQuery {
  page: number;
  search: string | null;
  sort: "newest" | "price-asc" | "price-desc" | "name";
  inStockOnly: boolean;
}

export interface NpShopMessages {
  locale: string;
  catalog: string;
  products: string;
  categories: string;
  featuredProducts: string;
  featured: string;
  search: string;
  searchPlaceholder: string;
  sort: string;
  newest: string;
  priceLow: string;
  priceHigh: string;
  name: string;
  inStockOnly: string;
  apply: string;
  clear: string;
  emptyProducts: string;
  emptyCategories: string;
  inventoryInStock: string;
  inventoryLow: string;
  inventoryOut: string;
  inventoryUntracked: string;
  compareAtPrice: string;
  sku: string;
  variants: string;
  option: string;
  price: string;
  stock: string;
  taxIncluded: string;
  catalogOnly: string;
  cart: string;
  addToCart: string;
  addingToCart: string;
  addedToCart: string;
  cartEmpty: string;
  cartQuantity: string;
  cartRemove: string;
  cartClear: string;
  cartSubtotal: string;
  cartUnavailable: string;
  cartPriceChanged: string;
  cartInsufficientStock: string;
  cartMixedCurrency: string;
  cartReady: string;
  cartNotReady: string;
  cartCheckoutUnavailable: string;
  cartUpdateFailed: string;
  selectVariant: string;
  previous: string;
  next: string;
  backToCatalog: string;
  viewProduct: string;
  pageOf: (page: number, totalPages: number) => string;
  formatMoney: (amountMinor: number, currency: NpShopCurrency) => string;
}

export interface NpShopCatalogSkinProps {
  basePath: string;
  products: NpShopProductSummary[];
  categories: NpShopCategory[];
  query: NpShopCatalogQuery;
  totalPages: number;
  totalProducts: number;
  messages: NpShopMessages;
}

export interface NpShopCategorySkinProps {
  basePath: string;
  category: NpShopCategory;
  products: NpShopProductSummary[];
  query: NpShopCatalogQuery;
  totalPages: number;
  totalProducts: number;
  messages: NpShopMessages;
}

export interface NpShopProductSkinProps {
  basePath: string;
  product: NpShopProduct;
  categories: NpShopCategory[];
  description: ReactNode;
  cartAction?: ReactNode;
  messages: NpShopMessages;
}

export const npShopCartIssueCodes = [
  "product-unavailable",
  "variant-required",
  "variant-unavailable",
  "insufficient-stock",
  "price-changed",
  "mixed-currency",
] as const;

export type NpShopCartIssueCode = (typeof npShopCartIssueCodes)[number];

export interface NpShopCartLine {
  key: string;
  productId: string;
  productSlug: string | null;
  productName: string;
  variantSku: string | null;
  variantName: string | null;
  quantity: number;
  currency: NpShopCurrency;
  unitPriceMinor: number;
  lineTotalMinor: number;
  imageUrl: string | null;
  available: boolean;
  stockQuantity: number | null;
  issues: NpShopCartIssueCode[];
}

export interface NpShopCartTotal {
  currency: NpShopCurrency;
  subtotalMinor: number;
}

export interface NpShopCartQuote {
  contract: "np.shop-cart-quote.v1";
  revision: number;
  lines: NpShopCartLine[];
  totals: NpShopCartTotal[];
  totalUnits: number;
  ready: boolean;
  issues: NpShopCartIssueCode[];
  fingerprint: string;
  updatedAt: string | null;
}

export interface NpShopCartClientMessages {
  locale: string;
  cart: string;
  addToCart: string;
  addingToCart: string;
  addedToCart: string;
  cartEmpty: string;
  cartQuantity: string;
  cartRemove: string;
  cartClear: string;
  cartSubtotal: string;
  cartUnavailable: string;
  cartPriceChanged: string;
  cartInsufficientStock: string;
  cartMixedCurrency: string;
  cartReady: string;
  cartNotReady: string;
  cartCheckoutUnavailable: string;
  cartUpdateFailed: string;
  selectVariant: string;
}

export interface NpShopCartSkinProps {
  basePath: string;
  apiPath: string;
  quote: NpShopCartQuote;
  messages: NpShopMessages;
}

export interface NpShopSkin {
  id: string;
  label: string;
  renderCatalog: (props: NpShopCatalogSkinProps) => ReactNode | Promise<ReactNode>;
  renderCategory: (props: NpShopCategorySkinProps) => ReactNode | Promise<ReactNode>;
  renderProduct: (props: NpShopProductSkinProps) => ReactNode | Promise<ReactNode>;
  renderCart?: (props: NpShopCartSkinProps) => ReactNode | Promise<ReactNode>;
}
