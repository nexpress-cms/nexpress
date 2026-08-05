import { createHash } from "node:crypto";

import {
  NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT,
  npShopTrackingPollBackoffSeconds,
  npShopTrackingReceiptOutcomes,
  npShopTrackingStatuses,
  type NpShopIgnoredTrackingWebhook,
  type NpShopTrackingReceiptOutcome,
  type NpShopTrackingStatus,
  type NpShopTrackingWebhookInput,
} from "./tracking-contract.js";

export const NP_SHOP_RETURN_TRACKING_EVENT_CONTRACT = "np.shop-return-tracking-event.v1" as const;
export const NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT =
  "np.shop-return-tracking-receipt.v1" as const;
export const NP_SHOP_RETURN_TRACKING_STORAGE_CONTRACT =
  "np.shop-return-tracking-storage.v1" as const;
export const NP_SHOP_RETURN_TRACKING_CONTRACT = "np.shop-return-tracking.v1" as const;
export const NP_SHOP_RETURN_TRACKING_POLL_REQUEST_CONTRACT =
  "np.shop-return-tracking-poll-request.v1" as const;
export const NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT =
  "np.shop-return-tracking-poll-result.v1" as const;
export const NP_SHOP_RETURN_TRACKING_POLL_STORAGE_CONTRACT =
  "np.shop-return-tracking-poll-storage.v1" as const;
export const NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT =
  "np.shop-return-tracking-poll-cursor.v1" as const;
export const NP_SHOP_RETURN_TRACKING_POLL_CURSOR_KEY = "return-tracking-poll-cursor" as const;

