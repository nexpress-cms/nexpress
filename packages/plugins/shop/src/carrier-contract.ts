import { npAnalyzeShopDeliveryMethod, type NpShopDeliveryMethod } from "./shipping-contract.js";
import type { NpShopOrderDraftShipping } from "./types.js";
import type {
  NpShopTrackingPollRequest,
  NpShopTrackingPollResult,
  NpShopTrackingWebhookInput,
  NpShopTrackingWebhookResult,
} from "./tracking-contract.js";
import {
  npAnalyzeShopFulfillmentParcels,
  type NpShopFulfillmentParcel,
} from "./parcel-contract.js";

export const NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT =
  "np.shop-carrier-booking-request.v1" as const;
export const NP_SHOP_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT =
  "np.shop-carrier-booking-request.v2" as const;
export const NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT = "np.shop-carrier-booking-result.v1" as const;
export const NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT =
  "np.shop-carrier-booking-storage.v1" as const;

export const npShopCarrierBookingStatuses = [
  "pending",
  "provider-confirmed",
  "completed",
  "manual-review",
] as const;
export type NpShopCarrierBookingStatus = (typeof npShopCarrierBookingStatuses)[number];

export const npShopCarrierLimits = Object.freeze({
  providerIdLength: 32,
  referenceLength: 200,
  carrierLength: 80,
  trackingNumberLength: 120,
  productNameLength: 180,
  variantSkuLength: 64,
  variantNameLength: 120,
  maximumItems: 100,
  maximumQuantity: 99,
  operatorNoteLength: 500,
  providerErrorCodeLength: 100,
  futureToleranceSeconds: 30,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export interface NpShopCarrierBookingItem {
  key: string;
  productId: string;
  productName: string;
  variantSku: string | null;
  variantName: string | null;
  quantity: number;
}

export interface NpShopCarrierBookingRequest {
  contract: typeof NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT;
  shipmentId: string;
  orderId: string;
  fulfillmentRevision: number;
  items: NpShopCarrierBookingItem[];
  destination: NpShopOrderDraftShipping;
  deliveryMethod: NpShopDeliveryMethod | null;
  requestedAt: string;
}

export interface NpShopCarrierParcelBookingRequest extends Omit<
  NpShopCarrierBookingRequest,
  "contract"
> {
  contract: typeof NP_SHOP_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT;
  parcelRevision: number;
  parcels: NpShopFulfillmentParcel[];
}

export interface NpShopCarrierBookingResult {
  contract: typeof NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT;
  shipmentId: string;
  orderId: string;
  bookingReference: string;
  carrier: string;
  trackingNumber: string;
  bookedAt: string;
}

export interface NpShopCarrierAdapter {
  /** Stable lowercase identifier persisted with the PII-free booking record. */
  id: string;
  /**
   * Book exactly one shipment. Implementations must use shipmentId as the
   * provider idempotency key. The destination is private and must stay out of
   * logs, thrown errors, and results.
   */
  bookShipment(
    input: NpShopCarrierBookingRequest,
  ): NpShopCarrierBookingResult | Promise<NpShopCarrierBookingResult>;
  /**
   * Book a shipment from one revision-safe, PII-free parcel snapshot. When
   * present, Shop requires and locks that snapshot before provider I/O. The
   * v1 method remains the fallback for bookings created without parcel data.
   */
  bookShipmentWithParcels?(
    input: NpShopCarrierParcelBookingRequest,
  ): NpShopCarrierBookingResult | Promise<NpShopCarrierBookingResult>;
  /**
   * Authenticate exact carrier callback bytes before projecting one canonical,
   * PII-free tracking event. Omit this capability when tracking callbacks are
   * not configured; booking remains independently available.
   */
  verifyTrackingWebhook?(
    input: NpShopTrackingWebhookInput,
  ): NpShopTrackingWebhookResult | Promise<NpShopTrackingWebhookResult>;
  /**
   * Read one PII-free shipment through an authenticated provider API. The
   * framework leases and schedules calls; implementations return one latest
   * canonical event or an exact no-change result.
   */
  readTracking?(
    input: NpShopTrackingPollRequest,
  ): NpShopTrackingPollResult | Promise<NpShopTrackingPollResult>;
}

export type NpShopCarrierTrackingAdapter = NpShopCarrierAdapter &
  Required<Pick<NpShopCarrierAdapter, "verifyTrackingWebhook">>;

export type NpShopCarrierTrackingPollAdapter = NpShopCarrierAdapter &
  Required<Pick<NpShopCarrierAdapter, "readTracking">>;

export type NpShopCarrierParcelAdapter = NpShopCarrierAdapter &
  Required<Pick<NpShopCarrierAdapter, "bookShipmentWithParcels">>;

export interface NpShopStoredCarrierBooking {
  contract: typeof NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT;
  id: string;
  orderId: string;
  providerId: string;
  status: NpShopCarrierBookingStatus;
  fulfillmentRevision: number;
  operatorNote: string | null;
  bookingReference: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  providerErrorCode: string | null;
  requestedAt: string;
  updatedAt: string;
  bookedAt: string | null;
  purgeAt: string;
}

export interface NpShopCarrierBookingActionInput {
  orderId: string;
  expectedRevision: number;
  operatorNote: string | null;
}

export class NpShopCarrierContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopCarrierContractError";
    this.issues = issues;
  }
}

