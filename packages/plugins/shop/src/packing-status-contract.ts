import { createHash } from "node:crypto";

export const NP_SHOP_PACKING_STATUS_EVENT_CONTRACT = "np.shop-packing-status-event.v1" as const;
export const NP_SHOP_PACKING_STATUS_STORAGE_CONTRACT = "np.shop-packing-status-storage.v1" as const;
export const NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT = "np.shop-packing-status-receipt.v1" as const;
export const NP_SHOP_PACKING_STATUS_WEBHOOK_IGNORED_CONTRACT =
  "np.shop-packing-status-webhook-ignored.v1" as const;
export const NP_SHOP_PACKING_STATUS_POLL_REQUEST_CONTRACT =
  "np.shop-packing-status-poll-request.v1" as const;
export const NP_SHOP_PACKING_STATUS_POLL_RESULT_CONTRACT =
  "np.shop-packing-status-poll-result.v1" as const;
export const NP_SHOP_PACKING_STATUS_POLL_STORAGE_CONTRACT =
  "np.shop-packing-status-poll-storage.v1" as const;
export const NP_SHOP_PACKING_STATUS_POLL_CURSOR_CONTRACT =
  "np.shop-packing-status-poll-cursor.v1" as const;
export const NP_SHOP_PACKING_STATUS_POLL_CURSOR_KEY = "packing-status-poll-cursor" as const;

export const npShopPackingEvidenceStatuses = ["accepted", "picking", "failed", "packed"] as const;
export type NpShopPackingEvidenceStatus = (typeof npShopPackingEvidenceStatuses)[number];

export const npShopPackingStatusReceiptOutcomes = [
  "advanced",
  "ignored-stale",
  "ignored-regression",
  "ignored-terminal",
] as const;
export type NpShopPackingStatusReceiptOutcome = (typeof npShopPackingStatusReceiptOutcomes)[number];

export const npShopPackingStatusLimits = Object.freeze({
  replayWindowSeconds: 5 * 60,
  maximumEventDelaySeconds: 30 * 24 * 60 * 60,
  futureToleranceSeconds: 30,
  providerIdLength: 32,
  eventIdLength: 200,
  providerWorkReferenceLength: 200,
  adminListSize: 50,
  diagnosticSampleSize: 500,
  pollLeaseSeconds: 5 * 60,
  pollIntervalSeconds: 10 * 60,
  pollInitialBackoffSeconds: 5 * 60,
  pollMaximumBackoffSeconds: 6 * 60 * 60,
  pollMaximumConsecutiveFailures: 16,
  pollBatchSize: 25,
  pollScanSize: 100,
  pollMaximumScanSize: 1_000,
});

export type NpShopPackingStatusTargetIdentity =
  | { readonly target: "outbound"; readonly exchangeId: null }
  | { readonly target: "replacement"; readonly exchangeId: string };

export type NpShopVerifiedPackingStatusEvent = NpShopPackingStatusTargetIdentity & {
  readonly contract: typeof NP_SHOP_PACKING_STATUS_EVENT_CONTRACT;
  readonly eventId: string;
  readonly workId: string;
  readonly orderId: string;
  readonly providerWorkReference: string;
  readonly status: NpShopPackingEvidenceStatus;
  readonly occurredAt: string;
  readonly signedAt: string;
};

export interface NpShopPackingStatusWebhookInput {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly receivedAt: string;
}

export interface NpShopIgnoredPackingStatusWebhook {
  readonly contract: typeof NP_SHOP_PACKING_STATUS_WEBHOOK_IGNORED_CONTRACT;
  readonly ignored: true;
  readonly reason: "unsupported-event";
}

export type NpShopPackingStatusWebhookResult =
  NpShopVerifiedPackingStatusEvent | NpShopIgnoredPackingStatusWebhook | null;

export interface NpShopPackingStatusPollCurrent {
  readonly eventId: string;
  readonly status: NpShopPackingEvidenceStatus;
  readonly occurredAt: string;
}

export type NpShopPackingStatusPollRequest = NpShopPackingStatusTargetIdentity & {
  readonly contract: typeof NP_SHOP_PACKING_STATUS_POLL_REQUEST_CONTRACT;
  readonly workId: string;
  readonly orderId: string;
  readonly providerWorkReference: string;
  readonly current: NpShopPackingStatusPollCurrent | null;
  readonly requestedAt: string;
};

export type NpShopPackingStatusPollResult = NpShopPackingStatusTargetIdentity & {
  readonly contract: typeof NP_SHOP_PACKING_STATUS_POLL_RESULT_CONTRACT;
  readonly workId: string;
  readonly orderId: string;
  readonly checkedAt: string;
  readonly event: NpShopVerifiedPackingStatusEvent | null;
};

