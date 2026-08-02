export const NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT =
  "np.shop-fulfillment-parcels-storage.v1" as const;

export const npShopFulfillmentParcelLimits = Object.freeze({
  maximumParcels: 20,
  maximumAllocations: 100,
  parcelIdLength: 32,
  lineKeyLength: 200,
  maximumDimensionMm: 3_000,
  maximumWeightGrams: 500_000,
  maximumQuantity: 99,
  actionJsonLength: 20_000,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopFulfillmentParcelItem {
  lineKey: string;
  quantity: number;
}

export interface NpShopFulfillmentParcel {
  id: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
  items: NpShopFulfillmentParcelItem[];
}

export interface NpShopStoredFulfillmentParcels {
  contract: typeof NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT;
  orderId: string;
  fulfillmentRevision: number;
  revision: number;
  parcels: NpShopFulfillmentParcel[];
  lockedShipmentId: string | null;
  createdAt: string;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopFulfillmentParcelsSaveInput {
  orderId: string;
  expectedFulfillmentRevision: number;
  expectedParcelRevision: number | null;
  parcels: NpShopFulfillmentParcel[];
}

export class NpShopFulfillmentParcelContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopFulfillmentParcelContractError";
    this.issues = issues;
  }
}

export class NpShopFulfillmentParcelConflictError extends Error {
  readonly code:
    | "parcel_fulfillment_not_processing"
    | "parcel_fulfillment_revision_conflict"
    | "parcel_revision_conflict"
    | "parcel_locked"
    | "parcel_required"
    | "parcel_allocation_mismatch";

  constructor(code: NpShopFulfillmentParcelConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopFulfillmentParcelConflictError";
    this.code = code;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const parcelIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;

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

function isPositiveSafeInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum;
}

function analyzeParcelItem(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["lineKey", "quantity"], path, issues);
  if (
    typeof value.lineKey !== "string" ||
    value.lineKey.length < 1 ||
    value.lineKey.length > npShopFulfillmentParcelLimits.lineKeyLength ||
    value.lineKey.trim() !== value.lineKey
  ) {
    issues.push(`${path}.lineKey is invalid.`);
  }
  if (!isPositiveSafeInteger(value.quantity, npShopFulfillmentParcelLimits.maximumQuantity)) {
    issues.push(`${path}.quantity is invalid.`);
  }
}

function analyzeParcel(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["id", "lengthMm", "widthMm", "heightMm", "weightGrams", "items"], path, issues);
  if (typeof value.id !== "string" || !parcelIdPattern.test(value.id)) {
    issues.push(`${path}.id is invalid.`);
  }
  for (const key of ["lengthMm", "widthMm", "heightMm"] as const) {
    if (!isPositiveSafeInteger(value[key], npShopFulfillmentParcelLimits.maximumDimensionMm)) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (!isPositiveSafeInteger(value.weightGrams, npShopFulfillmentParcelLimits.maximumWeightGrams)) {
    issues.push(`${path}.weightGrams is invalid.`);
  }
  if (!Array.isArray(value.items) || value.items.length < 1) {
    issues.push(`${path}.items must contain at least one allocation.`);
    return;
  }
  if (value.items.length > npShopFulfillmentParcelLimits.maximumAllocations) {
    issues.push(
      `${path}.items accepts at most ${npShopFulfillmentParcelLimits.maximumAllocations.toString()} allocations.`,
    );
  }
  const boundedItems = value.items.slice(0, npShopFulfillmentParcelLimits.maximumAllocations);
  boundedItems.forEach((item, index) =>
    analyzeParcelItem(item, `${path}.items[${index.toString()}]`, issues),
  );
  const lineKeys = boundedItems
    .filter(isRecord)
    .map((item) => item.lineKey)
    .filter((lineKey): lineKey is string => typeof lineKey === "string");
  if (new Set(lineKeys).size !== lineKeys.length) {
    issues.push(`${path}.items cannot repeat one order line.`);
  }
}

export function npAnalyzeShopFulfillmentParcels(
  value: unknown,
  path = "fulfillment parcels",
): string[] {
  const issues: string[] = [];
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopFulfillmentParcelLimits.maximumParcels
  ) {
    return [
      `${path} must contain between 1 and ${npShopFulfillmentParcelLimits.maximumParcels.toString()} parcels.`,
    ];
  }
  value.forEach((parcel, index) => analyzeParcel(parcel, `${path}[${index.toString()}]`, issues));
  const parcelIds = value
    .filter(isRecord)
    .map((parcel) => parcel.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(parcelIds).size !== parcelIds.length) {
    issues.push(`${path} ids must be unique.`);
  }
  const allocationCount = value.reduce(
    (total, parcel) =>
      total + (isRecord(parcel) && Array.isArray(parcel.items) ? parcel.items.length : 0),
    0,
  );
  if (allocationCount > npShopFulfillmentParcelLimits.maximumAllocations) {
    issues.push(
      `${path} accepts at most ${npShopFulfillmentParcelLimits.maximumAllocations.toString()} item allocations.`,
    );
  }
  return issues;
}

