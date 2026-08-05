import {
  npShopCurrencies,
  npShopInventoryReservationStatuses,
  npShopOrderCancellationReasons,
  npShopOrderPrivateDataStatuses,
  npShopOrderStatuses,
  type NpShopCheckoutIntentLine,
  type NpShopCurrency,
  type NpShopInventoryReservationStatus,
  type NpShopOrder,
  type NpShopOrderList,
  type NpShopOrderCancellationReason,
  type NpShopOrderDraftCustomer,
  type NpShopOrderDraftShipping,
  type NpShopOrderPrivateDataStatus,
  type NpShopOrderStatus,
} from "./types.js";
import { npAnalyzeShopFulfillment, npShopFulfillmentLimits } from "./fulfillment-contract.js";
import { NP_SHOP_REFUND_CONTRACT, npAnalyzeStoredShopRefund } from "./refund-contract.js";
import {
  NP_SHOP_PARTIAL_REFUND_CONTRACT,
  npAnalyzeShopPartialRefund,
} from "./partial-refund-contract.js";
import {
  NP_SHOP_PAYMENT_ADJUSTMENT_CONTRACT,
  npAnalyzeShopPaymentAdjustment,
} from "./payment-adjustment-contract.js";
import { NP_SHOP_RETURN_CONTRACT, npAnalyzeShopReturn } from "./return-contract.js";
import { npAnalyzeShopDeliveryMethod, type NpShopDeliveryMethod } from "./shipping-contract.js";
import { npAnalyzeShopTaxQuote, type NpShopTaxQuote } from "./tax-contract.js";
import { npAnalyzeShopTracking } from "./tracking-contract.js";

export const NP_SHOP_ORDER_CONTRACT = "np.shop-order.v1" as const;
export const NP_SHOP_ORDER_LIST_CONTRACT = "np.shop-order-list.v1" as const;
export const NP_SHOP_ORDER_STORAGE_CONTRACT = "np.shop-order-storage.v1" as const;
export const NP_SHOP_ORDER_PRIVATE_CONTRACT = "np.shop-order-private.v1" as const;
export const NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT = "np.shop-order-private.v2" as const;

export const npShopOrderLimits = {
  pendingTtlSeconds: 60 * 60 * 24,
  commercialRetentionSeconds: 60 * 60 * 24 * 365,
  maximumPendingPerOwner: 3,
  ownerListSize: 20,
  adminListSize: 50,
  cleanupBatchSize: 500,
  diagnosticSampleSize: 500,
} as const;

export interface NpShopOrderCreateInput {
  idempotencyKey: string;
  draftId: string;
  expectedRevision: number;
}

export interface NpShopOrderCancelInput {
  orderId: string;
  expectedRevision: number;
}

export interface NpShopStoredOrder {
  contract: typeof NP_SHOP_ORDER_STORAGE_CONTRACT;
  id: string;
  status: NpShopOrderStatus;
  revision: number;
  ownerSegment: string;
  sourceDraftId: string;
  checkoutIntentId: string;
  cartRevision: number;
  cartFingerprint: string;
  currency: NpShopCurrency;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  totalUnits: number;
  lines: NpShopCheckoutIntentLine[];
  deliveryMethod: NpShopDeliveryMethod | null;
  taxQuote: NpShopTaxQuote | null;
  privateDataStatus: NpShopOrderPrivateDataStatus;
  inventoryReservationStatus: NpShopInventoryReservationStatus;
  inventoryReservationLineKeys: string[];
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

export interface NpShopStoredOrderPrivate {
  contract: typeof NP_SHOP_ORDER_PRIVATE_CONTRACT;
  orderId: string;
  customer: NpShopOrderDraftCustomer;
  shipping: NpShopOrderDraftShipping;
  createdAt: string;
  expiresAt: string;
}

export interface NpShopStoredOrderFulfillmentPrivate {
  contract: typeof NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT;
  orderId: string;
  customer: NpShopOrderDraftCustomer;
  shipping: NpShopOrderDraftShipping;
  createdAt: string;
  retainedAt: string;
  expiresAt: string;
}

export type NpShopStoredOrderPrivateData =
  NpShopStoredOrderPrivate | NpShopStoredOrderFulfillmentPrivate;

export class NpShopOrderContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopOrderContractError";
    this.issues = issues;
  }
}

export class NpShopOrderConflictError extends Error {
  readonly code:
    | "order_revision_conflict"
    | "order_idempotency_conflict"
    | "order_inventory_unavailable"
    | "order_source_stale"
    | "order_pending_limit"
    | "order_not_cancellable";

  constructor(code: NpShopOrderConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopOrderConflictError";
    this.code = code;
  }
}