export const npShopReturnTrackingLimits = Object.freeze({
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

export interface NpShopVerifiedReturnTrackingEvent {
  contract: typeof NP_SHOP_RETURN_TRACKING_EVENT_CONTRACT;
  eventId: string;
  logisticsId: string;
  returnId: string;
  orderId: string;
  returnReference: string;
  trackingNumber: string;
  status: NpShopTrackingStatus;
  occurredAt: string;
  signedAt: string;
}

export type NpShopReturnTrackingWebhookResult =
  NpShopVerifiedReturnTrackingEvent | NpShopIgnoredTrackingWebhook | null;

export interface NpShopReturnTrackingPollCurrent {
  eventId: string;
  status: NpShopTrackingStatus;
  occurredAt: string;
}

export interface NpShopReturnTrackingPollRequest {
  contract: typeof NP_SHOP_RETURN_TRACKING_POLL_REQUEST_CONTRACT;
  logisticsId: string;
  returnId: string;
  orderId: string;
  returnReference: string;
  trackingNumber: string;
  current: NpShopReturnTrackingPollCurrent | null;
  requestedAt: string;
}

export interface NpShopReturnTrackingPollResult {
  contract: typeof NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT;
  logisticsId: string;
  returnId: string;
  orderId: string;
  checkedAt: string;
  event: NpShopVerifiedReturnTrackingEvent | null;
}

export const npShopReturnTrackingPollErrorCodes = [
  "provider-error",
  "invalid-result",
  "state-conflict",
] as const;
export type NpShopReturnTrackingPollErrorCode = (typeof npShopReturnTrackingPollErrorCodes)[number];

export interface NpShopStoredReturnTrackingPoll {
  contract: typeof NP_SHOP_RETURN_TRACKING_POLL_STORAGE_CONTRACT;
  orderId: string;
  returnId: string;
  logisticsId: string;
  providerId: string;
  consecutiveFailures: number;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  nextAttemptAt: string;
  lastErrorCode: NpShopReturnTrackingPollErrorCode | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopReturnTrackingPollCursor {
  contract: typeof NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT;
  providerId: string;
  lastLogisticsKey: string | null;
  updatedAt: string;
}

export interface NpShopReturnTrackingReconcileActionInput {
  orderId: string;
  returnId: string;
  logisticsId: string;
}

export interface NpShopReturnTracking {
  contract: typeof NP_SHOP_RETURN_TRACKING_CONTRACT;
  logisticsId: string;
  status: NpShopTrackingStatus;
  occurredAt: string;
  deliveredAt: string | null;
  updatedAt: string;
}

export interface NpShopStoredReturnTracking {
  contract: typeof NP_SHOP_RETURN_TRACKING_STORAGE_CONTRACT;
  orderId: string;
  returnId: string;
  logisticsId: string;
  providerId: string;
  returnReference: string;
  trackingNumber: string;
  status: NpShopTrackingStatus;
  latestEventId: string;
  occurredAt: string;
  deliveredAt: string | null;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopStoredReturnTrackingReceipt {
  contract: typeof NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT;
  providerId: string;
  event: NpShopVerifiedReturnTrackingEvent;
  eventDigest: string;
  outcome: NpShopTrackingReceiptOutcome;
  trackingStatus: NpShopTrackingStatus;
  processedAt: string;
  purgeAt: string;
}

export class NpShopReturnTrackingContractError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopReturnTrackingContractError";
    this.issues = issues;
  }
}

export class NpShopReturnTrackingVerificationError extends Error {
  constructor(message = "The carrier return-tracking callback signature is invalid.") {
    super(message);
    this.name = "NpShopReturnTrackingVerificationError";
  }
}

export class NpShopReturnTrackingConflictError extends Error {
  readonly code:
    | "return_tracking_event_conflict"
    | "return_tracking_logistics_not_found"
    | "return_tracking_expired"
    | "return_tracking_provider_mismatch"
    | "return_tracking_logistics_mismatch"
    | "return_tracking_return_mismatch";
  constructor(code: NpShopReturnTrackingConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopReturnTrackingConflictError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaquePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string) {
  const issues: string[] = [];
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) issues.push(`${path}.${key} is not supported.`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) issues.push(`${path}.${key} is required.`);
  }
  return issues;
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isOpaque(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    value.trim() === value &&
    opaquePattern.test(value)
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

function analyzeCurrent(value: unknown, path: string): string[] {
  if (value === null) return [];
  if (!isRecord(value)) return [`${path} must be null or a plain object.`];
  const issues = exactKeys(value, ["eventId", "status", "occurredAt"], path);
  if (!isOpaque(value.eventId, npShopReturnTrackingLimits.eventIdLength))
    issues.push(`${path}.eventId is invalid.`);
  if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.status))
    issues.push(`${path}.status is invalid.`);
  if (!isIso(value.occurredAt)) issues.push(`${path}.occurredAt is invalid.`);
  return issues;
}

export function npRequireShopReturnTrackingProviderId(value: unknown): string {
  if (typeof value !== "string" || !providerPattern.test(value)) {
    throw new NpShopReturnTrackingContractError("Invalid return-tracking provider id", [
      "provider id must be a lowercase slug with at most 32 characters.",
    ]);
  }
  return value;
}

export function npAnalyzeShopReturnTrackingEvent(value: unknown): string[] {
  if (!isRecord(value)) return ["event must be a plain object."];
  const issues = exactKeys(
    value,
    [
      "contract",
      "eventId",
      "logisticsId",
      "returnId",
      "orderId",
      "returnReference",
      "trackingNumber",
      "status",
      "occurredAt",
      "signedAt",
    ],
    "event",
  );
  if (value.contract !== NP_SHOP_RETURN_TRACKING_EVENT_CONTRACT)
    issues.push(`event.contract must equal "${NP_SHOP_RETURN_TRACKING_EVENT_CONTRACT}".`);
  if (!isOpaque(value.eventId, npShopReturnTrackingLimits.eventIdLength))
    issues.push("event.eventId is invalid.");
  for (const field of ["logisticsId", "returnId", "orderId"] as const) {
    if (!isUuid(value[field])) issues.push(`event.${field} is invalid.`);
  }
  if (!isOpaque(value.returnReference, npShopReturnTrackingLimits.referenceLength))
    issues.push("event.returnReference is invalid.");
  if (!isBoundedText(value.trackingNumber, npShopReturnTrackingLimits.trackingNumberLength))
    issues.push("event.trackingNumber is invalid.");
  if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.status))
    issues.push("event.status is invalid.");
  if (!isIso(value.occurredAt)) issues.push("event.occurredAt is invalid.");
  if (!isIso(value.signedAt)) issues.push("event.signedAt is invalid.");
  return issues;
}

