import { createHash } from "node:crypto";

export const NP_SHOP_TRACKING_EVENT_CONTRACT = "np.shop-tracking-event.v1" as const;
export const NP_SHOP_TRACKING_RECEIPT_CONTRACT = "np.shop-tracking-receipt.v1" as const;
export const NP_SHOP_TRACKING_STORAGE_CONTRACT = "np.shop-tracking-storage.v1" as const;
export const NP_SHOP_TRACKING_CONTRACT = "np.shop-tracking.v1" as const;
export const NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT =
  "np.shop-tracking-webhook-ignored.v1" as const;
export const NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT = "np.shop-tracking-poll-request.v1" as const;
export const NP_SHOP_TRACKING_POLL_RESULT_CONTRACT = "np.shop-tracking-poll-result.v1" as const;
export const NP_SHOP_TRACKING_POLL_STORAGE_CONTRACT = "np.shop-tracking-poll-storage.v1" as const;
export const NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT = "np.shop-tracking-poll-cursor.v1" as const;

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
  reconcileBatchSize: 25,
  reconcileScanSize: 100,
  reconcileMaximumScanSize: 500,
  pollIntervalSeconds: 10 * 60,
  pollLeaseSeconds: 5 * 60,
  pollInitialBackoffSeconds: 5 * 60,
  pollMaximumBackoffSeconds: 6 * 60 * 60,
  maximumConsecutiveFailures: 16,
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

export interface NpShopTrackingPollCurrent {
  eventId: string;
  status: NpShopTrackingStatus;
  occurredAt: string;
}

export interface NpShopTrackingPollRequest {
  contract: typeof NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT;
  shipmentId: string;
  orderId: string;
  bookingReference: string;
  trackingNumber: string;
  current: NpShopTrackingPollCurrent | null;
  requestedAt: string;
}

export interface NpShopTrackingPollResult {
  contract: typeof NP_SHOP_TRACKING_POLL_RESULT_CONTRACT;
  shipmentId: string;
  orderId: string;
  checkedAt: string;
  event: NpShopVerifiedTrackingEvent | null;
}

export const npShopTrackingPollErrorCodes = [
  "provider-error",
  "invalid-result",
  "state-conflict",
] as const;
export type NpShopTrackingPollErrorCode = (typeof npShopTrackingPollErrorCodes)[number];

export interface NpShopStoredTrackingPoll {
  contract: typeof NP_SHOP_TRACKING_POLL_STORAGE_CONTRACT;
  orderId: string;
  shipmentId: string;
  providerId: string;
  consecutiveFailures: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextAttemptAt: string;
  lastErrorCode: NpShopTrackingPollErrorCode | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopTrackingPollCursor {
  contract: typeof NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT;
  providerId: string;
  lastBookingKey: string | null;
  updatedAt: string;
}

export interface NpShopTrackingReconcileActionInput {
  orderId: string;
  shipmentId: string;
}

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

function isNonNegativeSafeInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
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

const pollCurrentKeys = ["eventId", "status", "occurredAt"] as const;
const pollRequestKeys = [
  "contract",
  "shipmentId",
  "orderId",
  "bookingReference",
  "trackingNumber",
  "current",
  "requestedAt",
] as const;

export function npAnalyzeShopTrackingPollRequest(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["tracking poll request must be a plain object."];
  exactKeys(value, pollRequestKeys, "tracking poll request", issues);
  if (value.contract !== NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT) {
    issues.push(
      `tracking poll request.contract must equal "${NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT}".`,
    );
  }
  if (typeof value.shipmentId !== "string" || !canonicalUuidPattern.test(value.shipmentId)) {
    issues.push("tracking poll request.shipmentId is invalid.");
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("tracking poll request.orderId is invalid.");
  }
  if (!isOpaqueReference(value.bookingReference, npShopTrackingLimits.referenceLength)) {
    issues.push("tracking poll request.bookingReference is invalid.");
  }
  if (!isBoundedText(value.trackingNumber, npShopTrackingLimits.trackingNumberLength)) {
    issues.push("tracking poll request.trackingNumber is invalid.");
  }
  if (value.current !== null) {
    if (!isRecord(value.current)) {
      issues.push("tracking poll request.current must be null or a plain object.");
    } else {
      exactKeys(value.current, pollCurrentKeys, "tracking poll request.current", issues);
      if (!isOpaqueReference(value.current.eventId, npShopTrackingLimits.eventIdLength)) {
        issues.push("tracking poll request.current.eventId is invalid.");
      }
      if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.current.status)) {
        issues.push("tracking poll request.current.status is invalid.");
      }
      if (!isCanonicalIso(value.current.occurredAt)) {
        issues.push("tracking poll request.current.occurredAt is invalid.");
      }
    }
  }
  if (!isCanonicalIso(value.requestedAt)) {
    issues.push("tracking poll request.requestedAt is invalid.");
  }
  return issues;
}