export class NpShopOrderNotFoundError extends Error {
  constructor() {
    super("The order does not exist for this browser identity.");
    this.name = "NpShopOrderNotFoundError";
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const paymentProviderPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaquePaymentReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;
const lineKeys = [
  "key",
  "productId",
  "productSlug",
  "productName",
  "variantSku",
  "variantName",
  "quantity",
  "unitPriceMinor",
  "lineTotalMinor",
] as const;
const customerKeys = ["fullName", "email", "phone"] as const;
const shippingKeys = [
  "recipientName",
  "phone",
  "countryCode",
  "postalCode",
  "addressLine1",
  "addressLine2",
  "locality",
  "administrativeArea",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) issues.push(`${path}.${key} is not supported.`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) issues.push(`${path}.${key} is required.`);
  }
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && canonicalUuidPattern.test(value);
}

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerSegmentPattern.test(value) ||
      (value.startsWith("member:") && isCanonicalUuid(value.slice("member:".length))))
  );
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function analyzeLine(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, lineKeys, path, issues);
  if (!isBoundedText(value.key, 300)) issues.push(`${path}.key is invalid.`);
  if (!isCanonicalUuid(value.productId)) issues.push(`${path}.productId is invalid.`);
  if (!isBoundedText(value.productSlug, 160)) issues.push(`${path}.productSlug is invalid.`);
  if (!isBoundedText(value.productName, 200)) issues.push(`${path}.productName is invalid.`);
  if (value.variantSku !== null && !isBoundedText(value.variantSku, 80)) {
    issues.push(`${path}.variantSku is invalid.`);
  }
  if (value.variantName !== null && !isBoundedText(value.variantName, 120)) {
    issues.push(`${path}.variantName is invalid.`);
  }
  if (!isPositiveSafeInteger(value.quantity)) issues.push(`${path}.quantity is invalid.`);
  if (!isNonNegativeSafeInteger(value.unitPriceMinor)) {
    issues.push(`${path}.unitPriceMinor is invalid.`);
  }
  if (
    !isNonNegativeSafeInteger(value.lineTotalMinor) ||
    (isPositiveSafeInteger(value.quantity) &&
      isNonNegativeSafeInteger(value.unitPriceMinor) &&
      value.lineTotalMinor !== value.quantity * value.unitPriceMinor)
  ) {
    issues.push(`${path}.lineTotalMinor is invalid.`);
  }
}

function analyzeCustomer(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, customerKeys, path, issues);
  if (!isBoundedText(value.fullName, 120)) issues.push(`${path}.fullName is invalid.`);
  if (
    !isBoundedText(value.email, 254) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.email) ||
    value.email !== value.email.toLowerCase()
  ) {
    issues.push(`${path}.email is invalid.`);
  }
  if (!isBoundedText(value.phone, 32) || !/^\+?[0-9 ()-]{7,32}$/u.test(value.phone)) {
    issues.push(`${path}.phone is invalid.`);
  }
}

function analyzeShipping(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, shippingKeys, path, issues);
  if (!isBoundedText(value.recipientName, 120)) {
    issues.push(`${path}.recipientName is invalid.`);
  }
  if (!isBoundedText(value.phone, 32) || !/^\+?[0-9 ()-]{7,32}$/u.test(value.phone)) {
    issues.push(`${path}.phone is invalid.`);
  }
  if (typeof value.countryCode !== "string" || !/^[A-Z]{2}$/u.test(value.countryCode)) {
    issues.push(`${path}.countryCode is invalid.`);
  }
  if (!isBoundedText(value.postalCode, 20)) issues.push(`${path}.postalCode is invalid.`);
  if (!isBoundedText(value.addressLine1, 200)) issues.push(`${path}.addressLine1 is invalid.`);
  if (value.addressLine2 !== null && !isBoundedText(value.addressLine2, 200)) {
    issues.push(`${path}.addressLine2 is invalid.`);
  }
  if (!isBoundedText(value.locality, 100)) issues.push(`${path}.locality is invalid.`);
  if (value.administrativeArea !== null && !isBoundedText(value.administrativeArea, 100)) {
    issues.push(`${path}.administrativeArea is invalid.`);
  }
}

