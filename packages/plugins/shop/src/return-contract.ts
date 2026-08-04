import {
  npAnalyzeShopReturnLogistics,
  type NpShopReturnLogistics,
} from "./return-logistics-contract.js";

export const NP_SHOP_RETURN_CONTRACT = "np.shop-return.v1" as const;
export const NP_SHOP_RETURN_STORAGE_CONTRACT = "np.shop-return-storage.v1" as const;

export const npShopReturnStatuses = [
  "requested",
  "approved",
  "rejected",
  "received",
  "cancelled",
] as const;
export type NpShopReturnStatus = (typeof npShopReturnStatuses)[number];

export const npShopReturnReasons = [
  "damaged",
  "defective",
  "wrong-item",
  "changed-mind",
  "other",
] as const;
export type NpShopReturnReason = (typeof npShopReturnReasons)[number];

export const npShopReturnInventoryOutcomes = [
  "pending",
  "not-required",
  "restocked",
  "manual-required",
] as const;
export type NpShopReturnInventoryOutcome = (typeof npShopReturnInventoryOutcomes)[number];

export const npShopReturnLimits = Object.freeze({
  maximumLines: 100,
  detailLength: 500,
  operatorNoteLength: 500,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopReturnLine {
  lineKey: string;
  quantity: number;
}

export interface NpShopStoredReturn {
  contract: typeof NP_SHOP_RETURN_STORAGE_CONTRACT;
  id: string;
  orderId: string;
  ownerSegment: string;
  status: NpShopReturnStatus;
  revision: number;
  orderRevision: number;
  lines: NpShopReturnLine[];
  reason: NpShopReturnReason;
  detail: string | null;
  operatorNote: string | null;
  inventoryOutcome: NpShopReturnInventoryOutcome;
  requestedAt: string;
  updatedAt: string;
  decidedAt: string | null;
  receivedAt: string | null;
  purgeAt: string;
}

export interface NpShopReturn {
  contract: typeof NP_SHOP_RETURN_CONTRACT;
  id: string;
  orderId: string;
  status: NpShopReturnStatus;
  revision: number;
  lines: NpShopReturnLine[];
  reason: NpShopReturnReason;
  detail: string | null;
  inventoryOutcome: NpShopReturnInventoryOutcome;
  requestedAt: string;
  updatedAt: string;
  decidedAt: string | null;
  receivedAt: string | null;
  /** Present after the owner starts provider-backed return logistics. */
  logistics?: NpShopReturnLogistics;
}

export interface NpShopReturnRequestInput {
  orderId: string;
  expectedOrderRevision: number;
  lines: NpShopReturnLine[];
  reason: NpShopReturnReason;
  detail: string | null;
}

export interface NpShopReturnCancelInput {
  orderId: string;
  expectedRevision: number;
}

export interface NpShopReturnStaffInput {
  orderId: string;
  expectedRevision: number;
  operatorNote: string | null;
}

export class NpShopReturnContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopReturnContractError";
    this.issues = issues;
  }
}

export class NpShopReturnConflictError extends Error {
  readonly code:
    | "return_not_found"
    | "return_already_exists"
    | "return_order_revision_conflict"
    | "return_revision_conflict"
    | "return_order_not_shipped"
    | "return_order_expired"
    | "return_invalid_transition";

  constructor(code: NpShopReturnConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopReturnConflictError";
    this.code = code;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;

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

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && canonicalUuidPattern.test(value);
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerSegmentPattern.test(value) ||
      (value.startsWith("member:") && isCanonicalUuid(value.slice("member:".length))))
  );
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function analyzeLines(value: unknown, path: string, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > npShopReturnLimits.maximumLines
  ) {
    issues.push(`${path} must contain 1-${npShopReturnLimits.maximumLines.toString()} lines.`);
    return;
  }
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    const linePath = `${path}[${index.toString()}]`;
    if (!isRecord(candidate)) {
      issues.push(`${linePath} must be a plain object.`);
      return;
    }
    exactKeys(candidate, ["lineKey", "quantity"], linePath, issues);
    if (!isBoundedText(candidate.lineKey, 300)) {
      issues.push(`${linePath}.lineKey is invalid.`);
    } else if (seen.has(candidate.lineKey)) {
      issues.push(`${linePath}.lineKey is duplicated.`);
    } else {
      seen.add(candidate.lineKey);
    }
    if (!Number.isSafeInteger(candidate.quantity) || (candidate.quantity as number) < 1) {
      issues.push(`${linePath}.quantity is invalid.`);
    }
  });
}

