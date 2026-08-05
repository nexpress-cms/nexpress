import { createHash } from "node:crypto";

import { npShopCurrencies, type NpShopCurrency } from "./types.js";

export const NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT =
  "np.shop-payment-adjustment-event.v1" as const;
export const NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT =
  "np.shop-payment-adjustment-receipt.v1" as const;
export const NP_SHOP_PAYMENT_ADJUSTMENT_STORAGE_CONTRACT =
  "np.shop-payment-adjustment-storage.v1" as const;
export const NP_SHOP_PAYMENT_ADJUSTMENT_CONTRACT = "np.shop-payment-adjustment.v1" as const;

export const npShopPaymentAdjustmentOutcomes = [
  "matched-refund",
  "applied-full-reversal",
  "manual-review",
  "closed-unpaid-order",
] as const;
export type NpShopPaymentAdjustmentOutcome = (typeof npShopPaymentAdjustmentOutcomes)[number];

export const npShopPaymentAdjustmentStatuses = [
  "matched-refund",
  "applied-full-reversal",
  "manual-review",
  "closed-unpaid-order",
] as const;
export type NpShopPaymentAdjustmentStatus = (typeof npShopPaymentAdjustmentStatuses)[number];

export const npShopPaymentAdjustmentLimits = Object.freeze({
  maximumCancellations: 100,
  referenceLength: 200,
  eventIdLength: 200,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopPaymentCancellation {
  reference: string;
  amountMinor: number;
  cancelledAt: string;
}

/** One authoritative cumulative captured-payment cancellation snapshot. */
export interface NpShopVerifiedPaymentAdjustmentEvent {
  contract: typeof NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT;
  eventId: string;
  orderId: string;
  paymentReference: string;
  currency: NpShopCurrency;
  originalAmountMinor: number;
  remainingAmountMinor: number;
  cancellations: NpShopPaymentCancellation[];
  signedAt: string;
}

export interface NpShopStoredPaymentAdjustmentReceipt {
  contract: typeof NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT;
  providerId: string;
  event: NpShopVerifiedPaymentAdjustmentEvent;
  eventDigest: string;
  outcome: NpShopPaymentAdjustmentOutcome;
  orderStatus: "paid" | "refunded" | "payment-failed" | "cancelled";
  orderRevision: number;
  processedAt: string;
  purgeAt: string;
}

export interface NpShopStoredPaymentAdjustment {
  contract: typeof NP_SHOP_PAYMENT_ADJUSTMENT_STORAGE_CONTRACT;
  providerId: string;
  orderId: string;
  paymentReference: string;
  currency: NpShopCurrency;
  originalAmountMinor: number;
  remainingAmountMinor: number;
  cancellations: NpShopPaymentCancellation[];
  status: NpShopPaymentAdjustmentStatus;
  latestEventId: string;
  orderRevision: number;
  inventoryOutcome:
    "pending" | "not-required" | "restocked" | "not-applicable-shipped" | "manual-required";
  fulfillmentOutcome: "pending" | "unchanged" | "cancelled" | "shipped-retained";
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopPaymentAdjustment {
  contract: typeof NP_SHOP_PAYMENT_ADJUSTMENT_CONTRACT;
  status: NpShopPaymentAdjustmentStatus;
  currency: NpShopCurrency;
  originalAmountMinor: number;
  reversedAmountMinor: number;
  remainingAmountMinor: number;
  cancellationCount: number;
  inventoryOutcome: NpShopStoredPaymentAdjustment["inventoryOutcome"];
  fulfillmentOutcome: NpShopStoredPaymentAdjustment["fulfillmentOutcome"];
  updatedAt: string;
}

export class NpShopPaymentAdjustmentContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopPaymentAdjustmentContractError";
    this.issues = issues;
  }
}

export class NpShopPaymentAdjustmentVerificationError extends Error {
  constructor(message = "The payment adjustment callback timestamp is invalid.") {
    super(message);
    this.name = "NpShopPaymentAdjustmentVerificationError";
  }
}

export class NpShopPaymentAdjustmentConflictError extends Error {
  readonly code:
    | "payment_adjustment_conflict"
    | "payment_adjustment_order_not_found"
    | "payment_adjustment_order_expired"
    | "payment_adjustment_payment_mismatch";

  constructor(code: NpShopPaymentAdjustmentConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopPaymentAdjustmentConflictError";
    this.code = code;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

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

function isOpaque(value: unknown): value is string {
  return typeof value === "string" && opaqueReferencePattern.test(value);
}

function analyzeCancellations(value: unknown, issues: string[]): number | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopPaymentAdjustmentLimits.maximumCancellations
  ) {
    issues.push(
      `payment adjustment event.cancellations must contain 1-${npShopPaymentAdjustmentLimits.maximumCancellations.toString()} entries.`,
    );
    return null;
  }
  const references = new Set<string>();
  let total = 0;
  let previous = "";
  value.forEach((candidate, index) => {
    const path = `payment adjustment event.cancellations[${index.toString()}]`;
    if (!isRecord(candidate)) {
      issues.push(`${path} must be a plain object.`);
      return;
    }
    exactKeys(candidate, ["reference", "amountMinor", "cancelledAt"], path, issues);
    if (!isOpaque(candidate.reference)) issues.push(`${path}.reference is invalid.`);
    if (typeof candidate.reference === "string") {
      if (references.has(candidate.reference)) issues.push(`${path}.reference is duplicated.`);
      references.add(candidate.reference);
    }
    if (!Number.isSafeInteger(candidate.amountMinor) || (candidate.amountMinor as number) < 1) {
      issues.push(`${path}.amountMinor is invalid.`);
    } else if (!Number.isSafeInteger(total + (candidate.amountMinor as number))) {
      issues.push("payment adjustment event cancellation total exceeds the safe integer range.");
    } else {
      total += candidate.amountMinor as number;
    }
    if (!isCanonicalIso(candidate.cancelledAt)) issues.push(`${path}.cancelledAt is invalid.`);
    if (isCanonicalIso(candidate.cancelledAt) && typeof candidate.reference === "string") {
      const cursor = `${candidate.cancelledAt}:${candidate.reference}`;
      if (previous && cursor <= previous) {
        issues.push("payment adjustment event.cancellations must be canonically ordered.");
      }
      previous = cursor;
    }
  });
  return total;
}

export function npAnalyzeShopPaymentAdjustmentEvent(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["payment adjustment event must be a plain object."];
  exactKeys(
    value,
    [
      "contract",
      "eventId",
      "orderId",
      "paymentReference",
      "currency",
      "originalAmountMinor",
      "remainingAmountMinor",
      "cancellations",
      "signedAt",
    ],
    "payment adjustment event",
    issues,
  );
  if (value.contract !== NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT) {
    issues.push(
      `payment adjustment event.contract must equal "${NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT}".`,
    );
  }
  if (!isOpaque(value.eventId)) issues.push("payment adjustment event.eventId is invalid.");
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("payment adjustment event.orderId is invalid.");
  }
  if (!isOpaque(value.paymentReference)) {
    issues.push("payment adjustment event.paymentReference is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("payment adjustment event.currency is invalid.");
  }
  if (
    !Number.isSafeInteger(value.originalAmountMinor) ||
    (value.originalAmountMinor as number) < 1
  ) {
    issues.push("payment adjustment event.originalAmountMinor is invalid.");
  }
  if (
    !Number.isSafeInteger(value.remainingAmountMinor) ||
    (value.remainingAmountMinor as number) < 0
  ) {
    issues.push("payment adjustment event.remainingAmountMinor is invalid.");
  }
  const cancellationTotal = analyzeCancellations(value.cancellations, issues);
  if (isCanonicalIso(value.signedAt) && Array.isArray(value.cancellations)) {
    const latestAccepted = new Date(value.signedAt).getTime() + 30 * 1_000;
    value.cancellations.forEach((candidate, index) => {
      if (
        isRecord(candidate) &&
        isCanonicalIso(candidate.cancelledAt) &&
        new Date(candidate.cancelledAt).getTime() > latestAccepted
      ) {
        issues.push(
          `payment adjustment event.cancellations[${index.toString()}].cancelledAt cannot be in the future.`,
        );
      }
    });
  }
  if (
    cancellationTotal !== null &&
    Number.isSafeInteger(value.originalAmountMinor) &&
    Number.isSafeInteger(value.remainingAmountMinor) &&
    cancellationTotal !==
      (value.originalAmountMinor as number) - (value.remainingAmountMinor as number)
  ) {
    issues.push(
      "payment adjustment event cancellation total must equal original minus remaining amount.",
    );
  }
  if (
    Number.isSafeInteger(value.originalAmountMinor) &&
    Number.isSafeInteger(value.remainingAmountMinor) &&
    (value.remainingAmountMinor as number) >= (value.originalAmountMinor as number)
  ) {
    issues.push("payment adjustment event must describe a positive captured-payment reversal.");
  }
  if (!isCanonicalIso(value.signedAt)) issues.push("payment adjustment event.signedAt is invalid.");
  return issues;
}

export function npRequireShopPaymentAdjustmentEvent(
  value: unknown,
): NpShopVerifiedPaymentAdjustmentEvent {
  const issues = npAnalyzeShopPaymentAdjustmentEvent(value);
  if (issues.length > 0) {
    throw new NpShopPaymentAdjustmentContractError("Invalid Shop payment adjustment event", issues);
  }
  return value as NpShopVerifiedPaymentAdjustmentEvent;
}

export function npRequireFreshShopPaymentAdjustmentEvent(
  value: unknown,
  receivedAt: Date,
): NpShopVerifiedPaymentAdjustmentEvent {
  const event = npRequireShopPaymentAdjustmentEvent(value);
  const signedAt = new Date(event.signedAt).getTime();
  const received = receivedAt.getTime();
  if (
    !Number.isFinite(received) ||
    signedAt < received - 5 * 60 * 1_000 ||
    signedAt > received + 30 * 1_000
  ) {
    throw new NpShopPaymentAdjustmentVerificationError(
      "The payment adjustment timestamp is outside the accepted replay window.",
    );
  }
  return event;
}

export function npShopPaymentAdjustmentEventDigest(
  event: NpShopVerifiedPaymentAdjustmentEvent,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        contract: event.contract,
        eventId: event.eventId,
        orderId: event.orderId,
        paymentReference: event.paymentReference,
        currency: event.currency,
        originalAmountMinor: event.originalAmountMinor,
        remainingAmountMinor: event.remainingAmountMinor,
        cancellations: event.cancellations.map((item) => ({
          reference: item.reference,
          amountMinor: item.amountMinor,
          cancelledAt: item.cancelledAt,
        })),
      }),
    )
    .digest("hex");
}