const storedOrderKeys = [
  "contract",
  "id",
  "status",
  "revision",
  "ownerSegment",
  "sourceDraftId",
  "checkoutIntentId",
  "cartRevision",
  "cartFingerprint",
  "currency",
  "subtotalMinor",
  "shippingMinor",
  "taxMinor",
  "totalMinor",
  "totalUnits",
  "lines",
  "deliveryMethod",
  "taxQuote",
  "privateDataStatus",
  "inventoryReservationStatus",
  "inventoryReservationLineKeys",
  "createdAt",
  "updatedAt",
  "pendingExpiresAt",
  "paymentProvider",
  "paymentReference",
  "paymentEventId",
  "paymentResolvedAt",
  "cancelledAt",
  "cancellationReason",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopOrder(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["order must be a plain object."];
  exactKeys(value, storedOrderKeys, "order", issues);
  if (value.contract !== NP_SHOP_ORDER_STORAGE_CONTRACT) {
    issues.push(`order.contract must equal "${NP_SHOP_ORDER_STORAGE_CONTRACT}".`);
  }
  if (!isCanonicalUuid(value.id)) issues.push("order.id is invalid.");
  if (!(npShopOrderStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("order.status is invalid.");
  }
  if (!isPositiveSafeInteger(value.revision)) issues.push("order.revision is invalid.");
  if (!isOwnerSegment(value.ownerSegment)) {
    issues.push("order.ownerSegment is invalid.");
  }
  if (!isCanonicalUuid(value.sourceDraftId)) issues.push("order.sourceDraftId is invalid.");
  if (!isCanonicalUuid(value.checkoutIntentId)) issues.push("order.checkoutIntentId is invalid.");
  if (!isPositiveSafeInteger(value.cartRevision)) issues.push("order.cartRevision is invalid.");
  if (typeof value.cartFingerprint !== "string" || !digestPattern.test(value.cartFingerprint)) {
    issues.push("order.cartFingerprint is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("order.currency is invalid.");
  }
  if (!isNonNegativeSafeInteger(value.subtotalMinor)) {
    issues.push("order.subtotalMinor is invalid.");
  }
  if (!isNonNegativeSafeInteger(value.shippingMinor)) {
    issues.push("order.shippingMinor is invalid.");
  }
  if (!isNonNegativeSafeInteger(value.taxMinor)) {
    issues.push("order.taxMinor is invalid.");
  }
  if (!isNonNegativeSafeInteger(value.totalMinor)) {
    issues.push("order.totalMinor is invalid.");
  }
  if (
    isNonNegativeSafeInteger(value.subtotalMinor) &&
    isNonNegativeSafeInteger(value.shippingMinor) &&
    isNonNegativeSafeInteger(value.taxMinor) &&
    isNonNegativeSafeInteger(value.totalMinor) &&
    value.subtotalMinor + value.shippingMinor + value.taxMinor !== value.totalMinor
  ) {
    issues.push("order.totalMinor must equal subtotalMinor plus shippingMinor plus taxMinor.");
  }
  if (!isPositiveSafeInteger(value.totalUnits)) issues.push("order.totalUnits is invalid.");
  if (!Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 100) {
    issues.push("order.lines must contain between 1 and 100 entries.");
  } else {
    value.lines.forEach((line, index) =>
      analyzeLine(line, `order.lines[${index.toString()}]`, issues),
    );
    const lineKeys = value.lines
      .filter(isRecord)
      .map((line) => line.key)
      .filter((key): key is string => typeof key === "string");
    if (new Set(lineKeys).size !== lineKeys.length) {
      issues.push("order.lines keys must be unique.");
    }
  }
  if (value.deliveryMethod !== null) {
    issues.push(
      ...npAnalyzeShopDeliveryMethod(value.deliveryMethod).map(
        (issue) => `order.${issue.replace(/^delivery method/u, "deliveryMethod")}`,
      ),
    );
  }
  if (
    isRecord(value.deliveryMethod) &&
    isNonNegativeSafeInteger(value.shippingMinor) &&
    value.deliveryMethod.amountMinor !== value.shippingMinor
  ) {
    issues.push("order.shippingMinor must equal the delivery method amount.");
  }
  if (value.deliveryMethod === null && value.shippingMinor !== 0) {
    issues.push("order without a delivery method must have zero shippingMinor.");
  }
  if (value.taxQuote !== null) {
    issues.push(
      ...npAnalyzeShopTaxQuote(value.taxQuote).map(
        (issue) => `order.${issue.replace(/^tax quote/u, "taxQuote")}`,
      ),
    );
  }
  if (
    isRecord(value.taxQuote) &&
    isNonNegativeSafeInteger(value.taxMinor) &&
    value.taxQuote.amountMinor !== value.taxMinor
  ) {
    issues.push("order.taxMinor must equal the tax quote amount.");
  }
  if (value.taxQuote === null && value.taxMinor !== 0) {
    issues.push("order without a tax quote must have zero taxMinor.");
  }
  if (!(npShopOrderPrivateDataStatuses as readonly unknown[]).includes(value.privateDataStatus)) {
    issues.push("order.privateDataStatus is invalid.");
  }
  if (
    !(npShopInventoryReservationStatuses as readonly unknown[]).includes(
      value.inventoryReservationStatus,
    )
  ) {
    issues.push("order.inventoryReservationStatus is invalid.");
  }
  if (
    !Array.isArray(value.inventoryReservationLineKeys) ||
    value.inventoryReservationLineKeys.length > 100 ||
    value.inventoryReservationLineKeys.some((key) => typeof key !== "string") ||
    new Set(value.inventoryReservationLineKeys).size !== value.inventoryReservationLineKeys.length
  ) {
    issues.push("order.inventoryReservationLineKeys is invalid.");
  } else if (Array.isArray(value.lines) && value.lines.every(isRecord)) {
    const storedLineKeys = new Set(value.lines.map((line) => line.key));
    if (value.inventoryReservationLineKeys.some((key) => !storedLineKeys.has(key))) {
      issues.push("order.inventoryReservationLineKeys must reference stored order lines.");
    }
  }
  if (
    (value.inventoryReservationStatus === "not-required" &&
      Array.isArray(value.inventoryReservationLineKeys) &&
      value.inventoryReservationLineKeys.length !== 0) ||
    ((value.inventoryReservationStatus === "held" ||
      value.inventoryReservationStatus === "consumed" ||
      value.inventoryReservationStatus === "released") &&
      Array.isArray(value.inventoryReservationLineKeys) &&
      value.inventoryReservationLineKeys.length === 0)
  ) {
    issues.push("order inventory reservation status must match its reserved line keys.");
  }
  for (const key of ["createdAt", "updatedAt", "pendingExpiresAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`order.${key} is invalid.`);
  }
  if (value.cancelledAt !== null && !isCanonicalIso(value.cancelledAt)) {
    issues.push("order.cancelledAt is invalid.");
  }
  if (
    value.paymentProvider !== null &&
    (typeof value.paymentProvider !== "string" ||
      !paymentProviderPattern.test(value.paymentProvider))
  ) {
    issues.push("order.paymentProvider is invalid.");
  }
  for (const key of ["paymentReference", "paymentEventId"] as const) {
    if (
      value[key] !== null &&
      (!isBoundedText(value[key], 200) || !opaquePaymentReferencePattern.test(value[key]))
    ) {
      issues.push(`order.${key} is invalid.`);
    }
  }
  if (value.paymentResolvedAt !== null && !isCanonicalIso(value.paymentResolvedAt)) {
    issues.push("order.paymentResolvedAt is invalid.");
  }
  if (
    value.cancellationReason !== null &&
    !(npShopOrderCancellationReasons as readonly unknown[]).includes(value.cancellationReason)
  ) {
    issues.push("order.cancellationReason is invalid.");
  }
  if (
    value.status === "pending-payment" &&
    (value.cancelledAt !== null ||
      value.cancellationReason !== null ||
      value.paymentProvider !== null ||
      value.paymentReference !== null ||
      value.paymentEventId !== null ||
      value.paymentResolvedAt !== null ||
      value.privateDataStatus !== "retained" ||
      (value.inventoryReservationStatus !== "held" &&
        value.inventoryReservationStatus !== "not-required"))
  ) {
    issues.push(
      "pending-payment orders require retained private data, an active reservation state, and no cancellation metadata.",
    );
  }
  const hasPaymentMetadata =
    typeof value.paymentProvider === "string" &&
    typeof value.paymentReference === "string" &&
    typeof value.paymentEventId === "string" &&
    isCanonicalIso(value.paymentResolvedAt);
  if (
    value.status === "paid" &&
    (!hasPaymentMetadata ||
      value.cancelledAt !== null ||
      value.cancellationReason !== null ||
      (value.inventoryReservationStatus !== "consumed" &&
        value.inventoryReservationStatus !== "not-required"))
  ) {
    issues.push(
      "paid orders require payment metadata, no cancellation metadata, and consumed or untracked inventory.",
    );
  }
  if (
    value.status === "refunded" &&
    (!hasPaymentMetadata ||
      value.cancelledAt !== null ||
      value.cancellationReason !== null ||
      value.privateDataStatus !== "redacted" ||
      (value.inventoryReservationStatus !== "consumed" &&
        value.inventoryReservationStatus !== "not-required"))
  ) {
    issues.push(
      "refunded orders require payment metadata, redacted private data, and the original inventory consumption state.",
    );
  }
  if (
    value.status === "payment-failed" &&
    (!hasPaymentMetadata ||
      value.cancelledAt !== null ||
      value.cancellationReason !== null ||
      value.privateDataStatus !== "redacted" ||
      (value.inventoryReservationStatus !== "released" &&
        value.inventoryReservationStatus !== "not-required"))
  ) {
    issues.push(
      "payment-failed orders require payment metadata, redacted private data, and released or untracked inventory.",
    );
  }
  if (
    value.status === "cancelled" &&
    (value.cancelledAt === null ||
      value.cancellationReason === null ||
      value.paymentProvider !== null ||
      value.paymentReference !== null ||
      value.paymentEventId !== null ||
      value.paymentResolvedAt !== null ||
      value.privateDataStatus !== "redacted" ||
      (value.inventoryReservationStatus !== "released" &&
        value.inventoryReservationStatus !== "not-required"))
  ) {
    issues.push(
      "cancelled orders require cancellation metadata, redacted private data, and no held inventory.",
    );
  }
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.createdAt)
  ) {
    issues.push("order.updatedAt cannot precede order.createdAt.");
  }
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.pendingExpiresAt) &&
    new Date(value.pendingExpiresAt).getTime() - new Date(value.createdAt).getTime() !==
      npShopOrderLimits.pendingTtlSeconds * 1_000
  ) {
    issues.push("order.pendingExpiresAt must equal the fixed pending lifetime.");
  }
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.purgeAt).getTime() - new Date(value.createdAt).getTime() !==
      npShopOrderLimits.commercialRetentionSeconds * 1_000
  ) {
    issues.push("order.purgeAt must equal the fixed commercial retention lifetime.");
  }
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.cancelledAt) &&
    new Date(value.cancelledAt) < new Date(value.createdAt)
  ) {
    issues.push("order.cancelledAt cannot precede order.createdAt.");
  }
  if (
    isCanonicalIso(value.paymentResolvedAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.paymentResolvedAt)
  ) {
    issues.push("order.updatedAt cannot precede order.paymentResolvedAt.");
  }
  if (
    isCanonicalIso(value.cancelledAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.cancelledAt)
  ) {
    issues.push("order.updatedAt cannot precede order.cancelledAt.");
  }
  if (
    Array.isArray(value.lines) &&
    value.lines.every(isRecord) &&
    isNonNegativeSafeInteger(value.subtotalMinor)
  ) {
    const subtotal = value.lines.reduce(
      (sum, line) =>
        isNonNegativeSafeInteger(line.lineTotalMinor) ? sum + line.lineTotalMinor : sum,
      0,
    );
    if (subtotal !== value.subtotalMinor)
      issues.push("order.subtotalMinor must equal line totals.");
  }
  if (
    Array.isArray(value.lines) &&
    value.lines.every(isRecord) &&
    isPositiveSafeInteger(value.totalUnits)
  ) {
    const units = value.lines.reduce(
      (sum, line) => (isPositiveSafeInteger(line.quantity) ? sum + line.quantity : sum),
      0,
    );
    if (units !== value.totalUnits) issues.push("order.totalUnits must equal line quantities.");
  }
  return issues;
}