export function npRequireShopTrackingPollRequest(value: unknown): NpShopTrackingPollRequest {
  const issues = npAnalyzeShopTrackingPollRequest(value);
  if (issues.length > 0) {
    throw new NpShopTrackingContractError("Invalid Shop tracking poll request", issues);
  }
  return Object.freeze({ ...(value as NpShopTrackingPollRequest) });
}

const pollResultKeys = ["contract", "shipmentId", "orderId", "checkedAt", "event"] as const;

export function npRequireShopTrackingPollResult(
  value: unknown,
  context: { request: NpShopTrackingPollRequest; receivedAt: Date },
): NpShopTrackingPollResult {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopTrackingContractError("Invalid Shop tracking poll result", [
      "tracking poll result must be a plain object.",
    ]);
  }
  exactKeys(value, pollResultKeys, "tracking poll result", issues);
  if (value.contract !== NP_SHOP_TRACKING_POLL_RESULT_CONTRACT) {
    issues.push(
      `tracking poll result.contract must equal "${NP_SHOP_TRACKING_POLL_RESULT_CONTRACT}".`,
    );
  }
  if (value.shipmentId !== context.request.shipmentId) {
    issues.push("tracking poll result.shipmentId must match the request.");
  }
  if (value.orderId !== context.request.orderId) {
    issues.push("tracking poll result.orderId must match the request.");
  }
  if (!isCanonicalIso(value.checkedAt)) {
    issues.push("tracking poll result.checkedAt is invalid.");
  } else {
    const checkedAt = new Date(value.checkedAt).getTime();
    if (
      checkedAt < new Date(context.request.requestedAt).getTime() ||
      checkedAt > context.receivedAt.getTime() + npShopTrackingLimits.futureToleranceSeconds * 1_000
    ) {
      issues.push("tracking poll result.checkedAt is outside the request window.");
    }
  }
  if (value.event !== null) {
    try {
      const event = npRequireFreshShopTrackingEvent(value.event, context.receivedAt);
      if (
        event.shipmentId !== context.request.shipmentId ||
        event.orderId !== context.request.orderId ||
        event.bookingReference !== context.request.bookingReference ||
        event.trackingNumber !== context.request.trackingNumber
      ) {
        issues.push("tracking poll result.event must match the exact shipment request.");
      }
      if (event.signedAt !== value.checkedAt) {
        issues.push("tracking poll result.event.signedAt must equal checkedAt.");
      }
    } catch (error) {
      if (error instanceof NpShopTrackingContractError) issues.push(...error.issues);
      else issues.push("tracking poll result.event is invalid.");
    }
  }
  if (issues.length > 0) {
    throw new NpShopTrackingContractError("Invalid Shop tracking poll result", issues);
  }
  return Object.freeze({ ...(value as unknown as NpShopTrackingPollResult) });
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

export function npShopTrackingPollStorageKey(orderId: string): string {
  if (!canonicalUuidPattern.test(orderId)) {
    throw new NpShopTrackingContractError("Invalid Shop tracking poll order id", [
      "tracking poll order id is invalid.",
    ]);
  }
  return `tracking-poll:${orderId}`;
}

