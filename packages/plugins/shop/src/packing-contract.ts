import { npShopFulfillmentParcelLimits } from "./parcel-contract.js";

export const NP_SHOP_PACKING_WORK_CREATE_REQUEST_CONTRACT =
  "np.shop-packing-work-create-request.v1" as const;
export const NP_SHOP_PACKING_WORK_CREATE_RESULT_CONTRACT =
  "np.shop-packing-work-create-result.v1" as const;
export const NP_SHOP_PACKING_WORK_CANCEL_REQUEST_CONTRACT =
  "np.shop-packing-work-cancel-request.v1" as const;
export const NP_SHOP_PACKING_WORK_CANCEL_RESULT_CONTRACT =
  "np.shop-packing-work-cancel-result.v1" as const;
export const NP_SHOP_PACKING_WORK_STORAGE_CONTRACT = "np.shop-packing-work-storage.v1" as const;

export const npShopPackingWorkTargets = ["outbound", "replacement"] as const;
export type NpShopPackingWorkTarget = (typeof npShopPackingWorkTargets)[number];

export const npShopPackingWorkStatuses = [
  "pending",
  "provider-confirmed",
  "active",
  "cancel-pending",
  "cancel-confirmed",
  "cancelled",
  "consumed",
  "manual-review",
] as const;
export type NpShopPackingWorkStatus = (typeof npShopPackingWorkStatuses)[number];

export const npShopPackingWorkLimits = Object.freeze({
  maximumLines: npShopFulfillmentParcelLimits.maximumAllocations,
  maximumParcels: npShopFulfillmentParcelLimits.maximumParcels,
  maximumAllocations: npShopFulfillmentParcelLimits.maximumAllocations,
  lineKeyLength: npShopFulfillmentParcelLimits.lineKeyLength,
  parcelIdLength: npShopFulfillmentParcelLimits.parcelIdLength,
  maximumDimensionMm: npShopFulfillmentParcelLimits.maximumDimensionMm,
  maximumWeightGrams: npShopFulfillmentParcelLimits.maximumWeightGrams,
  maximumQuantity: npShopFulfillmentParcelLimits.maximumQuantity,
  productSlugLength: 160,
  variantSkuLength: 80,
  providerIdLength: 32,
  providerWorkReferenceLength: 200,
  providerErrorCodeLength: 100,
  fingerprintLength: 64,
  futureToleranceSeconds: 30,
  maximumGraphNodes: 512,
  adminListSize: npShopFulfillmentParcelLimits.adminListSize,
  diagnosticSampleSize: npShopFulfillmentParcelLimits.diagnosticSampleSize,
});

export interface NpShopPackingWorkLine {
  readonly lineKey: string;
  readonly productId: string;
  readonly productSlug: string;
  readonly variantSku: string | null;
  readonly quantity: number;
}

export interface NpShopPackingWorkParcelItem {
  readonly lineKey: string;
  readonly quantity: number;
}

export interface NpShopPackingWorkParcel {
  readonly id: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly weightGrams: number;
  readonly items: readonly NpShopPackingWorkParcelItem[];
}

export type NpShopPackingWorkTargetIdentity =
  | { readonly target: "outbound"; readonly exchangeId: null }
  | { readonly target: "replacement"; readonly exchangeId: string };

interface NpShopPackingWorkSnapshot {
  readonly sourceRevision: number;
  readonly parcelRevision: number;
  readonly lines: readonly NpShopPackingWorkLine[];
  readonly parcels: readonly NpShopPackingWorkParcel[];
}

export type NpShopPackingWorkFingerprintSource = NpShopPackingWorkTargetIdentity &
  NpShopPackingWorkSnapshot;

interface NpShopPackingWorkCreateRequestBase extends NpShopPackingWorkSnapshot {
  readonly contract: typeof NP_SHOP_PACKING_WORK_CREATE_REQUEST_CONTRACT;
  readonly workId: string;
  readonly orderId: string;
  readonly parcelFingerprint: string;
  readonly requestedAt: string;
}

export type NpShopPackingWorkCreateRequest = NpShopPackingWorkCreateRequestBase &
  NpShopPackingWorkTargetIdentity;

interface NpShopPackingWorkCreateResultBase {
  readonly contract: typeof NP_SHOP_PACKING_WORK_CREATE_RESULT_CONTRACT;
  readonly workId: string;
  readonly orderId: string;
  readonly sourceRevision: number;
  readonly parcelRevision: number;
  readonly parcelFingerprint: string;
  readonly providerWorkReference: string;
  readonly confirmedAt: string;
}

export type NpShopPackingWorkCreateResult = NpShopPackingWorkCreateResultBase &
  NpShopPackingWorkTargetIdentity;

export type NpShopPackingWorkCreateResultFor<TRequest extends NpShopPackingWorkCreateRequest> =
  TRequest extends NpShopPackingWorkCreateRequest
    ? NpShopPackingWorkCreateResultBase & Pick<TRequest, "target" | "exchangeId">
    : never;

interface NpShopPackingWorkCancelRequestBase {
  readonly contract: typeof NP_SHOP_PACKING_WORK_CANCEL_REQUEST_CONTRACT;
  readonly cancellationId: string;
  readonly workId: string;
  readonly orderId: string;
  readonly sourceRevision: number;
  readonly parcelRevision: number;
  readonly parcelFingerprint: string;
  readonly providerWorkReference: string | null;
  readonly requestedAt: string;
}

export type NpShopPackingWorkCancelRequest = NpShopPackingWorkCancelRequestBase &
  NpShopPackingWorkTargetIdentity;

interface NpShopPackingWorkCancelResultBase {
  readonly contract: typeof NP_SHOP_PACKING_WORK_CANCEL_RESULT_CONTRACT;
  readonly cancellationId: string;
  readonly workId: string;
  readonly orderId: string;
  readonly sourceRevision: number;
  readonly parcelRevision: number;
  readonly parcelFingerprint: string;
  readonly providerWorkReference: string | null;
  readonly cancelledAt: string;
}

export type NpShopPackingWorkCancelResult = NpShopPackingWorkCancelResultBase &
  NpShopPackingWorkTargetIdentity;

export type NpShopPackingWorkCancelResultFor<TRequest extends NpShopPackingWorkCancelRequest> =
  TRequest extends NpShopPackingWorkCancelRequest
    ? NpShopPackingWorkCancelResultBase & Pick<TRequest, "target" | "exchangeId">
    : never;