export function npRequireStoredShopOrder(value: unknown): NpShopStoredOrder {
  const issues = npAnalyzeStoredShopOrder(value);
  if (issues.length > 0) {
    throw new NpShopOrderContractError("Invalid stored Shop order", issues);
  }
  return value as NpShopStoredOrder;
}

const privateKeys = ["contract", "orderId", "customer", "shipping", "createdAt", "expiresAt"];

export function npAnalyzeStoredShopOrderPrivate(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["private order data must be a plain object."];
  const fulfillment = value.contract === NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT;
  exactKeys(
    value,
    fulfillment ? [...privateKeys.slice(0, -1), "retainedAt", "expiresAt"] : privateKeys,
    "private",
    issues,
  );
  if (!fulfillment && value.contract !== NP_SHOP_ORDER_PRIVATE_CONTRACT) {
    issues.push(
      `private.contract must equal "${NP_SHOP_ORDER_PRIVATE_CONTRACT}" or "${NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT}".`,
    );
  }
  if (!isCanonicalUuid(value.orderId)) issues.push("private.orderId is invalid.");
  analyzeCustomer(value.customer, "private.customer", issues);
  analyzeShipping(value.shipping, "private.shipping", issues);
  if (!isCanonicalIso(value.createdAt)) issues.push("private.createdAt is invalid.");
  if (fulfillment && !isCanonicalIso(value.retainedAt)) {
    issues.push("private.retainedAt is invalid.");
  }
  if (!isCanonicalIso(value.expiresAt)) issues.push("private.expiresAt is invalid.");
  if (
    !fulfillment &&
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.expiresAt) &&
    new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime() !==
      npShopOrderLimits.pendingTtlSeconds * 1_000
  ) {
    issues.push("private.expiresAt must equal the fixed pending lifetime.");
  }
  if (
    fulfillment &&
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.retainedAt) &&
    new Date(value.retainedAt) < new Date(value.createdAt)
  ) {
    issues.push("private.retainedAt cannot precede private.createdAt.");
  }
  if (
    fulfillment &&
    isCanonicalIso(value.retainedAt) &&
    isCanonicalIso(value.expiresAt) &&
    new Date(value.expiresAt).getTime() - new Date(value.retainedAt).getTime() !==
      npShopFulfillmentLimits.privateRetentionSeconds * 1_000
  ) {
    issues.push("private.expiresAt must equal the fixed fulfillment retention lifetime.");
  }
  return issues;
}

