import type { NpShopCurrency } from "./types.js";

export const NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT = "np.shop-price-alert.v1" as const;
export const NP_SHOP_PRICE_DROP_NOTIFICATION_KIND = "shop.product-price-dropped" as const;

export const npShopPriceAlertLimits = {
  activeTtlSeconds: 60 * 60 * 24 * 180,
  completedTtlSeconds: 60 * 60 * 24 * 30,
  leaseSeconds: 5 * 60,
  processingBatchSize: 200,
  cleanupBatchSize: 500,
  diagnosticSampleSize: 500,
  maximumTargetsPerProduct: 101,
  maximumProductsPerRead: 200,
  maximumPriceMinor: 2_147_483_647,
} as const;

export type NpShopPriceAlertStatus = "active" | "claimed" | "completed";
export type NpShopPriceAlertOutcome = "notified" | "suppressed";

export interface NpShopPriceAlertStorage {
  contract: typeof NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT;
  eventId: string;
  memberId: string;
  productId: string;
  variantSku: string | null;
  currency: NpShopCurrency;
  baselinePriceMinor: number;
  status: NpShopPriceAlertStatus;
  outcome: NpShopPriceAlertOutcome | null;
  createdAt: string;
  checkedAt: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  notificationId: string | null;
  expiresAt: string;
}

export interface NpShopPriceAlertInput {
  productId: string;
  variantSku: string | null;
}

export interface NpShopPriceAlertWire extends NpShopPriceAlertInput {
  currency: NpShopCurrency;
  baselinePriceMinor: number;
  expiresAt: string;
}

export interface NpShopPriceAlertListWire {
  alerts: NpShopPriceAlertWire[];
}

export interface NpShopPriceAlertMutationWire {
  alert: NpShopPriceAlertWire | null;
}

export class NpShopPriceAlertContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopPriceAlertContractError";
    this.issues = issues;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const skuPattern = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;
const currencies = ["KRW", "USD", "EUR", "JPY"] as const;
const storageKeys = [
  "contract",
  "eventId",
  "memberId",
  "productId",
  "variantSku",
  "currency",
  "baselinePriceMinor",
  "status",
  "outcome",
  "createdAt",
  "checkedAt",
  "claimedAt",
  "leaseExpiresAt",
  "completedAt",
  "notificationId",
  "expiresAt",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string) {
  const issues: string[] = [];
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) issues.push(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) issues.push(`${path}.${key} is required.`);
  }
  return issues;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isNullableIso(value: unknown): value is string | null {
  return value === null || isIso(value);
}

function isSku(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && skuPattern.test(value));
}

function isCurrency(value: unknown): value is NpShopCurrency {
  return (currencies as readonly unknown[]).includes(value);
}

function isPrice(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= npShopPriceAlertLimits.maximumPriceMinor
  );
}

