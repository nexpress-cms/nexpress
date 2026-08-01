import {
  npShopFulfillmentStatuses,
  npShopOrderPrivateDataStatuses,
  type NpShopFulfillment,
  type NpShopFulfillmentStatus,
  type NpShopOrderPrivateDataStatus,
} from "./types.js";

export const NP_SHOP_FULFILLMENT_CONTRACT = "np.shop-fulfillment.v1" as const;
export const NP_SHOP_FULFILLMENT_STORAGE_CONTRACT = "np.shop-fulfillment-storage.v1" as const;

export const npShopFulfillmentLimits = {
  privateRetentionSeconds: 60 * 60 * 24 * 30,
  carrierLength: 80,
  trackingNumberLength: 120,
  operatorNoteLength: 500,
  adminListSize: 50,
  diagnosticSampleSize: 500,
} as const;

export interface NpShopStoredFulfillment {
  contract: typeof NP_SHOP_FULFILLMENT_STORAGE_CONTRACT;
  orderId: string;
  ownerSegment: string;
  status: NpShopFulfillmentStatus;
  revision: number;
  privateDataStatus: NpShopOrderPrivateDataStatus;
  carrier: string | null;
  trackingNumber: string | null;
  operatorNote: string | null;
  createdAt: string;
  updatedAt: string;
  privateExpiresAt: string;
  shippedAt: string | null;
  purgeAt: string;
}

export interface NpShopFulfillmentProcessInput {
  orderId: string;
  expectedRevision: number;
  operatorNote: string | null;
}

export interface NpShopFulfillmentShipInput extends NpShopFulfillmentProcessInput {
  carrier: string;
  trackingNumber: string;
}

export interface NpShopFulfillmentPrivateReadInput {
  orderId: string;
  expectedRevision: number;
}

export class NpShopFulfillmentContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopFulfillmentContractError";
    this.issues = issues;
  }
}

export class NpShopFulfillmentConflictError extends Error {
  readonly code:
    | "fulfillment_not_found"
    | "fulfillment_revision_conflict"
    | "fulfillment_terminal"
    | "fulfillment_private_expired";

  constructor(code: NpShopFulfillmentConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopFulfillmentConflictError";
    this.code = code;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) issues.push(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) issues.push(`${path}.${key} is required.`);
  }
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerSegmentPattern.test(value) ||
      (value.startsWith("member:") && canonicalUuidPattern.test(value.slice(7))))
  );
}

function isText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value
  );
}

