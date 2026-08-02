import { createHash } from "node:crypto";

export const NP_SHOP_TRACKING_EVENT_CONTRACT = "np.shop-tracking-event.v1" as const;
export const NP_SHOP_TRACKING_RECEIPT_CONTRACT = "np.shop-tracking-receipt.v1" as const;
export const NP_SHOP_TRACKING_STORAGE_CONTRACT = "np.shop-tracking-storage.v1" as const;
export const NP_SHOP_TRACKING_CONTRACT = "np.shop-tracking.v1" as const;
export const NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT =
  "np.shop-tracking-webhook-ignored.v1" as const;

export const npShopTrackingStatuses = [
  "in-transit",
  "out-for-delivery",
  "delivered",
  "exception",
] as const;
export type NpShopTrackingStatus = (typeof npShopTrackingStatuses)[number];

export const npShopTrackingReceiptOutcomes = [
  "advanced",
  "ignored-stale",
  "ignored-regression",
  "ignored-terminal",
] as const;
export type NpShopTrackingReceiptOutcome = (typeof npShopTrackingReceiptOutcomes)[number];

export const npShopTrackingLimits = Object.freeze({
  replayWindowSeconds: 5 * 60,
  maximumEventDelaySeconds: 30 * 24 * 60 * 60,
  futureToleranceSeconds: 30,
  providerIdLength: 32,
  eventIdLength: 200,
  referenceLength: 200,
  trackingNumberLength: 120,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopVerifiedTrackingEvent {
  contract: typeof NP_SHOP_TRACKING_EVENT_CONTRACT;
  eventId: string;
  shipmentId: string;
  orderId: string;
  bookingReference: string;
  trackingNumber: string;
  status: NpShopTrackingStatus;
  occurredAt: string;
  signedAt: string;
}

export interface NpShopTrackingWebhookInput {
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string>>;
  receivedAt: string;
}

export interface NpShopIgnoredTrackingWebhook {
  contract: typeof NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT;
  ignored: true;
  reason: "unsupported-event";
}

export type NpShopTrackingWebhookResult =
  NpShopVerifiedTrackingEvent | NpShopIgnoredTrackingWebhook | null;

export interface NpShopTracking {
  contract: typeof NP_SHOP_TRACKING_CONTRACT;
  shipmentId: string;
  status: NpShopTrackingStatus;
  occurredAt: string;
  deliveredAt: string | null;
  updatedAt: string;
}

export interface NpShopStoredTracking {
  contract: typeof NP_SHOP_TRACKING_STORAGE_CONTRACT;
  orderId: string;
  shipmentId: string;
  providerId: string;
  bookingReference: string;
  trackingNumber: string;
  status: NpShopTrackingStatus;
  latestEventId: string;
  occurredAt: string;
  deliveredAt: string | null;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopStoredTrackingReceipt {
  contract: typeof NP_SHOP_TRACKING_RECEIPT_CONTRACT;
  providerId: string;
  event: NpShopVerifiedTrackingEvent;
  eventDigest: string;
  outcome: NpShopTrackingReceiptOutcome;
  trackingStatus: NpShopTrackingStatus;
  processedAt: string;
  purgeAt: string;
}

export class NpShopTrackingContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopTrackingContractError";
    this.issues = issues;
  }
}

export class NpShopTrackingVerificationError extends Error {
  constructor(message = "The carrier tracking callback signature is invalid.") {
    super(message);
    this.name = "NpShopTrackingVerificationError";
  }
}

export class NpShopTrackingConflictError extends Error {
  readonly code:
    | "tracking_event_conflict"
    | "tracking_booking_not_found"
    | "tracking_shipment_expired"
    | "tracking_provider_mismatch"
    | "tracking_shipment_mismatch"
    | "tracking_fulfillment_mismatch";

  constructor(code: NpShopTrackingConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopTrackingConflictError";
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

function isOpaqueReference(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    value.trim() === value &&
    opaqueReferencePattern.test(value)
  );
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

export function npRequireShopTrackingProviderId(value: unknown): string {
  if (typeof value !== "string" || !providerIdPattern.test(value)) {
    throw new NpShopTrackingContractError("Invalid Shop tracking provider id", [
      "tracking provider id must be a lowercase segment of at most 32 characters.",
    ]);
  }
  return value;
}

const eventKeys = [
  "contract",
  "eventId",
  "shipmentId",
  "orderId",
  "bookingReference",
  "trackingNumber",
  "status",
  "occurredAt",
  "signedAt",
] as const;

export function npAnalyzeShopTrackingEvent(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["tracking event must be a plain object."];
  exactKeys(value, eventKeys, "tracking event", issues);
  if (value.contract !== NP_SHOP_TRACKING_EVENT_CONTRACT) {
    issues.push(`tracking event.contract must equal "${NP_SHOP_TRACKING_EVENT_CONTRACT}".`);
  }
  if (!isOpaqueReference(value.eventId, npShopTrackingLimits.eventIdLength)) {
    issues.push("tracking event.eventId is invalid.");
  }
  if (typeof value.shipmentId !== "string" || !canonicalUuidPattern.test(value.shipmentId)) {
    issues.push("tracking event.shipmentId is invalid.");
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("tracking event.orderId is invalid.");
  }
  if (!isOpaqueReference(value.bookingReference, npShopTrackingLimits.referenceLength)) {
    issues.push("tracking event.bookingReference is invalid.");
  }
  if (!isBoundedText(value.trackingNumber, npShopTrackingLimits.trackingNumberLength)) {
    issues.push("tracking event.trackingNumber is invalid.");
  }
  if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("tracking event.status is invalid.");
  }
  if (!isCanonicalIso(value.occurredAt)) issues.push("tracking event.occurredAt is invalid.");
  if (!isCanonicalIso(value.signedAt)) issues.push("tracking event.signedAt is invalid.");
  return issues;
}

export function npRequireFreshShopTrackingEvent(
  value: unknown,
  receivedAt: Date,
): NpShopVerifiedTrackingEvent {
  const issues = npAnalyzeShopTrackingEvent(value);
  if (issues.length === 0) {
    const event = value as NpShopVerifiedTrackingEvent;
    const signedDelta = receivedAt.getTime() - new Date(event.signedAt).getTime();
    const eventDelay = new Date(event.signedAt).getTime() - new Date(event.occurredAt).getTime();
    if (
      signedDelta < -npShopTrackingLimits.futureToleranceSeconds * 1_000 ||
      signedDelta > npShopTrackingLimits.replayWindowSeconds * 1_000
    ) {
      issues.push("tracking event.signedAt is outside the callback replay window.");
    }
    if (
      eventDelay < -npShopTrackingLimits.futureToleranceSeconds * 1_000 ||
      eventDelay > npShopTrackingLimits.maximumEventDelaySeconds * 1_000
    ) {
      issues.push("tracking event.occurredAt is outside the bounded provider delay window.");
    }
  }
  if (issues.length > 0) {
    throw new NpShopTrackingContractError("Invalid verified Shop tracking event", issues);
  }
  return Object.freeze({ ...(value as NpShopVerifiedTrackingEvent) });
}

export function npIsIgnoredTrackingWebhook(value: unknown): value is NpShopIgnoredTrackingWebhook {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.contract === NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT &&
    value.ignored === true &&
    value.reason === "unsupported-event"
  );
}

export function npShopTrackingEventDigest(event: NpShopVerifiedTrackingEvent): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        contract: event.contract,
        eventId: event.eventId,
        shipmentId: event.shipmentId,
        orderId: event.orderId,
        bookingReference: event.bookingReference,
        trackingNumber: event.trackingNumber,
        status: event.status,
        occurredAt: event.occurredAt,
      }),
    )
    .digest("hex");
}

