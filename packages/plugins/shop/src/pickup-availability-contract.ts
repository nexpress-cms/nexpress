import type { NpShopCarrierPickupPackage, NpShopCarrierPickupTarget } from "./pickup-contract.js";

export const NP_SHOP_CARRIER_PICKUP_AVAILABILITY_REQUEST_CONTRACT =
  "np.shop-carrier-pickup-availability-request.v1" as const;
export const NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT =
  "np.shop-carrier-pickup-availability-result.v1" as const;
export const NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT =
  "np.shop-carrier-pickup-availability-storage.v1" as const;
export const NP_SHOP_CARRIER_PICKUP_AVAILABILITY_HEALTH_CONTRACT =
  "np.shop-carrier-pickup-availability-health.v1" as const;

export const npShopCarrierPickupAvailabilityLimits = Object.freeze({
  windowIdLength: 64,
  maximumWindows: 20,
  maximumLifetimeSeconds: 60 * 60,
  futureToleranceSeconds: 30,
  maximumLeadSeconds: 14 * 24 * 60 * 60,
  adminListSize: 100,
  diagnosticSampleSize: 100,
  cleanupBatchSize: 100,
});

export interface NpShopCarrierPickupAvailabilityWindow {
  id: string;
  readyAt: string;
  closeAt: string;
}

export interface NpShopCarrierPickupAvailabilityRequest {
  contract: typeof NP_SHOP_CARRIER_PICKUP_AVAILABILITY_REQUEST_CONTRACT;
  availabilityId: string;
  shipmentId: string;
  orderId: string;
  bookingReference: string;
  carrier: string;
  trackingNumber: string;
  locationReference: string;
  parcelRevision: number;
  packages: NpShopCarrierPickupPackage[];
  requestedAt: string;
  maximumExpiresAt: string;
}

export interface NpShopCarrierPickupAvailabilityResult {
  contract: typeof NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT;
  availabilityId: string;
  windows: NpShopCarrierPickupAvailabilityWindow[];
  expiresAt: string;
}

export interface NpShopStoredCarrierPickupAvailability {
  contract: typeof NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT;
  id: string;
  orderId: string;
  shipmentId: string;
  target: NpShopCarrierPickupTarget;
  exchangeId: string | null;
  providerId: string;
  bookingFingerprint: string;
  revision: number;
  locationReference: string;
  parcelRevision: number;
  packages: NpShopCarrierPickupPackage[];
  windows: NpShopCarrierPickupAvailabilityWindow[];
  requestedAt: string;
  expiresAt: string;
  purgeAt: string;
}

export interface NpShopCarrierPickupAvailabilityHealth {
  contract: typeof NP_SHOP_CARRIER_PICKUP_AVAILABILITY_HEALTH_CONTRACT;
  providerId: string;
  status: "ok" | "error";
  errorCode: "provider-error" | "invalid-result" | null;
  attemptedAt: string;
  succeededAt: string | null;
}

export interface NpShopCarrierPickupAvailabilityQueryInput {
  orderId: string;
  shipmentId: string;
  target: NpShopCarrierPickupTarget;
  exchangeId: string | null;
  expectedPickupRevision: number;
}

export interface NpShopCarrierPickupAvailabilitySelectionInput {
  orderId: string;
  shipmentId: string;
  target: NpShopCarrierPickupTarget;
  exchangeId: string | null;
  expectedPickupRevision: number;
  availabilityId: string;
  expectedAvailabilityRevision: number;
  windowId: string;
}

export class NpShopCarrierPickupAvailabilityContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopCarrierPickupAvailabilityContractError";
    this.issues = issues;
  }
}

export class NpShopCarrierPickupAvailabilityConflictError extends Error {
  readonly code:
    | "pickup_availability_not_supported"
    | "pickup_availability_not_found"
    | "pickup_availability_revision_conflict"
    | "pickup_availability_expired"
    | "pickup_availability_window_not_found"
    | "pickup_availability_state_conflict";

  constructor(code: NpShopCarrierPickupAvailabilityConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopCarrierPickupAvailabilityConflictError";
    this.code = code;
  }
}

