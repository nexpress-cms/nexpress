import { npShopCurrencies, type NpShopCurrency } from "./types.js";

export const NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT = "np.shop-partial-refund-result.v1" as const;
export const NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT = "np.shop-partial-refund-storage.v1" as const;
export const NP_SHOP_PARTIAL_REFUND_CONTRACT = "np.shop-partial-refund.v1" as const;

export const npShopPartialRefundStatuses = [
  "pending",
  "provider-confirmed",
  "refunded",
  "manual-review",
] as const;
export type NpShopPartialRefundStatus = (typeof npShopPartialRefundStatuses)[number];

export const npShopPartialRefundLimits = Object.freeze({
  maximumLines: 100,
  reasonLength: 200,
  providerErrorCodeLength: 100,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopPartialRefundLine {
  lineKey: string;
  quantity: number;
  amountMinor: number;
}

export interface NpShopPartialRefundAllocation {
  lines: NpShopPartialRefundLine[];
  itemAmountMinor: number;
  shippingMinor: number;
  taxMinor: number;
}

export interface NpShopPaymentPartialRefundInput {
  refundId: string;
  orderId: string;
  returnId: string;
  paymentReference: string;
  currency: NpShopCurrency;
  amountMinor: number;
  allocation: NpShopPartialRefundAllocation;
  reason: string;
  requestedAt: string;
}

export interface NpShopPaymentPartialRefundResult {
  contract: typeof NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT;
  refundId: string;
  orderId: string;
  returnId: string;
  paymentReference: string;
  refundReference: string;
  currency: NpShopCurrency;
  amountMinor: number;
  refundedAt: string;
}

export interface NpShopStoredPartialRefund {
  contract: typeof NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT;
  id: string;
  orderId: string;
  returnId: string;
  providerId: string;
  status: NpShopPartialRefundStatus;
  orderRevision: number;
  returnRevision: number;
  paymentReference: string;
  refundReference: string | null;
  currency: NpShopCurrency;
  amountMinor: number;
  allocation: NpShopPartialRefundAllocation;
  reason: string;
  providerErrorCode: string | null;
  requestedAt: string;
  updatedAt: string;
  refundedAt: string | null;
  purgeAt: string;
}

export interface NpShopPartialRefund {
  contract: typeof NP_SHOP_PARTIAL_REFUND_CONTRACT;
  id: string;
  returnId: string;
  status: NpShopPartialRefundStatus;
  currency: NpShopCurrency;
  amountMinor: number;
  allocation: NpShopPartialRefundAllocation;
  requestedAt: string;
  refundedAt: string | null;
}

export interface NpShopPartialRefundActionInput {
  orderId: string;
  orderRevision: number;
  returnId: string;
  returnRevision: number;
  shippingMinor: number;
  taxMinor: number;
  reason: string;
}

export class NpShopPartialRefundContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopPartialRefundContractError";
    this.issues = issues;
  }
}

export class NpShopPartialRefundConflictError extends Error {
  readonly code:
    | "partial_refund_not_supported"
    | "partial_refund_not_found"
    | "partial_refund_order_expired"
    | "partial_refund_revision_conflict"
    | "partial_refund_return_not_received"
    | "partial_refund_order_not_paid"
    | "partial_refund_already_exists"
    | "partial_refund_full_refund_conflict"
    | "partial_refund_amount_invalid"
    | "partial_refund_provider_mismatch"
    | "partial_refund_manual_review";