interface NpShopStoredPackingWorkBase extends NpShopPackingWorkSnapshot {
  readonly contract: typeof NP_SHOP_PACKING_WORK_STORAGE_CONTRACT;
  readonly workId: string;
  readonly orderId: string;
  readonly providerId: string;
  readonly status: NpShopPackingWorkStatus;
  readonly revision: number;
  readonly parcelFingerprint: string;
  readonly providerWorkReference: string | null;
  readonly providerErrorCode: string | null;
  readonly cancellationId: string | null;
  readonly attachedShipmentId: string | null;
  readonly requestedAt: string;
  readonly confirmedAt: string | null;
  readonly activatedAt: string | null;
  readonly cancelRequestedAt: string | null;
  readonly cancelledAt: string | null;
  readonly consumedAt: string | null;
  readonly updatedAt: string;
  readonly purgeAt: string;
}

export type NpShopStoredPackingWork = NpShopStoredPackingWorkBase & NpShopPackingWorkTargetIdentity;

interface NpShopPackingWorkCreateActionInputBase {
  readonly orderId: string;
  readonly expectedSourceRevision: number;
  readonly expectedParcelRevision: number;
  readonly expectedWorkRevision: number | null;
}

export type NpShopPackingWorkCreateActionInput = NpShopPackingWorkCreateActionInputBase &
  NpShopPackingWorkTargetIdentity;

export type NpShopPackingWorkExistingActionInput = NpShopPackingWorkTargetIdentity & {
  readonly orderId: string;
  readonly workId: string;
  readonly expectedRevision: number;
};

/**
 * Packing-work v1 is this paired create/cancel boundary only. Provider
 * callbacks, polling, physical-pack confirmation, and provider-specific
 * protocols are not implied by this adapter.
 */
export interface NpShopPackingWorkAdapter {
  /** Stable lowercase identifier persisted with every PII-free work intent. */
  readonly id: string;
  /**
   * Create exactly one warehouse work intent from the immutable PII-free
   * line and parcel snapshot. Implementations must use workId as their stable
   * idempotency key, enforce a finite provider-I/O timeout, and must not infer
   * or request customer or address data.
   */
  createPackingWork<TRequest extends NpShopPackingWorkCreateRequest>(
    input: TRequest,
  ):
    | NpShopPackingWorkCreateResultFor<TRequest>
    | Promise<NpShopPackingWorkCreateResultFor<TRequest>>;
  /**
   * Cancel one intent with cancellationId as its stable idempotency key. The
   * adapter must durably remember cancellation for the workId even when no
   * provider reference exists yet. Cancellation dominates every delayed or
   * retried create call for the same workId: it must never recreate provider
   * work after cancellation was accepted. Implementations must enforce a
   * finite provider-I/O timeout so an ambiguous call remains resumable.
   */
  cancelPackingWork<TRequest extends NpShopPackingWorkCancelRequest>(
    input: TRequest,
  ):
    | NpShopPackingWorkCancelResultFor<TRequest>
    | Promise<NpShopPackingWorkCancelResultFor<TRequest>>;
}

export class NpShopPackingWorkContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopPackingWorkContractError";
    this.issues = issues;
  }
}

export class NpShopPackingWorkConflictError extends Error {
  readonly code:
    | "packing_work_not_supported"
    | "packing_work_not_found"
    | "packing_work_already_exists"
    | "packing_work_parcels_required"
    | "packing_work_revision_conflict"
    | "packing_work_state_conflict"
    | "packing_work_result_mismatch"
    | "packing_work_shipment_conflict"
    | "packing_work_manual_review";

  constructor(code: NpShopPackingWorkConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopPackingWorkConflictError";
    this.code = code;
  }
}