export function npRequireFreshShopReturnTrackingEvent(
  value: unknown,
  receivedAt: Date,
): NpShopVerifiedReturnTrackingEvent {
  const issues = npAnalyzeShopReturnTrackingEvent(value);
  if (issues.length)
    throw new NpShopReturnTrackingContractError("Invalid Shop return-tracking event", issues);
  const event = value as NpShopVerifiedReturnTrackingEvent;
  const signedAt = new Date(event.signedAt).getTime();
  const occurredAt = new Date(event.occurredAt).getTime();
  const received = receivedAt.getTime();
  if (
    signedAt < received - npShopReturnTrackingLimits.replayWindowSeconds * 1_000 ||
    signedAt > received + npShopReturnTrackingLimits.futureToleranceSeconds * 1_000
  ) {
    throw new NpShopReturnTrackingContractError("Stale Shop return-tracking event", [
      "event.signedAt is outside the replay window.",
    ]);
  }
  if (
    occurredAt > signedAt + npShopReturnTrackingLimits.futureToleranceSeconds * 1_000 ||
    occurredAt < signedAt - npShopReturnTrackingLimits.maximumEventDelaySeconds * 1_000
  ) {
    throw new NpShopReturnTrackingContractError("Invalid Shop return-tracking event time", [
      "event.occurredAt is outside the accepted provider-event window.",
    ]);
  }
  return Object.freeze({ ...event });
}

export function npIsIgnoredReturnTrackingWebhook(
  value: unknown,
): value is NpShopIgnoredTrackingWebhook {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.contract === NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT &&
    value.ignored === true &&
    value.reason === "unsupported-event"
  );
}

export function npRequireShopReturnTrackingPollRequest(
  value: unknown,
): NpShopReturnTrackingPollRequest {
  if (!isRecord(value))
    throw new NpShopReturnTrackingContractError("Invalid return-tracking poll request", [
      "request must be a plain object.",
    ]);
  const issues = exactKeys(
    value,
    [
      "contract",
      "logisticsId",
      "returnId",
      "orderId",
      "returnReference",
      "trackingNumber",
      "current",
      "requestedAt",
    ],
    "request",
  );
  if (value.contract !== NP_SHOP_RETURN_TRACKING_POLL_REQUEST_CONTRACT)
    issues.push(`request.contract must equal "${NP_SHOP_RETURN_TRACKING_POLL_REQUEST_CONTRACT}".`);
  for (const field of ["logisticsId", "returnId", "orderId"] as const) {
    if (!isUuid(value[field])) issues.push(`request.${field} is invalid.`);
  }
  if (!isOpaque(value.returnReference, npShopReturnTrackingLimits.referenceLength))
    issues.push("request.returnReference is invalid.");
  if (!isBoundedText(value.trackingNumber, npShopReturnTrackingLimits.trackingNumberLength))
    issues.push("request.trackingNumber is invalid.");
  issues.push(...analyzeCurrent(value.current, "request.current"));
  if (!isIso(value.requestedAt)) issues.push("request.requestedAt is invalid.");
  if (issues.length)
    throw new NpShopReturnTrackingContractError("Invalid return-tracking poll request", issues);
  return Object.freeze({ ...(value as unknown as NpShopReturnTrackingPollRequest) });
}

