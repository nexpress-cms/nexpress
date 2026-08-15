export const NP_SHOP_CARRIER_LABEL_VOID_REQUEST_CONTRACT =
  "np.shop-carrier-label-void-request.v1" as const;
export const NP_SHOP_CARRIER_LABEL_VOID_RESULT_CONTRACT =
  "np.shop-carrier-label-void-result.v1" as const;
export const NP_SHOP_CARRIER_LABEL_VOID_STORAGE_CONTRACT =
  "np.shop-carrier-label-void-storage.v1" as const;

export const npShopCarrierLabelVoidStatuses = [
  "pending",
  "provider-confirmed",
  "completed",
  "manual-review",
] as const;
export type NpShopCarrierLabelVoidStatus = (typeof npShopCarrierLabelVoidStatuses)[number];

export const npShopCarrierLabelVoidTargets = ["outbound", "replacement"] as const;
export type NpShopCarrierLabelVoidTarget = (typeof npShopCarrierLabelVoidTargets)[number];

export const npShopCarrierLabelVoidLimits = Object.freeze({
  referenceLength: 200,
  providerErrorCodeLength: 100,
  maximumGeneration: 1_000,
  futureToleranceSeconds: 30,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopCarrierLabelVoidRequest {
  contract: typeof NP_SHOP_CARRIER_LABEL_VOID_REQUEST_CONTRACT;
  voidId: string;
  acquisitionId: string;
  shipmentId: string;
  orderId: string;
  generation: number;
  bookingReference: string;
  labelReference: string;
  requestedAt: string;
}

export interface NpShopCarrierLabelVoidResult {
  contract: typeof NP_SHOP_CARRIER_LABEL_VOID_RESULT_CONTRACT;
  voidId: string;
  acquisitionId: string;
  shipmentId: string;
  orderId: string;
  generation: number;
  labelReference: string;
  voidedAt: string;
}

export interface NpShopStoredCarrierLabelVoid {
  contract: typeof NP_SHOP_CARRIER_LABEL_VOID_STORAGE_CONTRACT;
  id: string;
  acquisitionId: string;
  shipmentId: string;
  orderId: string;
  target: NpShopCarrierLabelVoidTarget;
  exchangeId: string | null;
  providerId: string;
  status: NpShopCarrierLabelVoidStatus;
  revision: number;
  sourceRevision: number;
  generation: number;
  bookingReference: string;
  labelReference: string;
  providerErrorCode: string | null;
  requestedAt: string;
  voidedAt: string | null;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopCarrierLabelVoidActionInput {
  orderId: string;
  shipmentId: string;
  target: NpShopCarrierLabelVoidTarget;
  exchangeId: string | null;
  acquisitionId: string;
  generation: number;
  expectedAcquisitionRevision: number;
  expectedVoidRevision: number;
}

export class NpShopCarrierLabelVoidContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopCarrierLabelVoidContractError";
    this.issues = issues;
  }
}

export class NpShopCarrierLabelVoidConflictError extends Error {
  readonly code:
    | "label_void_not_supported"
    | "label_void_acquisition_not_found"
    | "label_void_revision_conflict"
    | "label_void_tracking_started"
    | "label_void_state_conflict"
    | "label_void_result_mismatch"
    | "label_void_manual_review";

  constructor(code: NpShopCarrierLabelVoidConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopCarrierLabelVoidConflictError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const providerErrorPattern = /^[a-z][a-z0-9-]{0,99}$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

function readDataRecord(
  value: unknown,
  expected: readonly string[],
  path: string,
  issues: string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    issues.push(`${path} must be a plain object.`);
    return null;
  }
  try {
    if (Array.isArray(value)) {
      issues.push(`${path} must be a plain object.`);
      return null;
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      issues.push(`${path} must be a plain object.`);
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > expected.length + 8) {
      issues.push(`${path} contains too many properties.`);
      return null;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") {
        issues.push(`${path} cannot contain symbol properties.`);
        continue;
      }
      if (!expected.includes(key)) {
        issues.push(`${path}.${key} is not supported.`);
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        issues.push(`${path}.${key} must be an enumerable data property.`);
        continue;
      }
      result[key] = descriptor.value;
    }
    for (const key of expected) {
      if (!Object.hasOwn(result, key)) issues.push(`${path}.${key} is required.`);
    }
    return result;
  } catch {
    issues.push(`${path} could not be inspected safely.`);
    return null;
  }
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isReference(value: unknown): value is string {
  return typeof value === "string" && referencePattern.test(value);
}

function isPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum;
}

const requestKeys = [
  "contract",
  "voidId",
  "acquisitionId",
  "shipmentId",
  "orderId",
  "generation",
  "bookingReference",
  "labelReference",
  "requestedAt",
] as const;

const resultKeys = [
  "contract",
  "voidId",
  "acquisitionId",
  "shipmentId",
  "orderId",
  "generation",
  "labelReference",
  "voidedAt",
] as const;

function analyzeIdentity(value: Record<string, unknown>, path: string, issues: string[]): void {
  for (const key of ["voidId", "acquisitionId", "shipmentId", "orderId"] as const) {
    if (!isUuid(value[key])) issues.push(`${path}.${key} is invalid.`);
  }
  if (!isPositiveInteger(value.generation, npShopCarrierLabelVoidLimits.maximumGeneration)) {
    issues.push(`${path}.generation is invalid.`);
  }
  if (!isReference(value.labelReference)) issues.push(`${path}.labelReference is invalid.`);
}

export function npAnalyzeShopCarrierLabelVoidRequest(value: unknown): string[] {
  const issues: string[] = [];
  const path = "carrier label void request";
  const request = readDataRecord(value, requestKeys, path, issues);
  if (!request) return issues;
  if (request.contract !== NP_SHOP_CARRIER_LABEL_VOID_REQUEST_CONTRACT) {
    issues.push(`${path}.contract is invalid.`);
  }
  analyzeIdentity(request, path, issues);
  if (!isReference(request.bookingReference)) issues.push(`${path}.bookingReference is invalid.`);
  if (!isIso(request.requestedAt)) issues.push(`${path}.requestedAt is invalid.`);
  return issues;
}

export function npRequireShopCarrierLabelVoidRequest(
  value: unknown,
): NpShopCarrierLabelVoidRequest {
  const issues = npAnalyzeShopCarrierLabelVoidRequest(value);
  if (issues.length > 0) {
    throw new NpShopCarrierLabelVoidContractError(
      "Invalid Shop carrier label void request",
      issues,
    );
  }
  return readDataRecord(
    value,
    requestKeys,
    "carrier label void request",
    [],
  ) as unknown as NpShopCarrierLabelVoidRequest;
}

export function npAnalyzeShopCarrierLabelVoidResult(value: unknown): string[] {
  const issues: string[] = [];
  const path = "carrier label void result";
  const result = readDataRecord(value, resultKeys, path, issues);
  if (!result) return issues;
  if (result.contract !== NP_SHOP_CARRIER_LABEL_VOID_RESULT_CONTRACT) {
    issues.push(`${path}.contract is invalid.`);
  }
  analyzeIdentity(result, path, issues);
  if (!isIso(result.voidedAt)) issues.push(`${path}.voidedAt is invalid.`);
  return issues;
}

export function npRequireShopCarrierLabelVoidResult(value: unknown): NpShopCarrierLabelVoidResult {
  const issues = npAnalyzeShopCarrierLabelVoidResult(value);
  if (issues.length > 0) {
    throw new NpShopCarrierLabelVoidContractError("Invalid Shop carrier label void result", issues);
  }
  return readDataRecord(
    value,
    resultKeys,
    "carrier label void result",
    [],
  ) as unknown as NpShopCarrierLabelVoidResult;
}

const storageKeys = [
  "contract",
  "id",
  "acquisitionId",
  "shipmentId",
  "orderId",
  "target",
  "exchangeId",
  "providerId",
  "status",
  "revision",
  "sourceRevision",
  "generation",
  "bookingReference",
  "labelReference",
  "providerErrorCode",
  "requestedAt",
  "voidedAt",
  "updatedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopCarrierLabelVoid(value: unknown): string[] {
  const issues: string[] = [];
  const path = "stored carrier label void";
  const stored = readDataRecord(value, storageKeys, path, issues);
  if (!stored) return issues;
  if (stored.contract !== NP_SHOP_CARRIER_LABEL_VOID_STORAGE_CONTRACT) {
    issues.push(`${path}.contract is invalid.`);
  }
  for (const key of ["id", "acquisitionId", "shipmentId", "orderId"] as const) {
    if (!isUuid(stored[key])) issues.push(`${path}.${key} is invalid.`);
  }
  if (!(npShopCarrierLabelVoidTargets as readonly unknown[]).includes(stored.target)) {
    issues.push(`${path}.target is invalid.`);
  }
  if (stored.exchangeId !== null && !isUuid(stored.exchangeId)) {
    issues.push(`${path}.exchangeId is invalid.`);
  }
  if (
    (stored.target === "outbound" && stored.exchangeId !== null) ||
    (stored.target === "replacement" && stored.exchangeId === null)
  ) {
    issues.push(`${path}.target and exchangeId are inconsistent.`);
  }
  if (typeof stored.providerId !== "string" || !providerPattern.test(stored.providerId)) {
    issues.push(`${path}.providerId is invalid.`);
  }
  if (!(npShopCarrierLabelVoidStatuses as readonly unknown[]).includes(stored.status)) {
    issues.push(`${path}.status is invalid.`);
  }
  for (const key of ["revision", "sourceRevision"] as const) {
    if (!isPositiveInteger(stored[key])) issues.push(`${path}.${key} is invalid.`);
  }
  if (!isPositiveInteger(stored.generation, npShopCarrierLabelVoidLimits.maximumGeneration)) {
    issues.push(`${path}.generation is invalid.`);
  }
  for (const key of ["bookingReference", "labelReference"] as const) {
    if (!isReference(stored[key])) issues.push(`${path}.${key} is invalid.`);
  }
  if (
    stored.providerErrorCode !== null &&
    (typeof stored.providerErrorCode !== "string" ||
      !providerErrorPattern.test(stored.providerErrorCode))
  ) {
    issues.push(`${path}.providerErrorCode is invalid.`);
  }
  for (const key of ["requestedAt", "voidedAt", "updatedAt", "purgeAt"] as const) {
    if (stored[key] !== null && !isIso(stored[key])) issues.push(`${path}.${key} is invalid.`);
  }
  const confirmationEmpty = stored.voidedAt === null;
  if (
    (stored.status === "pending" && !confirmationEmpty) ||
    ((stored.status === "provider-confirmed" || stored.status === "completed") && confirmationEmpty)
  ) {
    issues.push(`${path}.provider confirmation fields do not match status.`);
  }
  if (stored.status === "manual-review" && stored.providerErrorCode === null) {
    issues.push(`${path}.manual-review requires providerErrorCode.`);
  }
  if (stored.status !== "manual-review" && stored.providerErrorCode !== null) {
    issues.push(`${path}.providerErrorCode is allowed only in manual-review.`);
  }
  if (
    isIso(stored.requestedAt) &&
    isIso(stored.voidedAt) &&
    new Date(stored.voidedAt).getTime() < new Date(stored.requestedAt).getTime()
  ) {
    issues.push(`${path}.voidedAt must not precede requestedAt.`);
  }
  if (
    isIso(stored.requestedAt) &&
    isIso(stored.updatedAt) &&
    new Date(stored.updatedAt).getTime() < new Date(stored.requestedAt).getTime()
  ) {
    issues.push(`${path}.updatedAt must not precede requestedAt.`);
  }
  if (
    isIso(stored.voidedAt) &&
    isIso(stored.updatedAt) &&
    new Date(stored.updatedAt).getTime() < new Date(stored.voidedAt).getTime()
  ) {
    issues.push(`${path}.updatedAt must not precede voidedAt.`);
  }
  if (
    isIso(stored.requestedAt) &&
    isIso(stored.purgeAt) &&
    new Date(stored.purgeAt).getTime() <= new Date(stored.requestedAt).getTime()
  ) {
    issues.push(`${path}.purgeAt must follow requestedAt.`);
  }
  if (
    isIso(stored.updatedAt) &&
    isIso(stored.purgeAt) &&
    new Date(stored.purgeAt).getTime() <= new Date(stored.updatedAt).getTime()
  ) {
    issues.push(`${path}.purgeAt must follow updatedAt.`);
  }
  return issues;
}

export function npRequireStoredShopCarrierLabelVoid(value: unknown): NpShopStoredCarrierLabelVoid {
  const issues = npAnalyzeStoredShopCarrierLabelVoid(value);
  if (issues.length > 0) {
    throw new NpShopCarrierLabelVoidContractError("Invalid stored Shop carrier label void", issues);
  }
  return readDataRecord(
    value,
    storageKeys,
    "stored carrier label void",
    [],
  ) as unknown as NpShopStoredCarrierLabelVoid;
}

export function npRequireShopCarrierLabelVoidActionInput(
  value: unknown,
): NpShopCarrierLabelVoidActionInput {
  const issues: string[] = [];
  const payload = readDataRecord(value, ["row", "values"], "payload", issues);
  if (!payload) {
    throw new NpShopCarrierLabelVoidContractError("Invalid Shop carrier label void action", issues);
  }
  const row = readDataRecord(
    payload.row,
    [
      "id",
      "shipmentId",
      "target",
      "exchangeId",
      "acquisitionId",
      "generation",
      "expectedAcquisitionRevision",
      "expectedVoidRevision",
    ],
    "payload.row",
    issues,
  );
  readDataRecord(payload.values, [], "payload.values", issues);
  if (row) {
    for (const key of ["id", "shipmentId", "acquisitionId"] as const) {
      if (!isUuid(row[key])) issues.push(`payload.row.${key} is invalid.`);
    }
    if (!(npShopCarrierLabelVoidTargets as readonly unknown[]).includes(row.target)) {
      issues.push("payload.row.target is invalid.");
    }
    if (row.exchangeId !== null && !isUuid(row.exchangeId)) {
      issues.push("payload.row.exchangeId is invalid.");
    }
    if (
      (row.target === "outbound" && row.exchangeId !== null) ||
      (row.target === "replacement" && row.exchangeId === null)
    ) {
      issues.push("payload.row.target and exchangeId are inconsistent.");
    }
    if (!isPositiveInteger(row.generation, npShopCarrierLabelVoidLimits.maximumGeneration)) {
      issues.push("payload.row.generation is invalid.");
    }
    for (const key of ["expectedAcquisitionRevision", "expectedVoidRevision"] as const) {
      if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) {
        issues.push(`payload.row.${key} is invalid.`);
      }
    }
  }
  if (issues.length > 0 || !row) {
    throw new NpShopCarrierLabelVoidContractError("Invalid Shop carrier label void action", issues);
  }
  return {
    orderId: row.id as string,
    shipmentId: row.shipmentId as string,
    target: row.target as NpShopCarrierLabelVoidTarget,
    exchangeId: row.exchangeId as string | null,
    acquisitionId: row.acquisitionId as string,
    generation: row.generation as number,
    expectedAcquisitionRevision: row.expectedAcquisitionRevision as number,
    expectedVoidRevision: row.expectedVoidRevision as number,
  };
}