export function npShopPaymentAdjustmentReceiptStorageKey(
  providerId: string,
  eventId: string,
): string {
  if (!providerIdPattern.test(providerId) || !isOpaque(eventId)) {
    throw new NpShopPaymentAdjustmentContractError("Invalid Shop payment adjustment key", [
      "Payment adjustment provider and event ids must be canonical opaque segments.",
    ]);
  }
  return `payment-adjustment-event:${providerId}:${createHash("sha256").update(eventId).digest("hex")}`;
}

export function npShopPaymentAdjustmentStorageKey(orderId: string): string {
  if (!canonicalUuidPattern.test(orderId)) {
    throw new NpShopPaymentAdjustmentContractError("Invalid Shop payment adjustment order", [
      "Payment adjustment order id must be a canonical UUID.",
    ]);
  }
  return `payment-adjustment:${orderId}`;
}

function analyzeReceipt(value: Record<string, unknown>, issues: string[]): void {
  exactKeys(
    value,
    [
      "contract",
      "providerId",
      "event",
      "eventDigest",
      "outcome",
      "orderStatus",
      "orderRevision",
      "processedAt",
      "purgeAt",
    ],
    "payment adjustment receipt",
    issues,
  );
  if (value.contract !== NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT) {
    issues.push(
      `payment adjustment receipt.contract must equal "${NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT}".`,
    );
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("payment adjustment receipt.providerId is invalid.");
  }
  const eventIssues = npAnalyzeShopPaymentAdjustmentEvent(value.event);
  issues.push(...eventIssues.map((issue) => `payment adjustment receipt: ${issue}`));
  if (typeof value.eventDigest !== "string" || !digestPattern.test(value.eventDigest)) {
    issues.push("payment adjustment receipt.eventDigest is invalid.");
  } else if (
    eventIssues.length === 0 &&
    value.eventDigest !==
      npShopPaymentAdjustmentEventDigest(value.event as NpShopVerifiedPaymentAdjustmentEvent)
  ) {
    issues.push("payment adjustment receipt.eventDigest must match its canonical event.");
  }
  if (!(npShopPaymentAdjustmentOutcomes as readonly unknown[]).includes(value.outcome)) {
    issues.push("payment adjustment receipt.outcome is invalid.");
  }
  if (!["paid", "refunded", "payment-failed", "cancelled"].includes(value.orderStatus as string)) {
    issues.push("payment adjustment receipt.orderStatus is invalid.");
  }
  if (!Number.isSafeInteger(value.orderRevision) || (value.orderRevision as number) < 1) {
    issues.push("payment adjustment receipt.orderRevision is invalid.");
  }
  if (!isCanonicalIso(value.processedAt))
    issues.push("payment adjustment receipt.processedAt is invalid.");
  if (!isCanonicalIso(value.purgeAt)) issues.push("payment adjustment receipt.purgeAt is invalid.");
  if (
    isRecord(value.event) &&
    isCanonicalIso(value.event.signedAt) &&
    isCanonicalIso(value.processedAt)
  ) {
    const signedAt = new Date(value.event.signedAt).getTime();
    const processedAt = new Date(value.processedAt).getTime();
    if (signedAt < processedAt - 5 * 60 * 1_000 || signedAt > processedAt + 30 * 1_000) {
      issues.push("payment adjustment receipt event timestamp is outside its replay window.");
    }
  }
  if (
    isCanonicalIso(value.processedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.purgeAt) <= new Date(value.processedAt)
  ) {
    issues.push("payment adjustment receipt.purgeAt must follow processing.");
  }
  if (value.outcome === "applied-full-reversal" && value.orderStatus !== "refunded") {
    issues.push("applied full-reversal receipts require a refunded order.");
  }
  if (value.outcome === "manual-review" && value.orderStatus !== "paid") {
    issues.push("manual-review adjustment receipts require a paid order.");
  }
  if (
    value.outcome === "matched-refund" &&
    value.orderStatus !== "paid" &&
    value.orderStatus !== "refunded"
  ) {
    issues.push("matched adjustment receipts require a paid or refunded order.");
  }
  if (
    value.outcome === "closed-unpaid-order" &&
    value.orderStatus !== "payment-failed" &&
    value.orderStatus !== "cancelled"
  ) {
    issues.push("closed unpaid adjustment receipts require a failed or cancelled order.");
  }
}