  constructor(code: NpShopPartialRefundConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopPartialRefundConflictError";
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

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && canonicalUuidPattern.test(value);
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

function analyzeAllocation(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["lines", "itemAmountMinor", "shippingMinor", "taxMinor"], path, issues);
  if (
    !Array.isArray(value.lines) ||
    value.lines.length < 1 ||
    value.lines.length > npShopPartialRefundLimits.maximumLines
  ) {
    issues.push(
      `${path}.lines must contain 1-${npShopPartialRefundLimits.maximumLines.toString()} entries.`,
    );
  } else {
    const seen = new Set<string>();
    let total = 0;
    value.lines.forEach((candidate, index) => {
      const linePath = `${path}.lines[${index.toString()}]`;
      if (!isRecord(candidate)) {
        issues.push(`${linePath} must be a plain object.`);
        return;
      }
      exactKeys(candidate, ["lineKey", "quantity", "amountMinor"], linePath, issues);
      if (!isBoundedText(candidate.lineKey, 300)) {
        issues.push(`${linePath}.lineKey is invalid.`);
      } else if (seen.has(candidate.lineKey)) {
        issues.push(`${linePath}.lineKey is duplicated.`);
      } else {
        seen.add(candidate.lineKey);
      }
      if (!Number.isSafeInteger(candidate.quantity) || (candidate.quantity as number) < 1) {
        issues.push(`${linePath}.quantity is invalid.`);
      }
      if (!Number.isSafeInteger(candidate.amountMinor) || (candidate.amountMinor as number) < 0) {
        issues.push(`${linePath}.amountMinor is invalid.`);
      } else if (Number.isSafeInteger(total + (candidate.amountMinor as number))) {
        total += candidate.amountMinor as number;
      } else {
        issues.push(`${path}.itemAmountMinor exceeds the safe integer range.`);
      }
    });
    if (Number.isSafeInteger(value.itemAmountMinor) && value.itemAmountMinor !== total) {
      issues.push(`${path}.itemAmountMinor must equal the exact line allocation sum.`);
    }
  }
  for (const key of ["itemAmountMinor", "shippingMinor", "taxMinor"] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
}

function analyzeSharedResult(value: Record<string, unknown>, path: string, issues: string[]): void {
  for (const key of ["refundId", "orderId", "returnId"] as const) {
    if (!isCanonicalUuid(value[key])) issues.push(`${path}.${key} is invalid.`);
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

export function npRequireShopPaymentPartialRefundResult(
  value: unknown,
): NpShopPaymentPartialRefundResult {
  if (!isRecord(value)) {
    throw new NpShopPartialRefundContractError("Invalid Shop partial refund result", [
      "partial refund result must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "refundId",
      "orderId",
      "returnId",
      "paymentReference",
      "refundReference",
      "currency",
      "amountMinor",
      "refundedAt",
    ],
    "partial refund result",
    issues,
  );
  if (value.contract !== NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT) {
    issues.push(
      `partial refund result.contract must equal "${NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT}".`,
    );
  }
  analyzeSharedResult(value, "partial refund result", issues);
  if (issues.length) {
    throw new NpShopPartialRefundContractError("Invalid Shop partial refund result", issues);
  }
  return value as unknown as NpShopPaymentPartialRefundResult;
}

const storedKeys = [
  "contract",
  "id",
  "orderId",
  "returnId",
  "providerId",
  "status",
  "orderRevision",
  "returnRevision",
  "paymentReference",
  "refundReference",
  "currency",
  "amountMinor",
  "allocation",
  "reason",
  "providerErrorCode",
  "requestedAt",
  "updatedAt",
  "refundedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopPartialRefund(value: unknown): string[] {
  if (!isRecord(value)) return ["partial refund must be a plain object."];
  const issues: string[] = [];
  exactKeys(value, storedKeys, "partial refund", issues);
  if (value.contract !== NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT) {
    issues.push(`partial refund.contract must equal "${NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT}".`);
  }
  for (const key of ["id", "orderId", "returnId"] as const) {
    if (!isCanonicalUuid(value[key])) issues.push(`partial refund.${key} is invalid.`);
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("partial refund.providerId is invalid.");
  }
  if (!(npShopPartialRefundStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("partial refund.status is invalid.");
  }
  for (const key of ["orderRevision", "returnRevision"] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) {
      issues.push(`partial refund.${key} is invalid.`);
    }
  }
  if (
    !isBoundedText(value.paymentReference, 200) ||
    !opaqueReferencePattern.test(value.paymentReference)
  ) {
    issues.push("partial refund.paymentReference is invalid.");
  }
  if (
    value.refundReference !== null &&
    (!isBoundedText(value.refundReference, 200) ||
      !opaqueReferencePattern.test(value.refundReference))
  ) {
    issues.push("partial refund.refundReference is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("partial refund.currency is invalid.");
  }
  if (!Number.isSafeInteger(value.amountMinor) || (value.amountMinor as number) < 1) {
    issues.push("partial refund.amountMinor is invalid.");
  }
  analyzeAllocation(value.allocation, "partial refund.allocation", issues);
  if (
    isRecord(value.allocation) &&
    Number.isSafeInteger(value.amountMinor) &&
    Number.isSafeInteger(value.allocation.itemAmountMinor) &&
    Number.isSafeInteger(value.allocation.shippingMinor) &&
    Number.isSafeInteger(value.allocation.taxMinor) &&
    value.amountMinor !==
      (value.allocation.itemAmountMinor as number) +
        (value.allocation.shippingMinor as number) +
        (value.allocation.taxMinor as number)
  ) {
    issues.push("partial refund.amountMinor must equal its item, shipping, and tax allocation.");
  }
  if (!isBoundedText(value.reason, npShopPartialRefundLimits.reasonLength)) {
    issues.push("partial refund.reason is invalid.");
  }
  if (
    value.providerErrorCode !== null &&
    !isBoundedText(value.providerErrorCode, npShopPartialRefundLimits.providerErrorCodeLength)
  ) {
    issues.push("partial refund.providerErrorCode is invalid.");
  }
  for (const key of ["requestedAt", "updatedAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`partial refund.${key} is invalid.`);
  }
  if (value.refundedAt !== null && !isCanonicalIso(value.refundedAt)) {
    issues.push("partial refund.refundedAt is invalid.");
  }
  if (
    value.status === "pending" &&
    (value.refundReference !== null ||
      value.refundedAt !== null ||
      value.providerErrorCode !== null)
  ) {
    issues.push("pending partial refunds cannot contain terminal provider metadata.");
  }
  if (
    value.status === "manual-review" &&
    (value.refundReference !== null ||
      value.refundedAt !== null ||
      value.providerErrorCode === null)
  ) {
    issues.push("manual-review partial refunds require only one bounded provider error code.");
  }
  if (
    (value.status === "provider-confirmed" || value.status === "refunded") &&
    (value.refundReference === null ||
      value.refundedAt === null ||
      value.providerErrorCode !== null)
  ) {
    issues.push("confirmed partial refunds require exact terminal provider metadata.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.requestedAt)
  ) {
    issues.push("partial refund.updatedAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.refundedAt) &&
    isCanonicalIso(value.requestedAt) &&
    new Date(value.refundedAt) < new Date(value.requestedAt)
  ) {
    issues.push("partial refund.refundedAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.updatedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.updatedAt) > new Date(value.purgeAt)
  ) {
    issues.push("partial refund.updatedAt cannot follow purgeAt.");
  }
  return issues;
}

export function npRequireStoredShopPartialRefund(value: unknown): NpShopStoredPartialRefund {
  const issues = npAnalyzeStoredShopPartialRefund(value);
  if (issues.length) {
    throw new NpShopPartialRefundContractError("Invalid stored Shop partial refund", issues);
  }
  return value as NpShopStoredPartialRefund;
}

export function npProjectShopPartialRefund(value: NpShopStoredPartialRefund): NpShopPartialRefund {
  return {
    contract: NP_SHOP_PARTIAL_REFUND_CONTRACT,
    id: value.id,
    returnId: value.returnId,
    status: value.status,
    currency: value.currency,
    amountMinor: value.amountMinor,
    allocation: value.allocation,
    requestedAt: value.requestedAt,
    refundedAt: value.refundedAt,
  };
}

export function npRequireShopPartialRefundActionInput(
  value: unknown,
): NpShopPartialRefundActionInput {
  if (!isRecord(value)) {
    throw new NpShopPartialRefundContractError("Invalid Shop partial refund action", [
      "payload must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  const row = isRecord(value.row) ? value.row : null;
  const values = isRecord(value.values) ? value.values : null;
  const parsedAmounts: { shippingMinor?: number; taxMinor?: number } = {};
  if (!row) issues.push("payload.row must be a plain object.");
  if (!values) issues.push("payload.values must be a plain object.");
  if (row) {
    exactKeys(row, ["id", "orderRevision", "returnId", "returnRevision"], "payload.row", issues);
    for (const key of ["id", "returnId"] as const) {
      if (!isCanonicalUuid(row[key])) issues.push(`payload.row.${key} is invalid.`);
    }
    for (const key of ["orderRevision", "returnRevision"] as const) {
      if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 1) {
        issues.push(`payload.row.${key} is invalid.`);
      }
    }
  }
  if (values) {
    exactKeys(values, ["shippingMinor", "taxMinor", "reason"], "payload.values", issues);
    for (const key of ["shippingMinor", "taxMinor"] as const) {
      const candidate =
        typeof values[key] === "string" && /^(?:0|[1-9][0-9]*)$/u.test(values[key])
          ? Number(values[key])
          : values[key];
      if (!Number.isSafeInteger(candidate) || (candidate as number) < 0) {
        issues.push(`payload.values.${key} is invalid.`);
      } else {
        parsedAmounts[key] = candidate as number;
      }
    }
    if (!isBoundedText(values.reason, npShopPartialRefundLimits.reasonLength)) {
      issues.push("payload.values.reason is invalid.");
    }
  }
  if (issues.length) {
    throw new NpShopPartialRefundContractError("Invalid Shop partial refund action", issues);
  }
  return {
    orderId: row!.id as string,
    orderRevision: row!.orderRevision as number,
    returnId: row!.returnId as string,
    returnRevision: row!.returnRevision as number,
    shippingMinor: parsedAmounts.shippingMinor!,
    taxMinor: parsedAmounts.taxMinor!,
    reason: values!.reason as string,
  };
}

export function npAnalyzeShopPartialRefund(value: unknown): string[] {
  if (!isRecord(value)) return ["partial refund must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "id",
      "returnId",
      "status",
      "currency",
      "amountMinor",
      "allocation",
      "requestedAt",
      "refundedAt",
    ],
    "partial refund",
    issues,
  );
  if (value.contract !== NP_SHOP_PARTIAL_REFUND_CONTRACT) {
    issues.push(`partial refund.contract must equal "${NP_SHOP_PARTIAL_REFUND_CONTRACT}".`);
  }
  for (const key of ["id", "returnId"] as const) {
    if (!isCanonicalUuid(value[key])) issues.push(`partial refund.${key} is invalid.`);
  }
  if (!(npShopPartialRefundStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("partial refund.status is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("partial refund.currency is invalid.");
  }
  if (!Number.isSafeInteger(value.amountMinor) || (value.amountMinor as number) < 1) {
    issues.push("partial refund.amountMinor is invalid.");
  }
  analyzeAllocation(value.allocation, "partial refund.allocation", issues);
  if (
    isRecord(value.allocation) &&
    Number.isSafeInteger(value.amountMinor) &&
    Number.isSafeInteger(value.allocation.itemAmountMinor) &&
    Number.isSafeInteger(value.allocation.shippingMinor) &&
    Number.isSafeInteger(value.allocation.taxMinor) &&
    value.amountMinor !==
      (value.allocation.itemAmountMinor as number) +
        (value.allocation.shippingMinor as number) +
        (value.allocation.taxMinor as number)
  ) {
    issues.push("partial refund.amountMinor must equal its exact allocation.");
  }
  for (const key of ["requestedAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`partial refund.${key} is invalid.`);
  }
  if (value.refundedAt !== null && !isCanonicalIso(value.refundedAt)) {
    issues.push("partial refund.refundedAt is invalid.");
  }
  if (
    value.status === "pending" || value.status === "manual-review"
      ? value.refundedAt !== null
      : value.refundedAt === null
  ) {
    issues.push("partial refund status must match refundedAt.");
  }
  return issues;
}

export function npRequireShopPartialRefund(value: unknown): NpShopPartialRefund {
  const issues = npAnalyzeShopPartialRefund(value);
  if (issues.length) {
    throw new NpShopPartialRefundContractError("Invalid projected Shop partial refund", issues);
  }
  return value as NpShopPartialRefund;
}