export const NP_SHOP_TRACKING_POLL_CURSOR_KEY = "tracking-poll-cursor" as const;

const storedPollKeys = [
  "contract",
  "orderId",
  "shipmentId",
  "providerId",
  "consecutiveFailures",
  "lastAttemptAt",
  "lastSuccessAt",
  "nextAttemptAt",
  "lastErrorCode",
  "leaseId",
  "leaseExpiresAt",
  "updatedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopTrackingPoll(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["tracking poll state must be a plain object."];
  exactKeys(value, storedPollKeys, "tracking poll state", issues);
  if (value.contract !== NP_SHOP_TRACKING_POLL_STORAGE_CONTRACT) {
    issues.push(
      `tracking poll state.contract must equal "${NP_SHOP_TRACKING_POLL_STORAGE_CONTRACT}".`,
    );
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("tracking poll state.orderId is invalid.");
  }
  if (typeof value.shipmentId !== "string" || !canonicalUuidPattern.test(value.shipmentId)) {
    issues.push("tracking poll state.shipmentId is invalid.");
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("tracking poll state.providerId is invalid.");
  }
  if (
    !isNonNegativeSafeInteger(
      value.consecutiveFailures,
      npShopTrackingLimits.maximumConsecutiveFailures,
    )
  ) {
    issues.push("tracking poll state.consecutiveFailures is invalid.");
  }
  for (const key of ["lastAttemptAt", "lastSuccessAt"] as const) {
    if (value[key] !== null && !isCanonicalIso(value[key])) {
      issues.push(`tracking poll state.${key} is invalid.`);
    }
  }
  for (const key of ["nextAttemptAt", "updatedAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`tracking poll state.${key} is invalid.`);
  }
  if (
    value.lastErrorCode !== null &&
    !(npShopTrackingPollErrorCodes as readonly unknown[]).includes(value.lastErrorCode)
  ) {
    issues.push("tracking poll state.lastErrorCode is invalid.");
  }
  if (
    (value.consecutiveFailures === 0) !== (value.lastErrorCode === null) ||
    (value.consecutiveFailures === 0 &&
      value.lastAttemptAt !== null &&
      value.lastSuccessAt === null &&
      value.leaseId === null)
  ) {
    issues.push("tracking poll state failure and success metadata is inconsistent.");
  }
  if ((value.leaseId === null) !== (value.leaseExpiresAt === null)) {
    issues.push("tracking poll state lease fields must be both null or both present.");
  }
  if (
    value.leaseId !== null &&
    (typeof value.leaseId !== "string" || !canonicalUuidPattern.test(value.leaseId))
  ) {
    issues.push("tracking poll state.leaseId is invalid.");
  }
  if (value.leaseExpiresAt !== null && !isCanonicalIso(value.leaseExpiresAt)) {
    issues.push("tracking poll state.leaseExpiresAt is invalid.");
  }
  if (value.lastAttemptAt === null) {
    issues.push("tracking poll state.lastAttemptAt is required.");
  }
  if (
    isCanonicalIso(value.lastAttemptAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.lastAttemptAt) > new Date(value.updatedAt)
  ) {
    issues.push("tracking poll state.lastAttemptAt cannot follow updatedAt.");
  }
  if (
    isCanonicalIso(value.lastSuccessAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.lastSuccessAt) > new Date(value.updatedAt)
  ) {
    issues.push("tracking poll state.lastSuccessAt cannot follow updatedAt.");
  }
  if (
    isCanonicalIso(value.nextAttemptAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.nextAttemptAt) < new Date(value.updatedAt)
  ) {
    issues.push("tracking poll state.nextAttemptAt cannot precede updatedAt.");
  }
  if (
    isCanonicalIso(value.updatedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.updatedAt) > new Date(value.purgeAt)
  ) {
    issues.push("tracking poll state.updatedAt cannot follow purgeAt.");
  }
  if (
    value.leaseId !== null &&
    (value.lastAttemptAt !== value.updatedAt || value.nextAttemptAt !== value.leaseExpiresAt)
  ) {
    issues.push(
      "leased tracking poll state requires lastAttemptAt equal to updatedAt and nextAttemptAt equal to leaseExpiresAt.",
    );
  }
  if (
    isCanonicalIso(value.leaseExpiresAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.leaseExpiresAt) <= new Date(value.updatedAt)
  ) {
    issues.push("tracking poll state.leaseExpiresAt must follow updatedAt.");
  }
  return issues;
}

export function npRequireStoredShopTrackingPoll(value: unknown): NpShopStoredTrackingPoll {
  const issues = npAnalyzeStoredShopTrackingPoll(value);
  if (issues.length > 0) {
    throw new NpShopTrackingContractError("Invalid stored Shop tracking poll", issues);
  }
  return value as NpShopStoredTrackingPoll;
}

const pollCursorKeys = ["contract", "providerId", "lastBookingKey", "updatedAt"] as const;

export function npRequireShopTrackingPollCursor(value: unknown): NpShopTrackingPollCursor {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopTrackingContractError("Invalid Shop tracking poll cursor", [
      "tracking poll cursor must be a plain object.",
    ]);
  }
  exactKeys(value, pollCursorKeys, "tracking poll cursor", issues);
  if (value.contract !== NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT) {
    issues.push(
      `tracking poll cursor.contract must equal "${NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT}".`,
    );
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("tracking poll cursor.providerId is invalid.");
  }
  if (
    value.lastBookingKey !== null &&
    (typeof value.lastBookingKey !== "string" ||
      !value.lastBookingKey.startsWith("carrier-booking:") ||
      !canonicalUuidPattern.test(value.lastBookingKey.slice("carrier-booking:".length)))
  ) {
    issues.push("tracking poll cursor.lastBookingKey is invalid.");
  }
  if (!isCanonicalIso(value.updatedAt)) issues.push("tracking poll cursor.updatedAt is invalid.");
  if (issues.length > 0) {
    throw new NpShopTrackingContractError("Invalid Shop tracking poll cursor", issues);
  }
  return value as unknown as NpShopTrackingPollCursor;
}