export class NpShopPackingWorkProviderError extends Error {
  /**
   * Closed PII- and secret-free slug persisted in durable health, audit, and
   * Admin surfaces. The free-text Error message is never persisted or shown.
   */
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, options: { readonly retryable: boolean }) {
    super(typeof message === "string" ? message : "Packing work provider error.");
    let retryable: boolean | null = null;
    try {
      const descriptor =
        typeof options === "object" && options !== null
          ? Object.getOwnPropertyDescriptor(options, "retryable")
          : undefined;
      if (descriptor && "value" in descriptor && typeof descriptor.value === "boolean") {
        retryable = descriptor.value;
      }
    } catch {
      // Hostile constructor input is rejected below without invoking accessors.
    }
    if (typeof code !== "string" || !providerErrorCodePattern.test(code) || retryable === null) {
      throw new NpShopPackingWorkContractError("Invalid packing-work provider error", [
        "provider error code must be a canonical PII-free slug and retryable must be a boolean data property.",
      ]);
    }
    this.name = "NpShopPackingWorkProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class NpShopPackingWorkUnavailableError extends Error {
  constructor(message = "Packing work provider is temporarily unavailable.") {
    super(message);
    this.name = "NpShopPackingWorkUnavailableError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const providerWorkReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const providerErrorCodePattern = /^[a-z][a-z0-9-]{0,99}$/u;
const parcelIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const fingerprintPattern = /^[0-9a-f]{64}$/u;

type SafeRecord = Readonly<Record<string, unknown>>;

interface GraphBudget {
  remaining: number;
  exhausted: boolean;
}

function createGraphBudget(): GraphBudget {
  return { remaining: npShopPackingWorkLimits.maximumGraphNodes, exhausted: false };
}

function consumeGraphNode(path: string, issues: string[], budget: GraphBudget): boolean {
  if (budget.remaining > 0) {
    budget.remaining -= 1;
    return true;
  }
  if (!budget.exhausted) {
    issues.push(
      `${path} exceeds the ${npShopPackingWorkLimits.maximumGraphNodes.toString()} node graph limit.`,
    );
    budget.exhausted = true;
  }
  return false;
}

function readExactDataObject(
  value: unknown,
  expected: readonly string[],
  path: string,
  issues: string[],
  budget: GraphBudget,
): SafeRecord | null {
  if (!consumeGraphNode(path, issues, budget)) return null;
  if (typeof value !== "object" || value === null) {
    issues.push(`${path} must be a plain data object.`);
    return null;
  }
  try {
    if (Array.isArray(value)) {
      issues.push(`${path} must be a plain data object.`);
      return null;
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      issues.push(`${path} must be a plain data object.`);
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
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
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

function readBoundedDataArray(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
  issues: string[],
  budget: GraphBudget,
): readonly unknown[] | null {
  if (!consumeGraphNode(path, issues, budget)) return null;
  try {
    if (!Array.isArray(value)) {
      issues.push(`${path} must be an array.`);
      return null;
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
    if (
      !Number.isSafeInteger(length) ||
      (length as number) < minimum ||
      (length as number) > maximum
    ) {
      issues.push(
        `${path} must contain between ${minimum.toString()} and ${maximum.toString()} entries.`,
      );
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > (length as number) + 1) {
      issues.push(`${path} cannot contain additional properties.`);
      return null;
    }
    const result: unknown[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        issues.push(`${path}[${index.toString()}] must be an enumerable data property.`);
        continue;
      }
      result.push(descriptor.value);
    }
    if (result.length !== length) return null;
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

function isPositiveRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function analyzeUuid(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) issues.push(`${path} is invalid.`);
}

function analyzeFingerprint(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || !fingerprintPattern.test(value)) {
    issues.push(`${path} must be one canonical lowercase SHA-256 digest.`);
  }
}

function analyzeProviderWorkReference(
  value: unknown,
  path: string,
  issues: string[],
  nullable: boolean,
): void {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !providerWorkReferencePattern.test(value)) {
    issues.push(`${path} is invalid.`);
  }
}

function analyzeTargetIdentity(
  target: unknown,
  exchangeId: unknown,
  path: string,
  issues: string[],
): void {
  if (!(npShopPackingWorkTargets as readonly unknown[]).includes(target)) {
    issues.push(`${path}.target is invalid.`);
  }
  if (exchangeId !== null) analyzeUuid(exchangeId, `${path}.exchangeId`, issues);
  if (
    (target === "outbound" && exchangeId !== null) ||
    (target === "replacement" && exchangeId === null)
  ) {
    issues.push(`${path} exchange identity does not match its target.`);
  }
}

function analyzeLine(
  value: unknown,
  path: string,
  issues: string[],
  budget: GraphBudget,
): SafeRecord | null {
  const line = readExactDataObject(
    value,
    ["lineKey", "productId", "productSlug", "variantSku", "quantity"],
    path,
    issues,
    budget,
  );
  if (!line) return null;
  if (
    typeof line.lineKey !== "string" ||
    line.lineKey.length < 1 ||
    line.lineKey.length > npShopPackingWorkLimits.lineKeyLength ||
    line.lineKey.trim() !== line.lineKey
  ) {
    issues.push(`${path}.lineKey is invalid.`);
  }
  analyzeUuid(line.productId, `${path}.productId`, issues);
  if (
    typeof line.productSlug !== "string" ||
    line.productSlug.length < 1 ||
    line.productSlug.length > npShopPackingWorkLimits.productSlugLength ||
    line.productSlug.trim() !== line.productSlug
  ) {
    issues.push(`${path}.productSlug is invalid.`);
  }
  if (
    line.variantSku !== null &&
    (typeof line.variantSku !== "string" ||
      line.variantSku.length < 1 ||
      line.variantSku.length > npShopPackingWorkLimits.variantSkuLength ||
      line.variantSku.trim() !== line.variantSku)
  ) {
    issues.push(`${path}.variantSku is invalid.`);
  }
  if (
    !Number.isSafeInteger(line.quantity) ||
    (line.quantity as number) < 1 ||
    (line.quantity as number) > npShopPackingWorkLimits.maximumQuantity
  ) {
    issues.push(`${path}.quantity is invalid.`);
  }
  return line;
}

function analyzeLines(
  value: unknown,
  path: string,
  issues: string[],
  budget: GraphBudget,
): readonly SafeRecord[] | null {
  const values = readBoundedDataArray(
    value,
    1,
    npShopPackingWorkLimits.maximumLines,
    path,
    issues,
    budget,
  );
  if (!values) return null;
  const lines = values
    .map((line, index) => analyzeLine(line, `${path}[${index.toString()}]`, issues, budget))
    .filter((line): line is SafeRecord => line !== null);
  const lineKeys = lines
    .map((line) => line.lineKey)
    .filter((lineKey): lineKey is string => typeof lineKey === "string");
  if (new Set(lineKeys).size !== lineKeys.length) issues.push(`${path} line keys must be unique.`);
  return lines;
}

function analyzeParcelItem(
  value: unknown,
  path: string,
  issues: string[],
  budget: GraphBudget,
): SafeRecord | null {
  const item = readExactDataObject(value, ["lineKey", "quantity"], path, issues, budget);
  if (!item) return null;
  if (
    typeof item.lineKey !== "string" ||
    item.lineKey.length < 1 ||
    item.lineKey.length > npShopPackingWorkLimits.lineKeyLength ||
    item.lineKey.trim() !== item.lineKey
  ) {
    issues.push(`${path}.lineKey is invalid.`);
  }
  if (
    !Number.isSafeInteger(item.quantity) ||
    (item.quantity as number) < 1 ||
    (item.quantity as number) > npShopPackingWorkLimits.maximumQuantity
  ) {
    issues.push(`${path}.quantity is invalid.`);
  }
  return item;
}

interface AnalyzedParcel {
  readonly record: SafeRecord;
  readonly items: readonly SafeRecord[];
}

function analyzeParcel(
  value: unknown,
  path: string,
  issues: string[],
  budget: GraphBudget,
): AnalyzedParcel | null {
  const parcel = readExactDataObject(
    value,
    ["id", "lengthMm", "widthMm", "heightMm", "weightGrams", "items"],
    path,
    issues,
    budget,
  );
  if (!parcel) return null;
  if (typeof parcel.id !== "string" || !parcelIdPattern.test(parcel.id)) {
    issues.push(`${path}.id is invalid.`);
  }
  for (const key of ["lengthMm", "widthMm", "heightMm"] as const) {
    if (
      !Number.isSafeInteger(parcel[key]) ||
      (parcel[key] as number) < 1 ||
      (parcel[key] as number) > npShopPackingWorkLimits.maximumDimensionMm
    ) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (
    !Number.isSafeInteger(parcel.weightGrams) ||
    (parcel.weightGrams as number) < 1 ||
    (parcel.weightGrams as number) > npShopPackingWorkLimits.maximumWeightGrams
  ) {
    issues.push(`${path}.weightGrams is invalid.`);
  }
  const itemValues = readBoundedDataArray(
    parcel.items,
    1,
    npShopPackingWorkLimits.maximumAllocations,
    `${path}.items`,
    issues,
    budget,
  );
  if (!itemValues) return { record: parcel, items: [] };
  const items = itemValues
    .map((item, index) =>
      analyzeParcelItem(item, `${path}.items[${index.toString()}]`, issues, budget),
    )
    .filter((item): item is SafeRecord => item !== null);
  const lineKeys = items
    .map((item) => item.lineKey)
    .filter((lineKey): lineKey is string => typeof lineKey === "string");
  if (new Set(lineKeys).size !== lineKeys.length) {
    issues.push(`${path}.items cannot repeat one line key.`);
  }
  return { record: parcel, items };
}

function analyzeParcels(
  value: unknown,
  path: string,
  issues: string[],
  budget: GraphBudget,
): readonly AnalyzedParcel[] | null {
  const values = readBoundedDataArray(
    value,
    1,
    npShopPackingWorkLimits.maximumParcels,
    path,
    issues,
    budget,
  );
  if (!values) return null;
  const parcels = values
    .map((parcel, index) => analyzeParcel(parcel, `${path}[${index.toString()}]`, issues, budget))
    .filter((parcel): parcel is AnalyzedParcel => parcel !== null);
  const parcelIds = parcels
    .map(({ record }) => record.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(parcelIds).size !== parcelIds.length) issues.push(`${path} ids must be unique.`);
  const allocationCount = parcels.reduce((total, parcel) => total + parcel.items.length, 0);
  if (allocationCount > npShopPackingWorkLimits.maximumAllocations) {
    issues.push(
      `${path} accepts at most ${npShopPackingWorkLimits.maximumAllocations.toString()} allocations.`,
    );
  }
  return parcels;
}

function analyzeSnapshot(
  linesValue: unknown,
  parcelsValue: unknown,
  path: string,
  issues: string[],
  budget: GraphBudget,
): { readonly lines: readonly SafeRecord[]; readonly parcels: readonly AnalyzedParcel[] } | null {
  const lines = analyzeLines(linesValue, `${path}.lines`, issues, budget);
  const parcels = analyzeParcels(parcelsValue, `${path}.parcels`, issues, budget);
  if (!lines || !parcels) return null;
  const expected = new Map<string, number>();
  for (const line of lines) {
    if (typeof line.lineKey === "string" && Number.isSafeInteger(line.quantity)) {
      expected.set(line.lineKey, line.quantity as number);
    }
  }
  const allocated = new Map<string, number>();
  for (const parcel of parcels) {
    for (const item of parcel.items) {
      if (typeof item.lineKey === "string" && Number.isSafeInteger(item.quantity)) {
        allocated.set(item.lineKey, (allocated.get(item.lineKey) ?? 0) + (item.quantity as number));
      }
    }
  }
  if (
    allocated.size !== expected.size ||
    [...expected].some(([lineKey, quantity]) => allocated.get(lineKey) !== quantity) ||
    [...allocated.keys()].some((lineKey) => !expected.has(lineKey))
  ) {
    issues.push(`${path}.parcels must allocate every immutable line and exact quantity.`);
  }
  return { lines, parcels };
}

const fingerprintSourceKeys = [
  "target",
  "exchangeId",
  "sourceRevision",
  "parcelRevision",
  "lines",
  "parcels",
] as const;

interface ParsedFingerprintSource {
  readonly record: SafeRecord;
  readonly lines: readonly SafeRecord[];
  readonly parcels: readonly AnalyzedParcel[];
}

function parseFingerprintSource(
  value: unknown,
  path: string,
  issues: string[],
  budget: GraphBudget,
): ParsedFingerprintSource | null {
  const source = readExactDataObject(value, fingerprintSourceKeys, path, issues, budget);
  if (!source) return null;
  analyzeTargetIdentity(source.target, source.exchangeId, path, issues);
  if (!isPositiveRevision(source.sourceRevision)) {
    issues.push(`${path}.sourceRevision is invalid.`);
  }
  if (!isPositiveRevision(source.parcelRevision)) {
    issues.push(`${path}.parcelRevision is invalid.`);
  }
  const snapshot = analyzeSnapshot(source.lines, source.parcels, path, issues, budget);
  if (!snapshot) return null;
  return { record: source, ...snapshot };
}

/**
 * Validate the exact PII-free source serialized by
 * npSerializeShopPackingWorkFingerprintSource before hashing it with SHA-256.
 */
export function npAnalyzeShopPackingWorkFingerprintSource(value: unknown): string[] {
  const issues: string[] = [];
  parseFingerprintSource(value, "packing work fingerprint source", issues, createGraphBudget());
  return issues;
}

/**
 * Return deterministic JSON for the exact target, revisions, lines, and parcel
 * snapshot. The service hashes these UTF-8 bytes with SHA-256; hashing stays
 * outside this browser-compatible public contract module.
 */
export function npSerializeShopPackingWorkFingerprintSource(value: unknown): string {
  const issues: string[] = [];
  const parsed = parseFingerprintSource(
    value,
    "packing work fingerprint source",
    issues,
    createGraphBudget(),
  );
  if (!parsed || issues.length) {
    throw new NpShopPackingWorkContractError(
      "Invalid Shop packing work fingerprint source",
      issues,
    );
  }
  return JSON.stringify({
    target: parsed.record.target,
    exchangeId: parsed.record.exchangeId,
    sourceRevision: parsed.record.sourceRevision,
    parcelRevision: parsed.record.parcelRevision,
    lines: parsed.lines.map((line) => ({
      lineKey: line.lineKey,
      productId: line.productId,
      productSlug: line.productSlug,
      variantSku: line.variantSku,
      quantity: line.quantity,
    })),
    parcels: parsed.parcels.map((parcel) => ({
      id: parcel.record.id,
      lengthMm: parcel.record.lengthMm,
      widthMm: parcel.record.widthMm,
      heightMm: parcel.record.heightMm,
      weightGrams: parcel.record.weightGrams,
      items: parcel.items.map((item) => ({
        lineKey: item.lineKey,
        quantity: item.quantity,
      })),
    })),
  });
}

export function npRequireShopPackingWorkParcelFingerprint(value: unknown): string {
  const issues: string[] = [];
  analyzeFingerprint(value, "parcel fingerprint", issues);
  if (issues.length) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work fingerprint", issues);
  }
  return value as string;
}

export function npRequireShopPackingWorkProviderId(value: unknown): string {
  if (typeof value !== "string" || !providerIdPattern.test(value)) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work provider id", [
      "provider id must be a lowercase slug with at most 32 characters.",
    ]);
  }
  return value;
}

export function npShopPackingWorkStorageKey(
  target: NpShopPackingWorkTarget,
  orderId: string,
): string {
  if (!(npShopPackingWorkTargets as readonly unknown[]).includes(target)) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work storage target", [
      "packing work storage target is invalid.",
    ]);
  }
  if (typeof orderId !== "string" || !uuidPattern.test(orderId)) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work storage order id", [
      "packing work storage order id is invalid.",
    ]);
  }
  return `packing-work:${target}:${orderId}`;
}