export class NpShopCarrierPickupAvailabilityUnavailableError extends Error {
  constructor(message = "Carrier pickup windows are temporarily unavailable.") {
    super(message);
    this.name = "NpShopCarrierPickupAvailabilityUnavailableError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const packageIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const windowIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

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
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function analyzeUuid(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) issues.push(`${path} is invalid.`);
}

function analyzeReference(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || !referencePattern.test(value))
    issues.push(`${path} is invalid.`);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function analyzePackage(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["id", "lengthMm", "widthMm", "heightMm", "weightGrams"], path, issues);
  if (typeof value.id !== "string" || value.id.length > 64 || !packageIdPattern.test(value.id)) {
    issues.push(`${path}.id is invalid.`);
  }
  for (const key of ["lengthMm", "widthMm", "heightMm"] as const) {
    if (!isPositiveInteger(value[key]) || value[key] > 3_000) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (!isPositiveInteger(value.weightGrams) || value.weightGrams > 500_000) {
    issues.push(`${path}.weightGrams is invalid.`);
  }
}

function analyzePackages(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    issues.push(`${path} must contain between 1 and 20 packages.`);
    return;
  }
  value.forEach((entry, index) => analyzePackage(entry, `${path}[${index.toString()}]`, issues));
  const ids = value
    .filter(isRecord)
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(ids).size !== ids.length) issues.push(`${path} ids must be unique.`);
}

function analyzeWindow(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["id", "readyAt", "closeAt"], path, issues);
  if (typeof value.id !== "string" || !windowIdPattern.test(value.id)) {
    issues.push(`${path}.id is invalid.`);
  }
  if (!isIso(value.readyAt)) issues.push(`${path}.readyAt is invalid.`);
  if (!isIso(value.closeAt)) issues.push(`${path}.closeAt is invalid.`);
  if (isIso(value.readyAt) && isIso(value.closeAt)) {
    const seconds = (new Date(value.closeAt).getTime() - new Date(value.readyAt).getTime()) / 1_000;
    if (seconds < 15 * 60 || seconds > 12 * 60 * 60) {
      issues.push(`${path} must span between 15 minutes and 12 hours.`);
    }
  }
}

function analyzeWindows(value: unknown, path: string, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopCarrierPickupAvailabilityLimits.maximumWindows
  ) {
    issues.push(`${path} must contain between 1 and 20 windows.`);
    return;
  }
  value.forEach((entry, index) => analyzeWindow(entry, `${path}[${index.toString()}]`, issues));
  const windows = value.filter(isRecord);
  const ids = windows.map((entry) => entry.id).filter((id): id is string => typeof id === "string");
  if (new Set(ids).size !== ids.length) issues.push(`${path} ids must be unique.`);
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const current = windows[index];
    if (
      previous &&
      current &&
      isIso(previous.closeAt) &&
      isIso(current.readyAt) &&
      current.readyAt < previous.closeAt
    ) {
      issues.push(`${path} must be ordered and non-overlapping.`);
      break;
    }
  }
}