export function npShopTrackingPollBackoffSeconds(consecutiveFailures: number): number {
  if (
    !Number.isSafeInteger(consecutiveFailures) ||
    consecutiveFailures < 1 ||
    consecutiveFailures > npShopTrackingLimits.maximumConsecutiveFailures
  ) {
    throw new NpShopTrackingContractError("Invalid Shop tracking poll failure count", [
      "tracking poll failure count is outside bounds.",
    ]);
  }
  return Math.min(
    npShopTrackingLimits.pollInitialBackoffSeconds * 2 ** (consecutiveFailures - 1),
    npShopTrackingLimits.pollMaximumBackoffSeconds,
  );
}

export function npRequireShopTrackingReconcileActionInput(
  value: unknown,
): NpShopTrackingReconcileActionInput {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopTrackingContractError("Invalid Shop tracking reconcile action", [
      "payload must be a plain object.",
    ]);
  }
  exactKeys(value, ["row", "values"], "payload", issues);
  const row = isRecord(value.row) ? value.row : null;
  const values = isRecord(value.values) ? value.values : null;
  if (!row) issues.push("payload.row must be a plain object.");
  if (!values) issues.push("payload.values must be a plain object.");
  if (row) {
    exactKeys(row, ["id", "shipmentId"], "payload.row", issues);
    if (typeof row.id !== "string" || !canonicalUuidPattern.test(row.id)) {
      issues.push("payload.row.id is invalid.");
    }
    if (typeof row.shipmentId !== "string" || !canonicalUuidPattern.test(row.shipmentId)) {
      issues.push("payload.row.shipmentId is invalid.");
    }
  }
  if (values) exactKeys(values, [], "payload.values", issues);
  if (issues.length > 0) {
    throw new NpShopTrackingContractError("Invalid Shop tracking reconcile action", issues);
  }
  return { orderId: row?.id as string, shipmentId: row?.shipmentId as string };
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
