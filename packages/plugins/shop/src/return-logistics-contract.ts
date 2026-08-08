import type { NpShopOrderDraftShipping } from "./types.js";
import {
  npAnalyzeShopReturnTracking,
  type NpShopReturnTracking,
} from "./return-tracking-contract.js";
import type { NpShopReturnPostageMethod } from "./return-postage-contract.js";

export const NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT =
  "np.shop-return-logistics-request.v1" as const;
export const NP_SHOP_RETURN_LOGISTICS_RESULT_CONTRACT =
  "np.shop-return-logistics-result.v1" as const;
export const NP_SHOP_RETURN_LOGISTICS_CANCEL_REQUEST_CONTRACT =
  "np.shop-return-logistics-cancel-request.v1" as const;
export const NP_SHOP_RETURN_LOGISTICS_CANCEL_RESULT_CONTRACT =
  "np.shop-return-logistics-cancel-result.v1" as const;
export const NP_SHOP_RETURN_LOGISTICS_LABEL_REQUEST_CONTRACT =
  "np.shop-return-logistics-label-request.v1" as const;
export const NP_SHOP_RETURN_LOGISTICS_LABEL_RESULT_CONTRACT =
  "np.shop-return-logistics-label-result.v1" as const;
export const NP_SHOP_RETURN_LOGISTICS_STORAGE_CONTRACT =
  "np.shop-return-logistics-storage.v1" as const;
export const NP_SHOP_RETURN_LOGISTICS_PRIVATE_CONTRACT =
  "np.shop-return-logistics-private.v1" as const;
export const NP_SHOP_RETURN_LOGISTICS_CONTRACT = "np.shop-return-logistics.v1" as const;

export const npShopReturnLogisticsModes = ["dropoff", "pickup"] as const;
export type NpShopReturnLogisticsMode = (typeof npShopReturnLogisticsModes)[number];

export const npShopReturnLogisticsStatuses = [
  "pending",
  "provider-confirmed",
  "active",
  "cancel-pending",
  "cancel-confirmed",
  "cancelled",
  "manual-review",
] as const;
export type NpShopReturnLogisticsStatus = (typeof npShopReturnLogisticsStatuses)[number];

export const npShopReturnLogisticsLabelFormats = ["pdf", "png", "zpl"] as const;
export type NpShopReturnLogisticsLabelFormat = (typeof npShopReturnLogisticsLabelFormats)[number];

export const npShopReturnLogisticsLimits = Object.freeze({
  providerIdLength: 32,
  referenceLength: 200,
  carrierLength: 80,
  trackingNumberLength: 120,
  productNameLength: 180,
  variantSkuLength: 64,
  variantNameLength: 120,
  maximumItems: 100,
  maximumQuantity: 99,
  providerErrorCodeLength: 100,
  privateTtlSeconds: 24 * 60 * 60,
  minimumWindowSeconds: 15 * 60,
  maximumWindowSeconds: 12 * 60 * 60,
  maximumLeadSeconds: 14 * 24 * 60 * 60,
  futureToleranceSeconds: 30,
  labelBytes: 5 * 1024 * 1024,
  adminListSize: 50,
  diagnosticSampleSize: 500,
  cleanupBatchSize: 100,
});

export interface NpShopReturnLogisticsItem {
  lineKey: string;
  productId: string;
  productName: string;
  variantSku: string | null;
  variantName: string | null;
  quantity: number;
}

export interface NpShopReturnLogisticsRequest {
  contract: typeof NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT;
  logisticsId: string;
  returnId: string;
  orderId: string;
  originalShipmentId: string;
  originalBookingReference: string;
  mode: NpShopReturnLogisticsMode;
  returnLocationReference: string;
  items: NpShopReturnLogisticsItem[];
  origin: NpShopOrderDraftShipping;
  readyAt: string | null;
  closeAt: string | null;
  requestedAt: string;
}

export interface NpShopReturnLogisticsResult {
  contract: typeof NP_SHOP_RETURN_LOGISTICS_RESULT_CONTRACT;
  logisticsId: string;
  returnId: string;
  orderId: string;
  returnReference: string;
  carrier: string;
  trackingNumber: string;
  readyAt: string | null;
  closeAt: string | null;
  confirmedAt: string;
}

export interface NpShopReturnLogisticsCancelRequest {
  contract: typeof NP_SHOP_RETURN_LOGISTICS_CANCEL_REQUEST_CONTRACT;
  cancellationId: string;
  logisticsId: string;
  returnId: string;
  orderId: string;
  returnReference: string;
  requestedAt: string;
}

export interface NpShopReturnLogisticsCancelResult {
  contract: typeof NP_SHOP_RETURN_LOGISTICS_CANCEL_RESULT_CONTRACT;
  cancellationId: string;
  logisticsId: string;
  returnId: string;
  orderId: string;
  cancelledAt: string;
}

export interface NpShopReturnLogisticsLabelRequest {
  contract: typeof NP_SHOP_RETURN_LOGISTICS_LABEL_REQUEST_CONTRACT;
  logisticsId: string;
  returnId: string;
  orderId: string;
  returnReference: string;
  carrier: string;
  trackingNumber: string;
  requestedAt: string;
}

export interface NpShopReturnLogisticsLabelResult {
  contract: typeof NP_SHOP_RETURN_LOGISTICS_LABEL_RESULT_CONTRACT;
  logisticsId: string;
  returnId: string;
  orderId: string;
  format: NpShopReturnLogisticsLabelFormat;
  content: Uint8Array;
  retrievedAt: string;
}

