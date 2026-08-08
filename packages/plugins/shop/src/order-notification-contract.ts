export const NP_SHOP_ORDER_NOTIFICATION_STORAGE_CONTRACT = "np.shop-order-notification.v1" as const;
export const NP_SHOP_ORDER_NOTIFICATION_PRIVATE_CONTRACT =
  "np.shop-order-notification-private.v1" as const;
export const NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT =
  "np.shop-order-notification-list.v1" as const;
export const NP_SHOP_ORDER_NOTIFICATION_KIND = "shop.order-update" as const;

export const npShopOrderNotificationKinds = [
  "order.created",
  "order.cancelled",
  "payment.succeeded",
  "payment.failed",
  "fulfillment.processing",
  "fulfillment.shipped",
  "delivery.delivered",
  "return.requested",
  "return.cancelled",
  "return.approved",
  "return.rejected",
  "return.received",
  "refund.completed",
  "partial-refund.completed",
] as const;

export type NpShopOrderNotificationKind = (typeof npShopOrderNotificationKinds)[number];
export type NpShopOrderNotificationStatus = "pending" | "claimed" | "completed" | "attention";
export type NpShopOrderNotificationChannelStatus =
  "pending" | "sent" | "suppressed" | "not-applicable" | "attention";

export const npShopOrderNotificationLimits = {
  privateTtlSeconds: 60 * 60 * 24,
  leaseSeconds: 5 * 60,
  processingBatchSize: 100,
  cleanupBatchSize: 500,
  diagnosticSampleSize: 500,
  timelineSize: 50,
  maximumAttempts: 5,
  errorCodeLength: 100,
} as const;

export interface NpShopOrderNotificationStorage {
  contract: typeof NP_SHOP_ORDER_NOTIFICATION_STORAGE_CONTRACT;
  id: string;
  orderId: string;
  ownerSegment: string;
  kind: NpShopOrderNotificationKind;
  orderRevision: number;
  occurredAt: string;
  status: NpShopOrderNotificationStatus;
  inboxStatus: NpShopOrderNotificationChannelStatus;
  emailStatus: NpShopOrderNotificationChannelStatus;
  notificationId: string | null;
  attempts: number;
  claimId: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  completedAt: string | null;
  purgeAt: string;
}

export interface NpShopOrderNotificationPrivate {
  contract: typeof NP_SHOP_ORDER_NOTIFICATION_PRIVATE_CONTRACT;
  eventId: string;
  orderId: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}

export interface NpShopOrderNotificationWire {
  id: string;
  kind: NpShopOrderNotificationKind;
  occurredAt: string;
}

export interface NpShopOrderNotificationListWire {
  contract: typeof NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT;
  events: NpShopOrderNotificationWire[];
}

export class NpShopOrderNotificationContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopOrderNotificationContractError";
    this.issues = issues;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;
const errorCodePattern = /^[a-z][a-z0-9-]{0,99}$/u;
const emailPattern = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/u;
const eventKeys = [
  "contract",
  "id",
  "orderId",
  "ownerSegment",
  "kind",
  "orderRevision",
  "occurredAt",
  "status",
  "inboxStatus",
  "emailStatus",
  "notificationId",
  "attempts",
  "claimId",
  "claimedAt",
  "leaseExpiresAt",
  "nextAttemptAt",
  "lastErrorCode",
  "completedAt",
  "purgeAt",
] as const;
const privateKeys = ["contract", "eventId", "orderId", "email", "createdAt", "expiresAt"];

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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && canonicalUuidPattern.test(value);
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isNullableIso(value: unknown): value is string | null {
  return value === null || isIso(value);
}

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerSegmentPattern.test(value) ||
      (value.startsWith("member:") && isUuid(value.slice("member:".length))))
  );
}

function isChannelStatus(value: unknown): value is NpShopOrderNotificationChannelStatus {
  return ["pending", "sent", "suppressed", "not-applicable", "attention"].includes(value as string);
}

function isTerminalChannel(value: unknown): boolean {
  return value === "sent" || value === "suppressed" || value === "not-applicable";
}

