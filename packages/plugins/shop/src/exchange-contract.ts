import type { NpShopCheckoutIntentLine } from "./types.js";

export const NP_SHOP_EXCHANGE_STORAGE_CONTRACT = "np.shop-exchange-storage.v1" as const;
export const NP_SHOP_EXCHANGE_CONTRACT = "np.shop-exchange.v1" as const;

export const npShopExchangeStatuses = ["awaiting", "processing", "shipped", "cancelled"] as const;
export type NpShopExchangeStatus = (typeof npShopExchangeStatuses)[number];

export const npShopExchangeInventoryOutcomes = [
  "consumed",
  "not-required",
  "restocked",
  "manual-required",
] as const;
export type NpShopExchangeInventoryOutcome = (typeof npShopExchangeInventoryOutcomes)[number];

export const npShopExchangeDestinationStatuses = [
  "awaiting",
  "submitted",
  "accessed",
  "expired",
  "redacted",
] as const;
export type NpShopExchangeDestinationStatus = (typeof npShopExchangeDestinationStatuses)[number];

export interface NpShopExchangeDestinationProjection {
  expiresAt: string;
  accessedAt: string | null;
}

export const npShopExchangeLimits = Object.freeze({
  maximumLines: 100,
  carrierLength: 80,
  trackingNumberLength: 120,
  operatorNoteLength: 500,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopExchangeLine {
  lineKey: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantSku: string | null;
  variantName: string | null;
  quantity: number;
}

export interface NpShopStoredExchange {
  contract: typeof NP_SHOP_EXCHANGE_STORAGE_CONTRACT;
  id: string;
  orderId: string;
  returnId: string;
  ownerSegment: string;
  status: NpShopExchangeStatus;
  revision: number;
  orderRevision: number;
  returnRevision: number;
  destinationRevision: number;
  destinationSubmittedAt: string | null;
  destinationRedactedAt: string | null;
  lines: NpShopExchangeLine[];
  inventoryOutcome: NpShopExchangeInventoryOutcome;
  carrier: string | null;
  trackingNumber: string | null;
  operatorNote: string | null;
  createdAt: string;
  updatedAt: string;
  shippedAt: string | null;
  cancelledAt: string | null;
  purgeAt: string;
}

export interface NpShopExchange {
  contract: typeof NP_SHOP_EXCHANGE_CONTRACT;
  id: string;
  returnId: string;
  status: NpShopExchangeStatus;
  revision: number;
  destinationStatus: NpShopExchangeDestinationStatus;
  destinationRevision: number;
  destinationExpiresAt: string | null;
  lines: NpShopExchangeLine[];
  inventoryOutcome: NpShopExchangeInventoryOutcome;
  carrier: string | null;
  trackingNumber: string | null;
  createdAt: string;
  updatedAt: string;
  shippedAt: string | null;
  cancelledAt: string | null;
}

export interface NpShopExchangeCreateInput {
  orderId: string;
  orderRevision: number;
  returnId: string;
  returnRevision: number;
  operatorNote: string | null;
}

export interface NpShopExchangeUpdateInput {
  orderId: string;
  exchangeId: string;
  exchangeRevision: number;
  orderRevision: number;
  operatorNote: string | null;
}

export interface NpShopExchangeShipInput extends NpShopExchangeUpdateInput {
  carrier: string;
  trackingNumber: string;
}

export class NpShopExchangeContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopExchangeContractError";
    this.issues = issues;
  }
}

export class NpShopExchangeConflictError extends Error {
  readonly code:
    | "exchange_not_found"
    | "exchange_already_exists"
    | "exchange_revision_conflict"
    | "exchange_return_not_received"
    | "exchange_inventory_unavailable"
    | "exchange_payment_conflict"
    | "exchange_terminal";

  constructor(code: NpShopExchangeConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopExchangeConflictError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const guestOwnerPattern = /^guest:[0-9a-f]{64}$/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isOwner(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerPattern.test(value) ||
      (value.startsWith("member:") && isUuid(value.slice("member:".length))))
  );
}