export interface NpShopStoredReturnLogistics {
  contract: typeof NP_SHOP_RETURN_LOGISTICS_STORAGE_CONTRACT;
  id: string;
  returnId: string;
  orderId: string;
  ownerSegment: string;
  providerId: string;
  status: NpShopReturnLogisticsStatus;
  revision: number;
  mode: NpShopReturnLogisticsMode;
  originalShipmentId: string;
  originalBookingReference: string;
  returnReference: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  readyAt: string | null;
  closeAt: string | null;
  providerErrorCode: string | null;
  cancellationId: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  purgeAt: string;
  /** Immutable PII-free provider quote selected before v2 creation. */
  postageMethod?: NpShopReturnPostageMethod | null;
}

export interface NpShopStoredReturnLogisticsPrivate {
  contract: typeof NP_SHOP_RETURN_LOGISTICS_PRIVATE_CONTRACT;
  logisticsId: string;
  returnId: string;
  orderId: string;
  ownerSegment: string;
  origin: NpShopOrderDraftShipping;
  createdAt: string;
  expiresAt: string;
}

export interface NpShopReturnLogistics {
  contract: typeof NP_SHOP_RETURN_LOGISTICS_CONTRACT;
  id: string;
  status: NpShopReturnLogisticsStatus;
  revision: number;
  mode: NpShopReturnLogisticsMode;
  carrier: string | null;
  trackingNumber: string | null;
  readyAt: string | null;
  closeAt: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  /** Present when the owner selected a provider-quoted return method. */
  postageMethod?: NpShopReturnPostageMethod;
  /** Present after the first verified reverse-shipment carrier event. */
  tracking?: NpShopReturnTracking;
}

export interface NpShopReturnLogisticsCreateInput {
  orderId: string;
  returnId: string;
  expectedReturnRevision: number;
  mode: NpShopReturnLogisticsMode;
  origin: NpShopOrderDraftShipping;
  readyAt: string | null;
  closeAt: string | null;
}

export interface NpShopReturnLogisticsExistingInput {
  orderId: string;
  returnId: string;
  logisticsId: string;
  expectedRevision: number;
}

export interface NpShopReturnLogisticsLabelReadInput {
  orderId: string;
  returnId: string;
  logisticsId: string;
}

export class NpShopReturnLogisticsContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopReturnLogisticsContractError";
    this.issues = issues;
  }
}

export class NpShopReturnLogisticsConflictError extends Error {
  readonly code:
    | "return_logistics_not_supported"
    | "return_logistics_not_found"
    | "return_logistics_already_exists"
    | "return_logistics_return_conflict"
    | "return_logistics_revision_conflict"
    | "return_logistics_state_conflict"
    | "return_logistics_private_expired"
    | "return_logistics_result_mismatch"
    | "return_logistics_manual_review"
    | "return_logistics_tracking_started";

  constructor(code: NpShopReturnLogisticsConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopReturnLogisticsConflictError";
    this.code = code;
  }
}

export class NpShopReturnLogisticsProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, options: { retryable: boolean }) {
    super(message);
    this.name = "NpShopReturnLogisticsProviderError";
    this.code = code;
    this.retryable = options.retryable;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const guestOwnerPattern = /^guest:[0-9a-f]{64}$/u;
const providerPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const postageMethodPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const errorCodePattern = /^[a-z][a-z0-9-]{0,99}$/u;
const countryPattern = /^[A-Z]{2}$/u;

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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerPattern.test(value) ||
      (value.startsWith("member:") && isUuid(value.slice("member:".length))))
  );
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function analyzeShipping(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(
    value,
    [
      "recipientName",
      "phone",
      "countryCode",
      "postalCode",
      "addressLine1",
      "addressLine2",
      "locality",
      "administrativeArea",
    ],
    path,
    issues,
  );
  if (!isText(value.recipientName, 120)) issues.push(`${path}.recipientName is invalid.`);
  if (!isText(value.phone, 40)) issues.push(`${path}.phone is invalid.`);
  if (typeof value.countryCode !== "string" || !countryPattern.test(value.countryCode)) {
    issues.push(`${path}.countryCode is invalid.`);
  }
  if (!isText(value.postalCode, 32)) issues.push(`${path}.postalCode is invalid.`);
  if (!isText(value.addressLine1, 200)) issues.push(`${path}.addressLine1 is invalid.`);
  if (value.addressLine2 !== null && !isText(value.addressLine2, 200)) {
    issues.push(`${path}.addressLine2 is invalid.`);
  }
  if (!isText(value.locality, 120)) issues.push(`${path}.locality is invalid.`);
  if (value.administrativeArea !== null && !isText(value.administrativeArea, 120)) {
    issues.push(`${path}.administrativeArea is invalid.`);
  }
}

function analyzeWindow(
  mode: unknown,
  readyAt: unknown,
  closeAt: unknown,
  path: string,
  issues: string[],
): void {
  if (mode === "dropoff") {
    if (readyAt !== null || closeAt !== null) {
      issues.push(`${path} dropoff mode cannot contain a pickup window.`);
    }
    return;
  }
  if (mode !== "pickup") return;
  if (!isIso(readyAt)) issues.push(`${path}.readyAt is invalid.`);
  if (!isIso(closeAt)) issues.push(`${path}.closeAt is invalid.`);
  if (!isIso(readyAt) || !isIso(closeAt)) return;
  const duration = new Date(closeAt).getTime() - new Date(readyAt).getTime();
  if (
    duration < npShopReturnLogisticsLimits.minimumWindowSeconds * 1_000 ||
    duration > npShopReturnLogisticsLimits.maximumWindowSeconds * 1_000
  ) {
    issues.push(`${path} pickup window duration is invalid.`);
  }
}