const createRequestKeys = [
  "contract",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "sourceRevision",
  "parcelRevision",
  "parcelFingerprint",
  "lines",
  "parcels",
  "requestedAt",
] as const;

export function npAnalyzeShopPackingWorkCreateRequest(value: unknown): string[] {
  const issues: string[] = [];
  const budget = createGraphBudget();
  const request = readExactDataObject(
    value,
    createRequestKeys,
    "packing work create request",
    issues,
    budget,
  );
  if (!request) return issues;
  if (request.contract !== NP_SHOP_PACKING_WORK_CREATE_REQUEST_CONTRACT) {
    issues.push("packing work create request.contract is invalid.");
  }
  analyzeUuid(request.workId, "packing work create request.workId", issues);
  analyzeUuid(request.orderId, "packing work create request.orderId", issues);
  analyzeTargetIdentity(request.target, request.exchangeId, "packing work create request", issues);
  if (!isPositiveRevision(request.sourceRevision)) {
    issues.push("packing work create request.sourceRevision is invalid.");
  }
  if (!isPositiveRevision(request.parcelRevision)) {
    issues.push("packing work create request.parcelRevision is invalid.");
  }
  analyzeFingerprint(
    request.parcelFingerprint,
    "packing work create request.parcelFingerprint",
    issues,
  );
  analyzeSnapshot(request.lines, request.parcels, "packing work create request", issues, budget);
  if (!isIso(request.requestedAt)) {
    issues.push("packing work create request.requestedAt is invalid.");
  }
  return issues;
}

