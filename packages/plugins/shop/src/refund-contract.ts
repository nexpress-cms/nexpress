import { npShopCurrencies, type NpShopCurrency } from "./types.js";

export const NP_SHOP_REFUND_RESULT_CONTRACT = "np.shop-refund-result.v1" as const;
export const NP_SHOP_REFUND_STORAGE_CONTRACT = "np.shop-refund-storage.v1" as const;
export const NP_SHOP_REFUND_CONTRACT = "np.shop-refund.v1" as const;

export const npShopRefundStatuses = [
  "pending",
  "provider-confirmed",
  "refunded",
  "manual-review",
] as const;
export type NpShopRefundStatus = (typeof npShopRefundStatuses)[number];

export const npShopRefundInventoryOutcomes = [
  "pending",
  "not-required",
  "restocked",
  "not-applicable-shipped",
  "manual-required",
] as const;
export type NpShopRefundInventoryOutcome = (typeof npShopRefundInventoryOutcomes)[number];

export const npShopRefundFulfillmentOutcomes = [
  "pending",
  "cancelled",
  "shipped-retained",
] as const;
export type NpShopRefundFulfillmentOutcome = (typeof npShopRefundFulfillmentOutcomes)[number];

export const npShopRefundLimits = Object.freeze({
  reasonLength: 200,
  providerErrorCodeLength: 100,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopPaymentRefundInput {
  refundId: string;
  orderId: string;
  paymentReference: string;
  currency: NpShopCurrency;
  amountMinor: number;
  reason: string;
  requestedAt: string;
}

export interface NpShopPaymentRefundResult {
  contract: typeof NP_SHOP_REFUND_RESULT_CONTRACT;
  refundId: string;
  orderId: string;
  paymentReference: string;
  refundReference: string;
  currency: NpShopCurrency;
  amountMinor: number;
  refundedAt: string;
}

export interface NpShopStoredRefund {
  contract: typeof NP_SHOP_REFUND_STORAGE_CONTRACT;
  id: string;
  orderId: string;
  providerId: string;
  status: NpShopRefundStatus;
  orderRevision: number;
  paymentReference: string;
  refundReference: string | null;
  currency: NpShopCurrency;
  amountMinor: number;
  reason: string;
  inventoryOutcome: NpShopRefundInventoryOutcome;
  fulfillmentOutcome: NpShopRefundFulfillmentOutcome;
  providerErrorCode: string | null;
  requestedAt: string;
  updatedAt: string;
  refundedAt: string | null;
  purgeAt: string;
}

export interface NpShopRefund {
  contract: typeof NP_SHOP_REFUND_CONTRACT;
  id: string;
  status: NpShopRefundStatus;
  currency: NpShopCurrency;
  amountMinor: number;
  inventoryOutcome: NpShopRefundInventoryOutcome;
  fulfillmentOutcome: NpShopRefundFulfillmentOutcome;
  requestedAt: string;
  refundedAt: string | null;
}

export interface NpShopRefundActionInput {
  orderId: string;
  expectedRevision: number;
  reason: string;
}

export class NpShopRefundContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopRefundContractError";
    this.issues = issues;
  }
}

export class NpShopRefundConflictError extends Error {
  readonly code:
    | "refund_not_supported"
    | "refund_order_not_found"
    | "refund_order_expired"
    | "refund_order_revision_conflict"
    | "refund_order_not_paid"
    | "refund_provider_mismatch"
    | "refund_manual_review";