function analyzePostageMethod(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(
    value,
    [
      "contract",
      "providerId",
      "quoteId",
      "methodId",
      "label",
      "currency",
      "amountMinor",
      "estimatedTransit",
      "quotedAt",
      "quoteExpiresAt",
    ],
    path,
    issues,
  );
  if (value.contract !== "np.shop-return-postage-method.v1") {
    issues.push(`${path}.contract is invalid.`);
  }
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId)) {
    issues.push(`${path}.providerId is invalid.`);
  }
  if (!isUuid(value.quoteId)) issues.push(`${path}.quoteId is invalid.`);
  if (!isText(value.methodId, 64) || !postageMethodPattern.test(value.methodId)) {
    issues.push(`${path}.methodId is invalid.`);
  }
  if (!isText(value.label, 120)) issues.push(`${path}.label is invalid.`);
  if (!["KRW", "USD", "EUR", "JPY"].includes(String(value.currency))) {
    issues.push(`${path}.currency is invalid.`);
  }
  if (
    !Number.isSafeInteger(value.amountMinor) ||
    (value.amountMinor as number) < 0 ||
    (value.amountMinor as number) > 2_147_483_647
  ) {
    issues.push(`${path}.amountMinor is invalid.`);
  }
  if (value.estimatedTransit !== null) {
    if (!isRecord(value.estimatedTransit)) {
      issues.push(`${path}.estimatedTransit is invalid.`);
    } else {
      exactKeys(
        value.estimatedTransit,
        ["minimumDays", "maximumDays"],
        `${path}.estimatedTransit`,
        issues,
      );
      for (const key of ["minimumDays", "maximumDays"] as const) {
        if (
          !Number.isSafeInteger(value.estimatedTransit[key]) ||
          (value.estimatedTransit[key] as number) < 0 ||
          (value.estimatedTransit[key] as number) > 365
        ) {
          issues.push(`${path}.estimatedTransit.${key} is invalid.`);
        }
      }
      if (
        Number.isSafeInteger(value.estimatedTransit.minimumDays) &&
        Number.isSafeInteger(value.estimatedTransit.maximumDays) &&
        (value.estimatedTransit.minimumDays as number) >
          (value.estimatedTransit.maximumDays as number)
      ) {
        issues.push(`${path}.estimatedTransit.minimumDays must not exceed maximumDays.`);
      }
    }
  }
  if (!isIso(value.quotedAt)) issues.push(`${path}.quotedAt is invalid.`);
  if (!isIso(value.quoteExpiresAt)) issues.push(`${path}.quoteExpiresAt is invalid.`);
  if (
    isIso(value.quotedAt) &&
    isIso(value.quoteExpiresAt) &&
    value.quoteExpiresAt <= value.quotedAt
  ) {
    issues.push(`${path} expiry must follow quotedAt.`);
  }
}

function analyzeItems(value: unknown, path: string, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopReturnLogisticsLimits.maximumItems
  ) {
    issues.push(
      `${path} must contain 1-${npShopReturnLogisticsLimits.maximumItems.toString()} items.`,
    );
    return;
  }
  const keys = new Set<string>();
  value.forEach((candidate, index) => {
    const itemPath = `${path}[${index.toString()}]`;
    if (!isRecord(candidate)) {
      issues.push(`${itemPath} must be a plain object.`);
      return;
    }
    exactKeys(
      candidate,
      ["lineKey", "productId", "productName", "variantSku", "variantName", "quantity"],
      itemPath,
      issues,
    );
    if (!isText(candidate.lineKey, 300)) issues.push(`${itemPath}.lineKey is invalid.`);
    else if (keys.has(candidate.lineKey)) issues.push(`${itemPath}.lineKey is duplicated.`);
    else keys.add(candidate.lineKey);
    if (!isUuid(candidate.productId)) issues.push(`${itemPath}.productId is invalid.`);
    if (!isText(candidate.productName, npShopReturnLogisticsLimits.productNameLength)) {
      issues.push(`${itemPath}.productName is invalid.`);
    }
    if (
      candidate.variantSku !== null &&
      !isText(candidate.variantSku, npShopReturnLogisticsLimits.variantSkuLength)
    ) {
      issues.push(`${itemPath}.variantSku is invalid.`);
    }
    if (
      candidate.variantName !== null &&
      !isText(candidate.variantName, npShopReturnLogisticsLimits.variantNameLength)
    ) {
      issues.push(`${itemPath}.variantName is invalid.`);
    }
    if (
      !Number.isSafeInteger(candidate.quantity) ||
      (candidate.quantity as number) < 1 ||
      (candidate.quantity as number) > npShopReturnLogisticsLimits.maximumQuantity
    ) {
      issues.push(`${itemPath}.quantity is invalid.`);
    }
  });
}

function analyzeIdentity(value: Record<string, unknown>, path: string, issues: string[]): void {
  for (const key of ["logisticsId", "returnId", "orderId"] as const) {
    if (!isUuid(value[key])) issues.push(`${path}.${key} is invalid.`);
  }
}