export function npAnalyzeShopCarrierPickupAvailabilityRequest(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier pickup availability request must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "availabilityId",
      "shipmentId",
      "orderId",
      "bookingReference",
      "carrier",
      "trackingNumber",
      "locationReference",
      "parcelRevision",
      "packages",
      "requestedAt",
      "maximumExpiresAt",
    ],
    "carrier pickup availability request",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_PICKUP_AVAILABILITY_REQUEST_CONTRACT) {
    issues.push(
      `carrier pickup availability request.contract must equal "${NP_SHOP_CARRIER_PICKUP_AVAILABILITY_REQUEST_CONTRACT}".`,
    );
  }
  for (const key of ["availabilityId", "shipmentId", "orderId"] as const) {
    analyzeUuid(value[key], `carrier pickup availability request.${key}`, issues);
  }
  for (const key of ["bookingReference", "locationReference"] as const) {
    analyzeReference(value[key], `carrier pickup availability request.${key}`, issues);
  }
  if (
    typeof value.carrier !== "string" ||
    value.carrier.trim() !== value.carrier ||
    value.carrier.length < 1 ||
    value.carrier.length > 80
  ) {
    issues.push("carrier pickup availability request.carrier is invalid.");
  }
  if (
    typeof value.trackingNumber !== "string" ||
    value.trackingNumber.trim() !== value.trackingNumber ||
    value.trackingNumber.length < 1 ||
    value.trackingNumber.length > 120
  ) {
    issues.push("carrier pickup availability request.trackingNumber is invalid.");
  }
  if (!isPositiveInteger(value.parcelRevision)) {
    issues.push("carrier pickup availability request.parcelRevision is invalid.");
  }
  analyzePackages(value.packages, "carrier pickup availability request.packages", issues);
  if (!isIso(value.requestedAt)) {
    issues.push("carrier pickup availability request.requestedAt is invalid.");
  }
  if (!isIso(value.maximumExpiresAt)) {
    issues.push("carrier pickup availability request.maximumExpiresAt is invalid.");
  }
  if (isIso(value.requestedAt) && isIso(value.maximumExpiresAt)) {
    const lifetime =
      (new Date(value.maximumExpiresAt).getTime() - new Date(value.requestedAt).getTime()) / 1_000;
    if (lifetime < 1 || lifetime > npShopCarrierPickupAvailabilityLimits.maximumLifetimeSeconds) {
      issues.push("carrier pickup availability request lifetime is invalid.");
    }
  }
  return issues;
}

export function npRequireShopCarrierPickupAvailabilityRequest(
  value: unknown,
): NpShopCarrierPickupAvailabilityRequest {
  const issues = npAnalyzeShopCarrierPickupAvailabilityRequest(value);
  if (issues.length) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid Shop carrier pickup availability request",
      issues,
    );
  }
  return value as NpShopCarrierPickupAvailabilityRequest;
}

export function npAnalyzeShopCarrierPickupAvailabilityResult(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier pickup availability result must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    ["contract", "availabilityId", "windows", "expiresAt"],
    "carrier pickup availability result",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT) {
    issues.push(
      `carrier pickup availability result.contract must equal "${NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT}".`,
    );
  }
  analyzeUuid(value.availabilityId, "carrier pickup availability result.availabilityId", issues);
  analyzeWindows(value.windows, "carrier pickup availability result.windows", issues);
  if (!isIso(value.expiresAt)) {
    issues.push("carrier pickup availability result.expiresAt is invalid.");
  }
  return issues;
}

export function npRequireShopCarrierPickupAvailabilityResult(
  value: unknown,
): NpShopCarrierPickupAvailabilityResult {
  const issues = npAnalyzeShopCarrierPickupAvailabilityResult(value);
  if (issues.length) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid Shop carrier pickup availability result",
      issues,
    );
  }
  return value as NpShopCarrierPickupAvailabilityResult;
}