export class NpShopCarrierProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, options: { retryable: boolean }) {
    super(message);
    this.name = "NpShopCarrierProviderError";
    this.code = code;
    this.retryable = options.retryable;
  }
}

export class NpShopCarrierConflictError extends Error {
  readonly code:
    | "carrier_not_supported"
    | "carrier_fulfillment_not_found"
    | "carrier_fulfillment_revision_conflict"
    | "carrier_fulfillment_not_processing"
    | "carrier_private_expired"
    | "carrier_provider_mismatch"
    | "carrier_result_mismatch"
    | "carrier_manual_review";

  constructor(code: NpShopCarrierConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopCarrierConflictError";
    this.code = code;
  }
}

export class NpShopCarrierUnavailableError extends Error {
  constructor(
    message = "The carrier provider is temporarily unavailable; retry the same booking.",
  ) {
    super(message);
    this.name = "NpShopCarrierUnavailableError";
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const providerErrorCodePattern = /^[a-z][a-z0-9-]{0,99}$/u;
const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

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

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function isPositiveSafeInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum;
}

function analyzeDestination(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(
    value,
    [
      "recipientName",
      "phone",
      "countryCode",
      "postalCode",
      "addressLine1",
      "addressLine2",
      "locality",
      "administrativeArea",
    ],
    path,
    issues,
  );
  if (!isBoundedText(value.recipientName, 120)) issues.push(`${path}.recipientName is invalid.`);
  if (!isBoundedText(value.phone, 32) || !/^[+0-9][+0-9(). -]{2,31}$/u.test(value.phone)) {
    issues.push(`${path}.phone is invalid.`);
  }
  if (typeof value.countryCode !== "string" || !/^[A-Z]{2}$/u.test(value.countryCode)) {
    issues.push(`${path}.countryCode is invalid.`);
  }
  if (!isBoundedText(value.postalCode, 20)) issues.push(`${path}.postalCode is invalid.`);
  if (!isBoundedText(value.addressLine1, 200)) issues.push(`${path}.addressLine1 is invalid.`);
  if (value.addressLine2 !== null && !isBoundedText(value.addressLine2, 200)) {
    issues.push(`${path}.addressLine2 is invalid.`);
  }
  if (!isBoundedText(value.locality, 100)) issues.push(`${path}.locality is invalid.`);
  if (value.administrativeArea !== null && !isBoundedText(value.administrativeArea, 100)) {
    issues.push(`${path}.administrativeArea is invalid.`);
  }
}

function analyzeItem(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(
    value,
    ["key", "productId", "productName", "variantSku", "variantName", "quantity"],
    path,
    issues,
  );
  if (!isBoundedText(value.key, 200)) issues.push(`${path}.key is invalid.`);
  if (typeof value.productId !== "string" || !canonicalUuidPattern.test(value.productId)) {
    issues.push(`${path}.productId is invalid.`);
  }
  if (!isBoundedText(value.productName, npShopCarrierLimits.productNameLength)) {
    issues.push(`${path}.productName is invalid.`);
  }
  if (
    value.variantSku !== null &&
    !isBoundedText(value.variantSku, npShopCarrierLimits.variantSkuLength)
  ) {
    issues.push(`${path}.variantSku is invalid.`);
  }
  if (
    value.variantName !== null &&
    !isBoundedText(value.variantName, npShopCarrierLimits.variantNameLength)
  ) {
    issues.push(`${path}.variantName is invalid.`);
  }
  if (!isPositiveSafeInteger(value.quantity, npShopCarrierLimits.maximumQuantity)) {
    issues.push(`${path}.quantity is invalid.`);
  }
}

export function npRequireShopCarrierProviderId(value: unknown): string {
  if (typeof value !== "string" || !providerIdPattern.test(value)) {
    throw new NpShopCarrierContractError("Invalid Shop carrier provider id", [
      "carrier provider id must be a lowercase segment of at most 32 characters.",
    ]);
  }
  return value;
}

export function npAnalyzeShopCarrierBookingRequest(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["carrier booking request must be a plain object."];
  exactKeys(
    value,
    [
      "contract",
      "shipmentId",
      "orderId",
      "fulfillmentRevision",
      "items",
      "destination",
      "deliveryMethod",
      "requestedAt",
    ],
    "carrier booking request",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT) {
    issues.push(
      `carrier booking request.contract must equal "${NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT}".`,
    );
  }
  for (const key of ["shipmentId", "orderId"] as const) {
    if (typeof value[key] !== "string" || !canonicalUuidPattern.test(value[key])) {
      issues.push(`carrier booking request.${key} is invalid.`);
    }
  }
  if (!isPositiveSafeInteger(value.fulfillmentRevision, Number.MAX_SAFE_INTEGER)) {
    issues.push("carrier booking request.fulfillmentRevision is invalid.");
  }
  if (
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > npShopCarrierLimits.maximumItems
  ) {
    issues.push(
      `carrier booking request.items must contain between 1 and ${npShopCarrierLimits.maximumItems.toString()} items.`,
    );
  } else {
    value.items.forEach((item, index) =>
      analyzeItem(item, `carrier booking request.items[${index.toString()}]`, issues),
    );
    const keys = value.items
      .filter(isRecord)
      .map((item) => item.key)
      .filter((key): key is string => typeof key === "string");
    if (new Set(keys).size !== keys.length) {
      issues.push("carrier booking request item keys must be unique.");
    }
  }
  analyzeDestination(value.destination, "carrier booking request.destination", issues);
  if (value.deliveryMethod !== null) {
    issues.push(
      ...npAnalyzeShopDeliveryMethod(value.deliveryMethod).map((issue) =>
        issue.replace(/^delivery method/u, "carrier booking request.deliveryMethod"),
      ),
    );
  }
  if (!isCanonicalIso(value.requestedAt)) {
    issues.push("carrier booking request.requestedAt is invalid.");
  }
  return issues;
}

export function npRequireShopCarrierBookingRequest(value: unknown): NpShopCarrierBookingRequest {
  const issues = npAnalyzeShopCarrierBookingRequest(value);
  if (issues.length > 0) {
    throw new NpShopCarrierContractError("Invalid Shop carrier booking request", issues);
  }
  return value as NpShopCarrierBookingRequest;
}

export function npAnalyzeShopCarrierParcelBookingRequest(value: unknown): string[] {
  if (!isRecord(value)) return ["carrier parcel booking request must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "shipmentId",
      "orderId",
      "fulfillmentRevision",
      "parcelRevision",
      "items",
      "parcels",
      "destination",
      "deliveryMethod",
      "requestedAt",
    ],
    "carrier parcel booking request",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT) {
    issues.push(
      `carrier parcel booking request.contract must equal "${NP_SHOP_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT}".`,
    );
  }
  const baseIssues = npAnalyzeShopCarrierBookingRequest({
    contract: NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT,
    shipmentId: value.shipmentId,
    orderId: value.orderId,
    fulfillmentRevision: value.fulfillmentRevision,
    items: value.items,
    destination: value.destination,
    deliveryMethod: value.deliveryMethod,
    requestedAt: value.requestedAt,
  });
  issues.push(
    ...baseIssues.map((issue) =>
      issue.replaceAll("carrier booking request", "carrier parcel booking request"),
    ),
  );
  if (!isPositiveSafeInteger(value.parcelRevision, Number.MAX_SAFE_INTEGER)) {
    issues.push("carrier parcel booking request.parcelRevision is invalid.");
  }
  issues.push(
    ...npAnalyzeShopFulfillmentParcels(value.parcels, "carrier parcel booking request.parcels"),
  );
  return issues;
}