export function npAnalyzeShopReturnLogisticsRequest(value: unknown): string[] {
  if (!isRecord(value)) return ["return logistics request must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "logisticsId",
      "returnId",
      "orderId",
      "originalShipmentId",
      "originalBookingReference",
      "mode",
      "returnLocationReference",
      "items",
      "origin",
      "readyAt",
      "closeAt",
      "requestedAt",
    ],
    "return logistics request",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT) {
    issues.push("return logistics request.contract is invalid.");
  }
  analyzeIdentity(value, "return logistics request", issues);
  if (!isUuid(value.originalShipmentId)) {
    issues.push("return logistics request.originalShipmentId is invalid.");
  }
  for (const key of ["originalBookingReference", "returnLocationReference"] as const) {
    if (typeof value[key] !== "string" || !referencePattern.test(value[key])) {
      issues.push(`return logistics request.${key} is invalid.`);
    }
  }
  if (!(npShopReturnLogisticsModes as readonly unknown[]).includes(value.mode)) {
    issues.push("return logistics request.mode is invalid.");
  }
  analyzeItems(value.items, "return logistics request.items", issues);
  analyzeShipping(value.origin, "return logistics request.origin", issues);
  analyzeWindow(value.mode, value.readyAt, value.closeAt, "return logistics request", issues);
  if (!isIso(value.requestedAt)) issues.push("return logistics request.requestedAt is invalid.");
  return issues;
}

export function npRequireShopReturnLogisticsRequest(value: unknown): NpShopReturnLogisticsRequest {
  const issues = npAnalyzeShopReturnLogisticsRequest(value);
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid return logistics request", issues);
  return value as NpShopReturnLogisticsRequest;
}

export function npAnalyzeShopReturnLogisticsResult(value: unknown): string[] {
  if (!isRecord(value)) return ["return logistics result must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "logisticsId",
      "returnId",
      "orderId",
      "returnReference",
      "carrier",
      "trackingNumber",
      "readyAt",
      "closeAt",
      "confirmedAt",
    ],
    "return logistics result",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_LOGISTICS_RESULT_CONTRACT) {
    issues.push("return logistics result.contract is invalid.");
  }
  analyzeIdentity(value, "return logistics result", issues);
  if (typeof value.returnReference !== "string" || !referencePattern.test(value.returnReference)) {
    issues.push("return logistics result.returnReference is invalid.");
  }
  if (!isText(value.carrier, npShopReturnLogisticsLimits.carrierLength)) {
    issues.push("return logistics result.carrier is invalid.");
  }
  if (!isText(value.trackingNumber, npShopReturnLogisticsLimits.trackingNumberLength)) {
    issues.push("return logistics result.trackingNumber is invalid.");
  }
  const nullableWindow = value.readyAt === null && value.closeAt === null;
  if (!nullableWindow)
    analyzeWindow("pickup", value.readyAt, value.closeAt, "return logistics result", issues);
  if (!isIso(value.confirmedAt)) issues.push("return logistics result.confirmedAt is invalid.");
  return issues;
}

export function npRequireShopReturnLogisticsResult(value: unknown): NpShopReturnLogisticsResult {
  const issues = npAnalyzeShopReturnLogisticsResult(value);
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid return logistics result", issues);
  return value as NpShopReturnLogisticsResult;
}

function analyzeCancel(value: unknown, result: boolean): string[] {
  if (!isRecord(value)) return ["return logistics cancellation must be a plain object."];
  const issues: string[] = [];
  const keys = result
    ? ["contract", "cancellationId", "logisticsId", "returnId", "orderId", "cancelledAt"]
    : [
        "contract",
        "cancellationId",
        "logisticsId",
        "returnId",
        "orderId",
        "returnReference",
        "requestedAt",
      ];
  exactKeys(value, keys, "return logistics cancellation", issues);
  if (
    value.contract !==
    (result
      ? NP_SHOP_RETURN_LOGISTICS_CANCEL_RESULT_CONTRACT
      : NP_SHOP_RETURN_LOGISTICS_CANCEL_REQUEST_CONTRACT)
  ) {
    issues.push("return logistics cancellation.contract is invalid.");
  }
  analyzeIdentity(value, "return logistics cancellation", issues);
  if (!isUuid(value.cancellationId))
    issues.push("return logistics cancellation.cancellationId is invalid.");
  if (
    !result &&
    (typeof value.returnReference !== "string" || !referencePattern.test(value.returnReference))
  ) {
    issues.push("return logistics cancellation.returnReference is invalid.");
  }
  const time = result ? value.cancelledAt : value.requestedAt;
  if (!isIso(time)) issues.push("return logistics cancellation timestamp is invalid.");
  return issues;
}

export function npRequireShopReturnLogisticsCancelRequest(
  value: unknown,
): NpShopReturnLogisticsCancelRequest {
  const issues = analyzeCancel(value, false);
  if (issues.length)
    throw new NpShopReturnLogisticsContractError(
      "Invalid return logistics cancellation request",
      issues,
    );
  return value as NpShopReturnLogisticsCancelRequest;
}

export function npRequireShopReturnLogisticsCancelResult(
  value: unknown,
): NpShopReturnLogisticsCancelResult {
  const issues = analyzeCancel(value, true);
  if (issues.length)
    throw new NpShopReturnLogisticsContractError(
      "Invalid return logistics cancellation result",
      issues,
    );
  return value as NpShopReturnLogisticsCancelResult;
}