export function npRequireShopPackingWorkCreateRequest(
  value: unknown,
): NpShopPackingWorkCreateRequest {
  const issues = npAnalyzeShopPackingWorkCreateRequest(value);
  if (issues.length) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work create request", issues);
  }
  return value as NpShopPackingWorkCreateRequest;
}

const createResultKeys = [
  "contract",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "sourceRevision",
  "parcelRevision",
  "parcelFingerprint",
  "providerWorkReference",
  "confirmedAt",
] as const;

export function npAnalyzeShopPackingWorkCreateResult(value: unknown): string[] {
  const issues: string[] = [];
  const result = readExactDataObject(
    value,
    createResultKeys,
    "packing work create result",
    issues,
    createGraphBudget(),
  );
  if (!result) return issues;
  if (result.contract !== NP_SHOP_PACKING_WORK_CREATE_RESULT_CONTRACT) {
    issues.push("packing work create result.contract is invalid.");
  }
  analyzeUuid(result.workId, "packing work create result.workId", issues);
  analyzeUuid(result.orderId, "packing work create result.orderId", issues);
  analyzeTargetIdentity(result.target, result.exchangeId, "packing work create result", issues);
  if (!isPositiveRevision(result.sourceRevision)) {
    issues.push("packing work create result.sourceRevision is invalid.");
  }
  if (!isPositiveRevision(result.parcelRevision)) {
    issues.push("packing work create result.parcelRevision is invalid.");
  }
  analyzeFingerprint(
    result.parcelFingerprint,
    "packing work create result.parcelFingerprint",
    issues,
  );
  analyzeProviderWorkReference(
    result.providerWorkReference,
    "packing work create result.providerWorkReference",
    issues,
    false,
  );
  if (!isIso(result.confirmedAt)) {
    issues.push("packing work create result.confirmedAt is invalid.");
  }
  return issues;
}

export function npRequireShopPackingWorkCreateResult(
  value: unknown,
): NpShopPackingWorkCreateResult {
  const issues: string[] = [];
  const result = readExactDataObject(
    value,
    createResultKeys,
    "packing work create result",
    issues,
    createGraphBudget(),
  );
  if (result) issues.push(...npAnalyzeShopPackingWorkCreateResult(result));
  if (issues.length || !result) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work create result", issues);
  }
  return Object.freeze({ ...result }) as unknown as NpShopPackingWorkCreateResult;
}

export function npCreateShopPackingWorkCreateResult<
  TRequest extends NpShopPackingWorkCreateRequest,
>(
  request: TRequest,
  result: Pick<NpShopPackingWorkCreateResultBase, "providerWorkReference" | "confirmedAt">,
): NpShopPackingWorkCreateResultFor<TRequest> {
  const common = {
    contract: NP_SHOP_PACKING_WORK_CREATE_RESULT_CONTRACT,
    workId: request.workId,
    orderId: request.orderId,
    sourceRevision: request.sourceRevision,
    parcelRevision: request.parcelRevision,
    parcelFingerprint: request.parcelFingerprint,
    providerWorkReference: result.providerWorkReference,
    confirmedAt: result.confirmedAt,
  };
  return (
    request.target === "outbound"
      ? { ...common, target: "outbound", exchangeId: null }
      : { ...common, target: "replacement", exchangeId: request.exchangeId }
  ) as NpShopPackingWorkCreateResultFor<TRequest>;
}

const cancelRequestKeys = [
  "contract",
  "cancellationId",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "sourceRevision",
  "parcelRevision",
  "parcelFingerprint",
  "providerWorkReference",
  "requestedAt",
] as const;

export function npAnalyzeShopPackingWorkCancelRequest(value: unknown): string[] {
  const issues: string[] = [];
  const request = readExactDataObject(
    value,
    cancelRequestKeys,
    "packing work cancel request",
    issues,
    createGraphBudget(),
  );
  if (!request) return issues;
  if (request.contract !== NP_SHOP_PACKING_WORK_CANCEL_REQUEST_CONTRACT) {
    issues.push("packing work cancel request.contract is invalid.");
  }
  for (const key of ["cancellationId", "workId", "orderId"] as const) {
    analyzeUuid(request[key], `packing work cancel request.${key}`, issues);
  }
  analyzeTargetIdentity(request.target, request.exchangeId, "packing work cancel request", issues);
  if (!isPositiveRevision(request.sourceRevision)) {
    issues.push("packing work cancel request.sourceRevision is invalid.");
  }
  if (!isPositiveRevision(request.parcelRevision)) {
    issues.push("packing work cancel request.parcelRevision is invalid.");
  }
  analyzeFingerprint(
    request.parcelFingerprint,
    "packing work cancel request.parcelFingerprint",
    issues,
  );
  analyzeProviderWorkReference(
    request.providerWorkReference,
    "packing work cancel request.providerWorkReference",
    issues,
    true,
  );
  if (!isIso(request.requestedAt)) {
    issues.push("packing work cancel request.requestedAt is invalid.");
  }
  return issues;
}

export function npRequireShopPackingWorkCancelRequest(
  value: unknown,
): NpShopPackingWorkCancelRequest {
  const issues = npAnalyzeShopPackingWorkCancelRequest(value);
  if (issues.length) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work cancel request", issues);
  }
  return value as NpShopPackingWorkCancelRequest;
}

const cancelResultKeys = [
  "contract",
  "cancellationId",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "sourceRevision",
  "parcelRevision",
  "parcelFingerprint",
  "providerWorkReference",
  "cancelledAt",
] as const;

export function npAnalyzeShopPackingWorkCancelResult(value: unknown): string[] {
  const issues: string[] = [];
  const result = readExactDataObject(
    value,
    cancelResultKeys,
    "packing work cancel result",
    issues,
    createGraphBudget(),
  );
  if (!result) return issues;
  if (result.contract !== NP_SHOP_PACKING_WORK_CANCEL_RESULT_CONTRACT) {
    issues.push("packing work cancel result.contract is invalid.");
  }
  for (const key of ["cancellationId", "workId", "orderId"] as const) {
    analyzeUuid(result[key], `packing work cancel result.${key}`, issues);
  }
  analyzeTargetIdentity(result.target, result.exchangeId, "packing work cancel result", issues);
  if (!isPositiveRevision(result.sourceRevision)) {
    issues.push("packing work cancel result.sourceRevision is invalid.");
  }
  if (!isPositiveRevision(result.parcelRevision)) {
    issues.push("packing work cancel result.parcelRevision is invalid.");
  }
  analyzeFingerprint(
    result.parcelFingerprint,
    "packing work cancel result.parcelFingerprint",
    issues,
  );
  analyzeProviderWorkReference(
    result.providerWorkReference,
    "packing work cancel result.providerWorkReference",
    issues,
    true,
  );
  if (!isIso(result.cancelledAt)) {
    issues.push("packing work cancel result.cancelledAt is invalid.");
  }
  return issues;
}