export function npRequireStoredShopPaymentAdjustmentReceipt(
  value: unknown,
): NpShopStoredPaymentAdjustmentReceipt {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopPaymentAdjustmentContractError("Invalid Shop payment adjustment receipt", [
      "Payment adjustment receipt must be a plain object.",
    ]);
  }
  analyzeReceipt(value, issues);
  if (issues.length > 0) {
    throw new NpShopPaymentAdjustmentContractError(
      "Invalid Shop payment adjustment receipt",
      issues,
    );
  }
  return value as unknown as NpShopStoredPaymentAdjustmentReceipt;
}

export function npRequireStoredShopPaymentAdjustment(
  value: unknown,
): NpShopStoredPaymentAdjustment {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopPaymentAdjustmentContractError("Invalid Shop payment adjustment state", [
      "Payment adjustment state must be a plain object.",
    ]);
  }
  exactKeys(
    value,
    [
      "contract",
      "providerId",
      "orderId",
      "paymentReference",
      "currency",
      "originalAmountMinor",
      "remainingAmountMinor",
      "cancellations",
      "status",
      "latestEventId",
      "orderRevision",
      "inventoryOutcome",
      "fulfillmentOutcome",
      "updatedAt",
      "purgeAt",
    ],
    "payment adjustment state",
    issues,
  );
  if (value.contract !== NP_SHOP_PAYMENT_ADJUSTMENT_STORAGE_CONTRACT) {
    issues.push(
      `payment adjustment state.contract must equal "${NP_SHOP_PAYMENT_ADJUSTMENT_STORAGE_CONTRACT}".`,
    );
  }
  const event = {
    contract: NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT,
    eventId: value.latestEventId,
    orderId: value.orderId,
    paymentReference: value.paymentReference,
    currency: value.currency,
    originalAmountMinor: value.originalAmountMinor,
    remainingAmountMinor: value.remainingAmountMinor,
    cancellations: value.cancellations,
    signedAt: value.updatedAt,
  };
  issues.push(
    ...npAnalyzeShopPaymentAdjustmentEvent(event).map(
      (issue) => `payment adjustment state: ${issue}`,
    ),
  );
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("payment adjustment state.providerId is invalid.");
  }
  if (!(npShopPaymentAdjustmentStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("payment adjustment state.status is invalid.");
  }
  if (!Number.isSafeInteger(value.orderRevision) || (value.orderRevision as number) < 1) {
    issues.push("payment adjustment state.orderRevision is invalid.");
  }
  if (
    !["pending", "not-required", "restocked", "not-applicable-shipped", "manual-required"].includes(
      value.inventoryOutcome as string,
    )
  ) {
    issues.push("payment adjustment state.inventoryOutcome is invalid.");
  }
  if (
    !["pending", "unchanged", "cancelled", "shipped-retained"].includes(
      value.fulfillmentOutcome as string,
    )
  ) {
    issues.push("payment adjustment state.fulfillmentOutcome is invalid.");
  }
  if (!isCanonicalIso(value.purgeAt)) issues.push("payment adjustment state.purgeAt is invalid.");
  if (
    isCanonicalIso(value.updatedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.purgeAt) <= new Date(value.updatedAt)
  ) {
    issues.push("payment adjustment state.purgeAt must follow its update.");
  }
  if (
    value.status === "manual-review" &&
    (value.inventoryOutcome !== "pending" || value.fulfillmentOutcome !== "pending")
  ) {
    issues.push("manual-review adjustments require pending compensation outcomes.");
  }
  if (
    (value.status === "matched-refund" || value.status === "closed-unpaid-order") &&
    (value.inventoryOutcome !== "not-required" || value.fulfillmentOutcome !== "unchanged")
  ) {
    issues.push("matched or unpaid adjustments cannot claim compensation transitions.");
  }
  if (
    value.status === "applied-full-reversal" &&
    (value.remainingAmountMinor !== 0 ||
      !["restocked", "not-required", "not-applicable-shipped", "manual-required"].includes(
        value.inventoryOutcome as string,
      ) ||
      !["cancelled", "shipped-retained"].includes(value.fulfillmentOutcome as string))
  ) {
    issues.push("applied full reversals require zero balance and closed compensation outcomes.");
  }
  if (issues.length > 0) {
    throw new NpShopPaymentAdjustmentContractError("Invalid Shop payment adjustment state", issues);
  }
  return value as unknown as NpShopStoredPaymentAdjustment;
}

