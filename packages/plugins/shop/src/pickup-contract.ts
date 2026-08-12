export const NP_SHOP_CARRIER_PICKUP_REQUEST_CONTRACT = "np.shop-carrier-pickup-request.v1" as const;
export const NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT = "np.shop-carrier-pickup-result.v1" as const;
export const NP_SHOP_CARRIER_PICKUP_CANCEL_REQUEST_CONTRACT =
  "np.shop-carrier-pickup-cancel-request.v1" as const;
export const NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT =
  "np.shop-carrier-pickup-cancel-result.v1" as const;
export const NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT = "np.shop-carrier-pickup-storage.v2" as const;

export const npShopCarrierPickupTargets = ["outbound", "replacement"] as const;
export type NpShopCarrierPickupTarget = (typeof npShopCarrierPickupTargets)[number];

export const npShopCarrierPickupStatuses = [
  "pending",
  "provider-confirmed",
  "scheduled",
  "cancel-pending",
  "cancel-confirmed",
  "cancelled",
  "manual-review",
] as const;
export type NpShopCarrierPickupStatus = (typeof npShopCarrierPickupStatuses)[number];

export const npShopCarrierPickupLimits = Object.freeze({
  locationReferenceLength: 200,
  pickupReferenceLength: 200,
  providerErrorCodeLength: 100,
  carrierLength: 80,
  trackingNumberLength: 120,
  packageIdLength: 64,
  maximumPackages: 20,
  maximumDimensionMm: 3_000,
  maximumWeightGrams: 500_000,
  minimumWindowSeconds: 15 * 60,
  maximumWindowSeconds: 12 * 60 * 60,
  maximumLeadSeconds: 14 * 24 * 60 * 60,
  futureToleranceSeconds: 30,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopCarrierPickupPackage {
  id: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
}

export interface NpShopCarrierPickupRequest {
  contract: typeof NP_SHOP_CARRIER_PICKUP_REQUEST_CONTRACT;
  pickupId: string;
  shipmentId: string;
  orderId: string;
  bookingReference: string;
  carrier: string;
  trackingNumber: string;
  locationReference: string;
  readyAt: string;
  closeAt: string;
  parcelRevision: number;
  packages: NpShopCarrierPickupPackage[];
  requestedAt: string;
}

export interface NpShopCarrierPickupResult {
  contract: typeof NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT;
  pickupId: string;
  shipmentId: string;
  orderId: string;
  pickupReference: string;
  readyAt: string;
  closeAt: string;
  scheduledAt: string;
}

export interface NpShopCarrierPickupCancelRequest {
  contract: typeof NP_SHOP_CARRIER_PICKUP_CANCEL_REQUEST_CONTRACT;
  cancellationId: string;
  pickupId: string;
  shipmentId: string;
  orderId: string;
  pickupReference: string;
  requestedAt: string;
}

export interface NpShopCarrierPickupCancelResult {
  contract: typeof NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT;
  cancellationId: string;
  pickupId: string;
  shipmentId: string;
  orderId: string;
  cancelledAt: string;
}

export interface NpShopStoredCarrierPickup {
  contract: typeof NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT;
  id: string;
  orderId: string;
  shipmentId: string;
  target: NpShopCarrierPickupTarget;
  exchangeId: string | null;
  providerId: string;
  status: NpShopCarrierPickupStatus;
  revision: number;
  locationReference: string;
  readyAt: string;
  closeAt: string;
  parcelRevision: number;
  packages: NpShopCarrierPickupPackage[];
  pickupReference: string | null;
  providerErrorCode: string | null;
  cancellationId: string | null;
  requestedAt: string;
  scheduledAt: string | null;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopCarrierPickupScheduleInput {
  orderId: string;
  shipmentId: string;
  target: NpShopCarrierPickupTarget;
  exchangeId: string | null;
  expectedRevision: number;
  readyAt: string;
  closeAt: string;
}

export interface NpShopCarrierPickupExistingActionInput {
  orderId: string;
  shipmentId: string;
  target: NpShopCarrierPickupTarget;
  exchangeId: string | null;
  pickupId: string;
  expectedRevision: number;
}

export class NpShopCarrierPickupContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopCarrierPickupContractError";
    this.issues = issues;
  }
}

export class NpShopCarrierPickupConflictError extends Error {
  readonly code:
    | "pickup_not_supported"
    | "pickup_booking_not_found"
    | "pickup_parcels_required"
    | "pickup_tracking_started"
    | "pickup_window_conflict"
    | "pickup_revision_conflict"
    | "pickup_state_conflict"
    | "pickup_result_mismatch"
    | "pickup_manual_review";

  constructor(code: NpShopCarrierPickupConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopCarrierPickupConflictError";
    this.code = code;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const packageIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const providerErrorCodePattern = /^[a-z][a-z0-9-]{0,99}$/u;

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

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function analyzeUuid(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || !canonicalUuidPattern.test(value)) {
    issues.push(`${path} is invalid.`);
  }
}

function analyzeReference(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || !opaqueReferencePattern.test(value)) {
    issues.push(`${path} is invalid.`);
  }
}

function analyzeWindow(readyAt: unknown, closeAt: unknown, path: string, issues: string[]): void {
  if (!isCanonicalIso(readyAt)) issues.push(`${path}.readyAt is invalid.`);
  if (!isCanonicalIso(closeAt)) issues.push(`${path}.closeAt is invalid.`);
  if (!isCanonicalIso(readyAt) || !isCanonicalIso(closeAt)) return;
  const duration = new Date(closeAt).getTime() - new Date(readyAt).getTime();
  if (
    duration < npShopCarrierPickupLimits.minimumWindowSeconds * 1_000 ||
    duration > npShopCarrierPickupLimits.maximumWindowSeconds * 1_000
  ) {
    issues.push(
      `${path} must span between ${npShopCarrierPickupLimits.minimumWindowSeconds.toString()} and ${npShopCarrierPickupLimits.maximumWindowSeconds.toString()} seconds.`,
    );
  }
}

function analyzePackage(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["id", "lengthMm", "widthMm", "heightMm", "weightGrams"], path, issues);
  if (
    typeof value.id !== "string" ||
    value.id.length > npShopCarrierPickupLimits.packageIdLength ||
    !packageIdPattern.test(value.id)
  ) {
    issues.push(`${path}.id is invalid.`);
  }
  for (const key of ["lengthMm", "widthMm", "heightMm"] as const) {
    if (!isPositiveSafeInteger(value[key], npShopCarrierPickupLimits.maximumDimensionMm)) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (!isPositiveSafeInteger(value.weightGrams, npShopCarrierPickupLimits.maximumWeightGrams)) {
    issues.push(`${path}.weightGrams is invalid.`);
  }
}

function analyzePackages(value: unknown, path: string, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopCarrierPickupLimits.maximumPackages
  ) {
    issues.push(
      `${path} must contain between 1 and ${npShopCarrierPickupLimits.maximumPackages.toString()} packages.`,
    );
    return;
  }
  value.forEach((entry, index) => analyzePackage(entry, `${path}[${index.toString()}]`, issues));
  const ids = value
    .filter(isRecord)
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(ids).size !== ids.length) issues.push(`${path} ids must be unique.`);
}