export function npAnalyzeShopOrderNotificationStorage(value: unknown): string[] {
  if (!isRecord(value)) return ["order notification must be a plain object."];
  const issues = exactKeys(value, eventKeys, "order notification");
  if (value.contract !== NP_SHOP_ORDER_NOTIFICATION_STORAGE_CONTRACT) {
    issues.push(
      `order notification.contract must equal "${NP_SHOP_ORDER_NOTIFICATION_STORAGE_CONTRACT}".`,
    );
  }
  if (!isUuid(value.id)) issues.push("order notification.id is invalid.");
  if (!isUuid(value.orderId)) issues.push("order notification.orderId is invalid.");
  if (!isOwnerSegment(value.ownerSegment)) {
    issues.push("order notification.ownerSegment is invalid.");
  }
  if (!(npShopOrderNotificationKinds as readonly unknown[]).includes(value.kind)) {
    issues.push("order notification.kind is invalid.");
  }
  if (!Number.isSafeInteger(value.orderRevision) || (value.orderRevision as number) < 1) {
    issues.push("order notification.orderRevision is invalid.");
  }
  if (!isIso(value.occurredAt)) issues.push("order notification.occurredAt is invalid.");
  if (!(
    value.status === "pending" ||
    value.status === "claimed" ||
    value.status === "completed" ||
    value.status === "attention"
  )) {
    issues.push("order notification.status is invalid.");
  }
  if (!isChannelStatus(value.inboxStatus)) {
    issues.push("order notification.inboxStatus is invalid.");
  }
  if (!isChannelStatus(value.emailStatus)) {
    issues.push("order notification.emailStatus is invalid.");
  }
  if (value.notificationId !== null && !isUuid(value.notificationId)) {
    issues.push("order notification.notificationId is invalid.");
  }
  if (
    !Number.isSafeInteger(value.attempts) ||
    (value.attempts as number) < 0 ||
    (value.attempts as number) > npShopOrderNotificationLimits.maximumAttempts
  ) {
    issues.push("order notification.attempts is invalid.");
  }
  if (value.claimId !== null && !isUuid(value.claimId)) {
    issues.push("order notification.claimId is invalid.");
  }
  for (const key of ["claimedAt", "leaseExpiresAt", "nextAttemptAt", "completedAt"] as const) {
    if (!isNullableIso(value[key])) issues.push(`order notification.${key} is invalid.`);
  }
  if (
    value.lastErrorCode !== null &&
    (typeof value.lastErrorCode !== "string" || !errorCodePattern.test(value.lastErrorCode))
  ) {
    issues.push("order notification.lastErrorCode is invalid.");
  }
  if (!isIso(value.purgeAt)) issues.push("order notification.purgeAt is invalid.");
  if (
    isIso(value.occurredAt) &&
    isIso(value.purgeAt) &&
    new Date(value.purgeAt) <= new Date(value.occurredAt)
  ) {
    issues.push("order notification.purgeAt must follow occurredAt.");
  }
  if (
    typeof value.ownerSegment === "string" &&
    value.ownerSegment.startsWith("guest:") &&
    value.inboxStatus !== "not-applicable"
  ) {
    issues.push("guest order notifications cannot target the member inbox.");
  }
  if (value.inboxStatus === "sent" && !isUuid(value.notificationId)) {
    issues.push("sent inbox notifications require a notification id.");
  }
  if (value.inboxStatus !== "sent" && value.notificationId !== null) {
    issues.push("only sent inbox notifications may retain a notification id.");
  }
  if (value.status === "claimed") {
    if (!isUuid(value.claimId) || !isIso(value.claimedAt) || !isIso(value.leaseExpiresAt)) {
      issues.push("claimed order notifications require one exact lease.");
    } else if (
      new Date(value.leaseExpiresAt).getTime() - new Date(value.claimedAt).getTime() !==
      npShopOrderNotificationLimits.leaseSeconds * 1_000
    ) {
      issues.push("order notification leases must use the fixed lifetime.");
    }
    if (value.completedAt !== null) {
      issues.push("claimed order notifications cannot be completed.");
    }
  } else if (value.claimId !== null || value.claimedAt !== null || value.leaseExpiresAt !== null) {
    issues.push("only claimed order notifications may contain lease state.");
  }
  if (value.status === "completed") {
    if (!isTerminalChannel(value.inboxStatus) || !isTerminalChannel(value.emailStatus)) {
      issues.push("completed order notifications require terminal channel outcomes.");
    }
    if (!isIso(value.completedAt)) {
      issues.push("completed order notifications require completedAt.");
    }
    if (value.nextAttemptAt !== null || value.lastErrorCode !== null) {
      issues.push("completed order notifications cannot contain retry state.");
    }
  } else if (value.completedAt !== null) {
    issues.push("only completed order notifications may contain completedAt.");
  }
  if (
    value.status === "attention" &&
    value.inboxStatus !== "attention" &&
    value.emailStatus !== "attention"
  ) {
    issues.push("attention order notifications require an attention channel.");
  }
  if (
    value.status !== "attention" &&
    (value.inboxStatus === "attention" || value.emailStatus === "attention")
  ) {
    issues.push("attention channels require attention order notification status.");
  }
  if (value.status === "attention" && value.lastErrorCode === null) {
    issues.push("attention order notifications require a bounded error code.");
  }
  if (value.status === "attention" && value.nextAttemptAt !== null) {
    issues.push("attention order notifications cannot retain a retry time.");
  }
  if (
    (value.status === "pending" || value.status === "claimed") &&
    value.attempts === npShopOrderNotificationLimits.maximumAttempts
  ) {
    issues.push("exhausted order notifications must enter attention state.");
  }
  if (
    value.status === "pending" &&
    isTerminalChannel(value.inboxStatus) &&
    isTerminalChannel(value.emailStatus)
  ) {
    issues.push("pending order notifications require at least one unfinished channel.");
  }
  return issues;
}