export function npAnalyzeStoredShopReturnLogistics(value: unknown): string[] {
  if (!isRecord(value)) return ["stored return logistics must be a plain object."];
  const issues: string[] = [];
  const requiredKeys = [
    "contract",
    "id",
    "returnId",
    "orderId",
    "ownerSegment",
    "providerId",
    "status",
    "revision",
    "mode",
    "originalShipmentId",
    "originalBookingReference",
    "returnReference",
    "carrier",
    "trackingNumber",
    "readyAt",
    "closeAt",
    "providerErrorCode",
    "cancellationId",
    "requestedAt",
    "confirmedAt",
    "cancelRequestedAt",
    "cancelledAt",
    "updatedAt",
    "purgeAt",
  ] as const;
  for (const key of Object.keys(value)) {
    if (![...requiredKeys, "postageMethod"].includes(key)) {
      issues.push(`stored return logistics.${key} is not supported.`);
    }
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) issues.push(`stored return logistics.${key} is required.`);
  }
  if (value.contract !== NP_SHOP_RETURN_LOGISTICS_STORAGE_CONTRACT)
    issues.push("stored return logistics.contract is invalid.");
  const identity = { ...value, logisticsId: value.id };
  analyzeIdentity(identity, "stored return logistics", issues);
  if (!isOwnerSegment(value.ownerSegment))
    issues.push("stored return logistics.ownerSegment is invalid.");
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId))
    issues.push("stored return logistics.providerId is invalid.");
  if (!(npShopReturnLogisticsStatuses as readonly unknown[]).includes(value.status))
    issues.push("stored return logistics.status is invalid.");
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1)
    issues.push("stored return logistics.revision is invalid.");
  if (!(npShopReturnLogisticsModes as readonly unknown[]).includes(value.mode))
    issues.push("stored return logistics.mode is invalid.");
  if (!isUuid(value.originalShipmentId))
    issues.push("stored return logistics.originalShipmentId is invalid.");
  if (
    typeof value.originalBookingReference !== "string" ||
    !referencePattern.test(value.originalBookingReference)
  )
    issues.push("stored return logistics.originalBookingReference is invalid.");
  for (const key of [
    "returnReference",
    "carrier",
    "trackingNumber",
    "providerErrorCode",
  ] as const) {
    if (value[key] !== null && typeof value[key] !== "string")
      issues.push(`stored return logistics.${key} is invalid.`);
  }
  if (typeof value.returnReference === "string" && !referencePattern.test(value.returnReference))
    issues.push("stored return logistics.returnReference is invalid.");
  if (
    typeof value.carrier === "string" &&
    !isText(value.carrier, npShopReturnLogisticsLimits.carrierLength)
  )
    issues.push("stored return logistics.carrier is invalid.");
  if (
    typeof value.trackingNumber === "string" &&
    !isText(value.trackingNumber, npShopReturnLogisticsLimits.trackingNumberLength)
  )
    issues.push("stored return logistics.trackingNumber is invalid.");
  if (
    typeof value.providerErrorCode === "string" &&
    !errorCodePattern.test(value.providerErrorCode)
  )
    issues.push("stored return logistics.providerErrorCode is invalid.");
  if (value.cancellationId !== null && !isUuid(value.cancellationId))
    issues.push("stored return logistics.cancellationId is invalid.");
  analyzeWindow(value.mode, value.readyAt, value.closeAt, "stored return logistics", issues);
  for (const key of ["requestedAt", "updatedAt", "purgeAt"] as const)
    if (!isIso(value[key])) issues.push(`stored return logistics.${key} is invalid.`);
  for (const key of ["confirmedAt", "cancelRequestedAt", "cancelledAt"] as const)
    if (value[key] !== null && !isIso(value[key]))
      issues.push(`stored return logistics.${key} is invalid.`);
  const requiresConfirmation = [
    "provider-confirmed",
    "active",
    "cancel-pending",
    "cancel-confirmed",
    "cancelled",
  ].includes(String(value.status));
  const hasConfirmation =
    value.returnReference !== null &&
    value.carrier !== null &&
    value.trackingNumber !== null &&
    value.confirmedAt !== null;
  const hasPartialConfirmation =
    value.returnReference !== null ||
    value.carrier !== null ||
    value.trackingNumber !== null ||
    value.confirmedAt !== null;
  if (
    (requiresConfirmation && !hasConfirmation) ||
    (value.status === "pending" && hasPartialConfirmation) ||
    (value.status === "manual-review" && hasPartialConfirmation && !hasConfirmation)
  )
    issues.push("stored return logistics provider confirmation fields do not match status.");
  const requiresCancellation = ["cancel-pending", "cancel-confirmed", "cancelled"].includes(
    String(value.status),
  );
  const hasCancellation = value.cancellationId !== null && value.cancelRequestedAt !== null;
  const hasPartialCancellation = value.cancellationId !== null || value.cancelRequestedAt !== null;
  if (
    (requiresCancellation && !hasCancellation) ||
    (value.status !== "manual-review" && !requiresCancellation && hasPartialCancellation) ||
    (value.status === "manual-review" && hasPartialCancellation && !hasCancellation)
  )
    issues.push("stored return logistics cancellation fields do not match status.");
  if (
    ["cancel-confirmed", "cancelled"].includes(String(value.status)) !==
      (value.cancelledAt !== null) &&
    value.status !== "manual-review"
  )
    issues.push("stored return logistics cancelledAt does not match status.");
  if (value.status === "manual-review" && value.cancelledAt !== null && !hasCancellation) {
    issues.push("stored return logistics cancelledAt requires one cancellation intent.");
  }
  if (
    ["provider-confirmed", "active", "cancel-confirmed", "cancelled"].includes(
      String(value.status),
    ) &&
    value.providerErrorCode !== null
  ) {
    issues.push("confirmed return logistics states cannot retain a provider error.");
  }
  if (value.status === "manual-review" && value.providerErrorCode === null) {
    issues.push("manual-review return logistics requires one closed provider error code.");
  }
  if (Object.hasOwn(value, "postageMethod") && value.postageMethod !== null) {
    analyzePostageMethod(value.postageMethod, "stored return logistics.postageMethod", issues);
    if (isRecord(value.postageMethod) && value.postageMethod.providerId !== value.providerId) {
      issues.push("stored return logistics.postageMethod provider must match logistics.");
    }
    if (
      isRecord(value.postageMethod) &&
      isIso(value.postageMethod.quotedAt) &&
      isIso(value.postageMethod.quoteExpiresAt) &&
      isIso(value.requestedAt) &&
      (value.postageMethod.quotedAt > value.requestedAt ||
        value.postageMethod.quoteExpiresAt <= value.requestedAt)
    ) {
      issues.push("stored return logistics.postageMethod must be live at creation.");
    }
  }
  if (
    isIso(value.requestedAt) &&
    isIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.requestedAt)
  )
    issues.push("stored return logistics.updatedAt cannot precede requestedAt.");
  if (
    isIso(value.confirmedAt) &&
    isIso(value.requestedAt) &&
    new Date(value.confirmedAt) < new Date(value.requestedAt)
  )
    issues.push("stored return logistics.confirmedAt cannot precede requestedAt.");
  if (
    isIso(value.cancelRequestedAt) &&
    isIso(value.requestedAt) &&
    new Date(value.cancelRequestedAt) < new Date(value.requestedAt)
  )
    issues.push("stored return logistics.cancelRequestedAt cannot precede requestedAt.");
  if (
    isIso(value.cancelledAt) &&
    isIso(value.cancelRequestedAt) &&
    new Date(value.cancelledAt) < new Date(value.cancelRequestedAt)
  )
    issues.push("stored return logistics.cancelledAt cannot precede cancelRequestedAt.");
  if (
    isIso(value.updatedAt) &&
    isIso(value.purgeAt) &&
    new Date(value.updatedAt) > new Date(value.purgeAt)
  )
    issues.push("stored return logistics.updatedAt cannot follow purgeAt.");
  for (const key of ["confirmedAt", "cancelRequestedAt", "cancelledAt"] as const) {
    if (
      isIso(value.updatedAt) &&
      isIso(value[key]) &&
      new Date(value.updatedAt) < new Date(value[key])
    ) {
      issues.push(`stored return logistics.updatedAt cannot precede ${key}.`);
    }
  }
  return issues;
}