export function npRequireShopCarrierParcelBookingRequest(
  value: unknown,
): NpShopCarrierParcelBookingRequest {
  const issues = npAnalyzeShopCarrierParcelBookingRequest(value);
  if (issues.length > 0) {
    throw new NpShopCarrierContractError("Invalid Shop carrier parcel booking request", issues);
  }
  return value as NpShopCarrierParcelBookingRequest;
}

export function npAnalyzeShopCarrierBookingResult(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["carrier booking result must be a plain object."];
  exactKeys(
    value,
    [
      "contract",
      "shipmentId",
      "orderId",
      "bookingReference",
      "carrier",
      "trackingNumber",
      "bookedAt",
    ],
    "carrier booking result",
    issues,
  );
  if (value.contract !== NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT) {
    issues.push(
      `carrier booking result.contract must equal "${NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT}".`,
    );
  }
  for (const key of ["shipmentId", "orderId"] as const) {
    if (typeof value[key] !== "string" || !canonicalUuidPattern.test(value[key])) {
      issues.push(`carrier booking result.${key} is invalid.`);
    }
  }
  if (
    !isBoundedText(value.bookingReference, npShopCarrierLimits.referenceLength) ||
    !opaqueReferencePattern.test(value.bookingReference)
  ) {
    issues.push("carrier booking result.bookingReference is invalid.");
  }
  if (!isBoundedText(value.carrier, npShopCarrierLimits.carrierLength)) {
    issues.push("carrier booking result.carrier is invalid.");
  }
  if (!isBoundedText(value.trackingNumber, npShopCarrierLimits.trackingNumberLength)) {
    issues.push("carrier booking result.trackingNumber is invalid.");
  }
  if (!isCanonicalIso(value.bookedAt)) {
    issues.push("carrier booking result.bookedAt is invalid.");
  }
  return issues;
}

