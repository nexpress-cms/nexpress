import { npShopCarrierLimits, type NpShopCarrierBookingItem } from "./carrier-contract.js";
import { npShopExchangeDestinationLimits } from "./exchange-destination-contract.js";
import {
  npAnalyzeShopFulfillmentParcels,
  type NpShopFulfillmentParcel,
} from "./parcel-contract.js";
import type { NpShopOrderDraftShipping } from "./types.js";

export const NP_SHOP_EXCHANGE_CARRIER_BOOKING_REQUEST_CONTRACT =
  "np.shop-exchange-carrier-booking-request.v1" as const;
export const NP_SHOP_EXCHANGE_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT =
  "np.shop-exchange-carrier-booking-request.v2" as const;
export const NP_SHOP_EXCHANGE_CARRIER_BOOKING_RESULT_CONTRACT =
  "np.shop-exchange-carrier-booking-result.v1" as const;
export const NP_SHOP_EXCHANGE_CARRIER_CANCEL_REQUEST_CONTRACT =
  "np.shop-exchange-carrier-cancel-request.v1" as const;
export const NP_SHOP_EXCHANGE_CARRIER_CANCEL_RESULT_CONTRACT =
  "np.shop-exchange-carrier-cancel-result.v1" as const;
export const NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT =
  "np.shop-exchange-carrier-booking-storage.v1" as const;

export const npShopExchangeCarrierBookingStatuses = [
  "pending",
  "provider-confirmed",
  "completed",
  "cancel-pending",
  "cancel-confirmed",
  "cancelled",
  "manual-review",
] as const;
export type NpShopExchangeCarrierBookingStatus =
  (typeof npShopExchangeCarrierBookingStatuses)[number];

export interface NpShopExchangeCarrierBookingRequest {
  contract: typeof NP_SHOP_EXCHANGE_CARRIER_BOOKING_REQUEST_CONTRACT;
  shipmentId: string;
  orderId: string;
  exchangeId: string;
  exchangeRevision: number;
  destinationRevision: number;
  items: NpShopCarrierBookingItem[];
  destination: NpShopOrderDraftShipping;
  requestedAt: string;
}

export interface NpShopExchangeCarrierParcelBookingRequest extends Omit<
  NpShopExchangeCarrierBookingRequest,
  "contract"
> {
  contract: typeof NP_SHOP_EXCHANGE_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT;
  parcelRevision: number;
  parcels: NpShopFulfillmentParcel[];
}

export interface NpShopExchangeCarrierBookingResult {
  contract: typeof NP_SHOP_EXCHANGE_CARRIER_BOOKING_RESULT_CONTRACT;
  shipmentId: string;
  orderId: string;
  exchangeId: string;
  bookingReference: string;
  carrier: string;
  trackingNumber: string;
  bookedAt: string;
}

export interface NpShopExchangeCarrierCancelRequest {
  contract: typeof NP_SHOP_EXCHANGE_CARRIER_CANCEL_REQUEST_CONTRACT;
  cancellationId: string;
  shipmentId: string;
  orderId: string;
  exchangeId: string;
  bookingReference: string;
  requestedAt: string;
}

export interface NpShopExchangeCarrierCancelResult {
  contract: typeof NP_SHOP_EXCHANGE_CARRIER_CANCEL_RESULT_CONTRACT;
  cancellationId: string;
  shipmentId: string;
  orderId: string;
  exchangeId: string;
  cancelledAt: string;
}

export interface NpShopStoredExchangeCarrierBooking {
  contract: typeof NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT;
  id: string;
  orderId: string;
  exchangeId: string;
  providerId: string;
  status: NpShopExchangeCarrierBookingStatus;
  revision: number;
  sourceOrderRevision: number;
  sourceExchangeRevision: number;
  destinationRevision: number;
  completedOrderRevision: number | null;
  completedExchangeRevision: number | null;
  operatorNote: string | null;
  bookingReference: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  providerErrorCode: string | null;
  cancellationId: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  purgeAt: string;
}

export interface NpShopExchangeCarrierBookActionInput {
  orderId: string;
  exchangeId: string;
  orderRevision: number;
  exchangeRevision: number;
  destinationRevision: number;
  operatorNote: string | null;
}

export interface NpShopExchangeCarrierExistingActionInput {
  orderId: string;
  exchangeId: string;
  orderRevision: number;
  exchangeRevision: number;
  bookingId: string;
  bookingRevision: number;
  operatorNote: string | null;
}

export class NpShopExchangeCarrierContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopExchangeCarrierContractError";
    this.issues = issues;
  }
}

export class NpShopExchangeCarrierConflictError extends Error {
  readonly code:
    | "exchange_carrier_not_supported"
    | "exchange_carrier_not_found"
    | "exchange_carrier_revision_conflict"
    | "exchange_carrier_state_conflict"
    | "exchange_carrier_destination_expired"
    | "exchange_carrier_provider_mismatch"
    | "exchange_carrier_result_mismatch"
    | "exchange_carrier_manual_review";

  constructor(code: NpShopExchangeCarrierConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopExchangeCarrierConflictError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const providerPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const providerErrorPattern = /^[a-z][a-z0-9-]{0,99}$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const phonePattern = /^[0-9+(). -]+$/u;

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

function isText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
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
  if (!isText(value.recipientName, npShopExchangeDestinationLimits.recipientNameLength)) {
    issues.push(`${path}.recipientName is invalid.`);
  }
  if (
    !isText(value.phone, npShopExchangeDestinationLimits.phoneLength) ||
    !phonePattern.test(value.phone)
  ) {
    issues.push(`${path}.phone is invalid.`);
  }
  if (typeof value.countryCode !== "string" || !/^[A-Z]{2}$/u.test(value.countryCode)) {
    issues.push(`${path}.countryCode is invalid.`);
  }
  if (!isText(value.postalCode, npShopExchangeDestinationLimits.postalCodeLength)) {
    issues.push(`${path}.postalCode is invalid.`);
  }
  if (!isText(value.addressLine1, npShopExchangeDestinationLimits.addressLength)) {
    issues.push(`${path}.addressLine1 is invalid.`);
  }
  if (
    value.addressLine2 !== null &&
    !isText(value.addressLine2, npShopExchangeDestinationLimits.addressLength)
  ) {
    issues.push(`${path}.addressLine2 is invalid.`);
  }
  if (!isText(value.locality, npShopExchangeDestinationLimits.localityLength)) {
    issues.push(`${path}.locality is invalid.`);
  }
  if (
    value.administrativeArea !== null &&
    !isText(value.administrativeArea, npShopExchangeDestinationLimits.localityLength)
  ) {
    issues.push(`${path}.administrativeArea is invalid.`);
  }
}

function analyzeItems(value: unknown, path: string, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopCarrierLimits.maximumItems
  ) {
    issues.push(`${path} is invalid.`);
    return;
  }
  const keys = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index.toString()}]`;
    if (!isRecord(item)) {
      issues.push(`${itemPath} must be a plain object.`);
      return;
    }
    exactKeys(
      item,
      ["key", "productId", "productName", "variantSku", "variantName", "quantity"],
      itemPath,
      issues,
    );
    if (!isText(item.key, 300) || keys.has(item.key)) issues.push(`${itemPath}.key is invalid.`);
    else keys.add(item.key);
    if (typeof item.productId !== "string" || !uuidPattern.test(item.productId)) {
      issues.push(`${itemPath}.productId is invalid.`);
    }
    if (!isText(item.productName, npShopCarrierLimits.productNameLength)) {
      issues.push(`${itemPath}.productName is invalid.`);
    }
    if (
      item.variantSku !== null &&
      !isText(item.variantSku, npShopCarrierLimits.variantSkuLength)
    ) {
      issues.push(`${itemPath}.variantSku is invalid.`);
    }
    if (
      item.variantName !== null &&
      !isText(item.variantName, npShopCarrierLimits.variantNameLength)
    ) {
      issues.push(`${itemPath}.variantName is invalid.`);
    }
    if (
      !Number.isSafeInteger(item.quantity) ||
      (item.quantity as number) < 1 ||
      (item.quantity as number) > npShopCarrierLimits.maximumQuantity
    ) {
      issues.push(`${itemPath}.quantity is invalid.`);
    }
  });
}

export function npAnalyzeShopExchangeCarrierBookingRequest(value: unknown): string[] {
  if (!isRecord(value)) return ["exchange carrier booking request must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "shipmentId",
      "orderId",
      "exchangeId",
      "exchangeRevision",
      "destinationRevision",
      "items",
      "destination",
      "requestedAt",
    ],
    "exchange carrier booking request",
    issues,
  );
  if (value.contract !== NP_SHOP_EXCHANGE_CARRIER_BOOKING_REQUEST_CONTRACT) {
    issues.push("exchange carrier booking request.contract is invalid.");
  }
  for (const key of ["shipmentId", "orderId", "exchangeId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key])) {
      issues.push(`exchange carrier booking request.${key} is invalid.`);
    }
  }
  for (const key of ["exchangeRevision", "destinationRevision"] as const) {
    if (!isRevision(value[key])) issues.push(`exchange carrier booking request.${key} is invalid.`);
  }
  analyzeItems(value.items, "exchange carrier booking request.items", issues);
  analyzeDestination(value.destination, "exchange carrier booking request.destination", issues);
  if (!isIso(value.requestedAt))
    issues.push("exchange carrier booking request.requestedAt is invalid.");
  return issues;
}

export function npRequireShopExchangeCarrierBookingRequest(
  value: unknown,
): NpShopExchangeCarrierBookingRequest {
  const issues = npAnalyzeShopExchangeCarrierBookingRequest(value);
  if (issues.length) {
    throw new NpShopExchangeCarrierContractError(
      "Invalid exchange carrier booking request",
      issues,
    );
  }
  return value as NpShopExchangeCarrierBookingRequest;
}

export function npAnalyzeShopExchangeCarrierParcelBookingRequest(value: unknown): string[] {
  if (!isRecord(value)) return ["exchange parcel carrier booking request must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "shipmentId",
      "orderId",
      "exchangeId",
      "exchangeRevision",
      "destinationRevision",
      "items",
      "destination",
      "requestedAt",
      "parcelRevision",
      "parcels",
    ],
    "exchange parcel carrier booking request",
    issues,
  );
  if (value.contract !== NP_SHOP_EXCHANGE_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT) {
    issues.push("exchange parcel carrier booking request.contract is invalid.");
  }
  for (const key of ["shipmentId", "orderId", "exchangeId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key])) {
      issues.push(`exchange parcel carrier booking request.${key} is invalid.`);
    }
  }
  for (const key of ["exchangeRevision", "destinationRevision", "parcelRevision"] as const) {
    if (!isRevision(value[key])) {
      issues.push(`exchange parcel carrier booking request.${key} is invalid.`);
    }
  }
  analyzeItems(value.items, "exchange parcel carrier booking request.items", issues);
  analyzeDestination(
    value.destination,
    "exchange parcel carrier booking request.destination",
    issues,
  );
  issues.push(
    ...npAnalyzeShopFulfillmentParcels(
      value.parcels,
      "exchange parcel carrier booking request.parcels",
    ),
  );
  if (!isIso(value.requestedAt)) {
    issues.push("exchange parcel carrier booking request.requestedAt is invalid.");
  }
  return issues;
}

export function npRequireShopExchangeCarrierParcelBookingRequest(
  value: unknown,
): NpShopExchangeCarrierParcelBookingRequest {
  const issues = npAnalyzeShopExchangeCarrierParcelBookingRequest(value);
  if (issues.length) {
    throw new NpShopExchangeCarrierContractError(
      "Invalid exchange parcel carrier booking request",
      issues,
    );
  }
  return value as NpShopExchangeCarrierParcelBookingRequest;
}

function analyzeBookingResult(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push("exchange carrier booking result must be a plain object.");
    return;
  }
  exactKeys(
    value,
    [
      "contract",
      "shipmentId",
      "orderId",
      "exchangeId",
      "bookingReference",
      "carrier",
      "trackingNumber",
      "bookedAt",
    ],
    "exchange carrier booking result",
    issues,
  );
  if (value.contract !== NP_SHOP_EXCHANGE_CARRIER_BOOKING_RESULT_CONTRACT) {
    issues.push("exchange carrier booking result.contract is invalid.");
  }
  for (const key of ["shipmentId", "orderId", "exchangeId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key])) {
      issues.push(`exchange carrier booking result.${key} is invalid.`);
    }
  }
  if (
    !isText(value.bookingReference, npShopCarrierLimits.referenceLength) ||
    !referencePattern.test(value.bookingReference)
  ) {
    issues.push("exchange carrier booking result.bookingReference is invalid.");
  }
  if (!isText(value.carrier, npShopCarrierLimits.carrierLength)) {
    issues.push("exchange carrier booking result.carrier is invalid.");
  }
  if (!isText(value.trackingNumber, npShopCarrierLimits.trackingNumberLength)) {
    issues.push("exchange carrier booking result.trackingNumber is invalid.");
  }
  if (!isIso(value.bookedAt)) issues.push("exchange carrier booking result.bookedAt is invalid.");
}

export function npRequireShopExchangeCarrierBookingResult(
  value: unknown,
): NpShopExchangeCarrierBookingResult {
  const issues: string[] = [];
  analyzeBookingResult(value, issues);
  if (issues.length) {
    throw new NpShopExchangeCarrierContractError("Invalid exchange carrier booking result", issues);
  }
  return value as NpShopExchangeCarrierBookingResult;
}

function analyzeCancellation(value: unknown, result: boolean): string[] {
  const label = result
    ? "exchange carrier cancellation result"
    : "exchange carrier cancellation request";
  if (!isRecord(value)) return [`${label} must be a plain object.`];
  const issues: string[] = [];
  exactKeys(
    value,
    result
      ? ["contract", "cancellationId", "shipmentId", "orderId", "exchangeId", "cancelledAt"]
      : [
          "contract",
          "cancellationId",
          "shipmentId",
          "orderId",
          "exchangeId",
          "bookingReference",
          "requestedAt",
        ],
    label,
    issues,
  );
  const expectedContract = result
    ? NP_SHOP_EXCHANGE_CARRIER_CANCEL_RESULT_CONTRACT
    : NP_SHOP_EXCHANGE_CARRIER_CANCEL_REQUEST_CONTRACT;
  if (value.contract !== expectedContract) issues.push(`${label}.contract is invalid.`);
  for (const key of ["cancellationId", "shipmentId", "orderId", "exchangeId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key])) {
      issues.push(`${label}.${key} is invalid.`);
    }
  }
  if (result) {
    if (!isIso(value.cancelledAt)) issues.push(`${label}.cancelledAt is invalid.`);
  } else {
    if (
      !isText(value.bookingReference, npShopCarrierLimits.referenceLength) ||
      !referencePattern.test(value.bookingReference)
    ) {
      issues.push(`${label}.bookingReference is invalid.`);
    }
    if (!isIso(value.requestedAt)) issues.push(`${label}.requestedAt is invalid.`);
  }
  return issues;
}

export function npRequireShopExchangeCarrierCancelRequest(
  value: unknown,
): NpShopExchangeCarrierCancelRequest {
  const issues = analyzeCancellation(value, false);
  if (issues.length) {
    throw new NpShopExchangeCarrierContractError(
      "Invalid exchange carrier cancellation request",
      issues,
    );
  }
  return value as NpShopExchangeCarrierCancelRequest;
}

export function npRequireShopExchangeCarrierCancelResult(
  value: unknown,
): NpShopExchangeCarrierCancelResult {
  const issues = analyzeCancellation(value, true);
  if (issues.length) {
    throw new NpShopExchangeCarrierContractError(
      "Invalid exchange carrier cancellation result",
      issues,
    );
  }
  return value as NpShopExchangeCarrierCancelResult;
}

const storedKeys = [
  "contract",
  "id",
  "orderId",
  "exchangeId",
  "providerId",
  "status",
  "revision",
  "sourceOrderRevision",
  "sourceExchangeRevision",
  "destinationRevision",
  "completedOrderRevision",
  "completedExchangeRevision",
  "operatorNote",
  "bookingReference",
  "carrier",
  "trackingNumber",
  "providerErrorCode",
  "cancellationId",
  "requestedAt",
  "confirmedAt",
  "cancelRequestedAt",
  "cancelledAt",
  "updatedAt",
  "purgeAt",
] as const;

export function npAnalyzeStoredShopExchangeCarrierBooking(value: unknown): string[] {
  if (!isRecord(value)) return ["exchange carrier booking must be a plain object."];
  const issues: string[] = [];
  exactKeys(value, storedKeys, "exchange carrier booking", issues);
  if (value.contract !== NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT) {
    issues.push("exchange carrier booking.contract is invalid.");
  }
  for (const key of ["id", "orderId", "exchangeId"] as const) {
    if (typeof value[key] !== "string" || !uuidPattern.test(value[key])) {
      issues.push(`exchange carrier booking.${key} is invalid.`);
    }
  }
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId)) {
    issues.push("exchange carrier booking.providerId is invalid.");
  }
  if (!(npShopExchangeCarrierBookingStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("exchange carrier booking.status is invalid.");
  }
  for (const key of [
    "revision",
    "sourceOrderRevision",
    "sourceExchangeRevision",
    "destinationRevision",
  ] as const) {
    if (!isRevision(value[key])) issues.push(`exchange carrier booking.${key} is invalid.`);
  }
  for (const key of ["completedOrderRevision", "completedExchangeRevision"] as const) {
    if (value[key] !== null && !isRevision(value[key])) {
      issues.push(`exchange carrier booking.${key} is invalid.`);
    }
  }
  if (
    value.operatorNote !== null &&
    !isText(value.operatorNote, npShopCarrierLimits.operatorNoteLength)
  ) {
    issues.push("exchange carrier booking.operatorNote is invalid.");
  }
  if (
    value.bookingReference !== null &&
    (!isText(value.bookingReference, npShopCarrierLimits.referenceLength) ||
      !referencePattern.test(value.bookingReference))
  ) {
    issues.push("exchange carrier booking.bookingReference is invalid.");
  }
  if (value.carrier !== null && !isText(value.carrier, npShopCarrierLimits.carrierLength)) {
    issues.push("exchange carrier booking.carrier is invalid.");
  }
  if (
    value.trackingNumber !== null &&
    !isText(value.trackingNumber, npShopCarrierLimits.trackingNumberLength)
  ) {
    issues.push("exchange carrier booking.trackingNumber is invalid.");
  }
  if (
    value.providerErrorCode !== null &&
    (typeof value.providerErrorCode !== "string" ||
      !providerErrorPattern.test(value.providerErrorCode))
  ) {
    issues.push("exchange carrier booking.providerErrorCode is invalid.");
  }
  if (
    value.cancellationId !== null &&
    (typeof value.cancellationId !== "string" || !uuidPattern.test(value.cancellationId))
  ) {
    issues.push("exchange carrier booking.cancellationId is invalid.");
  }
  for (const key of ["requestedAt", "updatedAt", "purgeAt"] as const) {
    if (!isIso(value[key])) issues.push(`exchange carrier booking.${key} is invalid.`);
  }
  for (const key of ["confirmedAt", "cancelRequestedAt", "cancelledAt"] as const) {
    if (value[key] !== null && !isIso(value[key]))
      issues.push(`exchange carrier booking.${key} is invalid.`);
  }
  const providerFields = [
    value.bookingReference,
    value.carrier,
    value.trackingNumber,
    value.confirmedAt,
  ];
  const hasProvider = providerFields.every((entry) => entry !== null);
  const noProvider = providerFields.every((entry) => entry === null);
  if (!hasProvider && !noProvider)
    issues.push("exchange carrier confirmation fields must be coherent.");
  const completed =
    value.completedOrderRevision !== null && value.completedExchangeRevision !== null;
  if ((value.completedOrderRevision === null) !== (value.completedExchangeRevision === null)) {
    issues.push("exchange carrier completion revisions must be coherent.");
  }
  const cancelling = ["cancel-pending", "cancel-confirmed", "cancelled"].includes(
    String(value.status),
  );
  if (
    (value.status === "pending" && (!noProvider || completed || value.cancellationId !== null)) ||
    (value.status === "provider-confirmed" &&
      (!hasProvider || completed || value.cancellationId !== null)) ||
    (value.status === "completed" &&
      (!hasProvider || !completed || value.cancellationId !== null)) ||
    (cancelling &&
      (!hasProvider ||
        !completed ||
        value.cancellationId === null ||
        value.cancelRequestedAt === null)) ||
    (value.status === "cancel-pending" && value.cancelledAt !== null) ||
    ((value.status === "cancel-confirmed" || value.status === "cancelled") &&
      value.cancelledAt === null)
  ) {
    issues.push("exchange carrier booking lifecycle metadata is inconsistent.");
  }
  if (value.status === "manual-review" && value.providerErrorCode === null) {
    issues.push("manual-review exchange carrier bookings require a provider error code.");
  }
  if (
    value.status !== "manual-review" &&
    value.providerErrorCode !== null &&
    value.status !== "pending" &&
    value.status !== "cancel-pending"
  ) {
    issues.push("closed exchange carrier booking states cannot retain a provider error code.");
  }
  if (isIso(value.requestedAt) && isIso(value.updatedAt) && value.updatedAt < value.requestedAt) {
    issues.push("exchange carrier booking.updatedAt cannot precede requestedAt.");
  }
  if (isIso(value.updatedAt) && isIso(value.purgeAt) && value.updatedAt > value.purgeAt) {
    issues.push("exchange carrier booking.updatedAt cannot follow purgeAt.");
  }
  return issues;
}

export function npRequireStoredShopExchangeCarrierBooking(
  value: unknown,
): NpShopStoredExchangeCarrierBooking {
  const issues = npAnalyzeStoredShopExchangeCarrierBooking(value);
  if (issues.length) {
    throw new NpShopExchangeCarrierContractError("Invalid stored exchange carrier booking", issues);
  }
  return value as NpShopStoredExchangeCarrierBooking;
}

function requireActionPayload(value: unknown): {
  row: Record<string, unknown>;
  values: Record<string, unknown>;
} {
  if (!isRecord(value) || !isRecord(value.row) || !isRecord(value.values)) {
    throw new NpShopExchangeCarrierContractError("Invalid exchange carrier action", [
      "payload, row, and values must be plain objects.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  if (issues.length)
    throw new NpShopExchangeCarrierContractError("Invalid exchange carrier action", issues);
  return { row: value.row, values: value.values };
}

function requireNote(values: Record<string, unknown>, issues: string[]): string | null {
  exactKeys(values, ["operatorNote"], "payload.values", issues);
  if (values.operatorNote === "" || values.operatorNote === null) return null;
  if (!isText(values.operatorNote, npShopCarrierLimits.operatorNoteLength)) {
    issues.push("payload.values.operatorNote is invalid.");
    return null;
  }
  return values.operatorNote;
}

export function npRequireShopExchangeCarrierBookActionInput(
  value: unknown,
): NpShopExchangeCarrierBookActionInput {
  const { row, values } = requireActionPayload(value);
  const issues: string[] = [];
  exactKeys(
    row,
    ["id", "exchangeId", "orderRevision", "exchangeRevision", "destinationRevision"],
    "payload.row",
    issues,
  );
  for (const key of ["id", "exchangeId"] as const) {
    if (typeof row[key] !== "string" || !uuidPattern.test(row[key]))
      issues.push(`payload.row.${key} is invalid.`);
  }
  for (const key of ["orderRevision", "exchangeRevision", "destinationRevision"] as const) {
    if (!isRevision(row[key])) issues.push(`payload.row.${key} is invalid.`);
  }
  const operatorNote = requireNote(values, issues);
  if (issues.length)
    throw new NpShopExchangeCarrierContractError("Invalid exchange carrier booking action", issues);
  return {
    orderId: row.id as string,
    exchangeId: row.exchangeId as string,
    orderRevision: row.orderRevision as number,
    exchangeRevision: row.exchangeRevision as number,
    destinationRevision: row.destinationRevision as number,
    operatorNote,
  };
}

export function npRequireShopExchangeCarrierExistingActionInput(
  value: unknown,
): NpShopExchangeCarrierExistingActionInput {
  const { row, values } = requireActionPayload(value);
  const issues: string[] = [];
  exactKeys(
    row,
    ["id", "exchangeId", "orderRevision", "exchangeRevision", "bookingId", "bookingRevision"],
    "payload.row",
    issues,
  );
  for (const key of ["id", "exchangeId", "bookingId"] as const) {
    if (typeof row[key] !== "string" || !uuidPattern.test(row[key]))
      issues.push(`payload.row.${key} is invalid.`);
  }
  for (const key of ["orderRevision", "exchangeRevision", "bookingRevision"] as const) {
    if (!isRevision(row[key])) issues.push(`payload.row.${key} is invalid.`);
  }
  const operatorNote = requireNote(values, issues);
  if (issues.length)
    throw new NpShopExchangeCarrierContractError("Invalid exchange carrier action", issues);
  return {
    orderId: row.id as string,
    exchangeId: row.exchangeId as string,
    orderRevision: row.orderRevision as number,
    exchangeRevision: row.exchangeRevision as number,
    bookingId: row.bookingId as string,
    bookingRevision: row.bookingRevision as number,
    operatorNote,
  };
}