export function npAnalyzeStoredShopCarrierPickupAvailability(value: unknown): string[] {
  if (!isRecord(value)) return ["stored carrier pickup availability must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "id",
      "orderId",
      "shipmentId",
      "target",
      "exchangeId",
      "providerId",
      "bookingFingerprint",
      "revision",
      "locationReference",
      "parcelRevision",
      "packages",
      "windows",
      "requestedAt",
      "expiresAt",
      "purgeAt",
    ],
    "stored carrier pickup availability",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT) {
    issues.push(
      `stored carrier pickup availability.contract must equal "${NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT}".`,
    );
  }
  for (const key of ["id", "orderId", "shipmentId"] as const) {
    analyzeUuid(value[key], `stored carrier pickup availability.${key}`, issues);
  }
  if (value.target !== "outbound" && value.target !== "replacement") {
    issues.push("stored carrier pickup availability.target is invalid.");
  }
  if (value.exchangeId !== null) {
    analyzeUuid(value.exchangeId, "stored carrier pickup availability.exchangeId", issues);
  }
  if (
    (value.target === "outbound" && value.exchangeId !== null) ||
    (value.target === "replacement" && value.exchangeId === null)
  ) {
    issues.push("stored carrier pickup availability exchange identity is invalid.");
  }
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId)) {
    issues.push("stored carrier pickup availability.providerId is invalid.");
  }
  if (
    typeof value.bookingFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.bookingFingerprint)
  ) {
    issues.push("stored carrier pickup availability.bookingFingerprint is invalid.");
  }
  if (!isPositiveInteger(value.revision)) {
    issues.push("stored carrier pickup availability.revision is invalid.");
  }
  analyzeReference(
    value.locationReference,
    "stored carrier pickup availability.locationReference",
    issues,
  );
  if (!isPositiveInteger(value.parcelRevision)) {
    issues.push("stored carrier pickup availability.parcelRevision is invalid.");
  }
  analyzePackages(value.packages, "stored carrier pickup availability.packages", issues);
  analyzeWindows(value.windows, "stored carrier pickup availability.windows", issues);
  for (const key of ["requestedAt", "expiresAt", "purgeAt"] as const) {
    if (!isIso(value[key])) issues.push(`stored carrier pickup availability.${key} is invalid.`);
  }
  if (
    isIso(value.requestedAt) &&
    isIso(value.expiresAt) &&
    (value.expiresAt <= value.requestedAt ||
      new Date(value.expiresAt).getTime() - new Date(value.requestedAt).getTime() >
        npShopCarrierPickupAvailabilityLimits.maximumLifetimeSeconds * 1_000)
  ) {
    issues.push("stored carrier pickup availability lifetime is invalid.");
  }
  if (isIso(value.expiresAt) && isIso(value.purgeAt) && value.expiresAt > value.purgeAt) {
    issues.push("stored carrier pickup availability.expiresAt cannot follow purgeAt.");
  }
  if (Array.isArray(value.windows) && isIso(value.expiresAt)) {
    const maximumWindowAt = isIso(value.requestedAt)
      ? new Date(
          new Date(value.requestedAt).getTime() +
            npShopCarrierPickupAvailabilityLimits.maximumLeadSeconds * 1_000,
        ).toISOString()
      : null;
    for (const window of value.windows) {
      if (isRecord(window) && isIso(window.readyAt) && window.readyAt <= value.expiresAt) {
        issues.push("stored carrier pickup availability windows must begin after expiry.");
        break;
      }
      if (
        isRecord(window) &&
        isIso(window.readyAt) &&
        isIso(window.closeAt) &&
        maximumWindowAt &&
        (window.readyAt > maximumWindowAt || window.closeAt > maximumWindowAt)
      ) {
        issues.push("stored carrier pickup availability windows exceed the 14-day horizon.");
        break;
      }
      if (
        isRecord(window) &&
        isIso(window.closeAt) &&
        isIso(value.purgeAt) &&
        window.closeAt > value.purgeAt
      ) {
        issues.push("stored carrier pickup availability windows cannot follow purgeAt.");
        break;
      }
    }
  }
  return issues;
}

export function npRequireStoredShopCarrierPickupAvailability(
  value: unknown,
): NpShopStoredCarrierPickupAvailability {
  const issues = npAnalyzeStoredShopCarrierPickupAvailability(value);
  if (issues.length) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid stored Shop carrier pickup availability",
      issues,
    );
  }
  return value as NpShopStoredCarrierPickupAvailability;
}

export function npAnalyzeShopCarrierPickupAvailabilityHealth(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier pickup availability health must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    ["contract", "providerId", "status", "errorCode", "attemptedAt", "succeededAt"],
    "carrier pickup availability health",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_PICKUP_AVAILABILITY_HEALTH_CONTRACT) {
    issues.push("carrier pickup availability health.contract is invalid.");
  }
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId)) {
    issues.push("carrier pickup availability health.providerId is invalid.");
  }
  if (value.status !== "ok" && value.status !== "error") {
    issues.push("carrier pickup availability health.status is invalid.");
  }
  if (
    value.errorCode !== null &&
    value.errorCode !== "provider-error" &&
    value.errorCode !== "invalid-result"
  ) {
    issues.push("carrier pickup availability health.errorCode is invalid.");
  }
  if ((value.status === "ok") !== (value.errorCode === null)) {
    issues.push("carrier pickup availability health error does not match status.");
  }
  if (!isIso(value.attemptedAt))
    issues.push("carrier pickup availability health.attemptedAt is invalid.");
  if (value.succeededAt !== null && !isIso(value.succeededAt)) {
    issues.push("carrier pickup availability health.succeededAt is invalid.");
  }
  if (value.status === "ok" && value.succeededAt !== value.attemptedAt) {
    issues.push("successful carrier pickup availability health must share one timestamp.");
  }
  if (
    isIso(value.succeededAt) &&
    isIso(value.attemptedAt) &&
    value.succeededAt > value.attemptedAt
  ) {
    issues.push("carrier pickup availability health.succeededAt cannot follow attemptedAt.");
  }
  return issues;
}