export function npRequireShopCarrierBookingResult(value: unknown): NpShopCarrierBookingResult {
  const issues = npAnalyzeShopCarrierBookingResult(value);
  if (issues.length > 0) {
    throw new NpShopCarrierContractError("Invalid Shop carrier booking result", issues);
  }
  return value as NpShopCarrierBookingResult;
}

const storedKeys = [
  "contract",
  "id",
  "orderId",
  "providerId",
  "status",
  "fulfillmentRevision",
  "operatorNote",
  "bookingReference",
  "carrier",
  "trackingNumber",
  "providerErrorCode",
  "requestedAt",
  "updatedAt",
  "bookedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopCarrierBooking(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["carrier booking must be a plain object."];
  exactKeys(value, storedKeys, "carrier booking", issues);
  if (value.contract !== NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT) {
    issues.push(
      `carrier booking.contract must equal "${NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT}".`,
    );
  }
  for (const key of ["id", "orderId"] as const) {
    if (typeof value[key] !== "string" || !canonicalUuidPattern.test(value[key])) {
      issues.push(`carrier booking.${key} is invalid.`);
    }
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("carrier booking.providerId is invalid.");
  }
  if (!(npShopCarrierBookingStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("carrier booking.status is invalid.");
  }
  if (!isPositiveSafeInteger(value.fulfillmentRevision, Number.MAX_SAFE_INTEGER)) {
    issues.push("carrier booking.fulfillmentRevision is invalid.");
  }
  if (
    value.operatorNote !== null &&
    !isBoundedText(value.operatorNote, npShopCarrierLimits.operatorNoteLength)
  ) {
    issues.push("carrier booking.operatorNote is invalid.");
  }
  if (
    value.bookingReference !== null &&
    (!isBoundedText(value.bookingReference, npShopCarrierLimits.referenceLength) ||
      !opaqueReferencePattern.test(value.bookingReference))
  ) {
    issues.push("carrier booking.bookingReference is invalid.");
  }
  if (value.carrier !== null && !isBoundedText(value.carrier, npShopCarrierLimits.carrierLength)) {
    issues.push("carrier booking.carrier is invalid.");
  }
  if (
    value.trackingNumber !== null &&
    !isBoundedText(value.trackingNumber, npShopCarrierLimits.trackingNumberLength)
  ) {
    issues.push("carrier booking.trackingNumber is invalid.");
  }
  if (
    value.providerErrorCode !== null &&
    (typeof value.providerErrorCode !== "string" ||
      !providerErrorCodePattern.test(value.providerErrorCode))
  ) {
    issues.push("carrier booking.providerErrorCode is invalid.");
  }
  for (const key of ["requestedAt", "updatedAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`carrier booking.${key} is invalid.`);
  }
  if (value.bookedAt !== null && !isCanonicalIso(value.bookedAt)) {
    issues.push("carrier booking.bookedAt is invalid.");
  }
  const providerFields = [
    value.bookingReference,
    value.carrier,
    value.trackingNumber,
    value.bookedAt,
  ];
  const hasAllProviderFields = providerFields.every((field) => field !== null);
  const hasNoProviderFields = providerFields.every((field) => field === null);
  if (!hasAllProviderFields && !hasNoProviderFields) {
    issues.push("carrier booking provider confirmation fields must be all present or all null.");
  }
  if (
    value.status === "pending" &&
    (!hasNoProviderFields ||
      (value.providerErrorCode !== null &&
        (typeof value.providerErrorCode !== "string" ||
          !providerErrorCodePattern.test(value.providerErrorCode))))
  ) {
    issues.push("pending carrier bookings cannot contain provider confirmation metadata.");
  }
  if (
    (value.status === "provider-confirmed" || value.status === "completed") &&
    (!hasAllProviderFields || value.providerErrorCode !== null)
  ) {
    issues.push(
      `${String(value.status)} carrier bookings require exact provider confirmation and no error.`,
    );
  }
  if (
    value.status === "manual-review" &&
    (value.providerErrorCode === null || (!hasNoProviderFields && !hasAllProviderFields))
  ) {
    issues.push("manual-review carrier bookings require a closed error and coherent metadata.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt < value.requestedAt
  ) {
    issues.push("carrier booking.updatedAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.bookedAt) &&
    isCanonicalIso(value.requestedAt) &&
    value.bookedAt < value.requestedAt
  ) {
    issues.push("carrier booking.bookedAt cannot precede requestedAt.");
  }
  if (
    isCanonicalIso(value.bookedAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.bookedAt > value.updatedAt
  ) {
    issues.push("carrier booking.bookedAt cannot follow updatedAt.");
  }
  if (
    isCanonicalIso(value.updatedAt) &&
    isCanonicalIso(value.purgeAt) &&
    value.updatedAt > value.purgeAt
  ) {
    issues.push("carrier booking.updatedAt cannot follow purgeAt.");
  }
  return issues;
}

export function npRequireStoredShopCarrierBooking(value: unknown): NpShopStoredCarrierBooking {
  const issues = npAnalyzeStoredShopCarrierBooking(value);
  if (issues.length > 0) {
    throw new NpShopCarrierContractError("Invalid stored Shop carrier booking", issues);
  }
  return value as NpShopStoredCarrierBooking;
}

export function npRequireShopCarrierBookingActionInput(
  value: unknown,
): NpShopCarrierBookingActionInput {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopCarrierContractError("Invalid Shop carrier booking action", [
      "payload must be a plain object.",
    ]);
  }
  exactKeys(value, ["row", "values"], "payload", issues);
  const row = isRecord(value.row) ? value.row : null;
  const values = isRecord(value.values) ? value.values : null;
  if (!row) issues.push("payload.row must be a plain object.");
  if (!values) issues.push("payload.values must be a plain object.");
  if (row) {
    exactKeys(row, ["id", "fulfillmentRevision"], "payload.row", issues);
    if (typeof row.id !== "string" || !canonicalUuidPattern.test(row.id)) {
      issues.push("payload.row.id is invalid.");
    }
    if (!isPositiveSafeInteger(row.fulfillmentRevision, Number.MAX_SAFE_INTEGER)) {
      issues.push("payload.row.fulfillmentRevision is invalid.");
    }
  }
  if (values) {
    exactKeys(values, ["operatorNote"], "payload.values", issues);
    if (
      values.operatorNote !== "" &&
      values.operatorNote !== null &&
      !isBoundedText(values.operatorNote, npShopCarrierLimits.operatorNoteLength)
    ) {
      issues.push("payload.values.operatorNote is invalid.");
    }
  }
  if (issues.length > 0) {
    throw new NpShopCarrierContractError("Invalid Shop carrier booking action", issues);
  }
  return {
    orderId: row?.id as string,
    expectedRevision: row?.fulfillmentRevision as number,
    operatorNote:
      values?.operatorNote === "" || values?.operatorNote === null
        ? null
        : (values?.operatorNote as string),
  };
}