export function npRequireShopReturnTrackingPollResult(
  value: unknown,
  context: { request: NpShopReturnTrackingPollRequest; receivedAt: Date },
): NpShopReturnTrackingPollResult {
  if (!isRecord(value))
    throw new NpShopReturnTrackingContractError("Invalid return-tracking poll result", [
      "result must be a plain object.",
    ]);
  const issues = exactKeys(
    value,
    ["contract", "logisticsId", "returnId", "orderId", "checkedAt", "event"],
    "result",
  );
  if (value.contract !== NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT)
    issues.push(`result.contract must equal "${NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT}".`);
  for (const field of ["logisticsId", "returnId", "orderId"] as const) {
    if (value[field] !== context.request[field]) issues.push(`result.${field} must match request.`);
  }
  if (!isIso(value.checkedAt)) issues.push("result.checkedAt is invalid.");
  if (isIso(value.checkedAt)) {
    const checked = new Date(value.checkedAt).getTime();
    const requested = new Date(context.request.requestedAt).getTime();
    if (
      checked < requested ||
      checked >
        context.receivedAt.getTime() + npShopReturnTrackingLimits.futureToleranceSeconds * 1_000
    )
      issues.push("result.checkedAt is outside the live request window.");
  }
  if (value.event !== null) {
    issues.push(...npAnalyzeShopReturnTrackingEvent(value.event));
    if (isRecord(value.event)) {
      for (const field of ["logisticsId", "returnId", "orderId"] as const) {
        if (value.event[field] !== context.request[field])
          issues.push(`result.event.${field} must match request.`);
      }
      if (value.event.returnReference !== context.request.returnReference)
        issues.push("result.event.returnReference must match request.");
      if (value.event.trackingNumber !== context.request.trackingNumber)
        issues.push("result.event.trackingNumber must match request.");
      if (value.event.signedAt !== value.checkedAt)
        issues.push("result.event.signedAt must equal checkedAt.");
      if (isIso(value.event.occurredAt) && isIso(value.checkedAt)) {
        const occurred = new Date(value.event.occurredAt).getTime();
        const checked = new Date(value.checkedAt).getTime();
        if (
          occurred > checked + npShopReturnTrackingLimits.futureToleranceSeconds * 1_000 ||
          occurred < checked - npShopReturnTrackingLimits.maximumEventDelaySeconds * 1_000
        )
          issues.push("result.event.occurredAt is outside the provider-event window.");
      }
    }
  }
  if (issues.length)
    throw new NpShopReturnTrackingContractError("Invalid return-tracking poll result", issues);
  return Object.freeze({ ...(value as unknown as NpShopReturnTrackingPollResult) });
}

export function npShopReturnTrackingEventDigest(event: NpShopVerifiedReturnTrackingEvent): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        event.contract,
        event.eventId,
        event.logisticsId,
        event.returnId,
        event.orderId,
        event.returnReference,
        event.trackingNumber,
        event.status,
        event.occurredAt,
      ]),
    )
    .digest("hex");
}

export function npShopReturnTrackingReceiptStorageKey(providerId: string, eventId: string): string {
  npRequireShopReturnTrackingProviderId(providerId);
  if (!isOpaque(eventId, npShopReturnTrackingLimits.eventIdLength)) {
    throw new NpShopReturnTrackingContractError("Invalid return-tracking event id", [
      "event id is invalid.",
    ]);
  }
  return `return-tracking-event:${providerId}:${createHash("sha256").update(eventId).digest("hex")}`;
}
export function npShopReturnTrackingStorageKey(orderId: string): string {
  if (!isUuid(orderId)) {
    throw new NpShopReturnTrackingContractError("Invalid return-tracking order id", [
      "order id is invalid.",
    ]);
  }
  return `return-tracking:${orderId}`;
}
export function npShopReturnTrackingPollStorageKey(orderId: string): string {
  if (!isUuid(orderId)) {
    throw new NpShopReturnTrackingContractError("Invalid return-tracking poll order id", [
      "order id is invalid.",
    ]);
  }
  return `return-tracking-poll:${orderId}`;
}