export function npAnalyzeShopPriceAlertStorage(value: unknown): string[] {
  if (!isRecord(value)) return ["price alert must be a plain object."];
  const issues = exactKeys(value, storageKeys, "price alert");
  if (value.contract !== NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT) {
    issues.push(`price alert.contract must equal "${NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT}".`);
  }
  if (!isUuid(value.eventId)) issues.push("price alert.eventId is invalid.");
  if (!isUuid(value.memberId)) issues.push("price alert.memberId is invalid.");
  if (!isUuid(value.productId)) issues.push("price alert.productId is invalid.");
  if (!isSku(value.variantSku)) issues.push("price alert.variantSku is invalid.");
  if (!isCurrency(value.currency)) issues.push("price alert.currency is invalid.");
  if (!isPrice(value.baselinePriceMinor) || value.baselinePriceMinor === 0) {
    issues.push("price alert.baselinePriceMinor must be a positive bounded integer.");
  }
  if (!(value.status === "active" || value.status === "claimed" || value.status === "completed")) {
    issues.push("price alert.status is invalid.");
  }
  if (value.outcome !== null && value.outcome !== "notified" && value.outcome !== "suppressed") {
    issues.push("price alert.outcome is invalid.");
  }
  if (!isIso(value.createdAt)) issues.push("price alert.createdAt is invalid.");
  for (const key of ["checkedAt", "claimedAt", "leaseExpiresAt", "completedAt"] as const) {
    if (!isNullableIso(value[key])) issues.push(`price alert.${key} is invalid.`);
  }
  if (value.notificationId !== null && !isUuid(value.notificationId)) {
    issues.push("price alert.notificationId is invalid.");
  }
  if (!isIso(value.expiresAt)) issues.push("price alert.expiresAt is invalid.");

  if (value.status === "active") {
    if (
      value.outcome !== null ||
      value.claimedAt !== null ||
      value.leaseExpiresAt !== null ||
      value.completedAt !== null ||
      value.notificationId !== null
    ) {
      issues.push("active price alerts cannot contain claim or completion state.");
    }
  } else if (value.status === "claimed") {
    if (
      value.outcome !== null ||
      !isIso(value.checkedAt) ||
      !isIso(value.claimedAt) ||
      !isIso(value.leaseExpiresAt) ||
      value.completedAt !== null ||
      value.notificationId !== null
    ) {
      issues.push("claimed price alerts require only one exact live lease.");
    }
    if (isIso(value.checkedAt) && value.checkedAt !== value.claimedAt) {
      issues.push("claimed price alerts require checkedAt to equal claimedAt.");
    }
    if (
      isIso(value.claimedAt) &&
      isIso(value.leaseExpiresAt) &&
      new Date(value.leaseExpiresAt).getTime() - new Date(value.claimedAt).getTime() !==
        npShopPriceAlertLimits.leaseSeconds * 1_000
    ) {
      issues.push("price alert claims must use the fixed lease lifetime.");
    }
  } else if (value.status === "completed") {
    if (
      (value.outcome !== "notified" && value.outcome !== "suppressed") ||
      !isIso(value.checkedAt) ||
      !isIso(value.claimedAt) ||
      value.leaseExpiresAt !== null ||
      !isIso(value.completedAt)
    ) {
      issues.push("completed price alerts require an outcome and exact timestamps.");
    }
    if (value.outcome === "notified" && !isUuid(value.notificationId)) {
      issues.push("notified price alerts require a notification id.");
    }
    if (value.outcome === "suppressed" && value.notificationId !== null) {
      issues.push("suppressed price alerts cannot retain a notification id.");
    }
    if (isIso(value.checkedAt) && value.checkedAt !== value.claimedAt) {
      issues.push("completed price alerts require checkedAt to equal claimedAt.");
    }
    if (
      isIso(value.claimedAt) &&
      isIso(value.completedAt) &&
      new Date(value.completedAt).getTime() < new Date(value.claimedAt).getTime()
    ) {
      issues.push("price alert.completedAt cannot precede claimedAt.");
    }
  }

  if (
    isIso(value.createdAt) &&
    isIso(value.expiresAt) &&
    (value.status === "active" || value.status === "claimed") &&
    new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime() !==
      npShopPriceAlertLimits.activeTtlSeconds * 1_000
  ) {
    issues.push("active price alerts must use the fixed subscription lifetime.");
  }
  if (
    value.status === "completed" &&
    isIso(value.completedAt) &&
    isIso(value.expiresAt) &&
    new Date(value.expiresAt).getTime() - new Date(value.completedAt).getTime() !==
      npShopPriceAlertLimits.completedTtlSeconds * 1_000
  ) {
    issues.push("completed price alerts must use the fixed receipt lifetime.");
  }
  for (const field of ["checkedAt", "claimedAt", "completedAt"] as const) {
    if (
      isIso(value.createdAt) &&
      isIso(value[field]) &&
      new Date(value[field]).getTime() < new Date(value.createdAt).getTime()
    ) {
      issues.push(`price alert.${field} cannot precede createdAt.`);
    }
  }
  return issues;
}