function isText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function analyzeLines(value: unknown, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopExchangeLimits.maximumLines
  ) {
    issues.push("exchange.lines is invalid.");
    return;
  }
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    const path = `exchange.lines[${index.toString()}]`;
    if (!isRecord(candidate)) {
      issues.push(`${path} must be a plain object.`);
      return;
    }
    exactKeys(
      candidate,
      [
        "lineKey",
        "productId",
        "productSlug",
        "productName",
        "variantSku",
        "variantName",
        "quantity",
      ],
      path,
      issues,
    );
    if (!isText(candidate.lineKey, 300) || seen.has(candidate.lineKey)) {
      issues.push(`${path}.lineKey is invalid or duplicated.`);
    } else {
      seen.add(candidate.lineKey);
    }
    if (!isUuid(candidate.productId)) issues.push(`${path}.productId is invalid.`);
    if (
      typeof candidate.productSlug !== "string" ||
      candidate.productSlug.length > 120 ||
      !slugPattern.test(candidate.productSlug)
    ) {
      issues.push(`${path}.productSlug is invalid.`);
    }
    if (!isText(candidate.productName, 200)) issues.push(`${path}.productName is invalid.`);
    if (candidate.variantSku !== null && !isText(candidate.variantSku, 64)) {
      issues.push(`${path}.variantSku is invalid.`);
    }
    if (candidate.variantName !== null && !isText(candidate.variantName, 120)) {
      issues.push(`${path}.variantName is invalid.`);
    }
    if (!Number.isSafeInteger(candidate.quantity) || (candidate.quantity as number) < 1) {
      issues.push(`${path}.quantity is invalid.`);
    }
  });
}