function analyzePoll(value: unknown): string[] {
  if (!isRecord(value)) return ["poll must be a plain object."];
  const issues = exactKeys(
    value,
    [
      "contract",
      "orderId",
      "returnId",
      "logisticsId",
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
    ],
    "poll",
  );
  if (value.contract !== NP_SHOP_RETURN_TRACKING_POLL_STORAGE_CONTRACT)
    issues.push(`poll.contract must equal "${NP_SHOP_RETURN_TRACKING_POLL_STORAGE_CONTRACT}".`);
  for (const field of ["orderId", "returnId", "logisticsId"] as const) {
    if (!isUuid(value[field])) issues.push(`poll.${field} is invalid.`);
  }
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId))
    issues.push("poll.providerId is invalid.");
  if (
    !Number.isSafeInteger(value.consecutiveFailures) ||
    (value.consecutiveFailures as number) < 0 ||
    (value.consecutiveFailures as number) > npShopReturnTrackingLimits.maximumConsecutiveFailures
  )
    issues.push("poll.consecutiveFailures is invalid.");
  for (const field of ["lastAttemptAt", "nextAttemptAt", "updatedAt", "purgeAt"] as const) {
    if (!isIso(value[field])) issues.push(`poll.${field} is invalid.`);
  }
  if (value.lastSuccessAt !== null && !isIso(value.lastSuccessAt))
    issues.push("poll.lastSuccessAt is invalid.");
  if (
    value.lastErrorCode !== null &&
    !(npShopReturnTrackingPollErrorCodes as readonly unknown[]).includes(value.lastErrorCode)
  )
    issues.push("poll.lastErrorCode is invalid.");
  if (value.leaseId !== null && !isUuid(value.leaseId)) issues.push("poll.leaseId is invalid.");
  if (value.leaseExpiresAt !== null && !isIso(value.leaseExpiresAt))
    issues.push("poll.leaseExpiresAt is invalid.");
  if ((value.leaseId === null) !== (value.leaseExpiresAt === null))
    issues.push("poll lease id and expiry must be present together.");
  if (
    (value.consecutiveFailures === 0) !== (value.lastErrorCode === null) ||
    (value.consecutiveFailures === 0 && value.lastSuccessAt === null && value.leaseId === null)
  )
    issues.push("poll failure and success metadata is inconsistent.");
  if (
    isIso(value.lastAttemptAt) &&
    isIso(value.updatedAt) &&
    new Date(value.lastAttemptAt) > new Date(value.updatedAt)
  )
    issues.push("poll.lastAttemptAt cannot follow updatedAt.");
  if (
    isIso(value.lastSuccessAt) &&
    isIso(value.updatedAt) &&
    new Date(value.lastSuccessAt) > new Date(value.updatedAt)
  )
    issues.push("poll.lastSuccessAt cannot follow updatedAt.");
  if (
    isIso(value.nextAttemptAt) &&
    isIso(value.updatedAt) &&
    new Date(value.nextAttemptAt) < new Date(value.updatedAt)
  )
    issues.push("poll.nextAttemptAt cannot precede updatedAt.");
  if (
    isIso(value.updatedAt) &&
    isIso(value.purgeAt) &&
    new Date(value.updatedAt) > new Date(value.purgeAt)
  )
    issues.push("poll.updatedAt cannot follow purgeAt.");
  if (
    value.leaseId !== null &&
    (value.lastAttemptAt !== value.updatedAt || value.nextAttemptAt !== value.leaseExpiresAt)
  )
    issues.push(
      "leased poll state requires lastAttemptAt equal to updatedAt and nextAttemptAt equal to leaseExpiresAt.",
    );
  if (
    isIso(value.leaseExpiresAt) &&
    isIso(value.updatedAt) &&
    new Date(value.leaseExpiresAt) <= new Date(value.updatedAt)
  )
    issues.push("poll.leaseExpiresAt must follow updatedAt.");
  return issues;
}

export function npRequireStoredShopReturnTrackingPoll(
  value: unknown,
): NpShopStoredReturnTrackingPoll {
  const issues = analyzePoll(value);
  if (issues.length)
    throw new NpShopReturnTrackingContractError("Invalid stored return-tracking poll", issues);
  return value as NpShopStoredReturnTrackingPoll;
}

export function npRequireShopReturnTrackingPollCursor(
  value: unknown,
): NpShopReturnTrackingPollCursor {
  if (!isRecord(value))
    throw new NpShopReturnTrackingContractError("Invalid return-tracking poll cursor", [
      "cursor must be a plain object.",
    ]);
  const issues = exactKeys(
    value,
    ["contract", "providerId", "lastLogisticsKey", "updatedAt"],
    "cursor",
  );
  if (value.contract !== NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT)
    issues.push(`cursor.contract must equal "${NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT}".`);
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId))
    issues.push("cursor.providerId is invalid.");
  if (
    value.lastLogisticsKey !== null &&
    (typeof value.lastLogisticsKey !== "string" ||
      !value.lastLogisticsKey.startsWith("return-logistics:"))
  )
    issues.push("cursor.lastLogisticsKey is invalid.");
  if (
    typeof value.lastLogisticsKey === "string" &&
    !isUuid(value.lastLogisticsKey.slice("return-logistics:".length))
  )
    issues.push("cursor.lastLogisticsKey must end with a canonical order id.");
  if (!isIso(value.updatedAt)) issues.push("cursor.updatedAt is invalid.");
  if (issues.length)
    throw new NpShopReturnTrackingContractError("Invalid return-tracking poll cursor", issues);
  return value as unknown as NpShopReturnTrackingPollCursor;
}