export function npRequireStoredShopOrderPrivate(value: unknown): NpShopStoredOrderPrivateData {
  const issues = npAnalyzeStoredShopOrderPrivate(value);
  if (issues.length > 0) {
    throw new NpShopOrderContractError("Invalid stored Shop order private data", issues);
  }
  return value as NpShopStoredOrderPrivateData;
}

const publicOrderKeys = [
  "contract",
  "id",
  "status",
  "revision",
  "sourceDraftId",
  "checkoutIntentId",
  "cartRevision",
  "cartFingerprint",
  "currency",
  "subtotalMinor",
  "shippingMinor",
  "taxMinor",
  "totalMinor",
  "totalUnits",
  "lines",
  "deliveryMethod",
  "taxQuote",
  "privateDataStatus",
  "inventoryReservationStatus",
  "inventoryReservationLineKeys",
  "customer",
  "shipping",
  "createdAt",
  "updatedAt",
  "pendingExpiresAt",
  "paymentProvider",
  "paymentReference",
  "paymentEventId",
  "paymentResolvedAt",
  "cancelledAt",
  "cancellationReason",
  "purgeAt",
] as const;

export function npAnalyzeShopOrder(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["order must be a plain object."];
  for (const key of Object.keys(value)) {
    if (
      ![
        ...publicOrderKeys,
        "fulfillment",
        "tracking",
        "refund",
        "partialRefund",
        "paymentAdjustment",
        "returnRequest",
      ].includes(key)
    ) {
      issues.push(`order.${key} is not supported.`);
    }
  }
  for (const key of publicOrderKeys) {
    if (!Object.hasOwn(value, key)) issues.push(`order.${key} is required.`);
  }
  const storedCandidate: Record<string, unknown> = {
    ...value,
    contract: NP_SHOP_ORDER_STORAGE_CONTRACT,
    ownerSegment: "guest:".padEnd(70, "0"),
  };
  delete storedCandidate.customer;
  delete storedCandidate.shipping;
  delete storedCandidate.fulfillment;
  delete storedCandidate.tracking;
  delete storedCandidate.refund;
  delete storedCandidate.partialRefund;
  delete storedCandidate.paymentAdjustment;
  delete storedCandidate.returnRequest;
  issues.push(...npAnalyzeStoredShopOrder(storedCandidate));
  if (value.contract !== NP_SHOP_ORDER_CONTRACT) {
    issues.push(`order.contract must equal "${NP_SHOP_ORDER_CONTRACT}".`);
  }
  if (value.privateDataStatus === "retained") {
    analyzeCustomer(value.customer, "order.customer", issues);
    analyzeShipping(value.shipping, "order.shipping", issues);
  } else if (value.customer !== null || value.shipping !== null) {
    issues.push("redacted orders cannot expose customer or shipping data.");
  }
  if (Object.hasOwn(value, "fulfillment")) {
    issues.push(...npAnalyzeShopFulfillment(value.fulfillment).map((issue) => `order.${issue}`));
    if (
      isRecord(value.fulfillment) &&
      (value.fulfillment.orderId !== value.id ||
        (value.status !== "paid" && value.status !== "refunded") ||
        value.fulfillment.privateDataStatus !== value.privateDataStatus ||
        value.fulfillment.createdAt !== value.paymentResolvedAt)
    ) {
      issues.push(
        "order.fulfillment must match the paid order id, payment timestamp, and private-data state.",
      );
    }
  }
  if (Object.hasOwn(value, "tracking")) {
    issues.push(...npAnalyzeShopTracking(value.tracking).map((issue) => `order.${issue}`));
    if (
      !isRecord(value.tracking) ||
      !isRecord(value.fulfillment) ||
      value.fulfillment.status !== "shipped" ||
      value.fulfillment.privateDataStatus !== "redacted"
    ) {
      issues.push("order.tracking requires one redacted shipped fulfillment.");
    }
  }
  if (Object.hasOwn(value, "refund")) {
    if (!isRecord(value.refund)) {
      issues.push("order.refund must be a plain object.");
    } else {
      const publicRefundKeys = [
        "contract",
        "id",
        "status",
        "currency",
        "amountMinor",
        "inventoryOutcome",
        "fulfillmentOutcome",
        "requestedAt",
        "refundedAt",
      ] as const;
      exactKeys(value.refund, publicRefundKeys, "order.refund", issues);
      const candidate = {
        contract: "np.shop-refund-storage.v1",
        id: value.refund.id,
        orderId: value.id,
        providerId: value.paymentProvider,
        status: value.refund.status,
        orderRevision: value.revision,
        paymentReference: value.paymentReference,
        refundReference:
          value.refund.status === "refunded" || value.refund.status === "provider-confirmed"
            ? "projected"
            : null,
        currency: value.refund.currency,
        amountMinor: value.refund.amountMinor,
        reason: "projected",
        inventoryOutcome: value.refund.inventoryOutcome,
        fulfillmentOutcome: value.refund.fulfillmentOutcome,
        providerErrorCode: value.refund.status === "manual-review" ? "projected" : null,
        requestedAt: value.refund.requestedAt,
        updatedAt:
          typeof value.refund.refundedAt === "string" &&
          typeof value.refund.requestedAt === "string" &&
          new Date(value.refund.refundedAt) > new Date(value.refund.requestedAt)
            ? value.refund.refundedAt
            : value.refund.requestedAt,
        refundedAt: value.refund.refundedAt,
        purgeAt: value.purgeAt,
      };
      issues.push(
        ...npAnalyzeStoredShopRefund(candidate)
          .filter((issue) => issue !== "refund.orderRevision is invalid.")
          .map((issue) => `order.${issue}`),
      );
      if (
        value.refund.contract !== NP_SHOP_REFUND_CONTRACT ||
        value.refund.currency !== value.currency ||
        value.refund.amountMinor !== value.totalMinor ||
        (value.refund.status === "refunded" && value.status !== "refunded")
      ) {
        issues.push("order.refund must match the order currency, amount, and terminal status.");
      }
      if (
        value.refund.status === "refunded" &&
        (!isRecord(value.fulfillment) ||
          (value.refund.fulfillmentOutcome === "cancelled"
            ? value.fulfillment.status !== "cancelled"
            : value.refund.fulfillmentOutcome === "shipped-retained"
              ? value.fulfillment.status !== "shipped"
              : true) ||
          (value.refund.inventoryOutcome === "not-applicable-shipped" &&
            value.fulfillment.status !== "shipped"))
      ) {
        issues.push("order.refund outcomes must match cancelled or shipped fulfillment state.");
      }
    }
  } else if (value.status === "refunded") {
    issues.push("refunded orders require a projected refund.");
  }
  if (Object.hasOwn(value, "partialRefund")) {
    issues.push(
      ...npAnalyzeShopPartialRefund(value.partialRefund).map((issue) => `order.${issue}`),
    );
    if (
      !isRecord(value.partialRefund) ||
      value.partialRefund.contract !== NP_SHOP_PARTIAL_REFUND_CONTRACT ||
      value.partialRefund.currency !== value.currency ||
      !Number.isSafeInteger(value.partialRefund.amountMinor) ||
      !Number.isSafeInteger(value.totalMinor) ||
      (value.partialRefund.amountMinor as number) >= (value.totalMinor as number) ||
      value.status !== "paid" ||
      !isRecord(value.fulfillment) ||
      value.fulfillment.status !== "shipped" ||
      !isRecord(value.returnRequest) ||
      value.returnRequest.status !== "received" ||
      value.partialRefund.returnId !== value.returnRequest.id ||
      Object.hasOwn(value, "refund")
    ) {
      issues.push(
        "order.partialRefund must match one paid shipped order, its received return, currency, and bounded non-full amount.",
      );
    }
  }
  if (Object.hasOwn(value, "paymentAdjustment")) {
    issues.push(
      ...npAnalyzeShopPaymentAdjustment(value.paymentAdjustment).map((issue) => `order.${issue}`),
    );
    if (
      !isRecord(value.paymentAdjustment) ||
      value.paymentAdjustment.contract !== NP_SHOP_PAYMENT_ADJUSTMENT_CONTRACT ||
      value.paymentAdjustment.currency !== value.currency ||
      value.paymentAdjustment.originalAmountMinor !== value.totalMinor ||
      (value.paymentAdjustment.status === "applied-full-reversal" && value.status !== "refunded") ||
      (value.paymentAdjustment.status === "manual-review" && value.status !== "paid") ||
      (value.paymentAdjustment.status === "matched-refund" &&
        value.status !== "paid" &&
        value.status !== "refunded") ||
      (value.paymentAdjustment.status === "closed-unpaid-order" &&
        value.status !== "payment-failed" &&
        value.status !== "cancelled")
    ) {
      issues.push(
        "order.paymentAdjustment must match the order currency, total, and reconciled status.",
      );
    }
  }
  if (Object.hasOwn(value, "returnRequest")) {
    issues.push(...npAnalyzeShopReturn(value.returnRequest).map((issue) => `order.${issue}`));
    if (
      !isRecord(value.returnRequest) ||
      value.returnRequest.contract !== NP_SHOP_RETURN_CONTRACT ||
      value.returnRequest.orderId !== value.id ||
      (value.status !== "paid" && value.status !== "refunded") ||
      !isRecord(value.fulfillment) ||
      value.fulfillment.status !== "shipped"
    ) {
      issues.push("order.returnRequest must match one shipped paid or refunded order.");
    }
  }
  return issues.filter(
    (issue) =>
      issue !== `order.contract must equal "${NP_SHOP_ORDER_STORAGE_CONTRACT}".` &&
      issue !== "order.ownerSegment is invalid.",
  );
}

