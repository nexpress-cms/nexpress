import { createHash } from "node:crypto";

import { npShopCurrencies, type NpShopCurrency } from "./types.js";

export const NP_SHOP_PAYMENT_DISPUTE_EVENT_CONTRACT = "np.shop-payment-dispute-event.v1" as const;
export const NP_SHOP_PAYMENT_DISPUTE_RECEIPT_CONTRACT =
  "np.shop-payment-dispute-receipt.v1" as const;
export const NP_SHOP_PAYMENT_DISPUTE_STORAGE_CONTRACT =
  "np.shop-payment-dispute-storage.v1" as const;

export const npShopPaymentDisputeStatuses = [
  "warning-needs-response",
  "warning-under-review",
  "warning-closed",
  "needs-response",
  "under-review",
  "won",
  "lost",
  "prevented",
] as const;
export type NpShopPaymentDisputeStatus = (typeof npShopPaymentDisputeStatuses)[number];

export const npShopPaymentDisputeReceiptOutcomes = [
  "opened",
  "updated",
  "ignored-stale",
  "ignored-terminal",
] as const;
export type NpShopPaymentDisputeReceiptOutcome =
  (typeof npShopPaymentDisputeReceiptOutcomes)[number];

export const npShopPaymentDisputeLimits = Object.freeze({
  eventIdLength: 200,
  referenceLength: 200,
  reasonCodeLength: 80,
  maximumPerOrder: 20,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopVerifiedPaymentDisputeEvent {
  contract: typeof NP_SHOP_PAYMENT_DISPUTE_EVENT_CONTRACT;
  eventId: string;
  disputeReference: string;
  orderId: string;
  paymentReference: string;
  currency: NpShopCurrency;
  amountMinor: number;
  status: NpShopPaymentDisputeStatus;
  reasonCode: string;
  occurredAt: string;
  signedAt: string;
}

export interface NpShopStoredPaymentDisputeReceipt {
  contract: typeof NP_SHOP_PAYMENT_DISPUTE_RECEIPT_CONTRACT;
  providerId: string;
  event: NpShopVerifiedPaymentDisputeEvent;
  eventDigest: string;
  outcome: NpShopPaymentDisputeReceiptOutcome;
  orderStatus: "paid" | "refunded";
  orderRevision: number;
  processedAt: string;
  purgeAt: string;
}

export interface NpShopStoredPaymentDispute {
  contract: typeof NP_SHOP_PAYMENT_DISPUTE_STORAGE_CONTRACT;
  providerId: string;
  disputeReference: string;
  orderId: string;
  paymentReference: string;
  currency: NpShopCurrency;
  amountMinor: number;
  status: NpShopPaymentDisputeStatus;
  reasonCode: string;
  latestEventId: string;
  openedAt: string;
  updatedAt: string;
  purgeAt: string;
}

export class NpShopPaymentDisputeContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopPaymentDisputeContractError";
    this.issues = issues;
  }
}

export class NpShopPaymentDisputeVerificationError extends Error {
  constructor(message = "The payment dispute callback timestamp is invalid.") {
    super(message);
    this.name = "NpShopPaymentDisputeVerificationError";
  }
}

export class NpShopPaymentDisputeConflictError extends Error {
  readonly code:
    | "payment_dispute_conflict"
    | "payment_dispute_order_not_found"
    | "payment_dispute_order_expired"
    | "payment_dispute_payment_mismatch"
    | "payment_dispute_limit";

  constructor(code: NpShopPaymentDisputeConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopPaymentDisputeConflictError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaquePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const reasonCodePattern = /^[a-z][a-z0-9_-]{0,79}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

function readDataRecord(
  value: unknown,
  expected: readonly string[],
  path: string,
  issues: string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    issues.push(`${path} must be a plain object.`);
    return null;
  }
  try {
    if (Array.isArray(value)) {
      issues.push(`${path} must be a plain object.`);
      return null;
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      issues.push(`${path} must be a plain object.`);
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > expected.length + 8) {
      issues.push(`${path} contains too many properties.`);
      return null;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") {
        issues.push(`${path} cannot contain symbol properties.`);
        continue;
      }
      if (!expected.includes(key)) {
        issues.push(`${path}.${key} is not supported.`);
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        issues.push(`${path}.${key} must be an enumerable data property.`);
        continue;
      }
      result[key] = descriptor.value;
    }
    for (const key of expected) {
      if (!Object.hasOwn(result, key)) issues.push(`${path}.${key} is required.`);
    }
    return result;
  } catch {
    issues.push(`${path} could not be inspected safely.`);
    return null;
  }
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isOpaque(value: unknown): value is string {
  return typeof value === "string" && opaquePattern.test(value);
}

export function npShopPaymentDisputeRequiresReview(
  value: NpShopPaymentDisputeStatus | NpShopStoredPaymentDispute,
): boolean {
  const status = typeof value === "string" ? value : value.status;
  return status !== "won" && status !== "warning-closed" && status !== "prevented";
}

export function npAnalyzeShopPaymentDisputeEvent(value: unknown): string[] {
  const issues: string[] = [];
  const event = readDataRecord(
    value,
    [
      "contract",
      "eventId",
      "disputeReference",
      "orderId",
      "paymentReference",
      "currency",
      "amountMinor",
      "status",
      "reasonCode",
      "occurredAt",
      "signedAt",
    ],
    "payment dispute event",
    issues,
  );
  if (!event) return issues;
  if (event.contract !== NP_SHOP_PAYMENT_DISPUTE_EVENT_CONTRACT) {
    issues.push(
      `payment dispute event.contract must equal "${NP_SHOP_PAYMENT_DISPUTE_EVENT_CONTRACT}".`,
    );
  }
  if (!isOpaque(event.eventId)) issues.push("payment dispute event.eventId is invalid.");
  if (!isOpaque(event.disputeReference)) {
    issues.push("payment dispute event.disputeReference is invalid.");
  }
  if (typeof event.orderId !== "string" || !uuidPattern.test(event.orderId)) {
    issues.push("payment dispute event.orderId is invalid.");
  }
  if (!isOpaque(event.paymentReference)) {
    issues.push("payment dispute event.paymentReference is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(event.currency)) {
    issues.push("payment dispute event.currency is invalid.");
  }
  if (!Number.isSafeInteger(event.amountMinor) || (event.amountMinor as number) < 1) {
    issues.push("payment dispute event.amountMinor is invalid.");
  }
  if (!(npShopPaymentDisputeStatuses as readonly unknown[]).includes(event.status)) {
    issues.push("payment dispute event.status is invalid.");
  }
  if (typeof event.reasonCode !== "string" || !reasonCodePattern.test(event.reasonCode)) {
    issues.push("payment dispute event.reasonCode is invalid.");
  }
  if (!isCanonicalIso(event.occurredAt)) {
    issues.push("payment dispute event.occurredAt is invalid.");
  }
  if (!isCanonicalIso(event.signedAt)) issues.push("payment dispute event.signedAt is invalid.");
  if (
    isCanonicalIso(event.occurredAt) &&
    isCanonicalIso(event.signedAt) &&
    new Date(event.occurredAt).getTime() > new Date(event.signedAt).getTime() + 30_000
  ) {
    issues.push("payment dispute event.occurredAt cannot follow its authenticated timestamp.");
  }
  return issues;
}

export function npRequireShopPaymentDisputeEvent(
  value: unknown,
): NpShopVerifiedPaymentDisputeEvent {
  const issues = npAnalyzeShopPaymentDisputeEvent(value);
  if (issues.length > 0) {
    throw new NpShopPaymentDisputeContractError("Invalid Shop payment dispute event", issues);
  }
  const canonical = readDataRecord(
    value,
    [
      "contract",
      "eventId",
      "disputeReference",
      "orderId",
      "paymentReference",
      "currency",
      "amountMinor",
      "status",
      "reasonCode",
      "occurredAt",
      "signedAt",
    ],
    "payment dispute event",
    [],
  );
  return canonical as unknown as NpShopVerifiedPaymentDisputeEvent;
}

export function npRequireFreshShopPaymentDisputeEvent(
  value: unknown,
  receivedAt: Date,
): NpShopVerifiedPaymentDisputeEvent {
  const event = npRequireShopPaymentDisputeEvent(value);
  const signedAt = new Date(event.signedAt).getTime();
  const received = receivedAt.getTime();
  if (
    !Number.isFinite(received) ||
    signedAt < received - 5 * 60 * 1_000 ||
    signedAt > received + 30 * 1_000
  ) {
    throw new NpShopPaymentDisputeVerificationError(
      "The payment dispute timestamp is outside the accepted replay window.",
    );
  }
  return event;
}

export function npShopPaymentDisputeEventDigest(event: NpShopVerifiedPaymentDisputeEvent): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        contract: event.contract,
        eventId: event.eventId,
        disputeReference: event.disputeReference,
        orderId: event.orderId,
        paymentReference: event.paymentReference,
        currency: event.currency,
        amountMinor: event.amountMinor,
        status: event.status,
        reasonCode: event.reasonCode,
        occurredAt: event.occurredAt,
      }),
    )
    .digest("hex");
}