export function npRequireShopPriceAlertStorage(value: unknown): NpShopPriceAlertStorage {
  const issues = npAnalyzeShopPriceAlertStorage(value);
  if (issues.length > 0)
    throw new NpShopPriceAlertContractError("Invalid Shop price alert", issues);
  return value as NpShopPriceAlertStorage;
}

export function npRequireShopPriceAlertInput(value: unknown): NpShopPriceAlertInput {
  if (!isRecord(value)) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert request", [
      "price alert request must be a plain object.",
    ]);
  }
  const issues = exactKeys(value, ["productId", "variantSku"], "price alert request");
  if (!isUuid(value.productId)) issues.push("price alert request.productId is invalid.");
  if (!isSku(value.variantSku)) issues.push("price alert request.variantSku is invalid.");
  if (issues.length > 0) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert request", issues);
  }
  return value as unknown as NpShopPriceAlertInput;
}

function requireWire(value: unknown, path: string): NpShopPriceAlertWire {
  if (!isRecord(value)) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert response", [
      `${path} must be a plain object.`,
    ]);
  }
  const issues = exactKeys(
    value,
    ["productId", "variantSku", "currency", "baselinePriceMinor", "expiresAt"],
    path,
  );
  if (!isUuid(value.productId)) issues.push(`${path}.productId is invalid.`);
  if (!isSku(value.variantSku)) issues.push(`${path}.variantSku is invalid.`);
  if (!isCurrency(value.currency)) issues.push(`${path}.currency is invalid.`);
  if (!isPrice(value.baselinePriceMinor) || value.baselinePriceMinor === 0) {
    issues.push(`${path}.baselinePriceMinor is invalid.`);
  }
  if (!isIso(value.expiresAt)) issues.push(`${path}.expiresAt is invalid.`);
  if (issues.length > 0) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert response", issues);
  }
  return value as unknown as NpShopPriceAlertWire;
}

export function npRequireShopPriceAlertListWire(value: unknown): NpShopPriceAlertListWire {
  if (!isRecord(value) || !Array.isArray(value.alerts)) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert response", [
      "price alert response must contain one alerts array.",
    ]);
  }
  const issues = exactKeys(value, ["alerts"], "price alert response");
  if (value.alerts.length > npShopPriceAlertLimits.maximumTargetsPerProduct) {
    issues.push("price alert response.alerts exceeds the product target bound.");
  }
  if (issues.length > 0) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert response", issues);
  }
  const alerts = value.alerts.map((entry, index) =>
    requireWire(entry, `price alert response.alerts[${index.toString()}]`),
  );
  if (
    new Set(alerts.map((alert) => `${alert.productId}:${alert.variantSku ?? "_"}`)).size !==
    alerts.length
  ) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert response", [
      "price alert response.alerts contains a duplicate target.",
    ]);
  }
  return { alerts };
}

export function npRequireShopPriceAlertMutationWire(value: unknown): NpShopPriceAlertMutationWire {
  if (!isRecord(value)) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert response", [
      "price alert response must be a plain object.",
    ]);
  }
  const issues = exactKeys(value, ["alert"], "price alert response");
  if (value.alert !== null && !isRecord(value.alert)) {
    issues.push("price alert response.alert must be an object or null.");
  }
  if (issues.length > 0) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert response", issues);
  }
  return {
    alert: value.alert === null ? null : requireWire(value.alert, "price alert response.alert"),
  };
}

export function npToShopPriceAlertWire(value: NpShopPriceAlertStorage): NpShopPriceAlertWire {
  return {
    productId: value.productId,
    variantSku: value.variantSku,
    currency: value.currency,
    baselinePriceMinor: value.baselinePriceMinor,
    expiresAt: value.expiresAt,
  };
}