  constructor(code: NpShopRefundConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopRefundConflictError";
    this.code = code;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

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

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function analyzeSharedResult(value: Record<string, unknown>, path: string, issues: string[]): void {
  if (typeof value.refundId !== "string" || !canonicalUuidPattern.test(value.refundId)) {
    issues.push(`${path}.refundId is invalid.`);
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push(`${path}.orderId is invalid.`);
  }
  for (const key of ["paymentReference", "refundReference"] as const) {
    if (!isBoundedText(value[key], 200) || !opaqueReferencePattern.test(value[key])) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push(`${path}.currency is invalid.`);
  }
  if (!Number.isSafeInteger(value.amountMinor) || (value.amountMinor as number) < 1) {
    issues.push(`${path}.amountMinor is invalid.`);
  }
  if (!isCanonicalIso(value.refundedAt)) issues.push(`${path}.refundedAt is invalid.`);
}

export function npRequireShopPaymentRefundResult(value: unknown): NpShopPaymentRefundResult {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopRefundContractError("Invalid Shop payment refund result", [
      "refund result must be a plain object.",
    ]);
  }
  exactKeys(
    value,
    [
      "contract",
      "refundId",
      "orderId",
      "paymentReference",
      "refundReference",
      "currency",
      "amountMinor",
      "refundedAt",
    ],
    "refund result",
    issues,
  );
  if (value.contract !== NP_SHOP_REFUND_RESULT_CONTRACT) {
    issues.push(`refund result.contract must equal "${NP_SHOP_REFUND_RESULT_CONTRACT}".`);
  }
  analyzeSharedResult(value, "refund result", issues);
  if (issues.length)
    throw new NpShopRefundContractError("Invalid Shop payment refund result", issues);
  return value as unknown as NpShopPaymentRefundResult;
}

const storedKeys = [
  "contract",
  "id",
  "orderId",
  "providerId",
  "status",
  "orderRevision",
  "paymentReference",
  "refundReference",
  "currency",
  "amountMinor",
  "reason",
  "inventoryOutcome",
  "fulfillmentOutcome",
  "providerErrorCode",
  "requestedAt",
  "updatedAt",
  "refundedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopRefund(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["refund must be a plain object."];
  exactKeys(value, storedKeys, "refund", issues);
  if (value.contract !== NP_SHOP_REFUND_STORAGE_CONTRACT) {
    issues.push(`refund.contract must equal "${NP_SHOP_REFUND_STORAGE_CONTRACT}".`);
  }
  if (typeof value.id !== "string" || !canonicalUuidPattern.test(value.id)) {
    issues.push("refund.id is invalid.");
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("refund.orderId is invalid.");
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("refund.providerId is invalid.");
  }
  if (!(npShopRefundStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("refund.status is invalid.");
  }
  if (!Number.isSafeInteger(value.orderRevision) || (value.orderRevision as number) < 1) {
    issues.push("refund.orderRevision is invalid.");
  }
  if (
    !isBoundedText(value.paymentReference, 200) ||
    !opaqueReferencePattern.test(value.paymentReference)
  ) {
    issues.push("refund.paymentReference is invalid.");
  }
  if (
    value.refundReference !== null &&
    (!isBoundedText(value.refundReference, 200) ||
      !opaqueReferencePattern.test(value.refundReference))
  ) {
    issues.push("refund.refundReference is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("refund.currency is invalid.");
  }
  if (!Number.isSafeInteger(value.amountMinor) || (value.amountMinor as number) < 1) {
    issues.push("refund.amountMinor is invalid.");
  }
  if (!isBoundedText(value.reason, npShopRefundLimits.reasonLength)) {
    issues.push("refund.reason is invalid.");
  }
  if (!(npShopRefundInventoryOutcomes as readonly unknown[]).includes(value.inventoryOutcome)) {
    issues.push("refund.inventoryOutcome is invalid.");
  }
  if (!(npShopRefundFulfillmentOutcomes as readonly unknown[]).includes(value.fulfillmentOutcome)) {
    issues.push("refund.fulfillmentOutcome is invalid.");
  }
  if (
    value.providerErrorCode !== null &&
    !isBoundedText(value.providerErrorCode, npShopRefundLimits.providerErrorCodeLength)
  ) {
    issues.push("refund.providerErrorCode is invalid.");
  }
  for (const key of ["requestedAt", "updatedAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`refund.${key} is invalid.`);
  }
  if (value.refundedAt !== null && !isCanonicalIso(value.refundedAt)) {
    issues.push("refund.refundedAt is invalid.");
  }
  if (
    value.status === "pending" &&
    (value.refundReference !== null ||
      value.refundedAt !== null ||
      value.providerErrorCode !== null ||
      value.inventoryOutcome !== "pending" ||
      value.fulfillmentOutcome !== "pending")
  ) {
    issues.push("pending refunds cannot contain terminal provider or compensation metadata.");
  }
  if (
    value.status === "manual-review" &&
    (value.refundReference !== null ||
      value.refundedAt !== null ||
      value.providerErrorCode === null ||
      value.inventoryOutcome !== "pending" ||
      value.fulfillmentOutcome !== "pending")
  ) {
    issues.push("manual-review refunds require only one bounded provider error code.");
  }
  if (
    value.status === "provider-confirmed" &&
    (value.refundReference === null ||
      value.refundedAt === null ||
      value.providerErrorCode !== null ||
      value.inventoryOutcome !== "pending" ||
      value.fulfillmentOutcome !== "pending")
  ) {
    issues.push(
      "provider-confirmed refunds require exact provider metadata and pending compensation.",
    );
  }
  if (
    value.status === "refunded" &&
    (value.refundReference === null ||
      value.refundedAt === null ||
      value.providerErrorCode !== null ||
      value.inventoryOutcome === "pending" ||
      value.fulfillmentOutcome === "pending")
  ) {
    issues.push("refunded records require terminal provider and compensation metadata.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.requestedAt)
  ) {
    issues.push("refund.updatedAt cannot precede refund.requestedAt.");
  }
  if (
    isCanonicalIso(value.refundedAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.refundedAt)
  ) {
    issues.push("refund.updatedAt cannot precede refund.refundedAt.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.refundedAt) &&
    new Date(value.refundedAt) < new Date(value.requestedAt)
  ) {
    issues.push("refund.refundedAt cannot precede refund.requestedAt.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.requestedAt) >= new Date(value.purgeAt)
  ) {
    issues.push("refund.requestedAt must precede refund.purgeAt.");
  }
  if (
    isCanonicalIso(value.updatedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.updatedAt) > new Date(value.purgeAt)
  ) {
    issues.push("refund.updatedAt cannot follow refund.purgeAt.");
  }
  return issues;
}

export function npRequireStoredShopRefund(value: unknown): NpShopStoredRefund {
  const issues = npAnalyzeStoredShopRefund(value);
  if (issues.length) throw new NpShopRefundContractError("Invalid stored Shop refund", issues);
  return value as NpShopStoredRefund;
}

export function npProjectShopRefund(value: NpShopStoredRefund): NpShopRefund {
  return {
    contract: NP_SHOP_REFUND_CONTRACT,
    id: value.id,
    status: value.status,
    currency: value.currency,
    amountMinor: value.amountMinor,
    inventoryOutcome: value.inventoryOutcome,
    fulfillmentOutcome: value.fulfillmentOutcome,
    requestedAt: value.requestedAt,
    refundedAt: value.refundedAt,
  };
}

export function npRequireShopRefundActionInput(value: unknown): NpShopRefundActionInput {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopRefundContractError("Invalid Shop refund action", [
      "refund action must be a plain object.",
    ]);
  }
  exactKeys(value, ["row", "values"], "payload", issues);
  const row = isRecord(value.row) ? value.row : null;
  const values = isRecord(value.values) ? value.values : null;
  if (!row) issues.push("payload.row must be a plain object.");
  if (!values) issues.push("payload.values must be a plain object.");
  if (row) {
    exactKeys(row, ["id", "revision"], "payload.row", issues);
    if (typeof row.id !== "string" || !canonicalUuidPattern.test(row.id)) {
      issues.push("payload.row.id is invalid.");
    }
    if (!Number.isSafeInteger(row.revision) || (row.revision as number) < 1) {
      issues.push("payload.row.revision is invalid.");
    }
  }
  if (values) {
    exactKeys(values, ["reason"], "payload.values", issues);
    if (!isBoundedText(values.reason, npShopRefundLimits.reasonLength)) {
      issues.push("payload.values.reason is invalid.");
    }
  }
  if (issues.length) throw new NpShopRefundContractError("Invalid Shop refund action", issues);
  if (
    !row ||
    !values ||
    typeof row.id !== "string" ||
    typeof row.revision !== "number" ||
    typeof values.reason !== "string"
  ) {
    throw new NpShopRefundContractError("Invalid Shop refund action", [
      "validated refund action fields are missing.",
    ]);
  }
  return {
    orderId: row.id,
    expectedRevision: row.revision,
    reason: values.reason,
  };
}