export function npShopTrackingReceiptStorageKey(providerId: string, eventId: string): string {
  npRequireShopTrackingProviderId(providerId);
  if (!isOpaqueReference(eventId, npShopTrackingLimits.eventIdLength)) {
    throw new NpShopTrackingContractError("Invalid Shop tracking event id", [
      "tracking event id is invalid.",
    ]);
  }
  return `tracking-event:${providerId}:${createHash("sha256").update(eventId).digest("hex")}`;
}

export function npShopTrackingStorageKey(orderId: string): string {
  if (!canonicalUuidPattern.test(orderId)) {
    throw new NpShopTrackingContractError("Invalid Shop tracking order id", [
      "tracking order id is invalid.",
    ]);
  }
  return `tracking:${orderId}`;
}

const storedKeys = [
  "contract",
  "orderId",
  "shipmentId",
  "providerId",
  "bookingReference",
  "trackingNumber",
  "status",
  "latestEventId",
  "occurredAt",
  "deliveredAt",
  "updatedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopTracking(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["tracking state must be a plain object."];
  exactKeys(value, storedKeys, "tracking state", issues);
  if (value.contract !== NP_SHOP_TRACKING_STORAGE_CONTRACT) {
    issues.push(`tracking state.contract must equal "${NP_SHOP_TRACKING_STORAGE_CONTRACT}".`);
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("tracking state.orderId is invalid.");
  }
  if (typeof value.shipmentId !== "string" || !canonicalUuidPattern.test(value.shipmentId)) {
    issues.push("tracking state.shipmentId is invalid.");
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("tracking state.providerId is invalid.");
  }
  if (!isOpaqueReference(value.bookingReference, npShopTrackingLimits.referenceLength)) {
    issues.push("tracking state.bookingReference is invalid.");
  }
  if (!isBoundedText(value.trackingNumber, npShopTrackingLimits.trackingNumberLength)) {
    issues.push("tracking state.trackingNumber is invalid.");
  }
  if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("tracking state.status is invalid.");
  }
  if (!isOpaqueReference(value.latestEventId, npShopTrackingLimits.eventIdLength)) {
    issues.push("tracking state.latestEventId is invalid.");
  }
  for (const key of ["occurredAt", "updatedAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`tracking state.${key} is invalid.`);
  }
  if (value.deliveredAt !== null && !isCanonicalIso(value.deliveredAt)) {
    issues.push("tracking state.deliveredAt is invalid.");
  }
  if (
    (value.status === "delivered") !== (value.deliveredAt !== null) ||
    (isCanonicalIso(value.deliveredAt) && value.deliveredAt !== value.occurredAt)
  ) {
    issues.push("delivered tracking state requires deliveredAt equal to occurredAt.");
  }
  return issues;
}