export function npRequireShopCarrierPickupLocationReference(value: unknown): string {
  if (typeof value !== "string" || !opaqueReferencePattern.test(value)) {
    throw new NpShopCarrierPickupContractError("Invalid Shop carrier pickup location", [
      "pickup location reference must be one opaque provider reference of at most 200 characters.",
    ]);
  }
  return value;
}

export function npAnalyzeShopCarrierPickupRequest(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier pickup request must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "pickupId",
      "shipmentId",
      "orderId",
      "bookingReference",
      "carrier",
      "trackingNumber",
      "locationReference",
      "readyAt",
      "closeAt",
      "parcelRevision",
      "packages",
      "requestedAt",
    ],
    "carrier pickup request",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_PICKUP_REQUEST_CONTRACT) {
    issues.push(
      `carrier pickup request.contract must equal "${NP_SHOP_CARRIER_PICKUP_REQUEST_CONTRACT}".`,
    );
  }
  for (const key of ["pickupId", "shipmentId", "orderId"] as const) {
    analyzeUuid(value[key], `carrier pickup request.${key}`, issues);
  }
  for (const key of ["bookingReference", "locationReference"] as const) {
    analyzeReference(value[key], `carrier pickup request.${key}`, issues);
  }
  if (!isBoundedText(value.carrier, npShopCarrierPickupLimits.carrierLength)) {
    issues.push("carrier pickup request.carrier is invalid.");
  }
  if (!isBoundedText(value.trackingNumber, npShopCarrierPickupLimits.trackingNumberLength)) {
    issues.push("carrier pickup request.trackingNumber is invalid.");
  }
  analyzeWindow(value.readyAt, value.closeAt, "carrier pickup request", issues);
  if (!isPositiveSafeInteger(value.parcelRevision, Number.MAX_SAFE_INTEGER)) {
    issues.push("carrier pickup request.parcelRevision is invalid.");
  }
  analyzePackages(value.packages, "carrier pickup request.packages", issues);
  if (!isCanonicalIso(value.requestedAt)) {
    issues.push("carrier pickup request.requestedAt is invalid.");
  } else if (isCanonicalIso(value.closeAt) && value.requestedAt > value.closeAt) {
    issues.push("carrier pickup request.requestedAt cannot follow closeAt.");
  }
  return issues;
}