export function npRequireStoredShopReturnLogistics(value: unknown): NpShopStoredReturnLogistics {
  const issues = npAnalyzeStoredShopReturnLogistics(value);
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid stored return logistics", issues);
  return value as NpShopStoredReturnLogistics;
}

export function npAnalyzeStoredShopReturnLogisticsPrivate(value: unknown): string[] {
  if (!isRecord(value)) return ["private return logistics must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "logisticsId",
      "returnId",
      "orderId",
      "ownerSegment",
      "origin",
      "createdAt",
      "expiresAt",
    ],
    "private return logistics",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_LOGISTICS_PRIVATE_CONTRACT)
    issues.push("private return logistics.contract is invalid.");
  analyzeIdentity(value, "private return logistics", issues);
  if (!isOwnerSegment(value.ownerSegment))
    issues.push("private return logistics.ownerSegment is invalid.");
  analyzeShipping(value.origin, "private return logistics.origin", issues);
  if (!isIso(value.createdAt)) issues.push("private return logistics.createdAt is invalid.");
  if (!isIso(value.expiresAt)) issues.push("private return logistics.expiresAt is invalid.");
  if (
    isIso(value.createdAt) &&
    isIso(value.expiresAt) &&
    (new Date(value.expiresAt).getTime() <= new Date(value.createdAt).getTime() ||
      new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime() >
        npShopReturnLogisticsLimits.privateTtlSeconds * 1_000)
  ) {
    issues.push("private return logistics lifetime is invalid.");
  }
  return issues;
}

export function npRequireStoredShopReturnLogisticsPrivate(
  value: unknown,
): NpShopStoredReturnLogisticsPrivate {
  const issues = npAnalyzeStoredShopReturnLogisticsPrivate(value);
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid private return logistics", issues);
  return value as NpShopStoredReturnLogisticsPrivate;
}

export function npProjectShopReturnLogistics(
  value: NpShopStoredReturnLogistics,
  tracking?: NpShopReturnTracking | null,
): NpShopReturnLogistics {
  return {
    contract: NP_SHOP_RETURN_LOGISTICS_CONTRACT,
    id: value.id,
    status: value.status,
    revision: value.revision,
    mode: value.mode,
    carrier: value.carrier,
    trackingNumber: value.trackingNumber,
    readyAt: value.readyAt,
    closeAt: value.closeAt,
    requestedAt: value.requestedAt,
    confirmedAt: value.confirmedAt,
    cancelledAt: value.cancelledAt,
    updatedAt: value.updatedAt,
    ...(value.postageMethod ? { postageMethod: value.postageMethod } : {}),
    ...(tracking ? { tracking } : {}),
  };
}