export function npAnalyzeShopPaymentAdjustment(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["payment adjustment must be a plain object."];
  exactKeys(
    value,
    [
      "contract",
      "status",
      "currency",
      "originalAmountMinor",
      "reversedAmountMinor",
      "remainingAmountMinor",
      "cancellationCount",
      "inventoryOutcome",
      "fulfillmentOutcome",
      "updatedAt",
    ],
    "payment adjustment",
    issues,
  );
  if (value.contract !== NP_SHOP_PAYMENT_ADJUSTMENT_CONTRACT) {
    issues.push(`payment adjustment.contract must equal "${NP_SHOP_PAYMENT_ADJUSTMENT_CONTRACT}".`);
  }
  if (!(npShopPaymentAdjustmentStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("payment adjustment.status is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("payment adjustment.currency is invalid.");
  }
  for (const key of ["originalAmountMinor", "reversedAmountMinor"] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) {
      issues.push(`payment adjustment.${key} is invalid.`);
    }
  }
  if (
    !Number.isSafeInteger(value.remainingAmountMinor) ||
    (value.remainingAmountMinor as number) < 0
  ) {
    issues.push("payment adjustment.remainingAmountMinor is invalid.");
  }
  if (
    Number.isSafeInteger(value.originalAmountMinor) &&
    Number.isSafeInteger(value.reversedAmountMinor) &&
    Number.isSafeInteger(value.remainingAmountMinor) &&
    (value.originalAmountMinor as number) !==
      (value.reversedAmountMinor as number) + (value.remainingAmountMinor as number)
  ) {
    issues.push("payment adjustment amounts must preserve the original payment total.");
  }
  if (
    !Number.isSafeInteger(value.cancellationCount) ||
    (value.cancellationCount as number) < 1 ||
    (value.cancellationCount as number) > npShopPaymentAdjustmentLimits.maximumCancellations
  ) {
    issues.push("payment adjustment.cancellationCount is invalid.");
  }
  if (
    !["pending", "not-required", "restocked", "not-applicable-shipped", "manual-required"].includes(
      value.inventoryOutcome as string,
    )
  ) {
    issues.push("payment adjustment.inventoryOutcome is invalid.");
  }
  if (
    !["pending", "unchanged", "cancelled", "shipped-retained"].includes(
      value.fulfillmentOutcome as string,
    )
  ) {
    issues.push("payment adjustment.fulfillmentOutcome is invalid.");
  }
  if (!isCanonicalIso(value.updatedAt)) issues.push("payment adjustment.updatedAt is invalid.");
  return issues;
}

export function npProjectShopPaymentAdjustment(
  value: NpShopStoredPaymentAdjustment,
): NpShopPaymentAdjustment {
  const stored = npRequireStoredShopPaymentAdjustment(value);
  const projected: NpShopPaymentAdjustment = {
    contract: NP_SHOP_PAYMENT_ADJUSTMENT_CONTRACT,
    status: stored.status,
    currency: stored.currency,
    originalAmountMinor: stored.originalAmountMinor,
    reversedAmountMinor: stored.originalAmountMinor - stored.remainingAmountMinor,
    remainingAmountMinor: stored.remainingAmountMinor,
    cancellationCount: stored.cancellations.length,
    inventoryOutcome: stored.inventoryOutcome,
    fulfillmentOutcome: stored.fulfillmentOutcome,
    updatedAt: stored.updatedAt,
  };
  const issues = npAnalyzeShopPaymentAdjustment(projected);
  if (issues.length > 0) {
    throw new NpShopPaymentAdjustmentContractError("Invalid Shop payment adjustment", issues);
  }
  return projected;
}

export function npIsShopPaymentAdjustmentEvent(
  value: unknown,
): value is NpShopVerifiedPaymentAdjustmentEvent {
  return isRecord(value) && value.contract === NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT;
}