export function npShopReturnTrackingPollBackoffSeconds(consecutiveFailures: number): number {
  return npShopTrackingPollBackoffSeconds(consecutiveFailures);
}

export function npRequireShopReturnTrackingReconcileActionInput(
  value: unknown,
): NpShopReturnTrackingReconcileActionInput {
  if (!isRecord(value))
    throw new NpShopReturnTrackingContractError("Invalid return-tracking action", [
      "payload must be a plain object.",
    ]);
  const issues = exactKeys(value, ["row", "values"], "payload");
  const row = isRecord(value.row) ? value.row : null;
  if (!row) issues.push("payload.row must be a plain object.");
  if (isRecord(value.values) && Object.keys(value.values).length !== 0)
    issues.push("payload.values must be empty.");
  else if (!isRecord(value.values)) issues.push("payload.values must be a plain object.");
  if (row) {
    issues.push(...exactKeys(row, ["id", "returnId", "logisticsId"], "payload.row"));
    for (const field of ["id", "returnId", "logisticsId"] as const) {
      if (!isUuid(row[field])) issues.push(`payload.row.${field} is invalid.`);
    }
  }
  if (issues.length)
    throw new NpShopReturnTrackingContractError("Invalid return-tracking action", issues);
  return {
    orderId: row!.id as string,
    returnId: row!.returnId as string,
    logisticsId: row!.logisticsId as string,
  };
}

function analyzeState(value: unknown): string[] {
  if (!isRecord(value)) return ["tracking must be a plain object."];
  const issues = exactKeys(
    value,
    [
      "contract",
      "orderId",
      "returnId",
      "logisticsId",
      "providerId",
      "returnReference",
      "trackingNumber",
      "status",
      "latestEventId",
      "occurredAt",
      "deliveredAt",
      "updatedAt",
      "purgeAt",
    ],
    "tracking",
  );
  if (value.contract !== NP_SHOP_RETURN_TRACKING_STORAGE_CONTRACT)
    issues.push(`tracking.contract must equal "${NP_SHOP_RETURN_TRACKING_STORAGE_CONTRACT}".`);
  for (const field of ["orderId", "returnId", "logisticsId"] as const) {
    if (!isUuid(value[field])) issues.push(`tracking.${field} is invalid.`);
  }
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId))
    issues.push("tracking.providerId is invalid.");
  for (const [field, maximum] of [
    ["returnReference", npShopReturnTrackingLimits.referenceLength],
    ["latestEventId", npShopReturnTrackingLimits.eventIdLength],
  ] as const) {
    if (!isOpaque(value[field], maximum)) issues.push(`tracking.${field} is invalid.`);
  }
  if (!isBoundedText(value.trackingNumber, npShopReturnTrackingLimits.trackingNumberLength))
    issues.push("tracking.trackingNumber is invalid.");
  if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.status))
    issues.push("tracking.status is invalid.");
  for (const field of ["occurredAt", "updatedAt", "purgeAt"] as const) {
    if (!isIso(value[field])) issues.push(`tracking.${field} is invalid.`);
  }
  if (value.deliveredAt !== null && !isIso(value.deliveredAt))
    issues.push("tracking.deliveredAt is invalid.");
  if ((value.status === "delivered") !== (value.deliveredAt !== null))
    issues.push("tracking.deliveredAt must exist exactly for delivered state.");
  if (isIso(value.deliveredAt) && value.deliveredAt !== value.occurredAt)
    issues.push("tracking.deliveredAt must equal occurredAt.");
  return issues;
}

