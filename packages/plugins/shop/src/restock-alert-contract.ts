export const NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT = "np.shop-restock-alert.v1" as const;
export const NP_SHOP_RESTOCK_NOTIFICATION_KIND = "shop.product-restocked" as const;

export const npShopRestockAlertLimits = {
  activeTtlSeconds: 60 * 60 * 24 * 180,
  completedTtlSeconds: 60 * 60 * 24 * 30,
  leaseSeconds: 5 * 60,
  processingBatchSize: 200,
  cleanupBatchSize: 500,
  diagnosticSampleSize: 500,
  maximumTargetsPerProduct: 100,
} as const;

export type NpShopRestockAlertStatus = "active" | "claimed" | "completed";
export type NpShopRestockAlertOutcome = "notified" | "suppressed";

export interface NpShopRestockAlertStorage {
  contract: typeof NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT;
  eventId: string;
  memberId: string;
  productId: string;
  variantSku: string | null;
  status: NpShopRestockAlertStatus;
  outcome: NpShopRestockAlertOutcome | null;
  createdAt: string;
  checkedAt: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  notificationId: string | null;
  expiresAt: string;
}

export interface NpShopRestockAlertInput {
  productId: string;
  variantSku: string | null;
}

export interface NpShopRestockAlertWire {
  productId: string;
  variantSku: string | null;
  expiresAt: string;
}

export interface NpShopRestockAlertListWire {
  alerts: NpShopRestockAlertWire[];
}

export interface NpShopRestockAlertMutationWire {
  alert: NpShopRestockAlertWire | null;
}

export class NpShopRestockAlertContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopRestockAlertContractError";
    this.issues = issues;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const skuPattern = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;
const storageKeys = [
  "contract",
  "eventId",
  "memberId",
  "productId",
  "variantSku",
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

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && canonicalUuidPattern.test(value);
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function nullableCanonicalIso(value: unknown): value is string | null {
  return value === null || isCanonicalIso(value);
}

function nullableUuid(value: unknown): value is string | null {
  return value === null || isCanonicalUuid(value);
}

function isVariantSku(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && skuPattern.test(value));
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): string[] {
  const issues: string[] = [];
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) issues.push(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) issues.push(`${path}.${key} is required.`);
  }
  return issues;
}

export function npAnalyzeShopRestockAlertStorage(value: unknown): string[] {
  if (!isRecord(value)) return ["restock alert must be a plain object."];
  const issues = exactKeys(value, storageKeys, "restock alert");
  if (value.contract !== NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT) {
    issues.push(`restock alert.contract must equal "${NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT}".`);
  }
  if (!isCanonicalUuid(value.eventId)) issues.push("restock alert.eventId is invalid.");
  if (!isCanonicalUuid(value.memberId)) issues.push("restock alert.memberId is invalid.");
  if (!isCanonicalUuid(value.productId)) issues.push("restock alert.productId is invalid.");
  if (!isVariantSku(value.variantSku)) issues.push("restock alert.variantSku is invalid.");
  if (!(["active", "claimed", "completed"] as unknown[]).includes(value.status)) {
    issues.push("restock alert.status is invalid.");
  }
  if (
    value.outcome !== null &&
    !(["notified", "suppressed"] as unknown[]).includes(value.outcome)
  ) {
    issues.push("restock alert.outcome is invalid.");
  }
  if (!isCanonicalIso(value.createdAt)) issues.push("restock alert.createdAt is invalid.");
  if (!nullableCanonicalIso(value.checkedAt)) issues.push("restock alert.checkedAt is invalid.");
  if (!nullableCanonicalIso(value.claimedAt)) issues.push("restock alert.claimedAt is invalid.");
  if (!nullableCanonicalIso(value.leaseExpiresAt)) {
    issues.push("restock alert.leaseExpiresAt is invalid.");
  }
  if (!nullableCanonicalIso(value.completedAt)) {
    issues.push("restock alert.completedAt is invalid.");
  }
  if (!nullableUuid(value.notificationId)) {
    issues.push("restock alert.notificationId is invalid.");
  }
  if (!isCanonicalIso(value.expiresAt)) issues.push("restock alert.expiresAt is invalid.");

  const status = value.status;
  if (status === "active") {
    if (
      value.outcome !== null ||
      value.claimedAt !== null ||
      value.leaseExpiresAt !== null ||
      value.completedAt !== null ||
      value.notificationId !== null
    ) {
      issues.push("active restock alerts cannot contain claim or completion state.");
    }
  } else if (status === "claimed") {
    if (
      value.outcome !== null ||
      !isCanonicalIso(value.checkedAt) ||
      !isCanonicalIso(value.claimedAt) ||
      !isCanonicalIso(value.leaseExpiresAt) ||
      value.completedAt !== null ||
      value.notificationId !== null
    ) {
      issues.push("claimed restock alerts require only a live claim lease.");
    }
    if (isCanonicalIso(value.checkedAt) && value.checkedAt !== value.claimedAt) {
      issues.push("claimed restock alerts require checkedAt to equal claimedAt.");
    }
    if (
      isCanonicalIso(value.claimedAt) &&
      isCanonicalIso(value.leaseExpiresAt) &&
      new Date(value.leaseExpiresAt).getTime() - new Date(value.claimedAt).getTime() !==
        npShopRestockAlertLimits.leaseSeconds * 1_000
    ) {
      issues.push("restock alert claim leases must use the fixed lease lifetime.");
    }
  } else if (status === "completed") {
    if (
      !(["notified", "suppressed"] as unknown[]).includes(value.outcome) ||
      !isCanonicalIso(value.checkedAt) ||
      !isCanonicalIso(value.claimedAt) ||
      value.leaseExpiresAt !== null ||
      !isCanonicalIso(value.completedAt)
    ) {
      issues.push("completed restock alerts require an outcome and completion timestamps.");
    }
    if (value.outcome === "notified" && !isCanonicalUuid(value.notificationId)) {
      issues.push("notified restock alerts require a notification id.");
    }
    if (value.outcome === "suppressed" && value.notificationId !== null) {
      issues.push("suppressed restock alerts cannot contain a notification id.");
    }
    if (isCanonicalIso(value.checkedAt) && value.checkedAt !== value.claimedAt) {
      issues.push("completed restock alerts require checkedAt to equal claimedAt.");
    }
    if (
      isCanonicalIso(value.claimedAt) &&
      isCanonicalIso(value.completedAt) &&
      new Date(value.completedAt).getTime() < new Date(value.claimedAt).getTime()
    ) {
      issues.push("restock alert.completedAt cannot precede claimedAt.");
    }
  }

  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.expiresAt) &&
    (status === "active" || status === "claimed") &&
    new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime() !==
      npShopRestockAlertLimits.activeTtlSeconds * 1_000
  ) {
    issues.push("active restock alerts must use the fixed subscription lifetime.");
  }
  if (
    status === "completed" &&
    isCanonicalIso(value.completedAt) &&
    isCanonicalIso(value.expiresAt) &&
    new Date(value.expiresAt).getTime() - new Date(value.completedAt).getTime() !==
      npShopRestockAlertLimits.completedTtlSeconds * 1_000
  ) {
    issues.push("completed restock alerts must use the fixed receipt lifetime.");
  }
  for (const field of ["checkedAt", "claimedAt", "completedAt"] as const) {
    if (
      isCanonicalIso(value.createdAt) &&
      isCanonicalIso(value[field]) &&
      new Date(value[field]).getTime() < new Date(value.createdAt).getTime()
    ) {
      issues.push(`restock alert.${field} cannot precede createdAt.`);
    }
  }
  return issues;
}