const storedKeys = [
  "contract",
  "orderId",
  "ownerSegment",
  "status",
  "revision",
  "privateDataStatus",
  "carrier",
  "trackingNumber",
  "operatorNote",
  "createdAt",
  "updatedAt",
  "privateExpiresAt",
  "shippedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopFulfillment(value: unknown): string[] {
  if (!isRecord(value)) return ["fulfillment must be a plain object."];
  const issues: string[] = [];
  exactKeys(value, storedKeys, "fulfillment", issues);
  if (value.contract !== NP_SHOP_FULFILLMENT_STORAGE_CONTRACT) {
    issues.push(`fulfillment.contract must equal "${NP_SHOP_FULFILLMENT_STORAGE_CONTRACT}".`);
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("fulfillment.orderId is invalid.");
  }
  if (!isOwnerSegment(value.ownerSegment)) issues.push("fulfillment.ownerSegment is invalid.");
  if (!(npShopFulfillmentStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("fulfillment.status is invalid.");
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    issues.push("fulfillment.revision is invalid.");
  }
  if (!(npShopOrderPrivateDataStatuses as readonly unknown[]).includes(value.privateDataStatus)) {
    issues.push("fulfillment.privateDataStatus is invalid.");
  }
  if (value.carrier !== null && !isText(value.carrier, npShopFulfillmentLimits.carrierLength)) {
    issues.push("fulfillment.carrier is invalid.");
  }
  if (
    value.trackingNumber !== null &&
    !isText(value.trackingNumber, npShopFulfillmentLimits.trackingNumberLength)
  ) {
    issues.push("fulfillment.trackingNumber is invalid.");
  }
  if (
    value.operatorNote !== null &&
    !isText(value.operatorNote, npShopFulfillmentLimits.operatorNoteLength)
  ) {
    issues.push("fulfillment.operatorNote is invalid.");
  }
  for (const key of ["createdAt", "updatedAt", "privateExpiresAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`fulfillment.${key} is invalid.`);
  }
  if (value.shippedAt !== null && !isCanonicalIso(value.shippedAt)) {
    issues.push("fulfillment.shippedAt is invalid.");
  }
  if (
    value.status === "shipped" &&
    (value.shippedAt === null ||
      value.carrier === null ||
      value.trackingNumber === null ||
      value.privateDataStatus !== "redacted")
  ) {
    issues.push("shipped fulfillment requires tracking, shippedAt, and redacted private data.");
  }
  if (
    value.status !== "shipped" &&
    (value.shippedAt !== null || value.carrier !== null || value.trackingNumber !== null)
  ) {
    issues.push("unshipped fulfillment cannot contain shipping completion metadata.");
  }
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.createdAt)
  ) {
    issues.push("fulfillment.updatedAt cannot precede createdAt.");
  }
  if (
    isCanonicalIso(value.privateExpiresAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.privateExpiresAt) > new Date(value.purgeAt)
  ) {
    issues.push("fulfillment private retention cannot exceed commercial retention.");
  }
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.privateExpiresAt) &&
    new Date(value.privateExpiresAt).getTime() - new Date(value.createdAt).getTime() !==
      npShopFulfillmentLimits.privateRetentionSeconds * 1_000
  ) {
    issues.push("fulfillment.privateExpiresAt must equal the fixed private retention lifetime.");
  }
  if (
    isCanonicalIso(value.updatedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.updatedAt) > new Date(value.purgeAt)
  ) {
    issues.push("fulfillment.updatedAt cannot follow purgeAt.");
  }
  if (
    isCanonicalIso(value.shippedAt) &&
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.updatedAt) &&
    (new Date(value.shippedAt) < new Date(value.createdAt) || value.shippedAt !== value.updatedAt)
  ) {
    issues.push("fulfillment.shippedAt must equal the terminal update timestamp.");
  }
  return issues;
}

export function npRequireStoredShopFulfillment(value: unknown): NpShopStoredFulfillment {
  const issues = npAnalyzeStoredShopFulfillment(value);
  if (issues.length) throw new NpShopFulfillmentContractError("Invalid stored fulfillment", issues);
  return value as NpShopStoredFulfillment;
}

export function npProjectShopFulfillment(value: NpShopStoredFulfillment): NpShopFulfillment {
  return {
    contract: NP_SHOP_FULFILLMENT_CONTRACT,
    orderId: value.orderId,
    status: value.status,
    revision: value.revision,
    privateDataStatus: value.privateDataStatus,
    carrier: value.carrier,
    trackingNumber: value.trackingNumber,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    shippedAt: value.shippedAt,
  };
}