const storedKeys = [
  "contract",
  "id",
  "orderId",
  "returnId",
  "ownerSegment",
  "status",
  "revision",
  "orderRevision",
  "returnRevision",
  "destinationRevision",
  "destinationSubmittedAt",
  "destinationRedactedAt",
  "lines",
  "inventoryOutcome",
  "carrier",
  "trackingNumber",
  "operatorNote",
  "createdAt",
  "updatedAt",
  "shippedAt",
  "cancelledAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopExchange(value: unknown): string[] {
  if (!isRecord(value)) return ["exchange must be a plain object."];
  const issues: string[] = [];
  exactKeys(value, storedKeys, "exchange", issues);
  if (value.contract !== NP_SHOP_EXCHANGE_STORAGE_CONTRACT) {
    issues.push(`exchange.contract must equal "${NP_SHOP_EXCHANGE_STORAGE_CONTRACT}".`);
  }
  for (const key of ["id", "orderId", "returnId"] as const) {
    if (!isUuid(value[key])) issues.push(`exchange.${key} is invalid.`);
  }
  if (!isOwner(value.ownerSegment)) issues.push("exchange.ownerSegment is invalid.");
  if (!(npShopExchangeStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("exchange.status is invalid.");
  }
  for (const key of ["revision", "orderRevision", "returnRevision"] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) {
      issues.push(`exchange.${key} is invalid.`);
    }
  }
  if (
    !Number.isSafeInteger(value.destinationRevision) ||
    (value.destinationRevision as number) < 0
  ) {
    issues.push("exchange.destinationRevision is invalid.");
  }
  for (const key of ["destinationSubmittedAt", "destinationRedactedAt"] as const) {
    if (value[key] !== null && !isIso(value[key])) issues.push(`exchange.${key} is invalid.`);
  }
  analyzeLines(value.lines, issues);
  if (!(npShopExchangeInventoryOutcomes as readonly unknown[]).includes(value.inventoryOutcome)) {
    issues.push("exchange.inventoryOutcome is invalid.");
  }
  if (value.carrier !== null && !isText(value.carrier, npShopExchangeLimits.carrierLength)) {
    issues.push("exchange.carrier is invalid.");
  }
  if (
    value.trackingNumber !== null &&
    !isText(value.trackingNumber, npShopExchangeLimits.trackingNumberLength)
  ) {
    issues.push("exchange.trackingNumber is invalid.");
  }
  if (
    value.operatorNote !== null &&
    !isText(value.operatorNote, npShopExchangeLimits.operatorNoteLength)
  ) {
    issues.push("exchange.operatorNote is invalid.");
  }
  for (const key of ["createdAt", "updatedAt", "purgeAt"] as const) {
    if (!isIso(value[key])) issues.push(`exchange.${key} is invalid.`);
  }
  for (const key of ["shippedAt", "cancelledAt"] as const) {
    if (value[key] !== null && !isIso(value[key])) issues.push(`exchange.${key} is invalid.`);
  }
  if (
    (value.status === "awaiting" || value.status === "processing") &&
    (value.carrier !== null ||
      value.trackingNumber !== null ||
      value.shippedAt !== null ||
      value.cancelledAt !== null ||
      (value.inventoryOutcome !== "consumed" && value.inventoryOutcome !== "not-required"))
  ) {
    issues.push("active exchanges require consumed inventory and no terminal metadata.");
  }
  if (
    value.status === "shipped" &&
    (!isText(value.carrier, npShopExchangeLimits.carrierLength) ||
      !isText(value.trackingNumber, npShopExchangeLimits.trackingNumberLength) ||
      !isIso(value.shippedAt) ||
      value.cancelledAt !== null ||
      (value.inventoryOutcome !== "consumed" && value.inventoryOutcome !== "not-required"))
  ) {
    issues.push("shipped exchanges require tracking and consumed replacement inventory.");
  }
  if (
    value.status === "cancelled" &&
    (value.carrier !== null ||
      value.trackingNumber !== null ||
      value.shippedAt !== null ||
      !isIso(value.cancelledAt) ||
      (value.inventoryOutcome !== "restocked" &&
        value.inventoryOutcome !== "manual-required" &&
        value.inventoryOutcome !== "not-required"))
  ) {
    issues.push("cancelled exchanges require a closed inventory outcome and no shipment.");
  }
  if (isIso(value.createdAt) && isIso(value.updatedAt) && value.updatedAt < value.createdAt) {
    issues.push("exchange.updatedAt cannot precede createdAt.");
  }
  if (isIso(value.updatedAt) && isIso(value.purgeAt) && value.updatedAt > value.purgeAt) {
    issues.push("exchange.updatedAt cannot follow purgeAt.");
  }
  if (value.status === "shipped" && value.shippedAt !== value.updatedAt) {
    issues.push("exchange.shippedAt must equal its terminal update.");
  }
  if (value.status === "cancelled" && value.cancelledAt !== value.updatedAt) {
    issues.push("exchange.cancelledAt must equal its terminal update.");
  }
  if (
    (value.destinationRevision === 0 && value.destinationSubmittedAt !== null) ||
    ((value.destinationRevision as number) > 0 && !isIso(value.destinationSubmittedAt))
  ) {
    issues.push("exchange destination revision and submission time must advance together.");
  }
  if (
    isIso(value.destinationSubmittedAt) &&
    isIso(value.destinationRedactedAt) &&
    value.destinationRedactedAt < value.destinationSubmittedAt
  ) {
    issues.push("exchange.destinationRedactedAt cannot precede destinationSubmittedAt.");
  }
  if (
    ((value.status === "processing" ||
      value.status === "shipped" ||
      value.status === "cancelled") &&
      !isIso(value.destinationRedactedAt)) ||
    (value.status === "awaiting" && value.destinationRedactedAt !== null)
  ) {
    issues.push("exchange destination must be redacted exactly when the exchange leaves awaiting.");
  }
  if (
    (value.status === "processing" || value.status === "shipped") &&
    (!Number.isSafeInteger(value.destinationRevision) ||
      (value.destinationRevision as number) < 1 ||
      !isIso(value.destinationSubmittedAt))
  ) {
    issues.push("processing and shipped exchanges require one submitted destination revision.");
  }
  return issues;
}

export function npRequireStoredShopExchange(value: unknown): NpShopStoredExchange {
  const issues = npAnalyzeStoredShopExchange(value);
  if (issues.length) throw new NpShopExchangeContractError("Invalid stored Shop exchange", issues);
  return value as NpShopStoredExchange;
}

export function npProjectShopExchange(
  value: NpShopStoredExchange,
  destination: NpShopExchangeDestinationProjection | null = null,
  now = new Date(),
): NpShopExchange {
  const retainedDestination =
    value.status === "awaiting" &&
    value.destinationRedactedAt === null &&
    destination !== null &&
    isIso(destination.expiresAt) &&
    new Date(destination.expiresAt) > now
      ? destination
      : null;
  const destinationStatus: NpShopExchangeDestinationStatus =
    value.status !== "awaiting" || value.destinationRedactedAt !== null
      ? "redacted"
      : retainedDestination
        ? retainedDestination.accessedAt
          ? "accessed"
          : "submitted"
        : value.destinationRevision > 0
          ? "expired"
          : "awaiting";
  return {
    contract: NP_SHOP_EXCHANGE_CONTRACT,
    id: value.id,
    returnId: value.returnId,
    status: value.status,
    revision: value.revision,
    destinationStatus,
    destinationRevision: value.destinationRevision,
    destinationExpiresAt: retainedDestination?.expiresAt ?? null,
    lines: value.lines,
    inventoryOutcome: value.inventoryOutcome,
    carrier: value.carrier,
    trackingNumber: value.trackingNumber,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    shippedAt: value.shippedAt,
    cancelledAt: value.cancelledAt,
  };
}