export function npAnalyzeShopReturnLogistics(value: unknown): string[] {
  if (!isRecord(value)) return ["return logistics must be a plain object."];
  const issues: string[] = [];
  const publicKeys = [
    "contract",
    "id",
    "status",
    "revision",
    "mode",
    "carrier",
    "trackingNumber",
    "readyAt",
    "closeAt",
    "requestedAt",
    "confirmedAt",
    "cancelledAt",
    "updatedAt",
  ] as const;
  for (const key of Object.keys(value)) {
    if (![...publicKeys, "tracking", "postageMethod"].includes(key))
      issues.push(`return logistics.${key} is not supported.`);
  }
  for (const key of publicKeys) {
    if (!Object.hasOwn(value, key)) issues.push(`return logistics.${key} is required.`);
  }
  if (Object.hasOwn(value, "tracking")) {
    issues.push(
      ...npAnalyzeShopReturnTracking(value.tracking).map((issue) => `return logistics.${issue}`),
    );
    if (isRecord(value.tracking) && value.tracking.logisticsId !== value.id) {
      issues.push("return logistics.tracking must match the logistics id.");
    }
    if (value.status !== "active") {
      issues.push("return logistics.tracking requires active logistics.");
    }
  }
  if (Object.hasOwn(value, "postageMethod")) {
    analyzePostageMethod(value.postageMethod, "return logistics.postageMethod", issues);
    if (
      isRecord(value.postageMethod) &&
      isIso(value.postageMethod.quotedAt) &&
      isIso(value.postageMethod.quoteExpiresAt) &&
      isIso(value.requestedAt) &&
      (value.postageMethod.quotedAt > value.requestedAt ||
        value.postageMethod.quoteExpiresAt <= value.requestedAt)
    ) {
      issues.push("return logistics.postageMethod must be live at creation.");
    }
  }
  if (value.contract !== NP_SHOP_RETURN_LOGISTICS_CONTRACT)
    issues.push("return logistics.contract is invalid.");
  if (!isUuid(value.id)) issues.push("return logistics.id is invalid.");
  if (!(npShopReturnLogisticsStatuses as readonly unknown[]).includes(value.status))
    issues.push("return logistics.status is invalid.");
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1)
    issues.push("return logistics.revision is invalid.");
  if (!(npShopReturnLogisticsModes as readonly unknown[]).includes(value.mode))
    issues.push("return logistics.mode is invalid.");
  if (value.carrier !== null && !isText(value.carrier, npShopReturnLogisticsLimits.carrierLength))
    issues.push("return logistics.carrier is invalid.");
  if (
    value.trackingNumber !== null &&
    !isText(value.trackingNumber, npShopReturnLogisticsLimits.trackingNumberLength)
  )
    issues.push("return logistics.trackingNumber is invalid.");
  analyzeWindow(value.mode, value.readyAt, value.closeAt, "return logistics", issues);
  for (const key of ["requestedAt", "updatedAt"] as const)
    if (!isIso(value[key])) issues.push(`return logistics.${key} is invalid.`);
  for (const key of ["confirmedAt", "cancelledAt"] as const)
    if (value[key] !== null && !isIso(value[key]))
      issues.push(`return logistics.${key} is invalid.`);
  const needsConfirmation = [
    "provider-confirmed",
    "active",
    "cancel-pending",
    "cancel-confirmed",
    "cancelled",
  ].includes(String(value.status));
  const hasConfirmation =
    value.carrier !== null && value.trackingNumber !== null && value.confirmedAt !== null;
  const hasPartialConfirmation =
    value.carrier !== null || value.trackingNumber !== null || value.confirmedAt !== null;
  if (
    (needsConfirmation && !hasConfirmation) ||
    (value.status === "pending" && hasPartialConfirmation) ||
    (value.status === "manual-review" && hasPartialConfirmation && !hasConfirmation)
  )
    issues.push("return logistics provider confirmation fields do not match status.");
  if (
    ["cancel-confirmed", "cancelled"].includes(String(value.status)) !==
      (value.cancelledAt !== null) &&
    value.status !== "manual-review"
  )
    issues.push("return logistics.cancelledAt does not match status.");
  if (
    isIso(value.requestedAt) &&
    isIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.requestedAt)
  )
    issues.push("return logistics.updatedAt cannot precede requestedAt.");
  for (const key of ["confirmedAt", "cancelledAt"] as const) {
    if (
      isIso(value.updatedAt) &&
      isIso(value[key]) &&
      new Date(value.updatedAt) < new Date(value[key])
    ) {
      issues.push(`return logistics.updatedAt cannot precede ${key}.`);
    }
  }
  if (
    isIso(value.confirmedAt) &&
    isIso(value.requestedAt) &&
    new Date(value.confirmedAt) < new Date(value.requestedAt)
  ) {
    issues.push("return logistics.confirmedAt cannot precede requestedAt.");
  }
  return issues;
}

export function npRequireShopReturnLogistics(value: unknown): NpShopReturnLogistics {
  const issues = npAnalyzeShopReturnLogistics(value);
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid return logistics", issues);
  return value as NpShopReturnLogistics;
}