export function npRequireShopCarrierPickupRequest(value: unknown): NpShopCarrierPickupRequest {
  const issues = npAnalyzeShopCarrierPickupRequest(value);
  if (issues.length)
    throw new NpShopCarrierPickupContractError("Invalid Shop pickup request", issues);
  return value as NpShopCarrierPickupRequest;
}

export function npAnalyzeShopCarrierPickupResult(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier pickup result must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "pickupId",
      "shipmentId",
      "orderId",
      "pickupReference",
      "readyAt",
      "closeAt",
      "scheduledAt",
    ],
    "carrier pickup result",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT) {
    issues.push(
      `carrier pickup result.contract must equal "${NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT}".`,
    );
  }
  for (const key of ["pickupId", "shipmentId", "orderId"] as const) {
    analyzeUuid(value[key], `carrier pickup result.${key}`, issues);
  }
  analyzeReference(value.pickupReference, "carrier pickup result.pickupReference", issues);
  analyzeWindow(value.readyAt, value.closeAt, "carrier pickup result", issues);
  if (!isCanonicalIso(value.scheduledAt)) {
    issues.push("carrier pickup result.scheduledAt is invalid.");
  } else if (isCanonicalIso(value.closeAt) && value.scheduledAt > value.closeAt) {
    issues.push("carrier pickup result.scheduledAt cannot follow closeAt.");
  }
  return issues;
}

export function npRequireShopCarrierPickupResult(value: unknown): NpShopCarrierPickupResult {
  const issues = npAnalyzeShopCarrierPickupResult(value);
  if (issues.length)
    throw new NpShopCarrierPickupContractError("Invalid Shop pickup result", issues);
  return value as NpShopCarrierPickupResult;
}

export function npAnalyzeShopCarrierPickupCancelRequest(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier pickup cancellation request must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "cancellationId",
      "pickupId",
      "shipmentId",
      "orderId",
      "pickupReference",
      "requestedAt",
    ],
    "carrier pickup cancellation request",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_PICKUP_CANCEL_REQUEST_CONTRACT) {
    issues.push(
      `carrier pickup cancellation request.contract must equal "${NP_SHOP_CARRIER_PICKUP_CANCEL_REQUEST_CONTRACT}".`,
    );
  }
  for (const key of ["cancellationId", "pickupId", "shipmentId", "orderId"] as const) {
    analyzeUuid(value[key], `carrier pickup cancellation request.${key}`, issues);
  }
  analyzeReference(
    value.pickupReference,
    "carrier pickup cancellation request.pickupReference",
    issues,
  );
  if (!isCanonicalIso(value.requestedAt)) {
    issues.push("carrier pickup cancellation request.requestedAt is invalid.");
  }
  return issues;
}

export function npRequireShopCarrierPickupCancelRequest(
  value: unknown,
): NpShopCarrierPickupCancelRequest {
  const issues = npAnalyzeShopCarrierPickupCancelRequest(value);
  if (issues.length) {
    throw new NpShopCarrierPickupContractError("Invalid Shop pickup cancellation request", issues);
  }
  return value as NpShopCarrierPickupCancelRequest;
}