export function npRequireShopPackingWorkCancelResult(
  value: unknown,
): NpShopPackingWorkCancelResult {
  const issues: string[] = [];
  const result = readExactDataObject(
    value,
    cancelResultKeys,
    "packing work cancel result",
    issues,
    createGraphBudget(),
  );
  if (result) issues.push(...npAnalyzeShopPackingWorkCancelResult(result));
  if (issues.length || !result) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work cancel result", issues);
  }
  return Object.freeze({ ...result }) as unknown as NpShopPackingWorkCancelResult;
}

export function npCreateShopPackingWorkCancelResult<
  TRequest extends NpShopPackingWorkCancelRequest,
>(
  request: TRequest,
  result: Pick<NpShopPackingWorkCancelResultBase, "cancelledAt">,
): NpShopPackingWorkCancelResultFor<TRequest> {
  const common = {
    contract: NP_SHOP_PACKING_WORK_CANCEL_RESULT_CONTRACT,
    cancellationId: request.cancellationId,
    workId: request.workId,
    orderId: request.orderId,
    sourceRevision: request.sourceRevision,
    parcelRevision: request.parcelRevision,
    parcelFingerprint: request.parcelFingerprint,
    providerWorkReference: request.providerWorkReference,
    cancelledAt: result.cancelledAt,
  };
  return (
    request.target === "outbound"
      ? { ...common, target: "outbound", exchangeId: null }
      : { ...common, target: "replacement", exchangeId: request.exchangeId }
  ) as NpShopPackingWorkCancelResultFor<TRequest>;
}

function analyzeEvaluatedAt(value: unknown, issues: string[]): number | null {
  try {
    const evaluated = Date.prototype.getTime.call(value);
    if (!Number.isFinite(evaluated)) throw new TypeError("Invalid evaluatedAt");
    return evaluated;
  } catch {
    issues.push("evaluatedAt is invalid.");
    return null;
  }
}

function analyzeResultTiming(
  requestedAt: string,
  completedAt: string,
  evaluatedAt: number,
  resultPath: string,
  issues: string[],
): void {
  const requested = new Date(requestedAt).getTime();
  const completed = new Date(completedAt).getTime();
  const evaluated = evaluatedAt;
  const tolerance = npShopPackingWorkLimits.futureToleranceSeconds * 1_000;
  if (completed < requested) issues.push(`${resultPath} cannot precede requestedAt.`);
  if (requested > evaluated + tolerance)
    issues.push("request.requestedAt is too far in the future.");
  if (completed > evaluated + tolerance) issues.push(`${resultPath} is too far in the future.`);
}

export function npAnalyzeShopPackingWorkCreateResultForRequest(
  requestValue: unknown,
  resultValue: unknown,
  evaluatedAt: unknown,
): string[] {
  const issues: string[] = [];
  const requestRecord = readExactDataObject(
    requestValue,
    createRequestKeys,
    "packing work create request",
    issues,
    createGraphBudget(),
  );
  const resultRecord = readExactDataObject(
    resultValue,
    createResultKeys,
    "packing work create result",
    issues,
    createGraphBudget(),
  );
  if (requestRecord) issues.push(...npAnalyzeShopPackingWorkCreateRequest(requestRecord));
  if (resultRecord) issues.push(...npAnalyzeShopPackingWorkCreateResult(resultRecord));
  const evaluated = analyzeEvaluatedAt(evaluatedAt, issues);
  if (issues.length || evaluated === null || !requestRecord || !resultRecord) return issues;
  const request = requestRecord as unknown as NpShopPackingWorkCreateRequest;
  const result = resultRecord as unknown as NpShopPackingWorkCreateResult;
  for (const key of [
    "workId",
    "orderId",
    "target",
    "exchangeId",
    "sourceRevision",
    "parcelRevision",
    "parcelFingerprint",
  ] as const) {
    if (result[key] !== request[key]) issues.push(`result.${key} must match the request.`);
  }
  analyzeResultTiming(
    request.requestedAt,
    result.confirmedAt,
    evaluated,
    "result.confirmedAt",
    issues,
  );
  return issues;
}

export function npAnalyzeShopPackingWorkCancelResultForRequest(
  requestValue: unknown,
  resultValue: unknown,
  evaluatedAt: unknown,
): string[] {
  const issues: string[] = [];
  const requestRecord = readExactDataObject(
    requestValue,
    cancelRequestKeys,
    "packing work cancel request",
    issues,
    createGraphBudget(),
  );
  const resultRecord = readExactDataObject(
    resultValue,
    cancelResultKeys,
    "packing work cancel result",
    issues,
    createGraphBudget(),
  );
  if (requestRecord) issues.push(...npAnalyzeShopPackingWorkCancelRequest(requestRecord));
  if (resultRecord) issues.push(...npAnalyzeShopPackingWorkCancelResult(resultRecord));
  const evaluated = analyzeEvaluatedAt(evaluatedAt, issues);
  if (issues.length || evaluated === null || !requestRecord || !resultRecord) return issues;
  const request = requestRecord as unknown as NpShopPackingWorkCancelRequest;
  const result = resultRecord as unknown as NpShopPackingWorkCancelResult;
  for (const key of [
    "cancellationId",
    "workId",
    "orderId",
    "target",
    "exchangeId",
    "sourceRevision",
    "parcelRevision",
    "parcelFingerprint",
    "providerWorkReference",
  ] as const) {
    if (result[key] !== request[key]) issues.push(`result.${key} must match the request.`);
  }
  analyzeResultTiming(
    request.requestedAt,
    result.cancelledAt,
    evaluated,
    "result.cancelledAt",
    issues,
  );
  return issues;
}

const storedKeys = [
  "contract",
  "workId",
  "orderId",
  "target",
  "exchangeId",
  "providerId",
  "status",
  "revision",
  "sourceRevision",
  "parcelRevision",
  "parcelFingerprint",
  "lines",
  "parcels",
  "providerWorkReference",
  "providerErrorCode",
  "cancellationId",
  "attachedShipmentId",
  "requestedAt",
  "confirmedAt",
  "activatedAt",
  "cancelRequestedAt",
  "cancelledAt",
  "consumedAt",
  "updatedAt",
  "purgeAt",
] as const;

