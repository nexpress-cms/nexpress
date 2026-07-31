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
  checkout: string;
  checkoutCreating: string;
  checkoutIntent: string;
  checkoutOpen: string;
  checkoutStale: string;
  checkoutCancelled: string;
  checkoutExpired: string;
  checkoutCancel: string;
  checkoutExpires: string;
  checkoutPaymentUnavailable: string;
  checkoutBackToCart: string;
  checkoutFailed: string;
  orderDraft: string;
  orderDraftCreate: string;
  orderDraftCreating: string;
  orderDraftCollecting: string;
  orderDraftReviewable: string;
  orderDraftStale: string;
  orderDraftExpires: string;
  orderDraftCustomer: string;
  orderDraftShipping: string;
  orderDraftFullName: string;
  orderDraftEmail: string;
  orderDraftPhone: string;
  orderDraftRecipientName: string;
  orderDraftCountryCode: string;
  orderDraftPostalCode: string;
  orderDraftAddressLine1: string;
  orderDraftAddressLine2: string;
  orderDraftLocality: string;
  orderDraftAdministrativeArea: string;
  orderDraftSave: string;
  orderDraftSaving: string;
  orderDraftDelete: string;
  orderDraftPrivacy: string;
  orderDraftPaymentUnavailable: string;
  orderDraftFailed: string;
  order: string;
  orders: string;
  orderCreate: string;
  orderCreating: string;
  orderPendingPayment: string;
  orderPaid: string;
  orderPaymentFailed: string;
  orderCancelled: string;
  orderPaymentVerified: string;
  orderPaymentFailedDetail: string;
  orderPrivateRetained: string;
  orderPrivateRedacted: string;
  orderInventoryHeld: string;
  orderInventoryConsumed: string;
  orderInventoryReleased: string;
  orderInventoryNotRequired: string;
  orderExpires: string;
  orderCreated: string;
  orderCancel: string;
  orderHistory: string;
  orderEmpty: string;
  orderReference: string;
  orderPaymentUnavailable: string;
  orderPay?: string;
  orderPaymentPreparing?: string;
  orderPaymentConfirming?: string;
  orderPaymentRetry?: string;
  orderPaymentStartFailed?: string;
  orderFailed: string;
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
  checkout: string;
  checkoutCreating: string;
  checkoutIntent: string;
  checkoutOpen: string;
  checkoutStale: string;
  checkoutCancelled: string;
  checkoutExpired: string;
  checkoutCancel: string;
  checkoutExpires: string;
  checkoutPaymentUnavailable: string;
  checkoutBackToCart: string;
  checkoutFailed: string;
  orderDraft: string;
  orderDraftCreate: string;
  orderDraftCreating: string;
  orderDraftCollecting: string;
  orderDraftReviewable: string;
  orderDraftStale: string;
  orderDraftExpires: string;
  orderDraftCustomer: string;
  orderDraftShipping: string;
  orderDraftFullName: string;
  orderDraftEmail: string;
  orderDraftPhone: string;
  orderDraftRecipientName: string;
  orderDraftCountryCode: string;
  orderDraftPostalCode: string;
  orderDraftAddressLine1: string;
  orderDraftAddressLine2: string;
  orderDraftLocality: string;
  orderDraftAdministrativeArea: string;
  orderDraftSave: string;
  orderDraftSaving: string;
  orderDraftDelete: string;
  orderDraftPrivacy: string;
  orderDraftPaymentUnavailable: string;
  orderDraftFailed: string;
  order: string;
  orders: string;
  orderCreate: string;
  orderCreating: string;
  orderPendingPayment: string;
  orderPaid: string;
  orderPaymentFailed: string;
  orderCancelled: string;
  orderPaymentVerified: string;
  orderPaymentFailedDetail: string;
  orderPrivateRetained: string;
  orderPrivateRedacted: string;
  orderInventoryHeld: string;
  orderInventoryConsumed: string;
  orderInventoryReleased: string;
  orderInventoryNotRequired: string;
  orderExpires: string;
  orderCreated: string;
  orderCancel: string;
  orderHistory: string;
  orderEmpty: string;
  orderReference: string;
  orderPaymentUnavailable: string;
  orderFailed: string;
}

export interface NpShopCartSkinProps {
  basePath: string;
  apiPath: string;
  checkoutApiPath: string;
  quote: NpShopCartQuote;
  messages: NpShopMessages;
}

export const npShopCheckoutIntentStatuses = ["open", "stale", "cancelled", "expired"] as const;

export type NpShopCheckoutIntentStatus = (typeof npShopCheckoutIntentStatuses)[number];