export function npRequireShopOrderNotificationStorage(
  value: unknown,
): NpShopOrderNotificationStorage {
  const issues = npAnalyzeShopOrderNotificationStorage(value);
  if (issues.length > 0) {
    throw new NpShopOrderNotificationContractError("Invalid Shop order notification", issues);
  }
  return value as NpShopOrderNotificationStorage;
}

export function npAnalyzeShopOrderNotificationPrivate(value: unknown): string[] {
  if (!isRecord(value)) return ["order notification private data must be a plain object."];
  const issues = exactKeys(value, privateKeys, "order notification private data");
  if (value.contract !== NP_SHOP_ORDER_NOTIFICATION_PRIVATE_CONTRACT) {
    issues.push(
      `order notification private data.contract must equal "${NP_SHOP_ORDER_NOTIFICATION_PRIVATE_CONTRACT}".`,
    );
  }
  if (!isUuid(value.eventId)) issues.push("order notification private data.eventId is invalid.");
  if (!isUuid(value.orderId)) issues.push("order notification private data.orderId is invalid.");
  if (
    typeof value.email !== "string" ||
    value.email.length > 254 ||
    value.email !== value.email.trim().toLowerCase() ||
    !emailPattern.test(value.email)
  ) {
    issues.push("order notification private data.email is invalid.");
  }
  if (!isIso(value.createdAt)) issues.push("order notification private data.createdAt is invalid.");
  if (!isIso(value.expiresAt)) issues.push("order notification private data.expiresAt is invalid.");
  if (
    isIso(value.createdAt) &&
    isIso(value.expiresAt) &&
    (new Date(value.expiresAt) <= new Date(value.createdAt) ||
      new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime() >
        npShopOrderNotificationLimits.privateTtlSeconds * 1_000)
  ) {
    issues.push(
      "order notification private data expiry must follow creation within the fixed maximum lifetime.",
    );
  }
  return issues;
}

export function npRequireShopOrderNotificationPrivate(
  value: unknown,
): NpShopOrderNotificationPrivate {
  const issues = npAnalyzeShopOrderNotificationPrivate(value);
  if (issues.length > 0) {
    throw new NpShopOrderNotificationContractError(
      "Invalid Shop order notification private data",
      issues,
    );
  }
  return value as NpShopOrderNotificationPrivate;
}

function requireWire(value: unknown, path: string): NpShopOrderNotificationWire {
  if (!isRecord(value)) {
    throw new NpShopOrderNotificationContractError("Invalid Shop order notification response", [
      `${path} must be a plain object.`,
    ]);
  }
  const issues = exactKeys(value, ["id", "kind", "occurredAt"], path);
  if (!isUuid(value.id)) issues.push(`${path}.id is invalid.`);
  if (!(npShopOrderNotificationKinds as readonly unknown[]).includes(value.kind)) {
    issues.push(`${path}.kind is invalid.`);
  }
  if (!isIso(value.occurredAt)) issues.push(`${path}.occurredAt is invalid.`);
  if (issues.length > 0) {
    throw new NpShopOrderNotificationContractError(
      "Invalid Shop order notification response",
      issues,
    );
  }
  return value as unknown as NpShopOrderNotificationWire;
}

export function npRequireShopOrderNotificationListWire(
  value: unknown,
): NpShopOrderNotificationListWire {
  if (!isRecord(value)) {
    throw new NpShopOrderNotificationContractError("Invalid Shop order notification response", [
      "order notification response must be a plain object.",
    ]);
  }
  const issues = exactKeys(value, ["contract", "events"], "order notification response");
  if (value.contract !== NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT) {
    issues.push("order notification response.contract is invalid.");
  }
  if (
    !Array.isArray(value.events) ||
    value.events.length > npShopOrderNotificationLimits.timelineSize
  ) {
    issues.push("order notification response.events is invalid.");
  }
  if (issues.length > 0) {
    throw new NpShopOrderNotificationContractError(
      "Invalid Shop order notification response",
      issues,
    );
  }
  const events = (value.events as unknown[]).map((entry, index) =>
    requireWire(entry, `order notification response.events[${index.toString()}]`),
  );
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    throw new NpShopOrderNotificationContractError("Invalid Shop order notification response", [
      "order notification response.events contains duplicate ids.",
    ]);
  }
  if (
    events.some(
      (event, index) =>
        index > 0 && event.occurredAt < (events[index - 1]?.occurredAt ?? event.occurredAt),
    )
  ) {
    throw new NpShopOrderNotificationContractError("Invalid Shop order notification response", [
      "order notification response.events must use chronological order.",
    ]);
  }
  return { contract: NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT, events };
}

export function npProjectShopOrderNotification(
  value: NpShopOrderNotificationStorage,
): NpShopOrderNotificationWire {
  return { id: value.id, kind: value.kind, occurredAt: value.occurredAt };
}