export function npRequireShopRestockAlertStorage(value: unknown): NpShopRestockAlertStorage {
  const issues = npAnalyzeShopRestockAlertStorage(value);
  if (issues.length > 0) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert", issues);
  }
  return value as NpShopRestockAlertStorage;
}

export function npRequireShopRestockAlertInput(value: unknown): NpShopRestockAlertInput {
  if (!isRecord(value)) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert request", [
      "restock alert request must be a plain object.",
    ]);
  }
  const issues = exactKeys(value, ["productId", "variantSku"], "restock alert request");
  if (!isCanonicalUuid(value.productId)) {
    issues.push("restock alert request.productId is invalid.");
  }
  if (!isVariantSku(value.variantSku)) {
    issues.push("restock alert request.variantSku is invalid.");
  }
  if (issues.length > 0) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert request", issues);
  }
  return value as unknown as NpShopRestockAlertInput;
}

function npRequireShopRestockAlertWire(value: unknown, path: string): NpShopRestockAlertWire {
  if (!isRecord(value)) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert response", [
      `${path} must be a plain object.`,
    ]);
  }
  const issues = exactKeys(value, ["productId", "variantSku", "expiresAt"], path);
  if (!isCanonicalUuid(value.productId)) issues.push(`${path}.productId is invalid.`);
  if (!isVariantSku(value.variantSku)) issues.push(`${path}.variantSku is invalid.`);
  if (!isCanonicalIso(value.expiresAt)) issues.push(`${path}.expiresAt is invalid.`);
  if (issues.length > 0) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert response", issues);
  }
  return value as unknown as NpShopRestockAlertWire;
}

export function npRequireShopRestockAlertListWire(value: unknown): NpShopRestockAlertListWire {
  if (!isRecord(value)) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert response", [
      "restock alert response must be a plain object.",
    ]);
  }
  const issues = exactKeys(value, ["alerts"], "restock alert response");
  if (!Array.isArray(value.alerts)) {
    issues.push("restock alert response.alerts must be an array.");
  } else if (value.alerts.length > npShopRestockAlertLimits.maximumTargetsPerProduct) {
    issues.push("restock alert response.alerts exceeds the product target bound.");
  }
  if (issues.length > 0) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert response", issues);
  }
  const alerts = (value.alerts as unknown[]).map((entry, index) =>
    npRequireShopRestockAlertWire(entry, `restock alert response.alerts[${index.toString()}]`),
  );
  const targets = new Set(alerts.map((alert) => alert.variantSku ?? "_"));
  if (targets.size !== alerts.length) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert response", [
      "restock alert response.alerts contains a duplicate target.",
    ]);
  }
  return { alerts };
}

export function npRequireShopRestockAlertMutationWire(
  value: unknown,
): NpShopRestockAlertMutationWire {
  if (!isRecord(value)) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert response", [
      "restock alert response must be a plain object.",
    ]);
  }
  const issues = exactKeys(value, ["alert"], "restock alert response");
  if (value.alert !== null && !isRecord(value.alert)) {
    issues.push("restock alert response.alert must be an object or null.");
  }
  if (issues.length > 0) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert response", issues);
  }
  return {
    alert:
      value.alert === null
        ? null
        : npRequireShopRestockAlertWire(value.alert, "restock alert response.alert"),
  };
}

export function npToShopRestockAlertWire(value: NpShopRestockAlertStorage): NpShopRestockAlertWire {
  return {
    productId: value.productId,
    variantSku: value.variantSku,
    expiresAt: value.expiresAt,
  };
}