export function npAnalyzeShopExchange(value: unknown): string[] {
  if (!isRecord(value)) return ["exchange must be a plain object."];
  const publicKeys = [
    ...storedKeys.filter(
      (key) =>
        ![
          "ownerSegment",
          "orderId",
          "orderRevision",
          "returnRevision",
          "operatorNote",
          "purgeAt",
          "destinationSubmittedAt",
          "destinationRedactedAt",
        ].includes(key),
    ),
    "destinationStatus",
    "destinationExpiresAt",
  ];
  const issues: string[] = [];
  exactKeys(value, publicKeys, "exchange", issues);
  const candidate = {
    ...value,
    contract: NP_SHOP_EXCHANGE_STORAGE_CONTRACT,
    orderId: "123e4567-e89b-42d3-a456-426614174000",
    ownerSegment: "guest:".padEnd(70, "0"),
    orderRevision: 1,
    returnRevision: 1,
    destinationSubmittedAt:
      typeof value.destinationRevision === "number" && value.destinationRevision > 0
        ? value.createdAt
        : null,
    destinationRedactedAt: value.destinationStatus === "redacted" ? value.updatedAt : null,
    operatorNote: null,
    purgeAt: "2099-01-01T00:00:00.000Z",
  };
  delete (candidate as { destinationStatus?: unknown }).destinationStatus;
  delete (candidate as { destinationExpiresAt?: unknown }).destinationExpiresAt;
  issues.push(
    ...npAnalyzeStoredShopExchange(candidate).filter(
      (issue) =>
        issue !== `exchange.contract must equal "${NP_SHOP_EXCHANGE_STORAGE_CONTRACT}".` &&
        issue !== "exchange.updatedAt cannot follow purgeAt.",
    ),
  );
  if (value.contract !== NP_SHOP_EXCHANGE_CONTRACT) {
    issues.push(`exchange.contract must equal "${NP_SHOP_EXCHANGE_CONTRACT}".`);
  }
  if (
    !(npShopExchangeDestinationStatuses as readonly unknown[]).includes(value.destinationStatus)
  ) {
    issues.push("exchange.destinationStatus is invalid.");
  }
  if (value.destinationExpiresAt !== null && !isIso(value.destinationExpiresAt)) {
    issues.push("exchange.destinationExpiresAt is invalid.");
  }
  if (
    ((value.destinationStatus === "submitted" || value.destinationStatus === "accessed") &&
      !isIso(value.destinationExpiresAt)) ||
    ((value.destinationStatus === "awaiting" ||
      value.destinationStatus === "expired" ||
      value.destinationStatus === "redacted") &&
      value.destinationExpiresAt !== null) ||
    (value.status === "awaiting" && value.destinationStatus === "redacted") ||
    (value.status !== "awaiting" && value.destinationStatus !== "redacted") ||
    ((value.status === "processing" || value.status === "shipped") &&
      (!Number.isSafeInteger(value.destinationRevision) ||
        (value.destinationRevision as number) < 1)) ||
    (value.destinationStatus === "awaiting" && value.destinationRevision !== 0) ||
    (value.destinationStatus !== "awaiting" &&
      value.destinationStatus !== "redacted" &&
      (!Number.isSafeInteger(value.destinationRevision) ||
        (value.destinationRevision as number) < 1))
  ) {
    issues.push("exchange destination projection is inconsistent with its lifecycle.");
  }
  return issues;
}

export function npRequireShopExchange(value: unknown): NpShopExchange {
  const issues = npAnalyzeShopExchange(value);
  if (issues.length)
    throw new NpShopExchangeContractError("Invalid projected Shop exchange", issues);
  return value as NpShopExchange;
}