export function npAnalyzeShopCarrierPickupCancelResult(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier pickup cancellation result must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    ["contract", "cancellationId", "pickupId", "shipmentId", "orderId", "cancelledAt"],
    "carrier pickup cancellation result",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT) {
    issues.push(
      `carrier pickup cancellation result.contract must equal "${NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT}".`,
    );
  }
  for (const key of ["cancellationId", "pickupId", "shipmentId", "orderId"] as const) {
    analyzeUuid(value[key], `carrier pickup cancellation result.${key}`, issues);
  }
  if (!isCanonicalIso(value.cancelledAt)) {
    issues.push("carrier pickup cancellation result.cancelledAt is invalid.");
  }
  return issues;
}

export function npRequireShopCarrierPickupCancelResult(
  value: unknown,
): NpShopCarrierPickupCancelResult {
  const issues = npAnalyzeShopCarrierPickupCancelResult(value);
  if (issues.length) {
    throw new NpShopCarrierPickupContractError("Invalid Shop pickup cancellation result", issues);
  }
  return value as NpShopCarrierPickupCancelResult;
}

const storedKeys = [
  "contract",
  "id",
  "orderId",
  "shipmentId",
  "target",
  "exchangeId",
  "providerId",
  "status",
  "revision",
  "locationReference",
  "readyAt",
  "closeAt",
  "parcelRevision",
  "packages",
  "pickupReference",
  "providerErrorCode",
  "cancellationId",
  "requestedAt",
  "scheduledAt",
  "cancelRequestedAt",
  "cancelledAt",
  "updatedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopCarrierPickup(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier pickup must be a plain object."];
  const issues: string[] = [];
  exactKeys(value, storedKeys, "carrier pickup", issues);
  if (value.contract !== NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT) {
    issues.push(`carrier pickup.contract must equal "${NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT}".`);
  }
  for (const key of ["id", "orderId", "shipmentId"] as const) {
    analyzeUuid(value[key], `carrier pickup.${key}`, issues);
  }
  if (!(npShopCarrierPickupTargets as readonly unknown[]).includes(value.target)) {
    issues.push("carrier pickup.target is invalid.");
  }
  if (value.exchangeId !== null) {
    analyzeUuid(value.exchangeId, "carrier pickup.exchangeId", issues);
  }
  if (
    (value.target === "outbound" && value.exchangeId !== null) ||
    (value.target === "replacement" && value.exchangeId === null)
  ) {
    issues.push("carrier pickup exchange identity does not match its target.");
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("carrier pickup.providerId is invalid.");
  }
  if (!(npShopCarrierPickupStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("carrier pickup.status is invalid.");
  }
  if (!isPositiveSafeInteger(value.revision, Number.MAX_SAFE_INTEGER)) {
    issues.push("carrier pickup.revision is invalid.");
  }
  analyzeReference(value.locationReference, "carrier pickup.locationReference", issues);
  analyzeWindow(value.readyAt, value.closeAt, "carrier pickup", issues);
  if (!isPositiveSafeInteger(value.parcelRevision, Number.MAX_SAFE_INTEGER)) {
    issues.push("carrier pickup.parcelRevision is invalid.");
  }
  analyzePackages(value.packages, "carrier pickup.packages", issues);
  if (value.pickupReference !== null) {
    analyzeReference(value.pickupReference, "carrier pickup.pickupReference", issues);
  }
  if (
    value.providerErrorCode !== null &&
    (typeof value.providerErrorCode !== "string" ||
      !providerErrorCodePattern.test(value.providerErrorCode))
  ) {
    issues.push("carrier pickup.providerErrorCode is invalid.");
  }
  if (value.cancellationId !== null) {
    analyzeUuid(value.cancellationId, "carrier pickup.cancellationId", issues);
  }
  for (const key of ["requestedAt", "updatedAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`carrier pickup.${key} is invalid.`);
  }
  for (const key of ["scheduledAt", "cancelRequestedAt", "cancelledAt"] as const) {
    if (value[key] !== null && !isCanonicalIso(value[key])) {
      issues.push(`carrier pickup.${key} is invalid.`);
    }
  }
  const requiresConfirmation = [
    "provider-confirmed",
    "scheduled",
    "cancel-pending",
    "cancel-confirmed",
    "cancelled",
  ].includes(String(value.status));
  const hasConfirmation = value.pickupReference !== null && value.scheduledAt !== null;
  const hasPartialConfirmation = (value.pickupReference === null) !== (value.scheduledAt === null);
  if (
    hasPartialConfirmation ||
    (requiresConfirmation && !hasConfirmation) ||
    (value.status === "pending" && hasConfirmation)
  ) {
    issues.push("carrier pickup provider confirmation fields do not match its status.");
  }
  const requiresCancellation = ["cancel-pending", "cancel-confirmed", "cancelled"].includes(
    String(value.status),
  );
  const hasCancellation = value.cancellationId !== null && value.cancelRequestedAt !== null;
  const hasPartialCancellation =
    (value.cancellationId === null) !== (value.cancelRequestedAt === null);
  if (
    hasPartialCancellation ||
    (requiresCancellation && !hasCancellation) ||
    (["pending", "provider-confirmed", "scheduled"].includes(String(value.status)) &&
      hasCancellation)
  ) {
    issues.push("carrier pickup cancellation intent fields do not match its status.");
  }
  const requiresCancelledAt = ["cancel-confirmed", "cancelled"].includes(String(value.status));
  if (
    (requiresCancelledAt && value.cancelledAt === null) ||
    (["pending", "provider-confirmed", "scheduled", "cancel-pending"].includes(
      String(value.status),
    ) &&
      value.cancelledAt !== null) ||
    (value.status === "manual-review" && value.cancelledAt !== null && !hasCancellation)
  ) {
    issues.push("carrier pickup cancellation confirmation does not match its status.");
  }
  if (
    ["provider-confirmed", "scheduled", "cancel-confirmed", "cancelled"].includes(
      String(value.status),
    ) &&
    value.providerErrorCode !== null
  ) {
    issues.push("confirmed carrier pickup states cannot retain a provider error.");
  }
  if (value.status === "manual-review" && value.providerErrorCode === null) {
    issues.push("manual-review carrier pickup requires one closed provider error code.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt < value.requestedAt
  ) {
    issues.push("carrier pickup.updatedAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.purgeAt) &&
    value.requestedAt >= value.purgeAt
  ) {
    issues.push("carrier pickup.purgeAt must follow requestedAt.");
  }
  if (
    isCanonicalIso(value.closeAt) &&
    isCanonicalIso(value.purgeAt) &&
    value.closeAt > value.purgeAt
  ) {
    issues.push("carrier pickup.closeAt cannot follow purgeAt.");
  }
  if (
    isCanonicalIso(value.scheduledAt) &&
    isCanonicalIso(value.requestedAt) &&
    value.scheduledAt < value.requestedAt
  ) {
    issues.push("carrier pickup.scheduledAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.cancelRequestedAt) &&
    isCanonicalIso(value.scheduledAt) &&
    value.cancelRequestedAt < value.scheduledAt
  ) {
    issues.push("carrier pickup.cancelRequestedAt cannot precede scheduledAt.");
  }
  if (
    isCanonicalIso(value.cancelledAt) &&
    isCanonicalIso(value.cancelRequestedAt) &&
    value.cancelledAt < value.cancelRequestedAt
  ) {
    issues.push("carrier pickup.cancelledAt cannot precede cancelRequestedAt.");
  }
  for (const key of ["scheduledAt", "cancelRequestedAt", "cancelledAt"] as const) {
    if (
      isCanonicalIso(value[key]) &&
      isCanonicalIso(value.updatedAt) &&
      value[key] > value.updatedAt
    ) {
      issues.push(`carrier pickup.${key} cannot follow updatedAt.`);
    }
  }
  return issues;
}

export function npRequireStoredShopCarrierPickup(value: unknown): NpShopStoredCarrierPickup {
  const issues = npAnalyzeStoredShopCarrierPickup(value);
  if (issues.length) {
    throw new NpShopCarrierPickupContractError("Invalid stored Shop carrier pickup", issues);
  }
  return value as NpShopStoredCarrierPickup;
}

function requireActionEnvelope(value: unknown): {
  row: Record<string, unknown>;
  values: Record<string, unknown>;
} {
  if (!isRecord(value)) {
    throw new NpShopCarrierPickupContractError("Invalid Shop pickup action", [
      "pickup action must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  if (!isRecord(value.row)) issues.push("payload.row must be a plain object.");
  if (!isRecord(value.values)) issues.push("payload.values must be a plain object.");
  if (issues.length)
    throw new NpShopCarrierPickupContractError("Invalid Shop pickup action", issues);
  return {
    row: value.row as Record<string, unknown>,
    values: value.values as Record<string, unknown>,
  };
}

export function npRequireShopCarrierPickupScheduleInput(
  value: unknown,
): NpShopCarrierPickupScheduleInput {
  const { row, values } = requireActionEnvelope(value);
  const issues: string[] = [];
  exactKeys(
    row,
    ["id", "shipmentId", "pickupTarget", "exchangeId", "pickupRevision"],
    "payload.row",
    issues,
  );
  exactKeys(values, ["readyAt", "closeAt"], "payload.values", issues);
  analyzeUuid(row.id, "payload.row.id", issues);
  analyzeUuid(row.shipmentId, "payload.row.shipmentId", issues);
  if (!(npShopCarrierPickupTargets as readonly unknown[]).includes(row.pickupTarget)) {
    issues.push("payload.row.pickupTarget is invalid.");
  }
  if (row.exchangeId !== null) analyzeUuid(row.exchangeId, "payload.row.exchangeId", issues);
  if (
    (row.pickupTarget === "outbound" && row.exchangeId !== null) ||
    (row.pickupTarget === "replacement" && row.exchangeId === null)
  ) {
    issues.push("payload.row exchange identity does not match its pickup target.");
  }
  if (!Number.isSafeInteger(row.pickupRevision) || (row.pickupRevision as number) < 0) {
    issues.push("payload.row.pickupRevision is invalid.");
  }
  analyzeWindow(values.readyAt, values.closeAt, "payload.values", issues);
  if (issues.length) {
    throw new NpShopCarrierPickupContractError("Invalid Shop pickup scheduling action", issues);
  }
  return {
    orderId: row.id as string,
    shipmentId: row.shipmentId as string,
    target: row.pickupTarget as NpShopCarrierPickupTarget,
    exchangeId: row.exchangeId as string | null,
    expectedRevision: row.pickupRevision as number,
    readyAt: values.readyAt as string,
    closeAt: values.closeAt as string,
  };
}

function requireExistingAction(value: unknown): NpShopCarrierPickupExistingActionInput {
  const { row, values } = requireActionEnvelope(value);
  const issues: string[] = [];
  exactKeys(
    row,
    ["id", "shipmentId", "pickupTarget", "exchangeId", "pickupId", "pickupRevision"],
    "payload.row",
    issues,
  );
  exactKeys(values, [], "payload.values", issues);
  analyzeUuid(row.id, "payload.row.id", issues);
  analyzeUuid(row.shipmentId, "payload.row.shipmentId", issues);
  if (!(npShopCarrierPickupTargets as readonly unknown[]).includes(row.pickupTarget)) {
    issues.push("payload.row.pickupTarget is invalid.");
  }
  if (row.exchangeId !== null) analyzeUuid(row.exchangeId, "payload.row.exchangeId", issues);
  if (
    (row.pickupTarget === "outbound" && row.exchangeId !== null) ||
    (row.pickupTarget === "replacement" && row.exchangeId === null)
  ) {
    issues.push("payload.row exchange identity does not match its pickup target.");
  }
  analyzeUuid(row.pickupId, "payload.row.pickupId", issues);
  if (!isPositiveSafeInteger(row.pickupRevision, Number.MAX_SAFE_INTEGER)) {
    issues.push("payload.row.pickupRevision is invalid.");
  }
  if (issues.length) {
    throw new NpShopCarrierPickupContractError("Invalid existing Shop pickup action", issues);
  }
  return {
    orderId: row.id as string,
    shipmentId: row.shipmentId as string,
    target: row.pickupTarget as NpShopCarrierPickupTarget,
    exchangeId: row.exchangeId as string | null,
    pickupId: row.pickupId as string,
    expectedRevision: row.pickupRevision as number,
  };
}

export function npRequireShopCarrierPickupResumeInput(
  value: unknown,
): NpShopCarrierPickupExistingActionInput {
  return requireExistingAction(value);
}

export function npRequireShopCarrierPickupCancelInput(
  value: unknown,
): NpShopCarrierPickupExistingActionInput {
  return requireExistingAction(value);
}