export function npRequireShopOrder(value: unknown): NpShopOrder {
  const issues = npAnalyzeShopOrder(value);
  if (issues.length > 0) throw new NpShopOrderContractError("Invalid Shop order", issues);
  return value as NpShopOrder;
}

export function npRequireShopOrderList(value: unknown): NpShopOrderList {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopOrderContractError("Invalid Shop order list", [
      "order list must be a plain object.",
    ]);
  }
  exactKeys(value, ["contract", "orders", "total"], "order list", issues);
  if (value.contract !== NP_SHOP_ORDER_LIST_CONTRACT) {
    issues.push(`order list.contract must equal "${NP_SHOP_ORDER_LIST_CONTRACT}".`);
  }
  if (!Array.isArray(value.orders) || value.orders.length > npShopOrderLimits.ownerListSize) {
    issues.push(
      `order list.orders must contain at most ${npShopOrderLimits.ownerListSize.toString()} entries.`,
    );
  } else {
    value.orders.forEach((order, index) => {
      issues.push(
        ...npAnalyzeShopOrder(order).map(
          (issue) => `order list.orders[${index.toString()}]: ${issue}`,
        ),
      );
    });
  }
  if (!isNonNegativeSafeInteger(value.total)) issues.push("order list.total is invalid.");
  if (
    Array.isArray(value.orders) &&
    isNonNegativeSafeInteger(value.total) &&
    value.total < value.orders.length
  ) {
    issues.push("order list.total cannot be smaller than the returned order count.");
  }
  if (issues.length > 0) throw new NpShopOrderContractError("Invalid Shop order list", issues);
  return value as unknown as NpShopOrderList;
}