export const npShopPackingStatusPollErrorCodes = [
  "provider-error",
  "invalid-result",
  "state-conflict",
] as const;
export type NpShopPackingStatusPollErrorCode = (typeof npShopPackingStatusPollErrorCodes)[number];

export type NpShopStoredPackingStatusPoll = NpShopPackingStatusTargetIdentity & {
  readonly contract: typeof NP_SHOP_PACKING_STATUS_POLL_STORAGE_CONTRACT;
  readonly workId: string;
  readonly orderId: string;
  readonly providerId: string;
  readonly providerWorkReference: string;
  readonly consecutiveFailures: number;
  readonly lastAttemptAt: string;
  readonly lastSuccessAt: string | null;
  readonly nextAttemptAt: string;
  readonly lastErrorCode: NpShopPackingStatusPollErrorCode | null;
  readonly leaseId: string | null;
  readonly leaseExpiresAt: string | null;
  readonly updatedAt: string;
  readonly purgeAt: string;
};

export interface NpShopPackingStatusPollCursor {
  readonly contract: typeof NP_SHOP_PACKING_STATUS_POLL_CURSOR_CONTRACT;
  readonly providerId: string;
  readonly lastWorkKey: string | null;
  readonly updatedAt: string;
}

export interface NpShopPackingStatusReconcileActionInput {
  readonly orderId: string;
  readonly workId: string;
  readonly target: "outbound" | "replacement";
  readonly exchangeId: string | null;
}

export type NpShopStoredPackingStatus = NpShopPackingStatusTargetIdentity & {
  readonly contract: typeof NP_SHOP_PACKING_STATUS_STORAGE_CONTRACT;
  readonly providerId: string;
  readonly workId: string;
  readonly orderId: string;
  readonly providerWorkReference: string;
  readonly status: NpShopPackingEvidenceStatus;
  readonly latestEventId: string;
  readonly occurredAt: string;
  readonly packedAt: string | null;
  readonly failedAt: string | null;
  readonly updatedAt: string;
  readonly purgeAt: string;
};

export interface NpShopStoredPackingStatusReceipt {
  readonly contract: typeof NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT;
  readonly providerId: string;
  readonly event: NpShopVerifiedPackingStatusEvent;
  readonly eventDigest: string;
  readonly outcome: NpShopPackingStatusReceiptOutcome;
  readonly packingStatus: NpShopPackingEvidenceStatus;
  readonly processedAt: string;
  readonly purgeAt: string;
}

export class NpShopPackingStatusContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopPackingStatusContractError";
    this.issues = issues;
  }
}

export class NpShopPackingStatusVerificationError extends Error {
  constructor(message = "The packing-work status callback signature is invalid.") {
    super(message);
    this.name = "NpShopPackingStatusVerificationError";
  }
}

export class NpShopPackingStatusConflictError extends Error {
  readonly code:
    | "packing_status_event_conflict"
    | "packing_status_work_not_found"
    | "packing_status_provider_mismatch"
    | "packing_status_work_mismatch";

