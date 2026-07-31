import { createHash } from "node:crypto";

import type {
  NpShopPaymentConfirmAdapterInput,
  NpShopPaymentLauncher,
  NpShopPaymentPrepareInput,
  NpShopPaymentPrepareResult,
} from "./payment-attempt-contract.js";
import { npShopCurrencies, type NpShopCurrency } from "./types.js";

export const NP_SHOP_PAYMENT_EVENT_CONTRACT = "np.shop-payment-event.v1" as const;
export const NP_SHOP_PAYMENT_RECEIPT_CONTRACT = "np.shop-payment-receipt.v1" as const;
export const NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT =
  "np.shop-payment-webhook-ignored.v1" as const;

export const npShopPaymentEventTypes = ["payment.succeeded", "payment.failed"] as const;
export type NpShopPaymentEventType = (typeof npShopPaymentEventTypes)[number];

export const npShopPaymentReceiptOutcomes = ["paid", "payment-failed", "ignored-terminal"] as const;
export type NpShopPaymentReceiptOutcome = (typeof npShopPaymentReceiptOutcomes)[number];

export const npShopPaymentLimits = Object.freeze({
  replayWindowSeconds: 5 * 60,
  futureToleranceSeconds: 30,
  providerIdLength: 32,
  eventIdLength: 200,
  paymentReferenceLength: 200,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopVerifiedPaymentEvent {
  contract: typeof NP_SHOP_PAYMENT_EVENT_CONTRACT;
  eventId: string;
  type: NpShopPaymentEventType;
  orderId: string;
  paymentReference: string;
  currency: NpShopCurrency;
  amountMinor: number;
  signedAt: string;
}

export interface NpShopPaymentWebhookInput {
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string>>;
  receivedAt: string;
}

export interface NpShopIgnoredPaymentWebhook {
  contract: typeof NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT;
  ignored: true;
  reason: "non-terminal" | "unsupported-event";
}

export type NpShopPaymentWebhookResult =
  NpShopVerifiedPaymentEvent | NpShopIgnoredPaymentWebhook | null;

export interface NpShopPaymentAdapter {
  /** Stable lowercase identifier persisted with PII-free payment receipts. */
  id: string;
  /**
   * Authenticate the exact raw bytes or verify their payment projection
   * through a server-authenticated provider query before returning one
   * canonical event. Project `payment.failed` only for a definitive terminal
   * failure. An authenticated non-terminal or unsupported event may return the
   * exact ignored result. Return `null` for unverifiable input and never
   * return unverified parsed fields.
   */
  verifyWebhook(
    input: NpShopPaymentWebhookInput,
  ): NpShopPaymentWebhookResult | Promise<NpShopPaymentWebhookResult>;
  /**
   * Prepare one public payment handoff. Implementations must be idempotent for
   * the same attempt id and must never return credentials or private order data.
   */
  preparePayment?(
    input: NpShopPaymentPrepareInput,
  ): NpShopPaymentPrepareResult | Promise<NpShopPaymentPrepareResult>;
  /**
   * Exchange provider-returned public confirmation data through a
   * server-authenticated provider API. A rejected or ambiguous provider call
   * must throw and leave the Shop order pending.
   */
  confirmPayment?(
    input: NpShopPaymentConfirmAdapterInput,
  ): NpShopVerifiedPaymentEvent | Promise<NpShopVerifiedPaymentEvent>;
  /** Build one provider-owned client launcher without exposing server secrets. */
  renderPaymentLauncher?: NpShopPaymentLauncher;
}

export type NpShopPaymentInitiationAdapter = NpShopPaymentAdapter &
  Required<
    Pick<NpShopPaymentAdapter, "preparePayment" | "confirmPayment" | "renderPaymentLauncher">
  >;

export function npIsIgnoredPaymentWebhook(value: unknown): value is NpShopIgnoredPaymentWebhook {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 3 &&
    (value as { contract?: unknown }).contract === NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT &&
    (value as { ignored?: unknown }).ignored === true &&
    ["non-terminal", "unsupported-event"].includes((value as { reason?: unknown }).reason as string)
  );
}

export interface NpShopStoredPaymentReceipt {
  contract: typeof NP_SHOP_PAYMENT_RECEIPT_CONTRACT;
  providerId: string;
  event: NpShopVerifiedPaymentEvent;
  eventDigest: string;
  outcome: NpShopPaymentReceiptOutcome;
  orderStatus: "paid" | "payment-failed" | "cancelled";
  orderRevision: number;
  processedAt: string;
  purgeAt: string;
}

export class NpShopPaymentContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopPaymentContractError";
    this.issues = issues;
  }
}