function requireInput(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!isRecord(value))
    throw new NpShopReturnLogisticsContractError(`Invalid ${path}`, [
      `${path} must be a plain object.`,
    ]);
  const issues: string[] = [];
  exactKeys(value, keys, path, issues);
  if (issues.length) throw new NpShopReturnLogisticsContractError(`Invalid ${path}`, issues);
  return value;
}

export function npRequireShopReturnLogisticsCreateInput(
  value: unknown,
): NpShopReturnLogisticsCreateInput {
  const input = requireInput(
    value,
    ["orderId", "returnId", "expectedReturnRevision", "mode", "origin", "readyAt", "closeAt"],
    "return logistics create input",
  );
  const issues: string[] = [];
  if (!isUuid(input.orderId)) issues.push("return logistics create input.orderId is invalid.");
  if (!isUuid(input.returnId)) issues.push("return logistics create input.returnId is invalid.");
  if (
    !Number.isSafeInteger(input.expectedReturnRevision) ||
    (input.expectedReturnRevision as number) < 1
  )
    issues.push("return logistics create input.expectedReturnRevision is invalid.");
  if (!(npShopReturnLogisticsModes as readonly unknown[]).includes(input.mode))
    issues.push("return logistics create input.mode is invalid.");
  analyzeShipping(input.origin, "return logistics create input.origin", issues);
  analyzeWindow(input.mode, input.readyAt, input.closeAt, "return logistics create input", issues);
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid return logistics create input", issues);
  return input as unknown as NpShopReturnLogisticsCreateInput;
}

export function npRequireShopReturnLogisticsExistingInput(
  value: unknown,
): NpShopReturnLogisticsExistingInput {
  const input = requireInput(
    value,
    ["orderId", "returnId", "logisticsId", "expectedRevision"],
    "return logistics action input",
  );
  const issues: string[] = [];
  for (const key of ["orderId", "returnId", "logisticsId"] as const)
    if (!isUuid(input[key])) issues.push(`return logistics action input.${key} is invalid.`);
  if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 1)
    issues.push("return logistics action input.expectedRevision is invalid.");
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid return logistics action input", issues);
  return input as unknown as NpShopReturnLogisticsExistingInput;
}

export function npRequireShopReturnLogisticsLabelReadInput(
  value: unknown,
): NpShopReturnLogisticsLabelReadInput {
  const input = requireInput(
    value,
    ["orderId", "returnId", "logisticsId"],
    "return logistics label input",
  );
  const issues: string[] = [];
  for (const key of ["orderId", "returnId", "logisticsId"] as const)
    if (!isUuid(input[key])) issues.push(`return logistics label input.${key} is invalid.`);
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid return logistics label input", issues);
  return input as unknown as NpShopReturnLogisticsLabelReadInput;
}

export function npRequireShopReturnLocationReference(value: unknown): string {
  if (typeof value !== "string" || !referencePattern.test(value)) {
    throw new NpShopReturnLogisticsContractError("Invalid return location reference", [
      "return location reference must be one opaque provider reference of at most 200 characters.",
    ]);
  }
  return value;
}

export function npRequireShopReturnLogisticsLabelResult(
  value: unknown,
): NpShopReturnLogisticsLabelResult {
  if (!isRecord(value))
    throw new NpShopReturnLogisticsContractError("Invalid return label result", [
      "return label result must be a plain object.",
    ]);
  const issues: string[] = [];
  exactKeys(
    value,
    ["contract", "logisticsId", "returnId", "orderId", "format", "content", "retrievedAt"],
    "return label result",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_LOGISTICS_LABEL_RESULT_CONTRACT)
    issues.push("return label result.contract is invalid.");
  analyzeIdentity(value, "return label result", issues);
  if (!(npShopReturnLogisticsLabelFormats as readonly unknown[]).includes(value.format))
    issues.push("return label result.format is invalid.");
  if (
    !(value.content instanceof Uint8Array) ||
    value.content.byteLength < 1 ||
    value.content.byteLength > npShopReturnLogisticsLimits.labelBytes
  )
    issues.push("return label result.content is invalid.");
  if (!isIso(value.retrievedAt)) issues.push("return label result.retrievedAt is invalid.");
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid return label result", issues);
  return value as unknown as NpShopReturnLogisticsLabelResult;
}

export function npRequireShopReturnLogisticsLabelRequest(
  value: unknown,
): NpShopReturnLogisticsLabelRequest {
  if (!isRecord(value))
    throw new NpShopReturnLogisticsContractError("Invalid return label request", [
      "return label request must be a plain object.",
    ]);
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "logisticsId",
      "returnId",
      "orderId",
      "returnReference",
      "carrier",
      "trackingNumber",
      "requestedAt",
    ],
    "return label request",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_LOGISTICS_LABEL_REQUEST_CONTRACT)
    issues.push("return label request.contract is invalid.");
  analyzeIdentity(value, "return label request", issues);
  if (typeof value.returnReference !== "string" || !referencePattern.test(value.returnReference))
    issues.push("return label request.returnReference is invalid.");
  if (!isText(value.carrier, npShopReturnLogisticsLimits.carrierLength))
    issues.push("return label request.carrier is invalid.");
  if (!isText(value.trackingNumber, npShopReturnLogisticsLimits.trackingNumberLength))
    issues.push("return label request.trackingNumber is invalid.");
  if (!isIso(value.requestedAt)) issues.push("return label request.requestedAt is invalid.");
  if (issues.length)
    throw new NpShopReturnLogisticsContractError("Invalid return label request", issues);
  return value as unknown as NpShopReturnLogisticsLabelRequest;
}