export function npRequireShopCarrierPickupAvailabilityHealth(
  value: unknown,
): NpShopCarrierPickupAvailabilityHealth {
  const issues = npAnalyzeShopCarrierPickupAvailabilityHealth(value);
  if (issues.length) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid Shop carrier pickup availability health",
      issues,
    );
  }
  return value as NpShopCarrierPickupAvailabilityHealth;
}

function requireActionEnvelope(value: unknown): {
  row: Record<string, unknown>;
  values: Record<string, unknown>;
} {
  if (!isRecord(value)) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid Shop carrier pickup availability action",
      ["payload must be a plain object."],
    );
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  if (!isRecord(value.row)) issues.push("payload.row must be a plain object.");
  if (!isRecord(value.values)) issues.push("payload.values must be a plain object.");
  if (issues.length) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid Shop carrier pickup availability action",
      issues,
    );
  }
  return {
    row: value.row as Record<string, unknown>,
    values: value.values as Record<string, unknown>,
  };
}

function analyzeTargetRow(row: Record<string, unknown>, issues: string[]): void {
  analyzeUuid(row.id, "payload.row.id", issues);
  analyzeUuid(row.shipmentId, "payload.row.shipmentId", issues);
  if (row.pickupTarget !== "outbound" && row.pickupTarget !== "replacement") {
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
}

export function npRequireShopCarrierPickupAvailabilityQueryInput(
  value: unknown,
): NpShopCarrierPickupAvailabilityQueryInput {
  const { row, values } = requireActionEnvelope(value);
  const issues: string[] = [];
  exactKeys(
    row,
    ["id", "shipmentId", "pickupTarget", "exchangeId", "pickupRevision"],
    "payload.row",
    issues,
  );
  exactKeys(values, [], "payload.values", issues);
  analyzeTargetRow(row, issues);
  if (issues.length) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid Shop carrier pickup availability query action",
      issues,
    );
  }
  return {
    orderId: row.id as string,
    shipmentId: row.shipmentId as string,
    target: row.pickupTarget as NpShopCarrierPickupTarget,
    exchangeId: row.exchangeId as string | null,
    expectedPickupRevision: row.pickupRevision as number,
  };
}

export function npRequireShopCarrierPickupAvailabilitySelectionInput(
  value: unknown,
): NpShopCarrierPickupAvailabilitySelectionInput {
  const { row, values } = requireActionEnvelope(value);
  const issues: string[] = [];
  exactKeys(
    row,
    [
      "id",
      "shipmentId",
      "pickupTarget",
      "exchangeId",
      "pickupRevision",
      "availabilityId",
      "availabilityRevision",
      "windowId",
    ],
    "payload.row",
    issues,
  );
  exactKeys(values, [], "payload.values", issues);
  analyzeTargetRow(row, issues);
  analyzeUuid(row.availabilityId, "payload.row.availabilityId", issues);
  if (!isPositiveInteger(row.availabilityRevision)) {
    issues.push("payload.row.availabilityRevision is invalid.");
  }
  if (typeof row.windowId !== "string" || !windowIdPattern.test(row.windowId)) {
    issues.push("payload.row.windowId is invalid.");
  }
  if (issues.length) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid Shop carrier pickup availability selection action",
      issues,
    );
  }
  return {
    orderId: row.id as string,
    shipmentId: row.shipmentId as string,
    target: row.pickupTarget as NpShopCarrierPickupTarget,
    exchangeId: row.exchangeId as string | null,
    expectedPickupRevision: row.pickupRevision as number,
    availabilityId: row.availabilityId as string,
    expectedAvailabilityRevision: row.availabilityRevision as number,
    windowId: row.windowId as string,
  };
}