function isStatus(value: unknown): value is NpShopPackingWorkStatus {
  return (npShopPackingWorkStatuses as readonly unknown[]).includes(value);
}

function analyzeStoredState(record: SafeRecord, path: string, issues: string[]): void {
  const hasReference = record.providerWorkReference !== null;
  const hasConfirmation = record.confirmedAt !== null;
  const hasActivation = record.activatedAt !== null;
  const hasCancellationId = record.cancellationId !== null;
  const hasCancelRequest = record.cancelRequestedAt !== null;
  const hasCancellationConfirmation = record.cancelledAt !== null;
  const hasShipment = record.attachedShipmentId !== null;
  const hasConsumption = record.consumedAt !== null;

  if (hasReference !== hasConfirmation) {
    issues.push(`${path} provider confirmation fields must be complete or empty.`);
  }
  if (hasActivation && !hasConfirmation) {
    issues.push(`${path}.activatedAt requires provider confirmation.`);
  }
  if (hasCancellationId !== hasCancelRequest) {
    issues.push(`${path} cancellation intent fields must be complete or empty.`);
  }
  if (hasCancellationConfirmation && !hasCancelRequest) {
    issues.push(`${path}.cancelledAt requires a cancellation intent.`);
  }
  if (hasShipment && (!hasConfirmation || !hasActivation)) {
    issues.push(`${path}.attachedShipmentId requires active provider work.`);
  }
  if (hasConsumption && (!hasConfirmation || !hasActivation)) {
    issues.push(`${path}.consumedAt requires active provider work.`);
  }

  if (
    record.status === "pending" &&
    (hasConfirmation ||
      hasActivation ||
      hasCancelRequest ||
      hasCancellationConfirmation ||
      hasShipment ||
      hasConsumption)
  ) {
    issues.push(`${path}.pending cannot contain provider, cancellation, or consumption effects.`);
  }
  if (
    record.status === "provider-confirmed" &&
    (!hasConfirmation || hasActivation || hasCancelRequest || hasShipment || hasConsumption)
  ) {
    issues.push(`${path}.provider-confirmed fields are inconsistent.`);
  }
  if (
    record.status === "active" &&
    (!hasConfirmation || !hasActivation || hasCancelRequest || hasConsumption)
  ) {
    issues.push(`${path}.active fields are inconsistent.`);
  }
  if (record.status === "cancel-pending" && (!hasCancelRequest || hasCancellationConfirmation)) {
    issues.push(`${path}.cancel-pending requires one unconfirmed cancellation intent.`);
  }
  if (
    (record.status === "cancel-confirmed" || record.status === "cancelled") &&
    (!hasCancelRequest || !hasCancellationConfirmation)
  ) {
    issues.push(`${path}.${String(record.status)} requires provider cancellation confirmation.`);
  }
  if (
    record.status === "consumed" &&
    (!hasConfirmation || !hasActivation || !hasConsumption || hasCancelRequest)
  ) {
    issues.push(`${path}.consumed requires activated work and one consumption timestamp.`);
  }
  if (record.status !== "consumed" && record.status !== "manual-review" && hasConsumption) {
    issues.push(`${path} shipment consumption is allowed only in consumed or manual-review.`);
  }
  if (
    !(
      [
        "active",
        "cancel-pending",
        "cancel-confirmed",
        "cancelled",
        "consumed",
        "manual-review",
      ] as readonly unknown[]
    ).includes(record.status) &&
    hasShipment
  ) {
    issues.push(`${path}.attachedShipmentId is not allowed in this state.`);
  }
  if (record.status === "manual-review" && record.providerErrorCode === null) {
    issues.push(`${path}.manual-review requires one closed provider error code.`);
  }
  if (record.status !== "manual-review" && record.providerErrorCode !== null) {
    issues.push(`${path}.providerErrorCode is allowed only in manual-review.`);
  }
}

function analyzeStoredTimes(record: SafeRecord, path: string, issues: string[]): void {
  const eventKeys = [
    "confirmedAt",
    "activatedAt",
    "cancelRequestedAt",
    "cancelledAt",
    "consumedAt",
  ] as const;
  if (
    isIso(record.requestedAt) &&
    isIso(record.updatedAt) &&
    record.updatedAt < record.requestedAt
  ) {
    issues.push(`${path}.updatedAt cannot precede requestedAt.`);
  }
  if (isIso(record.requestedAt) && isIso(record.purgeAt) && record.purgeAt <= record.requestedAt) {
    issues.push(`${path}.purgeAt must follow the original request.`);
  }
  for (const key of eventKeys) {
    if (isIso(record[key]) && isIso(record.requestedAt) && record[key] < record.requestedAt) {
      issues.push(`${path}.${key} cannot precede requestedAt.`);
    }
    if (isIso(record[key]) && isIso(record.updatedAt) && record[key] > record.updatedAt) {
      issues.push(`${path}.${key} cannot follow updatedAt.`);
    }
  }
  if (
    isIso(record.activatedAt) &&
    isIso(record.confirmedAt) &&
    record.activatedAt < record.confirmedAt
  ) {
    issues.push(`${path}.activatedAt cannot precede confirmedAt.`);
  }
  const latestProviderReadyAt = isIso(record.activatedAt)
    ? record.activatedAt
    : isIso(record.confirmedAt)
      ? record.confirmedAt
      : null;
  if (
    latestProviderReadyAt &&
    isIso(record.cancelRequestedAt) &&
    record.cancelRequestedAt < latestProviderReadyAt
  ) {
    issues.push(`${path}.cancelRequestedAt cannot precede the provider-ready state.`);
  }
  if (
    isIso(record.cancelledAt) &&
    isIso(record.cancelRequestedAt) &&
    record.cancelledAt < record.cancelRequestedAt
  ) {
    issues.push(`${path}.cancelledAt cannot precede cancelRequestedAt.`);
  }
  if (
    isIso(record.consumedAt) &&
    isIso(record.activatedAt) &&
    record.consumedAt < record.activatedAt
  ) {
    issues.push(`${path}.consumedAt cannot precede activatedAt.`);
  }
}