function requireInput(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const issues: string[] = [];
  if (!isRecord(value))
    throw new NpShopOrderContractError(`Invalid ${path}`, [`${path} is invalid.`]);
  exactKeys(value, keys, path, issues);
  if (issues.length > 0) throw new NpShopOrderContractError(`Invalid ${path}`, issues);
  return value;
}

export function npRequireShopOrderCreateInput(value: unknown): NpShopOrderCreateInput {
  const input = requireInput(
    value,
    ["idempotencyKey", "draftId", "expectedRevision"],
    "order create request",
  );
  const issues: string[] = [];
  if (!isCanonicalUuid(input.idempotencyKey)) {
    issues.push("order create request.idempotencyKey is invalid.");
  }
  if (!isCanonicalUuid(input.draftId)) issues.push("order create request.draftId is invalid.");
  if (!isPositiveSafeInteger(input.expectedRevision)) {
    issues.push("order create request.expectedRevision is invalid.");
  }
  if (issues.length > 0) throw new NpShopOrderContractError("Invalid order create request", issues);
  return input as unknown as NpShopOrderCreateInput;
}

export function npRequireShopOrderCancelInput(value: unknown): NpShopOrderCancelInput {
  const input = requireInput(value, ["orderId", "expectedRevision"], "order cancel request");
  const issues: string[] = [];
  if (!isCanonicalUuid(input.orderId)) issues.push("order cancel request.orderId is invalid.");
  if (!isPositiveSafeInteger(input.expectedRevision)) {
    issues.push("order cancel request.expectedRevision is invalid.");
  }
  if (issues.length > 0) throw new NpShopOrderContractError("Invalid order cancel request", issues);
  return input as unknown as NpShopOrderCancelInput;
}

export function npRequireShopOrderId(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    throw new NpShopOrderContractError("Invalid order id", ["order id must be a canonical UUID."]);
  }
  return value;
}