export function npAnalyzeShopFulfillment(value: unknown): string[] {
  if (!isRecord(value)) return ["fulfillment must be a plain object."];
  const issues: string[] = [];
  const keys = storedKeys.filter(
    (key) =>
      key !== "ownerSegment" &&
      key !== "operatorNote" &&
      key !== "privateExpiresAt" &&
      key !== "purgeAt",
  );
  exactKeys(value, keys, "fulfillment", issues);
  if (value.contract !== NP_SHOP_FULFILLMENT_CONTRACT) {
    issues.push(`fulfillment.contract must equal "${NP_SHOP_FULFILLMENT_CONTRACT}".`);
  }
  const createdAt = isCanonicalIso(value.createdAt) ? new Date(value.createdAt) : null;
  const storedCandidate = {
    ...value,
    contract: NP_SHOP_FULFILLMENT_STORAGE_CONTRACT,
    ownerSegment: "guest:".padEnd(70, "0"),
    operatorNote: null,
    privateExpiresAt: createdAt
      ? new Date(
          createdAt.getTime() + npShopFulfillmentLimits.privateRetentionSeconds * 1_000,
        ).toISOString()
      : value.createdAt,
    purgeAt: createdAt
      ? new Date(createdAt.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString()
      : value.createdAt,
  };
  issues.push(...npAnalyzeStoredShopFulfillment(storedCandidate));
  return issues.filter(
    (issue) =>
      issue !== `fulfillment.contract must equal "${NP_SHOP_FULFILLMENT_STORAGE_CONTRACT}".` &&
      issue !== "fulfillment.ownerSegment is invalid.",
  );
}

function requireActionPayload(value: unknown): {
  row: Record<string, unknown>;
  values: Record<string, unknown>;
} {
  if (!isRecord(value))
    throw new NpShopFulfillmentContractError("Invalid row action", ["payload must be an object."]);
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  if (!isRecord(value.row)) issues.push("payload.row must be an object.");
  if (!isRecord(value.values)) issues.push("payload.values must be an object.");
  if (issues.length) throw new NpShopFulfillmentContractError("Invalid row action", issues);
  return value as { row: Record<string, unknown>; values: Record<string, unknown> };
}

function requireBaseInput(
  value: unknown,
  valueKeys: readonly string[],
): { row: Record<string, unknown>; values: Record<string, unknown> } {
  const payload = requireActionPayload(value);
  const issues: string[] = [];
  exactKeys(payload.row, ["id", "fulfillmentRevision"], "payload.row", issues);
  exactKeys(payload.values, valueKeys, "payload.values", issues);
  if (typeof payload.row.id !== "string" || !canonicalUuidPattern.test(payload.row.id)) {
    issues.push("payload.row.id is invalid.");
  }
  if (
    !Number.isSafeInteger(payload.row.fulfillmentRevision) ||
    (payload.row.fulfillmentRevision as number) < 1
  ) {
    issues.push("payload.row.fulfillmentRevision is invalid.");
  }
  if (issues.length) throw new NpShopFulfillmentContractError("Invalid row action", issues);
  return payload;
}

function nullableNote(value: unknown): string | null {
  if (value === "" || value === null) return null;
  if (!isText(value, npShopFulfillmentLimits.operatorNoteLength)) {
    throw new NpShopFulfillmentContractError("Invalid fulfillment note", [
      "operatorNote is invalid.",
    ]);
  }
  return value;
}

export function npRequireShopFulfillmentProcessInput(
  value: unknown,
): NpShopFulfillmentProcessInput {
  const payload = requireBaseInput(value, ["operatorNote"]);
  return {
    orderId: payload.row.id as string,
    expectedRevision: payload.row.fulfillmentRevision as number,
    operatorNote: nullableNote(payload.values.operatorNote),
  };
}

export function npRequireShopFulfillmentShipInput(value: unknown): NpShopFulfillmentShipInput {
  const payload = requireBaseInput(value, ["carrier", "trackingNumber", "operatorNote"]);
  if (!isText(payload.values.carrier, npShopFulfillmentLimits.carrierLength)) {
    throw new NpShopFulfillmentContractError("Invalid shipment", ["carrier is invalid."]);
  }
  if (!isText(payload.values.trackingNumber, npShopFulfillmentLimits.trackingNumberLength)) {
    throw new NpShopFulfillmentContractError("Invalid shipment", ["trackingNumber is invalid."]);
  }
  return {
    orderId: payload.row.id as string,
    expectedRevision: payload.row.fulfillmentRevision as number,
    carrier: payload.values.carrier,
    trackingNumber: payload.values.trackingNumber,
    operatorNote: nullableNote(payload.values.operatorNote),
  };
}

export function npRequireShopFulfillmentPrivateReadInput(
  value: unknown,
): NpShopFulfillmentPrivateReadInput {
  const payload = requireBaseInput(value, []);
  return {
    orderId: payload.row.id as string,
    expectedRevision: payload.row.fulfillmentRevision as number,
  };
}