export function npRequireStoredShopReturnTracking(value: unknown): NpShopStoredReturnTracking {
  const issues = analyzeState(value);
  if (issues.length)
    throw new NpShopReturnTrackingContractError("Invalid stored return tracking", issues);
  return value as NpShopStoredReturnTracking;
}

function analyzeReceipt(value: unknown): string[] {
  if (!isRecord(value)) return ["receipt must be a plain object."];
  const issues = exactKeys(
    value,
    [
      "contract",
      "providerId",
      "event",
      "eventDigest",
      "outcome",
      "trackingStatus",
      "processedAt",
      "purgeAt",
    ],
    "receipt",
  );
  if (value.contract !== NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT)
    issues.push(`receipt.contract must equal "${NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT}".`);
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId))
    issues.push("receipt.providerId is invalid.");
  issues.push(...npAnalyzeShopReturnTrackingEvent(value.event));
  if (typeof value.eventDigest !== "string" || !digestPattern.test(value.eventDigest))
    issues.push("receipt.eventDigest is invalid.");
  else if (isRecord(value.event)) {
    try {
      if (
        npShopReturnTrackingEventDigest(
          value.event as unknown as NpShopVerifiedReturnTrackingEvent,
        ) !== value.eventDigest
      )
        issues.push("receipt.eventDigest must match its canonical event.");
    } catch {
      issues.push("receipt.eventDigest must match a valid event.");
    }
  }
  if (!(npShopTrackingReceiptOutcomes as readonly unknown[]).includes(value.outcome))
    issues.push("receipt.outcome is invalid.");
  if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.trackingStatus))
    issues.push("receipt.trackingStatus is invalid.");
  if (!isIso(value.processedAt)) issues.push("receipt.processedAt is invalid.");
  if (!isIso(value.purgeAt)) issues.push("receipt.purgeAt is invalid.");
  return issues;
}

export function npRequireStoredShopReturnTrackingReceipt(
  value: unknown,
): NpShopStoredReturnTrackingReceipt {
  const issues = analyzeReceipt(value);
  if (issues.length)
    throw new NpShopReturnTrackingContractError("Invalid stored return-tracking receipt", issues);
  return value as NpShopStoredReturnTrackingReceipt;
}

export function npProjectShopReturnTracking(
  value: NpShopStoredReturnTracking,
): NpShopReturnTracking {
  npRequireStoredShopReturnTracking(value);
  return {
    contract: NP_SHOP_RETURN_TRACKING_CONTRACT,
    logisticsId: value.logisticsId,
    status: value.status,
    occurredAt: value.occurredAt,
    deliveredAt: value.deliveredAt,
    updatedAt: value.updatedAt,
  };
}

export function npAnalyzeShopReturnTracking(value: unknown): string[] {
  if (!isRecord(value)) return ["return tracking must be a plain object."];
  const issues = exactKeys(
    value,
    ["contract", "logisticsId", "status", "occurredAt", "deliveredAt", "updatedAt"],
    "returnTracking",
  );
  if (value.contract !== NP_SHOP_RETURN_TRACKING_CONTRACT)
    issues.push(`returnTracking.contract must equal "${NP_SHOP_RETURN_TRACKING_CONTRACT}".`);
  if (!isUuid(value.logisticsId)) issues.push("returnTracking.logisticsId is invalid.");
  if (!(npShopTrackingStatuses as readonly unknown[]).includes(value.status))
    issues.push("returnTracking.status is invalid.");
  for (const field of ["occurredAt", "updatedAt"] as const) {
    if (!isIso(value[field])) issues.push(`returnTracking.${field} is invalid.`);
  }
  if (value.deliveredAt !== null && !isIso(value.deliveredAt))
    issues.push("returnTracking.deliveredAt is invalid.");
  if ((value.status === "delivered") !== (value.deliveredAt !== null))
    issues.push("returnTracking.deliveredAt must exist exactly for delivered state.");
  if (isIso(value.deliveredAt) && value.deliveredAt !== value.occurredAt)
    issues.push("returnTracking.deliveredAt must equal occurredAt.");
  return issues;
}

export type { NpShopTrackingWebhookInput };