const storedKeys = [
  "contract",
  "id",
  "orderId",
  "ownerSegment",
  "status",
  "revision",
  "orderRevision",
  "lines",
  "reason",
  "detail",
  "operatorNote",
  "inventoryOutcome",
  "requestedAt",
  "updatedAt",
  "decidedAt",
  "receivedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopReturn(value: unknown): string[] {
  if (!isRecord(value)) return ["return must be a plain object."];
  const issues: string[] = [];
  exactKeys(value, storedKeys, "return", issues);
  if (value.contract !== NP_SHOP_RETURN_STORAGE_CONTRACT) {
    issues.push(`return.contract must equal "${NP_SHOP_RETURN_STORAGE_CONTRACT}".`);
  }
  if (!isCanonicalUuid(value.id)) issues.push("return.id is invalid.");
  if (!isCanonicalUuid(value.orderId)) issues.push("return.orderId is invalid.");
  if (!isOwnerSegment(value.ownerSegment)) issues.push("return.ownerSegment is invalid.");
  if (!(npShopReturnStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("return.status is invalid.");
  }
  for (const key of ["revision", "orderRevision"] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) {
      issues.push(`return.${key} is invalid.`);
    }
  }
  analyzeLines(value.lines, "return.lines", issues);
  if (!(npShopReturnReasons as readonly unknown[]).includes(value.reason)) {
    issues.push("return.reason is invalid.");
  }
  if (value.detail !== null && !isBoundedText(value.detail, npShopReturnLimits.detailLength)) {
    issues.push("return.detail is invalid.");
  }
  if (
    value.operatorNote !== null &&
    !isBoundedText(value.operatorNote, npShopReturnLimits.operatorNoteLength)
  ) {
    issues.push("return.operatorNote is invalid.");
  }
  if (!(npShopReturnInventoryOutcomes as readonly unknown[]).includes(value.inventoryOutcome)) {
    issues.push("return.inventoryOutcome is invalid.");
  }
  for (const key of ["requestedAt", "updatedAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`return.${key} is invalid.`);
  }
  for (const key of ["decidedAt", "receivedAt"] as const) {
    if (value[key] !== null && !isCanonicalIso(value[key]))
      issues.push(`return.${key} is invalid.`);
  }
  if (
    value.status === "requested" &&
    (value.operatorNote !== null ||
      value.inventoryOutcome !== "pending" ||
      value.decidedAt !== null ||
      value.receivedAt !== null)
  ) {
    issues.push("requested returns cannot contain staff decision or inventory metadata.");
  }
  if (
    value.status === "approved" &&
    (value.inventoryOutcome !== "pending" || value.decidedAt === null || value.receivedAt !== null)
  ) {
    issues.push("approved returns require a decision and pending receipt inventory.");
  }
  if (
    (value.status === "rejected" || value.status === "cancelled") &&
    (value.inventoryOutcome !== "not-required" ||
      value.decidedAt === null ||
      value.receivedAt !== null)
  ) {
    issues.push("rejected or cancelled returns require one terminal decision without receipt.");
  }
  if (
    value.status === "rejected" &&
    !isBoundedText(value.operatorNote, npShopReturnLimits.operatorNoteLength)
  ) {
    issues.push("rejected returns require an operator note.");
  }
  if (value.status === "cancelled" && value.operatorNote !== null) {
    issues.push("owner-cancelled returns cannot contain an operator note.");
  }
  if (
    value.status === "received" &&
    (value.inventoryOutcome === "pending" || value.decidedAt === null || value.receivedAt === null)
  ) {
    issues.push("received returns require terminal inventory and decision timestamps.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.requestedAt)
  ) {
    issues.push("return.updatedAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.decidedAt) &&
    isCanonicalIso(value.requestedAt) &&
    new Date(value.decidedAt) < new Date(value.requestedAt)
  ) {
    issues.push("return.decidedAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.receivedAt) &&
    isCanonicalIso(value.decidedAt) &&
    new Date(value.receivedAt) < new Date(value.decidedAt)
  ) {
    issues.push("return.receivedAt cannot precede decidedAt.");
  }
  if (
    isCanonicalIso(value.updatedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.updatedAt) > new Date(value.purgeAt)
  ) {
    issues.push("return.updatedAt cannot follow purgeAt.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.purgeAt) &&
    new Date(value.requestedAt) >= new Date(value.purgeAt)
  ) {
    issues.push("return.requestedAt must precede purgeAt.");
  }
  if (
    value.status === "requested" &&
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt !== value.requestedAt
  ) {
    issues.push("requested return.updatedAt must equal requestedAt.");
  }
  if (
    (value.status === "approved" || value.status === "rejected" || value.status === "cancelled") &&
    isCanonicalIso(value.decidedAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt !== value.decidedAt
  ) {
    issues.push("decided return.updatedAt must equal decidedAt.");
  }
  if (
    value.status === "received" &&
    isCanonicalIso(value.receivedAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt !== value.receivedAt
  ) {
    issues.push("received return.updatedAt must equal receivedAt.");
  }
  return issues;
}

export function npRequireStoredShopReturn(value: unknown): NpShopStoredReturn {
  const issues = npAnalyzeStoredShopReturn(value);
  if (issues.length) throw new NpShopReturnContractError("Invalid stored Shop return", issues);
  return value as NpShopStoredReturn;
}

export function npProjectShopReturn(
  value: NpShopStoredReturn,
  logistics?: NpShopReturnLogistics | null,
): NpShopReturn {
  return {
    contract: NP_SHOP_RETURN_CONTRACT,
    id: value.id,
    orderId: value.orderId,
    status: value.status,
    revision: value.revision,
    lines: value.lines,
    reason: value.reason,
    detail: value.detail,
    inventoryOutcome: value.inventoryOutcome,
    requestedAt: value.requestedAt,
    updatedAt: value.updatedAt,
    decidedAt: value.decidedAt,
    receivedAt: value.receivedAt,
    ...(logistics ? { logistics } : {}),
  };
}

const publicKeys = [
  "contract",
  "id",
  "orderId",
  "status",
  "revision",
  "lines",
  "reason",
  "detail",
  "inventoryOutcome",
  "requestedAt",
  "updatedAt",
  "decidedAt",
  "receivedAt",
] as const;

export function npAnalyzeShopReturn(value: unknown): string[] {
  if (!isRecord(value)) return ["return must be a plain object."];
  const issues: string[] = [];
  for (const key of Object.keys(value)) {
    if (![...publicKeys, "logistics"].includes(key)) {
      issues.push(`return.${key} is not supported.`);
    }
  }
  for (const key of publicKeys) {
    if (!Object.hasOwn(value, key)) issues.push(`return.${key} is required.`);
  }
  if (value.contract !== NP_SHOP_RETURN_CONTRACT) {
    issues.push(`return.contract must equal "${NP_SHOP_RETURN_CONTRACT}".`);
  }
  if (!isCanonicalUuid(value.id)) issues.push("return.id is invalid.");
  if (!isCanonicalUuid(value.orderId)) issues.push("return.orderId is invalid.");
  if (!(npShopReturnStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("return.status is invalid.");
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    issues.push("return.revision is invalid.");
  }
  analyzeLines(value.lines, "return.lines", issues);
  if (!(npShopReturnReasons as readonly unknown[]).includes(value.reason)) {
    issues.push("return.reason is invalid.");
  }
  if (value.detail !== null && !isBoundedText(value.detail, npShopReturnLimits.detailLength)) {
    issues.push("return.detail is invalid.");
  }
  if (!(npShopReturnInventoryOutcomes as readonly unknown[]).includes(value.inventoryOutcome)) {
    issues.push("return.inventoryOutcome is invalid.");
  }
  if (Object.hasOwn(value, "logistics")) {
    issues.push(...npAnalyzeShopReturnLogistics(value.logistics).map((issue) => `return.${issue}`));
  }
  for (const key of ["requestedAt", "updatedAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`return.${key} is invalid.`);
  }
  for (const key of ["decidedAt", "receivedAt"] as const) {
    if (value[key] !== null && !isCanonicalIso(value[key]))
      issues.push(`return.${key} is invalid.`);
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.updatedAt) &&
    new Date(value.updatedAt) < new Date(value.requestedAt)
  ) {
    issues.push("return.updatedAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.decidedAt) &&
    isCanonicalIso(value.requestedAt) &&
    new Date(value.decidedAt) < new Date(value.requestedAt)
  ) {
    issues.push("return.decidedAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.receivedAt) &&
    isCanonicalIso(value.decidedAt) &&
    new Date(value.receivedAt) < new Date(value.decidedAt)
  ) {
    issues.push("return.receivedAt cannot precede decidedAt.");
  }
  if (
    value.status === "requested" &&
    (value.inventoryOutcome !== "pending" || value.decidedAt !== null || value.receivedAt !== null)
  ) {
    issues.push("requested returns cannot contain decision or inventory metadata.");
  }
  if (
    value.status === "approved" &&
    (value.inventoryOutcome !== "pending" || value.decidedAt === null || value.receivedAt !== null)
  ) {
    issues.push("approved returns require a decision and pending inventory.");
  }
  if (
    (value.status === "rejected" || value.status === "cancelled") &&
    (value.inventoryOutcome !== "not-required" ||
      value.decidedAt === null ||
      value.receivedAt !== null)
  ) {
    issues.push("rejected or cancelled returns require one terminal decision.");
  }
  if (
    value.status === "received" &&
    (value.inventoryOutcome === "pending" || value.decidedAt === null || value.receivedAt === null)
  ) {
    issues.push("received returns require terminal inventory and timestamps.");
  }
  if (
    value.status === "requested" &&
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt !== value.requestedAt
  ) {
    issues.push("requested return.updatedAt must equal requestedAt.");
  }
  if (
    (value.status === "approved" || value.status === "rejected" || value.status === "cancelled") &&
    isCanonicalIso(value.decidedAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt !== value.decidedAt
  ) {
    issues.push("decided return.updatedAt must equal decidedAt.");
  }
  if (
    value.status === "received" &&
    isCanonicalIso(value.receivedAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt !== value.receivedAt
  ) {
    issues.push("received return.updatedAt must equal receivedAt.");
  }
  return issues;
}

export function npRequireShopReturn(value: unknown): NpShopReturn {
  const issues = npAnalyzeShopReturn(value);
  if (issues.length) throw new NpShopReturnContractError("Invalid Shop return", issues);
  return value as NpShopReturn;
}

export function npRequireShopReturnRequestInput(value: unknown): NpShopReturnRequestInput {
  if (!isRecord(value)) {
    throw new NpShopReturnContractError("Invalid Shop return request", [
      "return request must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    ["orderId", "expectedOrderRevision", "lines", "reason", "detail"],
    "request",
    issues,
  );
  if (!isCanonicalUuid(value.orderId)) issues.push("request.orderId is invalid.");
  if (
    !Number.isSafeInteger(value.expectedOrderRevision) ||
    (value.expectedOrderRevision as number) < 1
  ) {
    issues.push("request.expectedOrderRevision is invalid.");
  }
  analyzeLines(value.lines, "request.lines", issues);
  if (!(npShopReturnReasons as readonly unknown[]).includes(value.reason)) {
    issues.push("request.reason is invalid.");
  }
  if (value.detail !== null && !isBoundedText(value.detail, npShopReturnLimits.detailLength)) {
    issues.push("request.detail is invalid.");
  }
  if (issues.length) throw new NpShopReturnContractError("Invalid Shop return request", issues);
  return value as unknown as NpShopReturnRequestInput;
}

export function npRequireShopReturnCancelInput(value: unknown): NpShopReturnCancelInput {
  if (!isRecord(value)) {
    throw new NpShopReturnContractError("Invalid Shop return cancellation", [
      "return cancellation must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["orderId", "expectedRevision"], "cancellation", issues);
  if (!isCanonicalUuid(value.orderId)) issues.push("cancellation.orderId is invalid.");
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1) {
    issues.push("cancellation.expectedRevision is invalid.");
  }
  if (issues.length)
    throw new NpShopReturnContractError("Invalid Shop return cancellation", issues);
  return value as unknown as NpShopReturnCancelInput;
}

function requireStaffInput(value: unknown, noteRequired: boolean): NpShopReturnStaffInput {
  if (!isRecord(value)) {
    throw new NpShopReturnContractError("Invalid Shop return staff action", [
      "staff action must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  const row = isRecord(value.row) ? value.row : null;
  const values = isRecord(value.values) ? value.values : null;
  if (!row) issues.push("payload.row must be a plain object.");
  if (!values) issues.push("payload.values must be a plain object.");
  if (row) {
    exactKeys(row, ["id", "returnRevision"], "payload.row", issues);
    if (!isCanonicalUuid(row.id)) issues.push("payload.row.id is invalid.");
    if (!Number.isSafeInteger(row.returnRevision) || (row.returnRevision as number) < 1) {
      issues.push("payload.row.returnRevision is invalid.");
    }
  }
  if (values) {
    exactKeys(values, ["operatorNote"], "payload.values", issues);
    if (
      (noteRequired &&
        !isBoundedText(values.operatorNote, npShopReturnLimits.operatorNoteLength)) ||
      (!noteRequired &&
        values.operatorNote !== null &&
        values.operatorNote !== "" &&
        !isBoundedText(values.operatorNote, npShopReturnLimits.operatorNoteLength))
    ) {
      issues.push("payload.values.operatorNote is invalid.");
    }
  }
  if (issues.length)
    throw new NpShopReturnContractError("Invalid Shop return staff action", issues);
  return {
    orderId: row!.id as string,
    expectedRevision: row!.returnRevision as number,
    operatorNote:
      typeof values!.operatorNote === "string" && values!.operatorNote.length > 0
        ? values!.operatorNote
        : null,
  };
}

export function npRequireShopReturnApproveInput(value: unknown): NpShopReturnStaffInput {
  return requireStaffInput(value, false);
}

export function npRequireShopReturnRejectInput(value: unknown): NpShopReturnStaffInput {
  return requireStaffInput(value, true);
}

export function npRequireShopReturnReceiveInput(value: unknown): NpShopReturnStaffInput {
  return requireStaffInput(value, false);
}
