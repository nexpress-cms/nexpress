export const NP_SHOP_CARRIER_LABEL_ACQUISITION_REQUEST_CONTRACT =
  "np.shop-carrier-label-acquisition-request.v1" as const;
export const NP_SHOP_CARRIER_LABEL_ACQUISITION_RESULT_CONTRACT =
  "np.shop-carrier-label-acquisition-result.v1" as const;
export const NP_SHOP_CARRIER_LABEL_ACQUISITION_STORAGE_CONTRACT =
  "np.shop-carrier-label-acquisition-storage.v1" as const;

export const npShopCarrierLabelAcquisitionOperations = ["purchase", "regenerate"] as const;
export type NpShopCarrierLabelAcquisitionOperation =
  (typeof npShopCarrierLabelAcquisitionOperations)[number];

export const npShopCarrierLabelAcquisitionStatuses = [
  "pending",
  "provider-confirmed",
  "completed",
  "manual-review",
] as const;
export type NpShopCarrierLabelAcquisitionStatus =
  (typeof npShopCarrierLabelAcquisitionStatuses)[number];

export const npShopCarrierLabelAcquisitionTargets = ["outbound", "replacement"] as const;
export type NpShopCarrierLabelAcquisitionTarget =
  (typeof npShopCarrierLabelAcquisitionTargets)[number];