export function npRequireStoredShopTracking(value: unknown): NpShopStoredTracking {
  const issues = npAnalyzeStoredShopTracking(value);
  if (issues.length > 0) throw new NpShopTrackingContractError("Invalid stored tracking", issues);
  return value as NpShopStoredTracking;
}

const receiptKeys = [
  "contract",
  "providerId",
  "event",
  "eventDigest",
  "outcome",
  "trackingStatus",
  "processedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopTrackingReceipt(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["tracking receipt must be a plain object."];
  exactKeys(value, receiptKeys, "tracking receipt", issues);
  if (value.contract !== NP_SHOP_TRACKING_RECEIPT_CONTRACT) {
    issues.push(`tracking receipt.contract must equal "${NP_SHOP_TRACKING_RECEIPT_CONTRACT}".`);
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("tracking receipt.providerId is invalid.");
  }
  issues.push(...npAnalyzeShopTrackingEvent(value.event));
  if (typeof value.eventDigest !== "string" || !digestPattern.test(value.eventDigest)) {
    issues.push("tracking receipt.eventDigest is invalid.");
  } else if (isRecord(value.event)) {
    try {
      if (
        npShopTrackingEventDigest(value.event as unknown as NpShopVerifiedTrackingEvent) !==
        value.eventDigest
      ) {
        issues.push("tracking receipt.eventDigest must match its canonical event.");
      }
    } catch {
      issues.push("tracking receipt.eventDigest must match a valid event.");
    }
  }
  if (!(npShopTrackingReceiptOutcomes as readonly unknown[]).includes(value.outcome)) {
    issues.push("tracking receipt.outcome is invalid.");
  }
  if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.trackingStatus)) {
    issues.push("tracking receipt.trackingStatus is invalid.");
  }
  if (!isCanonicalIso(value.processedAt)) issues.push("tracking receipt.processedAt is invalid.");
  if (!isCanonicalIso(value.purgeAt)) issues.push("tracking receipt.purgeAt is invalid.");
  return issues;
}

export function npRequireStoredShopTrackingReceipt(value: unknown): NpShopStoredTrackingReceipt {
  const issues = npAnalyzeStoredShopTrackingReceipt(value);
  if (issues.length > 0) {
    throw new NpShopTrackingContractError("Invalid stored tracking receipt", issues);
  }
  return value as NpShopStoredTrackingReceipt;
}

export function npProjectShopTracking(value: NpShopStoredTracking): NpShopTracking {
  npRequireStoredShopTracking(value);
  return {
    contract: NP_SHOP_TRACKING_CONTRACT,
    shipmentId: value.shipmentId,
    status: value.status,
    occurredAt: value.occurredAt,
    deliveredAt: value.deliveredAt,
    updatedAt: value.updatedAt,
  };
}

export function npAnalyzeShopTracking(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["tracking must be a plain object."];
  exactKeys(
    value,
    ["contract", "shipmentId", "status", "occurredAt", "deliveredAt", "updatedAt"],
    "tracking",
    issues,
  );
  if (value.contract !== NP_SHOP_TRACKING_CONTRACT) {
    issues.push(`tracking.contract must equal "${NP_SHOP_TRACKING_CONTRACT}".`);
  }
  if (typeof value.shipmentId !== "string" || !canonicalUuidPattern.test(value.shipmentId)) {
    issues.push("tracking.shipmentId is invalid.");
  }
  if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("tracking.status is invalid.");
  }
  for (const key of ["occurredAt", "updatedAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`tracking.${key} is invalid.`);
  }
  if (value.deliveredAt !== null && !isCanonicalIso(value.deliveredAt)) {
    issues.push("tracking.deliveredAt is invalid.");
  }
  if ((value.status === "delivered") !== (value.deliveredAt !== null)) {
    issues.push("delivered tracking requires deliveredAt.");
  }
  return issues;
}