function requireKeyParts(providerId: string, reference: string): void {
  if (
    typeof providerId !== "string" ||
    !providerIdPattern.test(providerId) ||
    !isOpaque(reference)
  ) {
    throw new NpShopPaymentDisputeContractError("Invalid Shop payment dispute key", [
      "Payment dispute provider and reference ids must be canonical opaque segments.",
    ]);
  }
}

export function npShopPaymentDisputeStorageKey(
  providerId: string,
  disputeReference: string,
): string {
  requireKeyParts(providerId, disputeReference);
  return `payment-dispute:${providerId}:${createHash("sha256").update(disputeReference).digest("hex")}`;
}

export function npShopPaymentDisputeReceiptStorageKey(providerId: string, eventId: string): string {
  requireKeyParts(providerId, eventId);
  return `payment-dispute-event:${providerId}:${createHash("sha256").update(eventId).digest("hex")}`;
}

export function npRequireStoredShopPaymentDispute(value: unknown): NpShopStoredPaymentDispute {
  const issues: string[] = [];
  const state = readDataRecord(
    value,
    [
      "contract",
      "providerId",
      "disputeReference",
      "orderId",
      "paymentReference",
      "currency",
      "amountMinor",
      "status",
      "reasonCode",
      "latestEventId",
      "openedAt",
      "updatedAt",
      "purgeAt",
    ],
    "payment dispute state",
    issues,
  );
  if (!state) {
    throw new NpShopPaymentDisputeContractError("Invalid Shop payment dispute state", issues);
  }
  if (state.contract !== NP_SHOP_PAYMENT_DISPUTE_STORAGE_CONTRACT) {
    issues.push(
      `payment dispute state.contract must equal "${NP_SHOP_PAYMENT_DISPUTE_STORAGE_CONTRACT}".`,
    );
  }
  if (typeof state.providerId !== "string" || !providerIdPattern.test(state.providerId)) {
    issues.push("payment dispute state.providerId is invalid.");
  }
  for (const key of ["disputeReference", "paymentReference", "latestEventId"] as const) {
    if (!isOpaque(state[key])) issues.push(`payment dispute state.${key} is invalid.`);
  }
  if (typeof state.orderId !== "string" || !uuidPattern.test(state.orderId)) {
    issues.push("payment dispute state.orderId is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(state.currency)) {
    issues.push("payment dispute state.currency is invalid.");
  }
  if (!Number.isSafeInteger(state.amountMinor) || (state.amountMinor as number) < 1) {
    issues.push("payment dispute state.amountMinor is invalid.");
  }
  if (!(npShopPaymentDisputeStatuses as readonly unknown[]).includes(state.status)) {
    issues.push("payment dispute state.status is invalid.");
  }
  if (typeof state.reasonCode !== "string" || !reasonCodePattern.test(state.reasonCode)) {
    issues.push("payment dispute state.reasonCode is invalid.");
  }
  for (const key of ["openedAt", "updatedAt", "purgeAt"] as const) {
    if (!isCanonicalIso(state[key])) issues.push(`payment dispute state.${key} is invalid.`);
  }
  if (
    isCanonicalIso(state.openedAt) &&
    isCanonicalIso(state.updatedAt) &&
    new Date(state.updatedAt) < new Date(state.openedAt)
  ) {
    issues.push("payment dispute state.updatedAt cannot precede openedAt.");
  }
  if (
    isCanonicalIso(state.updatedAt) &&
    isCanonicalIso(state.purgeAt) &&
    new Date(state.purgeAt) <= new Date(state.updatedAt)
  ) {
    issues.push("payment dispute state.purgeAt must follow updatedAt.");
  }
  if (issues.length > 0) {
    throw new NpShopPaymentDisputeContractError("Invalid Shop payment dispute state", issues);
  }
  return state as unknown as NpShopStoredPaymentDispute;
}

export function npRequireStoredShopPaymentDisputeReceipt(
  value: unknown,
): NpShopStoredPaymentDisputeReceipt {
  const issues: string[] = [];
  const receipt = readDataRecord(
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
    "payment dispute receipt",
    issues,
  );
  if (!receipt) {
    throw new NpShopPaymentDisputeContractError("Invalid Shop payment dispute receipt", issues);
  }
  if (receipt.contract !== NP_SHOP_PAYMENT_DISPUTE_RECEIPT_CONTRACT) {
    issues.push(
      `payment dispute receipt.contract must equal "${NP_SHOP_PAYMENT_DISPUTE_RECEIPT_CONTRACT}".`,
    );
  }
  if (typeof receipt.providerId !== "string" || !providerIdPattern.test(receipt.providerId)) {
    issues.push("payment dispute receipt.providerId is invalid.");
  }
  const eventIssues = npAnalyzeShopPaymentDisputeEvent(receipt.event);
  issues.push(...eventIssues.map((issue) => `payment dispute receipt: ${issue}`));
  const canonicalEvent =
    eventIssues.length === 0 ? npRequireShopPaymentDisputeEvent(receipt.event) : null;
  if (typeof receipt.eventDigest !== "string" || !digestPattern.test(receipt.eventDigest)) {
    issues.push("payment dispute receipt.eventDigest is invalid.");
  } else if (
    canonicalEvent &&
    receipt.eventDigest !== npShopPaymentDisputeEventDigest(canonicalEvent)
  ) {
    issues.push("payment dispute receipt.eventDigest must match its canonical event.");
  }
  if (!(npShopPaymentDisputeReceiptOutcomes as readonly unknown[]).includes(receipt.outcome)) {
    issues.push("payment dispute receipt.outcome is invalid.");
  }
  if (!(["paid", "refunded"] as readonly unknown[]).includes(receipt.orderStatus)) {
    issues.push("payment dispute receipt.orderStatus is invalid.");
  }
  if (!Number.isSafeInteger(receipt.orderRevision) || (receipt.orderRevision as number) < 1) {
    issues.push("payment dispute receipt.orderRevision is invalid.");
  }
  if (!isCanonicalIso(receipt.processedAt)) {
    issues.push("payment dispute receipt.processedAt is invalid.");
  }
  if (!isCanonicalIso(receipt.purgeAt)) {
    issues.push("payment dispute receipt.purgeAt is invalid.");
  }
  if (canonicalEvent && isCanonicalIso(receipt.processedAt)) {
    const signedAt = new Date(canonicalEvent.signedAt).getTime();
    const processedAt = new Date(receipt.processedAt).getTime();
    if (signedAt < processedAt - 5 * 60 * 1_000 || signedAt > processedAt + 30 * 1_000) {
      issues.push("payment dispute receipt event timestamp is outside its replay window.");
    }
  }
  if (
    isCanonicalIso(receipt.processedAt) &&
    isCanonicalIso(receipt.purgeAt) &&
    new Date(receipt.purgeAt) <= new Date(receipt.processedAt)
  ) {
    issues.push("payment dispute receipt.purgeAt must follow processing.");
  }
  if (issues.length > 0) {
    throw new NpShopPaymentDisputeContractError("Invalid Shop payment dispute receipt", issues);
  }
  return {
    ...receipt,
    event: canonicalEvent,
  } as unknown as NpShopStoredPaymentDisputeReceipt;
}

export function npIsShopPaymentDisputeEvent(
  value: unknown,
): value is NpShopVerifiedPaymentDisputeEvent {
  if (typeof value !== "object" || value === null) return false;
  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, "contract");
    return (
      descriptor !== undefined &&
      "value" in descriptor &&
      descriptor.enumerable === true &&
      descriptor.value === NP_SHOP_PAYMENT_DISPUTE_EVENT_CONTRACT
    );
  } catch {
    return false;
  }
}
