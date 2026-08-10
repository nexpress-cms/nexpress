import {
  npAnalyzeShopFulfillmentParcels,
  npShopFulfillmentParcelLimits,
  type NpShopFulfillmentParcel,
} from "./parcel-contract.js";

export const NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT =
  "np.shop-exchange-parcels-storage.v1" as const;

export interface NpShopStoredExchangeParcels {
  contract: typeof NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT;
  orderId: string;
  exchangeId: string;
  exchangeRevision: number;
  revision: number;
  parcels: NpShopFulfillmentParcel[];
  lockedShipmentId: string | null;
  createdAt: string;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopExchangeParcelsSaveInput {
  orderId: string;
  exchangeId: string;
  expectedExchangeRevision: number;
  expectedParcelRevision: number | null;
  parcels: NpShopFulfillmentParcel[];
}

export class NpShopExchangeParcelContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopExchangeParcelContractError";
    this.issues = issues;
  }
}

export class NpShopExchangeParcelConflictError extends Error {
  readonly code:
    | "exchange_parcel_not_awaiting"
    | "exchange_parcel_revision_conflict"
    | "exchange_parcel_locked"
    | "exchange_parcel_required"
    | "exchange_parcel_allocation_mismatch";

  constructor(code: NpShopExchangeParcelConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopExchangeParcelConflictError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

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

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

export function npAnalyzeStoredShopExchangeParcels(value: unknown): string[] {
  if (!isRecord(value)) return ["exchange parcel snapshot must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "orderId",
      "exchangeId",
      "exchangeRevision",
      "revision",
      "parcels",
      "lockedShipmentId",
      "createdAt",
      "updatedAt",
      "purgeAt",
    ],
    "exchange parcel snapshot",
    issues,
  );
  if (value.contract !== NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT) {
    issues.push("exchange parcel snapshot.contract is invalid.");
  }
  for (const key of ["orderId", "exchangeId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key])) {
      issues.push(`exchange parcel snapshot.${key} is invalid.`);
    }
  }
  for (const key of ["exchangeRevision", "revision"] as const) {
    if (!isRevision(value[key])) issues.push(`exchange parcel snapshot.${key} is invalid.`);
  }
  issues.push(
    ...npAnalyzeShopFulfillmentParcels(value.parcels, "exchange parcel snapshot.parcels"),
  );
  if (
    value.lockedShipmentId !== null &&
    (typeof value.lockedShipmentId !== "string" || !uuidPattern.test(value.lockedShipmentId))
  ) {
    issues.push("exchange parcel snapshot.lockedShipmentId is invalid.");
  }
  for (const key of ["createdAt", "updatedAt", "purgeAt"] as const) {
    if (!isIso(value[key])) issues.push(`exchange parcel snapshot.${key} is invalid.`);
  }
  if (isIso(value.createdAt) && isIso(value.updatedAt) && value.updatedAt < value.createdAt) {
    issues.push("exchange parcel snapshot.updatedAt cannot precede createdAt.");
  }
  if (isIso(value.updatedAt) && isIso(value.purgeAt) && value.updatedAt > value.purgeAt) {
    issues.push("exchange parcel snapshot.updatedAt cannot follow purgeAt.");
  }
  return issues;
}

export function npRequireStoredShopExchangeParcels(value: unknown): NpShopStoredExchangeParcels {
  const issues = npAnalyzeStoredShopExchangeParcels(value);
  if (issues.length > 0) {
    throw new NpShopExchangeParcelContractError("Invalid stored exchange parcels", issues);
  }
  return value as NpShopStoredExchangeParcels;
}

export function npRequireShopExchangeParcelsSaveInput(
  value: unknown,
): NpShopExchangeParcelsSaveInput {
  if (!isRecord(value)) {
    throw new NpShopExchangeParcelContractError("Invalid exchange parcel action", [
      "payload must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  const row = isRecord(value.row) ? value.row : null;
  const values = isRecord(value.values) ? value.values : null;
  if (!row) issues.push("payload.row must be a plain object.");
  if (!values) issues.push("payload.values must be a plain object.");
  if (row) {
    exactKeys(
      row,
      ["id", "exchangeId", "exchangeRevision", "parcelRevision"],
      "payload.row",
      issues,
    );
    for (const key of ["id", "exchangeId"] as const) {
      if (typeof row[key] !== "string" || !uuidPattern.test(row[key])) {
        issues.push(`payload.row.${key} is invalid.`);
      }
    }
    if (!isRevision(row.exchangeRevision)) {
      issues.push("payload.row.exchangeRevision is invalid.");
    }
    if (row.parcelRevision !== null && !isRevision(row.parcelRevision)) {
      issues.push("payload.row.parcelRevision is invalid.");
    }
  }
  let parcels: unknown;
  let parsed = false;
  if (values) {
    exactKeys(values, ["parcels"], "payload.values", issues);
    if (
      typeof values.parcels !== "string" ||
      values.parcels.length < 1 ||
      values.parcels.length > npShopFulfillmentParcelLimits.actionJsonLength
    ) {
      issues.push("payload.values.parcels must be bounded JSON text.");
    } else {
      try {
        parcels = JSON.parse(values.parcels) as unknown;
        parsed = true;
      } catch {
        issues.push("payload.values.parcels must be valid JSON.");
      }
    }
  }
  if (parsed) issues.push(...npAnalyzeShopFulfillmentParcels(parcels, "parcels"));
  if (issues.length > 0) {
    throw new NpShopExchangeParcelContractError("Invalid exchange parcel action", issues);
  }
  return {
    orderId: row?.id as string,
    exchangeId: row?.exchangeId as string,
    expectedExchangeRevision: row?.exchangeRevision as number,
    expectedParcelRevision: row?.parcelRevision as number | null,
    parcels: parcels as NpShopFulfillmentParcel[],
  };
}