export class NpShopPaymentVerificationError extends Error {
  constructor(message = "The payment callback signature is invalid.") {
    super(message);
    this.name = "NpShopPaymentVerificationError";
  }
}

export class NpShopPaymentConflictError extends Error {
  readonly code:
    | "payment_event_conflict"
    | "payment_order_not_found"
    | "payment_order_expired"
    | "payment_amount_mismatch"
    | "payment_inventory_conflict";

  constructor(code: NpShopPaymentConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopPaymentConflictError";
    this.code = code;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const eventKeys = [
  "contract",
  "eventId",
  "type",
  "orderId",
  "paymentReference",
  "currency",
  "amountMinor",
  "signedAt",
] as const;
const receiptKeys = [
  "contract",
  "providerId",
  "event",
  "eventDigest",
  "outcome",
  "orderStatus",
  "orderRevision",
  "processedAt",
  "purgeAt",
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

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

export function npRequireShopPaymentProviderId(value: unknown): string {
  if (typeof value !== "string" || !providerIdPattern.test(value)) {
    throw new NpShopPaymentContractError("Invalid Shop payment provider id", [
      "payment provider id must be a lowercase segment of at most 32 characters.",
    ]);
  }
  return value;
}

export function npAnalyzeShopPaymentEvent(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["payment event must be a plain object."];
  exactKeys(value, eventKeys, "payment event", issues);
  if (value.contract !== NP_SHOP_PAYMENT_EVENT_CONTRACT) {
    issues.push(`payment event.contract must equal "${NP_SHOP_PAYMENT_EVENT_CONTRACT}".`);
  }
  if (
    !isBoundedText(value.eventId, npShopPaymentLimits.eventIdLength) ||
    !opaqueReferencePattern.test(value.eventId)
  ) {
    issues.push("payment event.eventId is invalid.");
  }
  if (!(npShopPaymentEventTypes as readonly unknown[]).includes(value.type)) {
    issues.push("payment event.type is invalid.");
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("payment event.orderId is invalid.");
  }
  if (
    !isBoundedText(value.paymentReference, npShopPaymentLimits.paymentReferenceLength) ||
    !opaqueReferencePattern.test(value.paymentReference)
  ) {
    issues.push("payment event.paymentReference is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("payment event.currency is invalid.");
  }
  if (!Number.isSafeInteger(value.amountMinor) || (value.amountMinor as number) < 0) {
    issues.push("payment event.amountMinor is invalid.");
  }
  if (!isCanonicalIso(value.signedAt)) issues.push("payment event.signedAt is invalid.");
  return issues;
}

export function npRequireShopPaymentEvent(value: unknown): NpShopVerifiedPaymentEvent {
  const issues = npAnalyzeShopPaymentEvent(value);
  if (issues.length > 0) {
    throw new NpShopPaymentContractError("Invalid verified Shop payment event", issues);
  }
  const event = value as NpShopVerifiedPaymentEvent;
  return Object.freeze({
    contract: event.contract,
    eventId: event.eventId,
    type: event.type,
    orderId: event.orderId,
    paymentReference: event.paymentReference,
    currency: event.currency,
    amountMinor: event.amountMinor,
    signedAt: event.signedAt,
  });
}

export function npRequireFreshShopPaymentEvent(
  value: unknown,
  receivedAt: Date,
): NpShopVerifiedPaymentEvent {
  const event = npRequireShopPaymentEvent(value);
  const signedAt = new Date(event.signedAt).getTime();
  const received = receivedAt.getTime();
  if (!Number.isFinite(received)) {
    throw new NpShopPaymentVerificationError("The payment callback receive timestamp is invalid.");
  }
  if (
    signedAt < received - npShopPaymentLimits.replayWindowSeconds * 1_000 ||
    signedAt > received + npShopPaymentLimits.futureToleranceSeconds * 1_000
  ) {
    throw new NpShopPaymentVerificationError(
      "The payment callback signed timestamp is outside the accepted replay window.",
    );
  }
  return event;
}

export function npShopPaymentEventDigest(event: NpShopVerifiedPaymentEvent): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        contract: event.contract,
        eventId: event.eventId,
        type: event.type,
        orderId: event.orderId,
        paymentReference: event.paymentReference,
        currency: event.currency,
        amountMinor: event.amountMinor,
      }),
    )
    .digest("hex");
}