export const npShopCarrierLabelAcquisitionLimits = Object.freeze({
  providerIdLength: 32,
  referenceLength: 200,
  carrierLength: 80,
  trackingNumberLength: 120,
  providerErrorCodeLength: 100,
  maximumGeneration: 1_000,
  futureToleranceSeconds: 30,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopCarrierLabelAcquisitionRequest {
  contract: typeof NP_SHOP_CARRIER_LABEL_ACQUISITION_REQUEST_CONTRACT;
  acquisitionId: string;
  shipmentId: string;
  orderId: string;
  generation: number;
  operation: NpShopCarrierLabelAcquisitionOperation;
  bookingReference: string;
  carrier: string;
  trackingNumber: string;
  replacesLabelReference: string | null;
  requestedAt: string;
}

export interface NpShopCarrierLabelAcquisitionResult {
  contract: typeof NP_SHOP_CARRIER_LABEL_ACQUISITION_RESULT_CONTRACT;
  acquisitionId: string;
  shipmentId: string;
  orderId: string;
  generation: number;
  operation: NpShopCarrierLabelAcquisitionOperation;
  labelReference: string;
  acquiredAt: string;
}

export interface NpShopStoredCarrierLabelAcquisition {
  contract: typeof NP_SHOP_CARRIER_LABEL_ACQUISITION_STORAGE_CONTRACT;
  id: string;
  shipmentId: string;
  orderId: string;
  target: NpShopCarrierLabelAcquisitionTarget;
  exchangeId: string | null;
  providerId: string;
  status: NpShopCarrierLabelAcquisitionStatus;
  revision: number;
  sourceRevision: number;
  generation: number;
  operation: NpShopCarrierLabelAcquisitionOperation;
  bookingReference: string;
  carrier: string;
  trackingNumber: string;
  replacesLabelReference: string | null;
  labelReference: string | null;
  providerErrorCode: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopCarrierLabelAcquisitionActionInput {
  orderId: string;
  shipmentId: string;
  target: NpShopCarrierLabelAcquisitionTarget;
  exchangeId: string | null;
  expectedRevision: number;
}

export class NpShopCarrierLabelAcquisitionContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopCarrierLabelAcquisitionContractError";
    this.issues = issues;
  }
}

export class NpShopCarrierLabelAcquisitionConflictError extends Error {
  readonly code:
    | "label_acquisition_not_supported"
    | "label_acquisition_booking_not_found"
    | "label_acquisition_revision_conflict"
    | "label_acquisition_tracking_started"
    | "label_acquisition_state_conflict"
    | "label_acquisition_result_mismatch"
    | "label_acquisition_manual_review";

  constructor(code: NpShopCarrierLabelAcquisitionConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopCarrierLabelAcquisitionConflictError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const providerErrorPattern = /^[a-z][a-z0-9-]{0,99}$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

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

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum;
}

function isOperation(value: unknown): value is NpShopCarrierLabelAcquisitionOperation {
  return (npShopCarrierLabelAcquisitionOperations as readonly unknown[]).includes(value);
}

function isStatus(value: unknown): value is NpShopCarrierLabelAcquisitionStatus {
  return (npShopCarrierLabelAcquisitionStatuses as readonly unknown[]).includes(value);
}

function isTarget(value: unknown): value is NpShopCarrierLabelAcquisitionTarget {
  return (npShopCarrierLabelAcquisitionTargets as readonly unknown[]).includes(value);
}

function analyzeRequestLike(
  value: Record<string, unknown>,
  contract: string,
  path: string,
  issues: string[],
): void {
  if (value.contract !== contract) issues.push(`${path}.contract is invalid.`);
  for (const key of ["acquisitionId", "shipmentId", "orderId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key])) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (!isPositiveInteger(value.generation, npShopCarrierLabelAcquisitionLimits.maximumGeneration)) {
    issues.push(`${path}.generation is invalid.`);
  }
  if (!isOperation(value.operation)) issues.push(`${path}.operation is invalid.`);
  if (value.operation === "purchase" && value.generation !== 1) {
    issues.push(`${path}.purchase must use generation 1.`);
  }
  if (value.operation === "regenerate" && value.generation === 1) {
    issues.push(`${path}.regenerate must use generation 2 or later.`);
  }
}

export function npAnalyzeShopCarrierLabelAcquisitionRequest(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier label acquisition request must be a plain object."];
  const issues: string[] = [];
  const path = "carrier label acquisition request";
  exactKeys(
    value,
    [
      "contract",
      "acquisitionId",
      "shipmentId",
      "orderId",
      "generation",
      "operation",
      "bookingReference",
      "carrier",
      "trackingNumber",
      "replacesLabelReference",
      "requestedAt",
    ],
    path,
    issues,
  );
  analyzeRequestLike(value, NP_SHOP_CARRIER_LABEL_ACQUISITION_REQUEST_CONTRACT, path, issues);
  if (
    typeof value.bookingReference !== "string" ||
    !referencePattern.test(value.bookingReference)
  ) {
    issues.push(`${path}.bookingReference is invalid.`);
  }
  if (
    typeof value.carrier !== "string" ||
    !value.carrier.trim() ||
    value.carrier.trim() !== value.carrier ||
    value.carrier.length > npShopCarrierLabelAcquisitionLimits.carrierLength
  ) {
    issues.push(`${path}.carrier is invalid.`);
  }
  if (
    typeof value.trackingNumber !== "string" ||
    !value.trackingNumber.trim() ||
    value.trackingNumber.trim() !== value.trackingNumber ||
    value.trackingNumber.length > npShopCarrierLabelAcquisitionLimits.trackingNumberLength
  ) {
    issues.push(`${path}.trackingNumber is invalid.`);
  }
  if (
    value.replacesLabelReference !== null &&
    (typeof value.replacesLabelReference !== "string" ||
      !referencePattern.test(value.replacesLabelReference))
  ) {
    issues.push(`${path}.replacesLabelReference is invalid.`);
  }
  if (value.operation === "purchase" && value.replacesLabelReference !== null) {
    issues.push(`${path}.purchase cannot replace a label reference.`);
  }
  if (value.operation === "regenerate" && value.replacesLabelReference === null) {
    issues.push(`${path}.regenerate requires a replaced label reference.`);
  }
  if (!isIso(value.requestedAt)) issues.push(`${path}.requestedAt is invalid.`);
  return issues;
}

export function npRequireShopCarrierLabelAcquisitionRequest(
  value: unknown,
): NpShopCarrierLabelAcquisitionRequest {
  const issues = npAnalyzeShopCarrierLabelAcquisitionRequest(value);
  if (issues.length) {
    throw new NpShopCarrierLabelAcquisitionContractError(
      "Invalid Shop carrier label acquisition request",
      issues,
    );
  }
  return value as NpShopCarrierLabelAcquisitionRequest;
}

export function npAnalyzeShopCarrierLabelAcquisitionResult(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier label acquisition result must be a plain object."];
  const issues: string[] = [];
  const path = "carrier label acquisition result";
  exactKeys(
    value,
    [
      "contract",
      "acquisitionId",
      "shipmentId",
      "orderId",
      "generation",
      "operation",
      "labelReference",
      "acquiredAt",
    ],
    path,
    issues,
  );
  analyzeRequestLike(value, NP_SHOP_CARRIER_LABEL_ACQUISITION_RESULT_CONTRACT, path, issues);
  if (typeof value.labelReference !== "string" || !referencePattern.test(value.labelReference)) {
    issues.push(`${path}.labelReference is invalid.`);
  }
  if (!isIso(value.acquiredAt)) issues.push(`${path}.acquiredAt is invalid.`);
  return issues;
}

export function npRequireShopCarrierLabelAcquisitionResult(
  value: unknown,
): NpShopCarrierLabelAcquisitionResult {
  const issues = npAnalyzeShopCarrierLabelAcquisitionResult(value);
  if (issues.length) {
    throw new NpShopCarrierLabelAcquisitionContractError(
      "Invalid Shop carrier label acquisition result",
      issues,
    );
  }
  return value as NpShopCarrierLabelAcquisitionResult;
}

export function npAnalyzeStoredShopCarrierLabelAcquisition(value: unknown): string[] {
  if (!isRecord(value)) return ["stored carrier label acquisition must be a plain object."];
  const issues: string[] = [];
  const path = "stored carrier label acquisition";
  exactKeys(
    value,
    [
      "contract",
      "id",
      "shipmentId",
      "orderId",
      "target",
      "exchangeId",
      "providerId",
      "status",
      "revision",
      "sourceRevision",
      "generation",
      "operation",
      "bookingReference",
      "carrier",
      "trackingNumber",
      "replacesLabelReference",
      "labelReference",
      "providerErrorCode",
      "requestedAt",
      "confirmedAt",
      "updatedAt",
      "purgeAt",
    ],
    path,
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_LABEL_ACQUISITION_STORAGE_CONTRACT) {
    issues.push(`${path}.contract is invalid.`);
  }
  for (const key of ["id", "shipmentId", "orderId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key])) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (!isTarget(value.target)) issues.push(`${path}.target is invalid.`);
  if (
    value.exchangeId !== null &&
    (typeof value.exchangeId !== "string" || !uuidPattern.test(value.exchangeId))
  ) {
    issues.push(`${path}.exchangeId is invalid.`);
  }
  if (
    (value.target === "outbound" && value.exchangeId !== null) ||
    (value.target === "replacement" && value.exchangeId === null)
  ) {
    issues.push(`${path}.target and exchangeId are inconsistent.`);
  }
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId)) {
    issues.push(`${path}.providerId is invalid.`);
  }
  if (!isStatus(value.status)) issues.push(`${path}.status is invalid.`);
  if (!isPositiveInteger(value.revision)) issues.push(`${path}.revision is invalid.`);
  if (!isPositiveInteger(value.sourceRevision)) issues.push(`${path}.sourceRevision is invalid.`);
  if (!isPositiveInteger(value.generation, npShopCarrierLabelAcquisitionLimits.maximumGeneration)) {
    issues.push(`${path}.generation is invalid.`);
  }
  if (!isOperation(value.operation)) issues.push(`${path}.operation is invalid.`);
  for (const key of ["bookingReference", "replacesLabelReference", "labelReference"] as const) {
    const candidate = value[key];
    if (
      candidate !== null &&
      (typeof candidate !== "string" || !referencePattern.test(candidate))
    ) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (typeof value.bookingReference !== "string")
    issues.push(`${path}.bookingReference is invalid.`);
  for (const [key, maximum] of [
    ["carrier", npShopCarrierLabelAcquisitionLimits.carrierLength],
    ["trackingNumber", npShopCarrierLabelAcquisitionLimits.trackingNumberLength],
  ] as const) {
    const candidate = value[key];
    if (
      typeof candidate !== "string" ||
      !candidate.trim() ||
      candidate.trim() !== candidate ||
      candidate.length > maximum
    ) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (
    value.providerErrorCode !== null &&
    (typeof value.providerErrorCode !== "string" ||
      !providerErrorPattern.test(value.providerErrorCode))
  ) {
    issues.push(`${path}.providerErrorCode is invalid.`);
  }
  for (const key of ["requestedAt", "confirmedAt", "updatedAt", "purgeAt"] as const) {
    if (value[key] !== null && !isIso(value[key])) issues.push(`${path}.${key} is invalid.`);
  }
  if (value.operation === "purchase" && value.replacesLabelReference !== null) {
    issues.push(`${path}.purchase cannot replace a label reference.`);
  }
  if (value.operation === "regenerate" && value.replacesLabelReference === null) {
    issues.push(`${path}.regenerate requires a replaced label reference.`);
  }
  if (value.operation === "purchase" && value.generation !== 1) {
    issues.push(`${path}.purchase must use generation 1.`);
  }
  if (value.operation === "regenerate" && value.generation === 1) {
    issues.push(`${path}.regenerate must use generation 2 or later.`);
  }
  const confirmationComplete = value.labelReference !== null && value.confirmedAt !== null;
  const confirmationEmpty = value.labelReference === null && value.confirmedAt === null;
  if (
    (value.status === "pending" && !confirmationEmpty) ||
    ((value.status === "provider-confirmed" || value.status === "completed") &&
      !confirmationComplete) ||
    (value.status === "manual-review" && !confirmationComplete && !confirmationEmpty)
  ) {
    issues.push(`${path}.provider confirmation fields do not match status.`);
  }
  if (value.status !== "manual-review" && value.providerErrorCode !== null) {
    issues.push(`${path}.providerErrorCode is allowed only in manual-review.`);
  }
  if (value.status === "manual-review" && value.providerErrorCode === null) {
    issues.push(`${path}.manual-review requires providerErrorCode.`);
  }
  if (
    isIso(value.requestedAt) &&
    isIso(value.updatedAt) &&
    new Date(value.updatedAt).getTime() < new Date(value.requestedAt).getTime()
  ) {
    issues.push(`${path}.updatedAt must not precede requestedAt.`);
  }
  if (
    isIso(value.requestedAt) &&
    isIso(value.confirmedAt) &&
    new Date(value.confirmedAt).getTime() < new Date(value.requestedAt).getTime()
  ) {
    issues.push(`${path}.confirmedAt must not precede requestedAt.`);
  }
  if (
    isIso(value.confirmedAt) &&
    isIso(value.updatedAt) &&
    new Date(value.updatedAt).getTime() < new Date(value.confirmedAt).getTime()
  ) {
    issues.push(`${path}.updatedAt must not precede confirmedAt.`);
  }
  if (
    isIso(value.requestedAt) &&
    isIso(value.purgeAt) &&
    new Date(value.purgeAt).getTime() <= new Date(value.requestedAt).getTime()
  ) {
    issues.push(`${path}.purgeAt must follow requestedAt.`);
  }
  return issues;
}

export function npRequireStoredShopCarrierLabelAcquisition(
  value: unknown,
): NpShopStoredCarrierLabelAcquisition {
  const issues = npAnalyzeStoredShopCarrierLabelAcquisition(value);
  if (issues.length) {
    throw new NpShopCarrierLabelAcquisitionContractError(
      "Invalid stored Shop carrier label acquisition",
      issues,
    );
  }
  return value as NpShopStoredCarrierLabelAcquisition;
}

export function npRequireShopCarrierLabelAcquisitionActionInput(
  value: unknown,
): NpShopCarrierLabelAcquisitionActionInput {
  if (!isRecord(value)) {
    throw new NpShopCarrierLabelAcquisitionContractError(
      "Invalid Shop carrier label acquisition action",
      ["carrier label acquisition action must be a plain object."],
    );
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  if (!isRecord(value.row)) issues.push("payload.row must be a plain object.");
  if (!isRecord(value.values)) issues.push("payload.values must be a plain object.");
  if (issues.length) {
    throw new NpShopCarrierLabelAcquisitionContractError(
      "Invalid Shop carrier label acquisition action",
      issues,
    );
  }
  const row = value.row as Record<string, unknown>;
  const values = value.values as Record<string, unknown>;
  const path = "payload.row";
  exactKeys(row, ["id", "shipmentId", "target", "exchangeId", "expectedRevision"], path, issues);
  exactKeys(values, [], "payload.values", issues);
  for (const key of ["id", "shipmentId"] as const) {
    if (typeof row[key] !== "string" || !uuidPattern.test(row[key])) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (!isTarget(row.target)) issues.push(`${path}.target is invalid.`);
  if (
    row.exchangeId !== null &&
    (typeof row.exchangeId !== "string" || !uuidPattern.test(row.exchangeId))
  ) {
    issues.push(`${path}.exchangeId is invalid.`);
  }
  if (
    (row.target === "outbound" && row.exchangeId !== null) ||
    (row.target === "replacement" && row.exchangeId === null)
  ) {
    issues.push(`${path}.target and exchangeId are inconsistent.`);
  }
  if (!Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 0) {
    issues.push(`${path}.expectedRevision is invalid.`);
  }
  if (issues.length) {
    throw new NpShopCarrierLabelAcquisitionContractError(
      "Invalid Shop carrier label acquisition action",
      issues,
    );
  }
  return {
    orderId: row.id as string,
    shipmentId: row.shipmentId as string,
    target: row.target as NpShopCarrierLabelAcquisitionTarget,
    exchangeId: row.exchangeId as string | null,
    expectedRevision: row.expectedRevision as number,
  };
}