function requirePayload(value: unknown): {
  row: Record<string, unknown>;
  values: Record<string, unknown>;
} {
  if (!isRecord(value) || !isRecord(value.row) || !isRecord(value.values)) {
    throw new NpShopExchangeContractError("Invalid Shop exchange action", [
      "payload, row, and values must be plain objects.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  if (issues.length) throw new NpShopExchangeContractError("Invalid Shop exchange action", issues);
  return { row: value.row, values: value.values };
}

function nullableNote(value: unknown): string | null {
  if (value === "" || value === null) return null;
  if (!isText(value, npShopExchangeLimits.operatorNoteLength)) {
    throw new NpShopExchangeContractError("Invalid Shop exchange note", [
      "operatorNote is invalid.",
    ]);
  }
  return value;
}

export function npRequireShopExchangeCreateInput(value: unknown): NpShopExchangeCreateInput {
  const { row, values } = requirePayload(value);
  const issues: string[] = [];
  exactKeys(row, ["id", "orderRevision", "returnId", "returnRevision"], "payload.row", issues);
  exactKeys(values, ["operatorNote"], "payload.values", issues);
  for (const key of ["id", "returnId"] as const) {
    if (!isUuid(row[key])) issues.push(`payload.row.${key} is invalid.`);
  }
  for (const key of ["orderRevision", "returnRevision"] as const) {
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 1) {
      issues.push(`payload.row.${key} is invalid.`);
    }
  }
  if (issues.length) throw new NpShopExchangeContractError("Invalid Shop exchange action", issues);
  return {
    orderId: row.id as string,
    orderRevision: row.orderRevision as number,
    returnId: row.returnId as string,
    returnRevision: row.returnRevision as number,
    operatorNote: nullableNote(values.operatorNote),
  };
}

function requireUpdateInput(
  value: unknown,
  valueKeys: readonly string[],
): {
  row: Record<string, unknown>;
  values: Record<string, unknown>;
  base: NpShopExchangeUpdateInput;
} {
  const { row, values } = requirePayload(value);
  const issues: string[] = [];
  exactKeys(row, ["id", "exchangeId", "exchangeRevision", "orderRevision"], "payload.row", issues);
  exactKeys(values, valueKeys, "payload.values", issues);
  for (const key of ["id", "exchangeId"] as const) {
    if (!isUuid(row[key])) issues.push(`payload.row.${key} is invalid.`);
  }
  for (const key of ["exchangeRevision", "orderRevision"] as const) {
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 1) {
      issues.push(`payload.row.${key} is invalid.`);
    }
  }
  if (issues.length) throw new NpShopExchangeContractError("Invalid Shop exchange action", issues);
  return {
    row,
    values,
    base: {
      orderId: row.id as string,
      exchangeId: row.exchangeId as string,
      exchangeRevision: row.exchangeRevision as number,
      orderRevision: row.orderRevision as number,
      operatorNote: nullableNote(values.operatorNote),
    },
  };
}

export function npRequireShopExchangeUpdateInput(value: unknown): NpShopExchangeUpdateInput {
  return requireUpdateInput(value, ["operatorNote"]).base;
}

export function npRequireShopExchangeShipInput(value: unknown): NpShopExchangeShipInput {
  const { values, base } = requireUpdateInput(value, ["carrier", "trackingNumber", "operatorNote"]);
  if (!isText(values.carrier, npShopExchangeLimits.carrierLength)) {
    throw new NpShopExchangeContractError("Invalid Shop exchange shipment", [
      "carrier is invalid.",
    ]);
  }
  if (!isText(values.trackingNumber, npShopExchangeLimits.trackingNumberLength)) {
    throw new NpShopExchangeContractError("Invalid Shop exchange shipment", [
      "trackingNumber is invalid.",
    ]);
  }
  return { ...base, carrier: values.carrier, trackingNumber: values.trackingNumber };
}

export function npShopExchangeLinesFromOrder(
  orderLines: readonly NpShopCheckoutIntentLine[],
  returnedLines: readonly { lineKey: string; quantity: number }[],
): NpShopExchangeLine[] {
  return returnedLines.map((returned) => {
    const line = orderLines.find((candidate) => candidate.key === returned.lineKey);
    if (!line || returned.quantity > line.quantity) {
      throw new NpShopExchangeContractError("Invalid Shop exchange lines", [
        "returned lines must match the immutable order snapshot.",
      ]);
    }
    return {
      lineKey: line.key,
      productId: line.productId,
      productSlug: line.productSlug,
      productName: line.productName,
      variantSku: line.variantSku,
      variantName: line.variantName,
      quantity: returned.quantity,
    };
  });
}