const storedKeys = [
  "contract",
  "orderId",
  "fulfillmentRevision",
  "revision",
  "parcels",
  "lockedShipmentId",
  "createdAt",
  "updatedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopFulfillmentParcels(value: unknown): string[] {
  if (!isRecord(value)) return ["fulfillment parcel snapshot must be a plain object."];
  const issues: string[] = [];
  exactKeys(value, storedKeys, "fulfillment parcel snapshot", issues);
  if (value.contract !== NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT) {
    issues.push(
      `fulfillment parcel snapshot.contract must equal "${NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT}".`,
    );
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("fulfillment parcel snapshot.orderId is invalid.");
  }
  if (!isPositiveSafeInteger(value.fulfillmentRevision, Number.MAX_SAFE_INTEGER)) {
    issues.push("fulfillment parcel snapshot.fulfillmentRevision is invalid.");
  }
  if (!isPositiveSafeInteger(value.revision, Number.MAX_SAFE_INTEGER)) {
    issues.push("fulfillment parcel snapshot.revision is invalid.");
  }
  issues.push(...npAnalyzeShopFulfillmentParcels(value.parcels));
  if (
    value.lockedShipmentId !== null &&
    (typeof value.lockedShipmentId !== "string" ||
      !canonicalUuidPattern.test(value.lockedShipmentId))
  ) {
    issues.push("fulfillment parcel snapshot.lockedShipmentId is invalid.");
  }
  for (const key of ["createdAt", "updatedAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`fulfillment parcel snapshot.${key} is invalid.`);
  }
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt < value.createdAt
  ) {
    issues.push("fulfillment parcel snapshot.updatedAt cannot precede createdAt.");
  }
  if (
    isCanonicalIso(value.updatedAt) &&
    isCanonicalIso(value.purgeAt) &&
    value.updatedAt > value.purgeAt
  ) {
    issues.push("fulfillment parcel snapshot.updatedAt cannot follow purgeAt.");
  }
  return issues;
}

export function npRequireStoredShopFulfillmentParcels(
  value: unknown,
): NpShopStoredFulfillmentParcels {
  const issues = npAnalyzeStoredShopFulfillmentParcels(value);
  if (issues.length > 0) {
    throw new NpShopFulfillmentParcelContractError("Invalid stored fulfillment parcels", issues);
  }
  return value as NpShopStoredFulfillmentParcels;
}

export function npRequireShopFulfillmentParcelsSaveInput(
  value: unknown,
): NpShopFulfillmentParcelsSaveInput {
  if (!isRecord(value)) {
    throw new NpShopFulfillmentParcelContractError("Invalid fulfillment parcel action", [
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
    exactKeys(row, ["id", "fulfillmentRevision", "parcelRevision"], "payload.row", issues);
    if (typeof row.id !== "string" || !canonicalUuidPattern.test(row.id)) {
      issues.push("payload.row.id is invalid.");
    }
    if (!isPositiveSafeInteger(row.fulfillmentRevision, Number.MAX_SAFE_INTEGER)) {
      issues.push("payload.row.fulfillmentRevision is invalid.");
    }
    if (
      row.parcelRevision !== null &&
      !isPositiveSafeInteger(row.parcelRevision, Number.MAX_SAFE_INTEGER)
    ) {
      issues.push("payload.row.parcelRevision is invalid.");
    }
  }
  let parcels: unknown;
  let parsedParcels = false;
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
        parsedParcels = true;
      } catch {
        issues.push("payload.values.parcels must be valid JSON.");
      }
    }
  }
  if (parsedParcels) issues.push(...npAnalyzeShopFulfillmentParcels(parcels, "parcels"));
  if (issues.length > 0) {
    throw new NpShopFulfillmentParcelContractError("Invalid fulfillment parcel action", issues);
  }
  return {
    orderId: row?.id as string,
    expectedFulfillmentRevision: row?.fulfillmentRevision as number,
    expectedParcelRevision: row?.parcelRevision as number | null,
    parcels: parcels as NpShopFulfillmentParcel[],
  };
}

export function npShopFulfillmentParcelTotals(parcels: readonly NpShopFulfillmentParcel[]): {
  parcelCount: number;
  allocationCount: number;
  unitCount: number;
  weightGrams: number;
} {
  return parcels.reduce(
    (totals, parcel) => ({
      parcelCount: totals.parcelCount + 1,
      allocationCount: totals.allocationCount + parcel.items.length,
      unitCount: totals.unitCount + parcel.items.reduce((sum, item) => sum + item.quantity, 0),
      weightGrams: totals.weightGrams + parcel.weightGrams,
    }),
    { parcelCount: 0, allocationCount: 0, unitCount: 0, weightGrams: 0 },
  );
}