export function npShopPaymentReceiptStorageKey(providerId: string, eventId: string): string {
  npRequireShopPaymentProviderId(providerId);
  if (
    !isBoundedText(eventId, npShopPaymentLimits.eventIdLength) ||
    !opaqueReferencePattern.test(eventId)
  ) {
    throw new NpShopPaymentContractError("Invalid Shop payment event id", [
      "payment event id is invalid.",
    ]);
  }
  return `payment-event:${providerId}:${createHash("sha256").update(eventId).digest("hex")}`;
}

export function npAnalyzeStoredShopPaymentReceipt(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["payment receipt must be a plain object."];
  exactKeys(value, receiptKeys, "payment receipt", issues);
  if (value.contract !== NP_SHOP_PAYMENT_RECEIPT_CONTRACT) {
    issues.push(`payment receipt.contract must equal "${NP_SHOP_PAYMENT_RECEIPT_CONTRACT}".`);
  }
  try {
    npRequireShopPaymentProviderId(value.providerId);
  } catch {
    issues.push("payment receipt.providerId is invalid.");
  }
  issues.push(
    ...npAnalyzeShopPaymentEvent(value.event).map((issue) => `payment receipt: ${issue}`),
  );
  if (typeof value.eventDigest !== "string" || !digestPattern.test(value.eventDigest)) {
    issues.push("payment receipt.eventDigest is invalid.");
  } else if (npAnalyzeShopPaymentEvent(value.event).length === 0) {
    if (value.eventDigest !== npShopPaymentEventDigest(value.event as NpShopVerifiedPaymentEvent)) {
      issues.push("payment receipt.eventDigest must match its canonical event.");
    }
  }
  if (!(npShopPaymentReceiptOutcomes as readonly unknown[]).includes(value.outcome)) {
    issues.push("payment receipt.outcome is invalid.");
  }
  if (!["paid", "payment-failed", "cancelled"].includes(value.orderStatus as string)) {
    issues.push("payment receipt.orderStatus is invalid.");
  }
  if (
    value.outcome === "paid" &&
    (value.orderStatus !== "paid" ||
      !isRecord(value.event) ||
      value.event.type !== "payment.succeeded")
  ) {
    issues.push("paid receipts require a succeeded event and paid order status.");
  }
  if (
    value.outcome === "payment-failed" &&
    (value.orderStatus !== "payment-failed" ||
      !isRecord(value.event) ||
      value.event.type !== "payment.failed")
  ) {
    issues.push("payment-failed receipts require a failed event and failed order status.");
  }
  if (!Number.isSafeInteger(value.orderRevision) || (value.orderRevision as number) < 1) {
    issues.push("payment receipt.orderRevision is invalid.");
  }
  if (!isCanonicalIso(value.processedAt)) issues.push("payment receipt.processedAt is invalid.");
  if (!isCanonicalIso(value.purgeAt)) issues.push("payment receipt.purgeAt is invalid.");
  if (
    isRecord(value.event) &&
    isCanonicalIso(value.event.signedAt) &&
    isCanonicalIso(value.processedAt)
  ) {
    const signedAt = new Date(value.event.signedAt).getTime();
    const processedAt = new Date(value.processedAt).getTime();
    if (
      signedAt < processedAt - npShopPaymentLimits.replayWindowSeconds * 1_000 ||
      signedAt > processedAt + npShopPaymentLimits.futureToleranceSeconds * 1_000
    ) {
      issues.push("payment receipt event timestamp is outside its processing replay window.");
    }
  }
  if (
    isCanonicalIso(value.processedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.purgeAt) <= new Date(value.processedAt)
  ) {
    issues.push("payment receipt.purgeAt must follow processing.");
  }
  return issues;
}

export function npRequireStoredShopPaymentReceipt(value: unknown): NpShopStoredPaymentReceipt {
  const issues = npAnalyzeStoredShopPaymentReceipt(value);
  if (issues.length > 0) {
    throw new NpShopPaymentContractError("Invalid stored Shop payment receipt", issues);
  }
  return value as NpShopStoredPaymentReceipt;
}