  constructor(code: NpShopPackingStatusConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopPackingStatusConflictError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaquePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function readExactDataObject(
  value: unknown,
  expected: readonly string[],
  path: string,
  issues: string[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return null;
  }
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    issues.push(`${path} could not be inspected safely.`);
    return null;
  }
  if (keys.length > expected.length + 8) {
    issues.push(`${path} contains too many properties.`);
    return null;
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !expected.includes(key)) {
      issues.push(`${path} contains an unsupported property.`);
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      issues.push(`${path} could not be inspected safely.`);
      return null;
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      issues.push(`${path}.${key} must be an enumerable data property.`);
    } else {
      result[key] = descriptor.value;
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(result, key)) issues.push(`${path}.${key} is required.`);
  }
  return result;
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isOpaque(value: unknown): value is string {
  return typeof value === "string" && opaquePattern.test(value);
}

const eventKeys = [
  "contract",
  "eventId",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "providerWorkReference",
  "status",
  "occurredAt",
  "signedAt",
] as const;

export function npRequireShopPackingStatusProviderId(value: unknown): string {
  if (typeof value !== "string" || !providerIdPattern.test(value)) {
    throw new NpShopPackingStatusContractError("Invalid packing status provider id", [
      "provider id must be one lowercase segment of at most 32 characters.",
    ]);
  }
  return value;
}

export function npAnalyzeShopPackingStatusEvent(value: unknown): string[] {
  const issues: string[] = [];
  const initial = readExactDataObject(value, eventKeys, "packing status event", issues);
  if (!initial) return issues;
  if (initial.contract !== NP_SHOP_PACKING_STATUS_EVENT_CONTRACT) {
    issues.push(
      `packing status event.contract must equal "${NP_SHOP_PACKING_STATUS_EVENT_CONTRACT}".`,
    );
  }
  if (!isOpaque(initial.eventId)) issues.push("packing status event.eventId is invalid.");
  if (typeof initial.workId !== "string" || !uuidPattern.test(initial.workId)) {
    issues.push("packing status event.workId is invalid.");
  }
  if (typeof initial.orderId !== "string" || !uuidPattern.test(initial.orderId)) {
    issues.push("packing status event.orderId is invalid.");
  }
  if (initial.target !== "outbound" && initial.target !== "replacement") {
    issues.push("packing status event.target is invalid.");
  }
  if (
    (initial.target === "outbound" && initial.exchangeId !== null) ||
    (initial.target === "replacement" &&
      (typeof initial.exchangeId !== "string" || !uuidPattern.test(initial.exchangeId)))
  ) {
    issues.push("packing status event.exchangeId is invalid for its target.");
  }
  if (!isOpaque(initial.providerWorkReference)) {
    issues.push("packing status event.providerWorkReference is invalid.");
  }
  if (!(npShopPackingEvidenceStatuses as readonly unknown[]).includes(initial.status)) {
    issues.push("packing status event.status is invalid.");
  }
  if (!isIso(initial.occurredAt)) issues.push("packing status event.occurredAt is invalid.");
  if (!isIso(initial.signedAt)) issues.push("packing status event.signedAt is invalid.");
  return issues;
}

function materializePackingStatusEvent(value: unknown): NpShopVerifiedPackingStatusEvent {
  const issues = npAnalyzeShopPackingStatusEvent(value);
  const record = readExactDataObject(value, eventKeys, "packing status event", issues);
  if (issues.length > 0 || !record) {
    throw new NpShopPackingStatusContractError("Invalid verified packing status event", issues);
  }
  const event = record as unknown as NpShopVerifiedPackingStatusEvent;
  return event.target === "outbound"
    ? Object.freeze({
        contract: event.contract,
        eventId: event.eventId,
        workId: event.workId,
        orderId: event.orderId,
        target: "outbound",
        exchangeId: null,
        providerWorkReference: event.providerWorkReference,
        status: event.status,
        occurredAt: event.occurredAt,
        signedAt: event.signedAt,
      })
    : Object.freeze({
        contract: event.contract,
        eventId: event.eventId,
        workId: event.workId,
        orderId: event.orderId,
        target: "replacement",
        exchangeId: event.exchangeId,
        providerWorkReference: event.providerWorkReference,
        status: event.status,
        occurredAt: event.occurredAt,
        signedAt: event.signedAt,
      });
}

export function npRequireFreshShopPackingStatusEvent(
  value: unknown,
  receivedAt: Date,
): NpShopVerifiedPackingStatusEvent {
  const event = materializePackingStatusEvent(value);
  const issues: string[] = [];
  let received: number;
  try {
    received = Date.prototype.getTime.call(receivedAt);
  } catch {
    received = Number.NaN;
  }
  if (!Number.isFinite(received)) issues.push("packing status callback receivedAt is invalid.");
  if (issues.length === 0) {
    const signedAt = new Date(event.signedAt).getTime();
    const occurredAt = new Date(event.occurredAt).getTime();
    if (
      received - signedAt < -npShopPackingStatusLimits.futureToleranceSeconds * 1_000 ||
      received - signedAt > npShopPackingStatusLimits.replayWindowSeconds * 1_000
    ) {
      issues.push("packing status event.signedAt is outside the callback replay window.");
    }
    if (
      signedAt - occurredAt < -npShopPackingStatusLimits.futureToleranceSeconds * 1_000 ||
      signedAt - occurredAt > npShopPackingStatusLimits.maximumEventDelaySeconds * 1_000
    ) {
      issues.push("packing status event.occurredAt is outside the provider delay window.");
    }
  }
  if (issues.length > 0) {
    throw new NpShopPackingStatusContractError("Invalid verified packing status event", issues);
  }
  return event;
}

export function npIsIgnoredPackingStatusWebhook(
  value: unknown,
): value is NpShopIgnoredPackingStatusWebhook {
  const issues: string[] = [];
  const record = readExactDataObject(
    value,
    ["contract", "ignored", "reason"],
    "ignored packing status webhook",
    issues,
  );
  return Boolean(
    record &&
    issues.length === 0 &&
    record.contract === NP_SHOP_PACKING_STATUS_WEBHOOK_IGNORED_CONTRACT &&
    record.ignored === true &&
    record.reason === "unsupported-event",
  );
}

export function npShopPackingStatusEventDigest(event: NpShopVerifiedPackingStatusEvent): string {
  const canonical = materializePackingStatusEvent(event);
  return createHash("sha256")
    .update(
      JSON.stringify({
        contract: canonical.contract,
        eventId: canonical.eventId,
        workId: canonical.workId,
        orderId: canonical.orderId,
        target: canonical.target,
        exchangeId: canonical.exchangeId,
        providerWorkReference: canonical.providerWorkReference,
        status: canonical.status,
        occurredAt: canonical.occurredAt,
      }),
      "utf8",
    )
    .digest("hex");
}

export function npShopPackingStatusStorageKey(
  target: NpShopPackingStatusTargetIdentity["target"],
  orderId: string,
): string {
  if (
    (target !== "outbound" && target !== "replacement") ||
    typeof orderId !== "string" ||
    !uuidPattern.test(orderId)
  ) {
    throw new NpShopPackingStatusContractError("Invalid packing status storage identity", [
      "target and orderId must identify one canonical packing work.",
    ]);
  }
  return `packing-status:${target}:${orderId}`;
}

export function npShopPackingStatusReceiptStorageKey(providerId: string, eventId: string): string {
  const provider = npRequireShopPackingStatusProviderId(providerId);
  if (!isOpaque(eventId)) {
    throw new NpShopPackingStatusContractError("Invalid packing status event id", [
      "eventId must be one bounded opaque reference.",
    ]);
  }
  return `packing-status-event:${provider}:${createHash("sha256").update(eventId).digest("hex")}`;
}

const pollCurrentKeys = ["eventId", "status", "occurredAt"] as const;
const pollRequestKeys = [
  "contract",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "providerWorkReference",
  "current",
  "requestedAt",
] as const;

export function npAnalyzeShopPackingStatusPollRequest(value: unknown): string[] {
  const issues: string[] = [];
  const record = readExactDataObject(value, pollRequestKeys, "packing status poll request", issues);
  if (!record) return issues;
  if (record.contract !== NP_SHOP_PACKING_STATUS_POLL_REQUEST_CONTRACT) {
    issues.push(
      `packing status poll request.contract must equal "${NP_SHOP_PACKING_STATUS_POLL_REQUEST_CONTRACT}".`,
    );
  }
  if (typeof record.workId !== "string" || !uuidPattern.test(record.workId)) {
    issues.push("packing status poll request.workId is invalid.");
  }
  if (typeof record.orderId !== "string" || !uuidPattern.test(record.orderId)) {
    issues.push("packing status poll request.orderId is invalid.");
  }
  if (
    (record.target !== "outbound" && record.target !== "replacement") ||
    (record.target === "outbound" && record.exchangeId !== null) ||
    (record.target === "replacement" &&
      (typeof record.exchangeId !== "string" || !uuidPattern.test(record.exchangeId)))
  ) {
    issues.push("packing status poll request target identity is invalid.");
  }
  if (!isOpaque(record.providerWorkReference)) {
    issues.push("packing status poll request.providerWorkReference is invalid.");
  }
  if (record.current !== null) {
    const current = readExactDataObject(
      record.current,
      pollCurrentKeys,
      "packing status poll request.current",
      issues,
    );
    if (current) {
      if (!isOpaque(current.eventId)) {
        issues.push("packing status poll request.current.eventId is invalid.");
      }
      if (!(npShopPackingEvidenceStatuses as readonly unknown[]).includes(current.status)) {
        issues.push("packing status poll request.current.status is invalid.");
      }
      if (!isIso(current.occurredAt)) {
        issues.push("packing status poll request.current.occurredAt is invalid.");
      }
    }
  }
  if (!isIso(record.requestedAt)) {
    issues.push("packing status poll request.requestedAt is invalid.");
  }
  return issues;
}

export function npRequireShopPackingStatusPollRequest(
  value: unknown,
): NpShopPackingStatusPollRequest {
  const issues = npAnalyzeShopPackingStatusPollRequest(value);
  const record = readExactDataObject(value, pollRequestKeys, "packing status poll request", issues);
  if (issues.length > 0 || !record) {
    throw new NpShopPackingStatusContractError("Invalid packing status poll request", issues);
  }
  const request = record as unknown as NpShopPackingStatusPollRequest;
  const current =
    request.current === null
      ? null
      : Object.freeze({
          eventId: request.current.eventId,
          status: request.current.status,
          occurredAt: request.current.occurredAt,
        });
  return Object.freeze({ ...request, current });
}

const pollResultKeys = [
  "contract",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "checkedAt",
  "event",
] as const;

export function npRequireShopPackingStatusPollResult(
  value: unknown,
  context: { readonly request: NpShopPackingStatusPollRequest; readonly receivedAt: Date },
): NpShopPackingStatusPollResult {
  const issues: string[] = [];
  const record = readExactDataObject(value, pollResultKeys, "packing status poll result", issues);
  if (!record) {
    throw new NpShopPackingStatusContractError("Invalid packing status poll result", issues);
  }
  const request = context.request;
  if (record.contract !== NP_SHOP_PACKING_STATUS_POLL_RESULT_CONTRACT) {
    issues.push(
      `packing status poll result.contract must equal "${NP_SHOP_PACKING_STATUS_POLL_RESULT_CONTRACT}".`,
    );
  }
  if (
    record.workId !== request.workId ||
    record.orderId !== request.orderId ||
    record.target !== request.target ||
    record.exchangeId !== request.exchangeId
  ) {
    issues.push("packing status poll result must match the exact request identity.");
  }
  if (!isIso(record.checkedAt)) {
    issues.push("packing status poll result.checkedAt is invalid.");
  } else {
    let received = Number.NaN;
    try {
      received = Date.prototype.getTime.call(context.receivedAt);
    } catch {
      // Closed below.
    }
    const checked = new Date(record.checkedAt).getTime();
    if (
      !Number.isFinite(received) ||
      checked < new Date(request.requestedAt).getTime() ||
      checked > received + npShopPackingStatusLimits.futureToleranceSeconds * 1_000
    ) {
      issues.push("packing status poll result.checkedAt is outside the request window.");
    }
  }
  let event: NpShopVerifiedPackingStatusEvent | null = null;
  if (record.event !== null) {
    try {
      event = npRequireFreshShopPackingStatusEvent(record.event, context.receivedAt);
      if (
        event.workId !== request.workId ||
        event.orderId !== request.orderId ||
        event.target !== request.target ||
        event.exchangeId !== request.exchangeId ||
        event.providerWorkReference !== request.providerWorkReference
      ) {
        issues.push("packing status poll result.event must match the exact work request.");
      }
      if (event.signedAt !== record.checkedAt) {
        issues.push("packing status poll result.event.signedAt must equal checkedAt.");
      }
    } catch (error) {
      if (error instanceof NpShopPackingStatusContractError) issues.push(...error.issues);
      else issues.push("packing status poll result.event is invalid.");
    }
  }
  if (issues.length > 0) {
    throw new NpShopPackingStatusContractError("Invalid packing status poll result", issues);
  }
  return Object.freeze({
    contract: NP_SHOP_PACKING_STATUS_POLL_RESULT_CONTRACT,
    workId: request.workId,
    orderId: request.orderId,
    target: request.target,
    exchangeId: request.exchangeId,
    checkedAt: record.checkedAt as string,
    event,
  }) as NpShopPackingStatusPollResult;
}

export function npCreateShopPackingStatusPollResult(
  request: NpShopPackingStatusPollRequest,
  input: {
    readonly checkedAt: string;
    readonly event: {
      readonly eventId: string;
      readonly status: NpShopPackingEvidenceStatus;
      readonly occurredAt: string;
    } | null;
  },
): NpShopPackingStatusPollResult {
  const event = input.event
    ? {
        contract: NP_SHOP_PACKING_STATUS_EVENT_CONTRACT,
        eventId: input.event.eventId,
        workId: request.workId,
        orderId: request.orderId,
        target: request.target,
        exchangeId: request.exchangeId,
        providerWorkReference: request.providerWorkReference,
        status: input.event.status,
        occurredAt: input.event.occurredAt,
        signedAt: input.checkedAt,
      }
    : null;
  return Object.freeze({
    contract: NP_SHOP_PACKING_STATUS_POLL_RESULT_CONTRACT,
    workId: request.workId,
    orderId: request.orderId,
    target: request.target,
    exchangeId: request.exchangeId,
    checkedAt: input.checkedAt,
    event,
  }) as NpShopPackingStatusPollResult;
}

export function npShopPackingStatusPollStorageKey(
  target: NpShopPackingStatusTargetIdentity["target"],
  orderId: string,
): string {
  npShopPackingStatusStorageKey(target, orderId);
  return `packing-status-poll:${target}:${orderId}`;
}

const storedPollKeys = [
  "contract",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "providerId",
  "providerWorkReference",
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

export function npAnalyzeStoredShopPackingStatusPoll(value: unknown): string[] {
  const issues: string[] = [];
  const record = readExactDataObject(value, storedPollKeys, "packing status poll state", issues);
  if (!record) return issues;
  if (record.contract !== NP_SHOP_PACKING_STATUS_POLL_STORAGE_CONTRACT) {
    issues.push(
      `packing status poll state.contract must equal "${NP_SHOP_PACKING_STATUS_POLL_STORAGE_CONTRACT}".`,
    );
  }
  try {
    npRequireShopPackingStatusProviderId(record.providerId);
  } catch (error) {
    issues.push(...(error as NpShopPackingStatusContractError).issues);
  }
  const identityIssues = npAnalyzeShopPackingStatusPollRequest({
    contract: NP_SHOP_PACKING_STATUS_POLL_REQUEST_CONTRACT,
    workId: record.workId,
    orderId: record.orderId,
    target: record.target,
    exchangeId: record.exchangeId,
    providerWorkReference: record.providerWorkReference,
    current: null,
    requestedAt: record.lastAttemptAt,
  });
  issues.push(...identityIssues);
  if (
    !Number.isSafeInteger(record.consecutiveFailures) ||
    (record.consecutiveFailures as number) < 0 ||
    (record.consecutiveFailures as number) >
      npShopPackingStatusLimits.pollMaximumConsecutiveFailures
  ) {
    issues.push("packing status poll state.consecutiveFailures is invalid.");
  }
  for (const key of ["lastAttemptAt", "nextAttemptAt", "updatedAt", "purgeAt"] as const) {
    if (!isIso(record[key])) issues.push(`packing status poll state.${key} is invalid.`);
  }
  if (record.lastSuccessAt !== null && !isIso(record.lastSuccessAt)) {
    issues.push("packing status poll state.lastSuccessAt is invalid.");
  }
  if (
    record.lastErrorCode !== null &&
    !(npShopPackingStatusPollErrorCodes as readonly unknown[]).includes(record.lastErrorCode)
  ) {
    issues.push("packing status poll state.lastErrorCode is invalid.");
  }
  if ((record.consecutiveFailures === 0) !== (record.lastErrorCode === null)) {
    issues.push("packing status poll failure metadata is inconsistent.");
  }
  if ((record.leaseId === null) !== (record.leaseExpiresAt === null)) {
    issues.push("packing status poll lease fields must be both null or both present.");
  }
  if (
    record.leaseId !== null &&
    (typeof record.leaseId !== "string" || !uuidPattern.test(record.leaseId))
  ) {
    issues.push("packing status poll state.leaseId is invalid.");
  }
  if (record.leaseExpiresAt !== null && !isIso(record.leaseExpiresAt)) {
    issues.push("packing status poll state.leaseExpiresAt is invalid.");
  }
  if (
    isIso(record.updatedAt) &&
    isIso(record.nextAttemptAt) &&
    record.nextAttemptAt < record.updatedAt
  ) {
    issues.push("packing status poll state.nextAttemptAt cannot precede updatedAt.");
  }
  if (
    isIso(record.updatedAt) &&
    isIso(record.lastAttemptAt) &&
    record.lastAttemptAt > record.updatedAt
  ) {
    issues.push("packing status poll state.lastAttemptAt cannot follow updatedAt.");
  }
  if (
    isIso(record.updatedAt) &&
    isIso(record.lastSuccessAt) &&
    record.lastSuccessAt > record.updatedAt
  ) {
    issues.push("packing status poll state.lastSuccessAt cannot follow updatedAt.");
  }
  if (
    record.leaseId !== null &&
    isIso(record.updatedAt) &&
    isIso(record.leaseExpiresAt) &&
    record.leaseExpiresAt <= record.updatedAt
  ) {
    issues.push("packing status poll lease must expire after updatedAt.");
  }
  if (
    record.leaseId !== null &&
    (record.lastAttemptAt !== record.updatedAt || record.nextAttemptAt !== record.leaseExpiresAt)
  ) {
    issues.push("leased packing status poll state has inconsistent timestamps.");
  }
  return issues;
}

export function npRequireStoredShopPackingStatusPoll(
  value: unknown,
): NpShopStoredPackingStatusPoll {
  const issues = npAnalyzeStoredShopPackingStatusPoll(value);
  const record = readExactDataObject(value, storedPollKeys, "packing status poll state", issues);
  if (issues.length > 0 || !record) {
    throw new NpShopPackingStatusContractError("Invalid stored packing status poll", issues);
  }
  return Object.freeze(record) as unknown as NpShopStoredPackingStatusPoll;
}

const pollCursorKeys = ["contract", "providerId", "lastWorkKey", "updatedAt"] as const;

export function npRequireShopPackingStatusPollCursor(
  value: unknown,
): NpShopPackingStatusPollCursor {
  const issues: string[] = [];
  const record = readExactDataObject(value, pollCursorKeys, "packing status poll cursor", issues);
  if (!record) {
    throw new NpShopPackingStatusContractError("Invalid packing status poll cursor", issues);
  }
  if (record.contract !== NP_SHOP_PACKING_STATUS_POLL_CURSOR_CONTRACT) {
    issues.push(
      `packing status poll cursor.contract must equal "${NP_SHOP_PACKING_STATUS_POLL_CURSOR_CONTRACT}".`,
    );
  }
  try {
    npRequireShopPackingStatusProviderId(record.providerId);
  } catch (error) {
    issues.push(...(error as NpShopPackingStatusContractError).issues);
  }
  if (
    record.lastWorkKey !== null &&
    (typeof record.lastWorkKey !== "string" ||
      !/^packing-work:(?:outbound|replacement):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        record.lastWorkKey,
      ))
  ) {
    issues.push("packing status poll cursor.lastWorkKey is invalid.");
  }
  if (!isIso(record.updatedAt)) issues.push("packing status poll cursor.updatedAt is invalid.");
  if (issues.length > 0) {
    throw new NpShopPackingStatusContractError("Invalid packing status poll cursor", issues);
  }
  return Object.freeze({
    contract: NP_SHOP_PACKING_STATUS_POLL_CURSOR_CONTRACT,
    providerId: record.providerId as string,
    lastWorkKey: record.lastWorkKey as string | null,
    updatedAt: record.updatedAt as string,
  });
}

export function npShopPackingStatusPollBackoffSeconds(consecutiveFailures: number): number {
  if (
    !Number.isSafeInteger(consecutiveFailures) ||
    consecutiveFailures < 1 ||
    consecutiveFailures > npShopPackingStatusLimits.pollMaximumConsecutiveFailures
  ) {
    throw new NpShopPackingStatusContractError("Invalid packing status poll failure count", [
      "failure count is outside bounds.",
    ]);
  }
  return Math.min(
    npShopPackingStatusLimits.pollInitialBackoffSeconds * 2 ** (consecutiveFailures - 1),
    npShopPackingStatusLimits.pollMaximumBackoffSeconds,
  );
}

export function npRequireShopPackingStatusReconcileActionInput(
  value: unknown,
): NpShopPackingStatusReconcileActionInput {
  const issues: string[] = [];
  const payload = readExactDataObject(value, ["row", "values"], "payload", issues);
  const row = payload
    ? readExactDataObject(
        payload.row,
        ["id", "packingWorkId", "packingWorkTarget", "exchangeId"],
        "payload.row",
        issues,
      )
    : null;
  const values = payload ? readExactDataObject(payload.values, [], "payload.values", issues) : null;
  if (!values) issues.push("payload.values must be an empty object.");
  if (row) {
    if (typeof row.id !== "string" || !uuidPattern.test(row.id)) {
      issues.push("payload.row.id is invalid.");
    }
    if (typeof row.packingWorkId !== "string" || !uuidPattern.test(row.packingWorkId)) {
      issues.push("payload.row.packingWorkId is invalid.");
    }
    if (
      (row.packingWorkTarget !== "outbound" && row.packingWorkTarget !== "replacement") ||
      (row.packingWorkTarget === "outbound" && row.exchangeId !== null) ||
      (row.packingWorkTarget === "replacement" &&
        (typeof row.exchangeId !== "string" || !uuidPattern.test(row.exchangeId)))
    ) {
      issues.push("payload.row target identity is invalid.");
    }
  }
  if (issues.length > 0 || !row) {
    throw new NpShopPackingStatusContractError("Invalid packing status reconcile action", issues);
  }
  return Object.freeze({
    orderId: row.id as string,
    workId: row.packingWorkId as string,
    target: row.packingWorkTarget as "outbound" | "replacement",
    exchangeId: row.exchangeId as string | null,
  });
}

const stateKeys = [
  "contract",
  "providerId",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "providerWorkReference",
  "status",
  "latestEventId",
  "occurredAt",
  "packedAt",
  "failedAt",
  "updatedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopPackingStatus(value: unknown): string[] {
  const issues: string[] = [];
  const record = readExactDataObject(value, stateKeys, "stored packing status", issues);
  if (!record) return issues;
  if (record.contract !== NP_SHOP_PACKING_STATUS_STORAGE_CONTRACT) {
    issues.push(
      `stored packing status.contract must equal "${NP_SHOP_PACKING_STATUS_STORAGE_CONTRACT}".`,
    );
  }
  try {
    npRequireShopPackingStatusProviderId(record.providerId);
  } catch (error) {
    issues.push(...(error as NpShopPackingStatusContractError).issues);
  }
  issues.push(
    ...npAnalyzeShopPackingStatusEvent({
      contract: NP_SHOP_PACKING_STATUS_EVENT_CONTRACT,
      eventId: record.latestEventId,
      workId: record.workId,
      orderId: record.orderId,
      target: record.target,
      exchangeId: record.exchangeId,
      providerWorkReference: record.providerWorkReference,
      status: record.status,
      occurredAt: record.occurredAt,
      signedAt: record.occurredAt,
    }),
  );
  if (record.packedAt !== null && !isIso(record.packedAt))
    issues.push("stored packing status.packedAt is invalid.");
  if (record.failedAt !== null && !isIso(record.failedAt))
    issues.push("stored packing status.failedAt is invalid.");
  if (!isIso(record.updatedAt)) issues.push("stored packing status.updatedAt is invalid.");
  if (!isIso(record.purgeAt)) issues.push("stored packing status.purgeAt is invalid.");
  if (record.status === "packed" && record.packedAt !== record.occurredAt) {
    issues.push("stored packed status must retain its exact packedAt timestamp.");
  }
  if (record.status !== "packed" && record.packedAt !== null) {
    issues.push("stored non-packed status cannot set packedAt.");
  }
  if (record.status === "failed" && record.failedAt !== record.occurredAt) {
    issues.push("stored failed status must retain its exact failedAt timestamp.");
  }
  if (record.status !== "failed" && record.failedAt !== null) {
    issues.push("stored non-failed status cannot set failedAt.");
  }
  return issues;
}

export function npRequireStoredShopPackingStatus(value: unknown): NpShopStoredPackingStatus {
  const issues = npAnalyzeStoredShopPackingStatus(value);
  if (issues.length > 0) {
    throw new NpShopPackingStatusContractError("Invalid stored packing status", issues);
  }
  const record = readExactDataObject(value, stateKeys, "stored packing status", issues);
  if (!record) {
    throw new NpShopPackingStatusContractError("Invalid stored packing status", issues);
  }
  return Object.freeze(record) as unknown as NpShopStoredPackingStatus;
}

const receiptKeys = [
  "contract",
  "providerId",
  "event",
  "eventDigest",
  "outcome",
  "packingStatus",
  "processedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopPackingStatusReceipt(value: unknown): string[] {
  const issues: string[] = [];
  const record = readExactDataObject(value, receiptKeys, "stored packing status receipt", issues);
  if (!record) return issues;
  if (record.contract !== NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT) {
    issues.push(
      `stored packing status receipt.contract must equal "${NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT}".`,
    );
  }
  try {
    npRequireShopPackingStatusProviderId(record.providerId);
  } catch (error) {
    issues.push(...(error as NpShopPackingStatusContractError).issues);
  }
  const eventIssues = npAnalyzeShopPackingStatusEvent(record.event);
  issues.push(...eventIssues);
  const eventRecord = readExactDataObject(
    record.event,
    eventKeys,
    "stored packing status receipt.event",
    issues,
  );
  if (
    eventIssues.length === 0 &&
    eventRecord &&
    (typeof record.eventDigest !== "string" ||
      record.eventDigest !==
        npShopPackingStatusEventDigest(eventRecord as unknown as NpShopVerifiedPackingStatusEvent))
  ) {
    issues.push("stored packing status receipt.eventDigest must match its canonical event.");
  }
  if (typeof record.eventDigest !== "string" || !digestPattern.test(record.eventDigest)) {
    issues.push("stored packing status receipt.eventDigest is invalid.");
  }
  if (!(npShopPackingStatusReceiptOutcomes as readonly unknown[]).includes(record.outcome)) {
    issues.push("stored packing status receipt.outcome is invalid.");
  }
  if (!(npShopPackingEvidenceStatuses as readonly unknown[]).includes(record.packingStatus)) {
    issues.push("stored packing status receipt.packingStatus is invalid.");
  }
  if (!isIso(record.processedAt))
    issues.push("stored packing status receipt.processedAt is invalid.");
  if (!isIso(record.purgeAt)) issues.push("stored packing status receipt.purgeAt is invalid.");
  if (record.outcome === "advanced" && eventRecord) {
    if (record.packingStatus !== eventRecord.status) {
      issues.push("advanced packing status receipt must retain the event status.");
    }
  }
  if (record.outcome === "ignored-terminal" && record.packingStatus !== "packed") {
    issues.push("terminal packing status receipt must retain packed evidence.");
  }
  return issues;
}

export function npRequireStoredShopPackingStatusReceipt(
  value: unknown,
): NpShopStoredPackingStatusReceipt {
  const issues = npAnalyzeStoredShopPackingStatusReceipt(value);
  if (issues.length > 0) {
    throw new NpShopPackingStatusContractError("Invalid stored packing status receipt", issues);
  }
  const record = readExactDataObject(value, receiptKeys, "stored packing status receipt", issues);
  if (!record) {
    throw new NpShopPackingStatusContractError("Invalid stored packing status receipt", issues);
  }
  return Object.freeze({
    ...record,
    event: materializePackingStatusEvent(record.event),
  }) as unknown as NpShopStoredPackingStatusReceipt;
}