export function npAnalyzeStoredShopPackingWork(value: unknown): string[] {
  const issues: string[] = [];
  const budget = createGraphBudget();
  const record = readExactDataObject(value, storedKeys, "stored packing work", issues, budget);
  if (!record) return issues;
  if (record.contract !== NP_SHOP_PACKING_WORK_STORAGE_CONTRACT) {
    issues.push("stored packing work.contract is invalid.");
  }
  analyzeUuid(record.workId, "stored packing work.workId", issues);
  analyzeUuid(record.orderId, "stored packing work.orderId", issues);
  analyzeTargetIdentity(record.target, record.exchangeId, "stored packing work", issues);
  if (typeof record.providerId !== "string" || !providerIdPattern.test(record.providerId)) {
    issues.push("stored packing work.providerId is invalid.");
  }
  if (!isStatus(record.status)) issues.push("stored packing work.status is invalid.");
  if (!isPositiveRevision(record.revision)) {
    issues.push("stored packing work.revision is invalid.");
  }
  if (!isPositiveRevision(record.sourceRevision)) {
    issues.push("stored packing work.sourceRevision is invalid.");
  }
  if (!isPositiveRevision(record.parcelRevision)) {
    issues.push("stored packing work.parcelRevision is invalid.");
  }
  analyzeFingerprint(record.parcelFingerprint, "stored packing work.parcelFingerprint", issues);
  analyzeSnapshot(record.lines, record.parcels, "stored packing work", issues, budget);
  analyzeProviderWorkReference(
    record.providerWorkReference,
    "stored packing work.providerWorkReference",
    issues,
    true,
  );
  if (
    record.providerErrorCode !== null &&
    (typeof record.providerErrorCode !== "string" ||
      !providerErrorCodePattern.test(record.providerErrorCode))
  ) {
    issues.push("stored packing work.providerErrorCode is invalid.");
  }
  if (record.cancellationId !== null) {
    analyzeUuid(record.cancellationId, "stored packing work.cancellationId", issues);
  }
  if (record.attachedShipmentId !== null) {
    analyzeUuid(record.attachedShipmentId, "stored packing work.attachedShipmentId", issues);
  }
  for (const key of ["requestedAt", "updatedAt", "purgeAt"] as const) {
    if (!isIso(record[key])) issues.push(`stored packing work.${key} is invalid.`);
  }
  for (const key of [
    "confirmedAt",
    "activatedAt",
    "cancelRequestedAt",
    "cancelledAt",
    "consumedAt",
  ] as const) {
    if (record[key] !== null && !isIso(record[key])) {
      issues.push(`stored packing work.${key} is invalid.`);
    }
  }
  analyzeStoredState(record, "stored packing work", issues);
  analyzeStoredTimes(record, "stored packing work", issues);
  return issues;
}

export function npRequireStoredShopPackingWork(value: unknown): NpShopStoredPackingWork {
  const issues = npAnalyzeStoredShopPackingWork(value);
  if (issues.length) {
    throw new NpShopPackingWorkContractError("Invalid stored Shop packing work", issues);
  }
  return value as NpShopStoredPackingWork;
}

interface ActionEnvelope {
  readonly row: unknown;
  readonly values: unknown;
  readonly budget: GraphBudget;
}

function requireActionEnvelope(value: unknown): ActionEnvelope {
  const issues: string[] = [];
  const budget = createGraphBudget();
  const envelope = readExactDataObject(value, ["row", "values"], "payload", issues, budget);
  if (!envelope || issues.length) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work action", issues);
  }
  return { row: envelope.row, values: envelope.values, budget };
}

function requireCreateAction(
  value: unknown,
  target: NpShopPackingWorkTarget,
): NpShopPackingWorkCreateActionInput {
  const { row, values, budget } = requireActionEnvelope(value);
  const issues: string[] = [];
  const rowKeys =
    target === "outbound"
      ? ["id", "fulfillmentRevision", "parcelRevision", "packingWorkRevision"]
      : ["id", "exchangeId", "exchangeRevision", "parcelRevision", "packingWorkRevision"];
  const exactRow = readExactDataObject(row, rowKeys, "payload.row", issues, budget);
  readExactDataObject(values, [], "payload.values", issues, budget);
  if (exactRow) {
    analyzeUuid(exactRow.id, "payload.row.id", issues);
    if (target === "replacement") {
      analyzeUuid(exactRow.exchangeId, "payload.row.exchangeId", issues);
    }
    const sourceRevision =
      target === "outbound" ? exactRow.fulfillmentRevision : exactRow.exchangeRevision;
    if (!isPositiveRevision(sourceRevision)) {
      issues.push(
        `payload.row.${target === "outbound" ? "fulfillmentRevision" : "exchangeRevision"} is invalid.`,
      );
    }
    if (!isPositiveRevision(exactRow.parcelRevision)) {
      issues.push("payload.row.parcelRevision is invalid.");
    }
    if (
      exactRow.packingWorkRevision !== null &&
      !isPositiveRevision(exactRow.packingWorkRevision)
    ) {
      issues.push("payload.row.packingWorkRevision is invalid.");
    }
  }
  if (!exactRow || issues.length) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing work create action", issues);
  }
  const common = {
    orderId: exactRow.id as string,
    expectedSourceRevision: (target === "outbound"
      ? exactRow.fulfillmentRevision
      : exactRow.exchangeRevision) as number,
    expectedParcelRevision: exactRow.parcelRevision as number,
    expectedWorkRevision: exactRow.packingWorkRevision as number | null,
  };
  return target === "outbound"
    ? { ...common, target: "outbound", exchangeId: null }
    : {
        ...common,
        target: "replacement",
        exchangeId: exactRow.exchangeId as string,
      };
}

export function npRequireShopFulfillmentPackingWorkCreateInput(
  value: unknown,
): NpShopPackingWorkCreateActionInput {
  return requireCreateAction(value, "outbound");
}

export function npRequireShopExchangePackingWorkCreateInput(
  value: unknown,
): NpShopPackingWorkCreateActionInput {
  return requireCreateAction(value, "replacement");
}

export function npRequireShopPackingWorkExistingActionInput(
  value: unknown,
): NpShopPackingWorkExistingActionInput {
  const { row, values, budget } = requireActionEnvelope(value);
  const issues: string[] = [];
  const exactRow = readExactDataObject(
    row,
    ["id", "packingWorkTarget", "exchangeId", "packingWorkId", "packingWorkRevision"],
    "payload.row",
    issues,
    budget,
  );
  readExactDataObject(values, [], "payload.values", issues, budget);
  if (exactRow) {
    analyzeUuid(exactRow.id, "payload.row.id", issues);
    analyzeTargetIdentity(exactRow.packingWorkTarget, exactRow.exchangeId, "payload.row", issues);
    analyzeUuid(exactRow.packingWorkId, "payload.row.packingWorkId", issues);
    if (!isPositiveRevision(exactRow.packingWorkRevision)) {
      issues.push("payload.row.packingWorkRevision is invalid.");
    }
  }
  if (!exactRow || issues.length) {
    throw new NpShopPackingWorkContractError("Invalid existing Shop packing work action", issues);
  }
  const common = {
    orderId: exactRow.id as string,
    workId: exactRow.packingWorkId as string,
    expectedRevision: exactRow.packingWorkRevision as number,
  };
  return exactRow.packingWorkTarget === "outbound"
    ? { ...common, target: "outbound", exchangeId: null }
    : {
        ...common,
        target: "replacement",
        exchangeId: exactRow.exchangeId as string,
      };
}