export interface NpShopCheckoutIntentLine {
  key: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantSku: string | null;
  variantName: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface NpShopCheckoutIntent {
  contract: "np.shop-checkout-intent.v1";
  id: string;
  status: NpShopCheckoutIntentStatus;
  cartRevision: number;
  cartFingerprint: string;
  currency: NpShopCurrency;
  subtotalMinor: number;
  totalUnits: number;
  lines: NpShopCheckoutIntentLine[];
  createdAt: string;
  expiresAt: string;
  cancelledAt: string | null;
}

export interface NpShopCheckoutSkinProps {
  basePath: string;
  apiPath: string;
  orderDraftApiPath: string;
  intentId: string;
  messages: NpShopMessages;
}

export const npShopOrderDraftStatuses = ["collecting", "reviewable", "stale"] as const;

export type NpShopOrderDraftStatus = (typeof npShopOrderDraftStatuses)[number];

export interface NpShopOrderDraftCustomer {
  fullName: string;
  email: string;
  phone: string;
}

export interface NpShopOrderDraftShipping {
  recipientName: string;
  phone: string;
  countryCode: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string | null;
  locality: string;
  administrativeArea: string | null;
}

export interface NpShopOrderDraft {
  contract: "np.shop-order-draft.v1";
  id: string;
  status: NpShopOrderDraftStatus;
  revision: number;
  checkoutIntentId: string;
  cartRevision: number;
  cartFingerprint: string;
  currency: NpShopCurrency;
  subtotalMinor: number;
  totalUnits: number;
  lines: NpShopCheckoutIntentLine[];
  customer: NpShopOrderDraftCustomer | null;
  shipping: NpShopOrderDraftShipping | null;
  sourceCreatedAt: string;
  sourceExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface NpShopOrderDraftSkinProps {
  basePath: string;
  apiPath: string;
  orderApiPath: string;
  draftId: string;
  messages: NpShopMessages;
}

export const npShopOrderStatuses = [
  "pending-payment",
  "paid",
  "payment-failed",
  "cancelled",
] as const;

export type NpShopOrderStatus = (typeof npShopOrderStatuses)[number];

export const npShopOrderPrivateDataStatuses = ["retained", "redacted"] as const;

export type NpShopOrderPrivateDataStatus = (typeof npShopOrderPrivateDataStatuses)[number];

export const npShopOrderCancellationReasons = ["customer", "payment-timeout"] as const;

export type NpShopOrderCancellationReason = (typeof npShopOrderCancellationReasons)[number];

export const npShopInventoryReservationStatuses = [
  "held",
  "consumed",
  "released",
  "not-required",
] as const;

export type NpShopInventoryReservationStatus = (typeof npShopInventoryReservationStatuses)[number];

export interface NpShopOrder {
  contract: "np.shop-order.v1";
  id: string;
  status: NpShopOrderStatus;
  revision: number;
  sourceDraftId: string;
  checkoutIntentId: string;
  cartRevision: number;
  cartFingerprint: string;
  currency: NpShopCurrency;
  subtotalMinor: number;
  totalUnits: number;
  lines: NpShopCheckoutIntentLine[];
  privateDataStatus: NpShopOrderPrivateDataStatus;
  inventoryReservationStatus: NpShopInventoryReservationStatus;
  inventoryReservationLineKeys: string[];
  customer: NpShopOrderDraftCustomer | null;
  shipping: NpShopOrderDraftShipping | null;
  createdAt: string;
  updatedAt: string;
  pendingExpiresAt: string;
  paymentProvider: string | null;
  paymentReference: string | null;
  paymentEventId: string | null;
  paymentResolvedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: NpShopOrderCancellationReason | null;
  purgeAt: string;
}

export interface NpShopOrderList {
  contract: "np.shop-order-list.v1";
  orders: NpShopOrder[];
  total: number;
}

export interface NpShopOrdersSkinProps {
  basePath: string;
  apiPath: string;
  messages: NpShopMessages;
}

export interface NpShopOrderSkinProps {
  basePath: string;
  apiPath: string;
  orderId: string;
  paymentAction?: ReactNode;
  messages: NpShopMessages;
}

export interface NpShopSkin {
  id: string;
  label: string;
  renderCatalog: (props: NpShopCatalogSkinProps) => ReactNode | Promise<ReactNode>;
  renderCategory: (props: NpShopCategorySkinProps) => ReactNode | Promise<ReactNode>;
  renderProduct: (props: NpShopProductSkinProps) => ReactNode | Promise<ReactNode>;
  renderCart?: (props: NpShopCartSkinProps) => ReactNode | Promise<ReactNode>;
  renderCheckout?: (props: NpShopCheckoutSkinProps) => ReactNode | Promise<ReactNode>;
  renderOrderDraft?: (props: NpShopOrderDraftSkinProps) => ReactNode | Promise<ReactNode>;
  renderOrders?: (props: NpShopOrdersSkinProps) => ReactNode | Promise<ReactNode>;
  renderOrder?: (props: NpShopOrderSkinProps) => ReactNode | Promise<ReactNode>;
}
