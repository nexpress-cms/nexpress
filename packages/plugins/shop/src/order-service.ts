import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { npIsCanonicalSiteId, requireSiteId } from "@nexpress/core/sites";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT,
  NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT,
  NP_SHOP_CARRIER_LABEL_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT,
  NpShopCarrierConflictError,
  NpShopCarrierContractError,
  NpShopCarrierProviderError,
  NpShopCarrierUnavailableError,
  npRequireShopCarrierBookingRequest,
  npRequireShopCarrierBookingResult,
  npRequireShopCarrierLabelRequest,
  npRequireShopCarrierLabelResult,
  npRequireShopCarrierParcelBookingRequest,
  npRequireStoredShopCarrierBooking,
  npShopCarrierLimits,
  type NpShopCarrierBookingActionInput,
  type NpShopCarrierBookingResult,
  type NpShopCarrierLabelReadInput,
  type NpShopCarrierLabelResult,
  type NpShopStoredCarrierBooking,
} from "./carrier-contract.js";
import {
  NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT,
  NpShopFulfillmentParcelConflictError,
  NpShopFulfillmentParcelContractError,
  npRequireStoredShopFulfillmentParcels,
  npShopFulfillmentParcelLimits,
  npShopFulfillmentParcelTotals,
  type NpShopFulfillmentParcelsSaveInput,
  type NpShopStoredFulfillmentParcels,
} from "./parcel-contract.js";
import {
  NpShopPackagingProposalUnavailableError,
  type NpShopPackagingProposalInput,
  type NpShopPackagingProposalLine,
} from "./packaging-contract.js";
import {
  NP_SHOP_PACKING_WORK_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_PACKING_WORK_CREATE_REQUEST_CONTRACT,
  NP_SHOP_PACKING_WORK_STORAGE_CONTRACT,
  NpShopPackingWorkContractError,
  NpShopPackingWorkConflictError,
  NpShopPackingWorkProviderError,
  NpShopPackingWorkUnavailableError,
  npAnalyzeShopPackingWorkCancelResultForRequest,
  npAnalyzeShopPackingWorkCreateResultForRequest,
  npRequireShopPackingWorkCancelResult,
  npRequireShopPackingWorkCreateResult,
  npSerializeShopPackingWorkFingerprintSource,
  npShopPackingWorkStorageKey,
  type NpShopPackingWorkCancelRequest,
  type NpShopPackingWorkCancelResult,
  type NpShopPackingWorkCreateActionInput,
  type NpShopPackingWorkCreateRequest,
  type NpShopPackingWorkCreateResult,
  type NpShopPackingWorkExistingActionInput,
  type NpShopPackingWorkTarget,
  type NpShopStoredPackingWork,
} from "./packing-contract.js";
import {
  npPersistStoredShopPackingWork,
  npReadStoredShopPackingWork,
  npRequireStoredShopPackingWorkAtKey,
  npShopPackingWorkAllowsShipmentEffect,
  npShopPackingWorkIsPurgeTerminal,
  npShopPackingWorkMatchesIdentity,
  npShopPackingWorkMatchesUnattachedTombstone,
  type NpShopPackingWorkPurgeSource,
} from "./packing-work-storage.js";
import {
  npShopPackingStatusPollStorageKey,
  npShopPackingStatusStorageKey,
} from "./packing-status-contract.js";
import {
  npCleanupExpiredShopInventoryReservations,
  npConsumeShopInventoryReservations,
  npLockShopInventoryProducts,
  npPersistShopInventoryReservations,
  npPurgeShopInventoryReservations,
  npReleaseShopInventoryReservations,
  npRestoreShopOrderInventory,
  npConsumeShopReplacementInventory,
} from "./inventory-reservation-service.js";
import { NpShopPaymentProviderError } from "./payment-attempt-contract.js";
import {
  NP_SHOP_PAYMENT_RECEIPT_CONTRACT,
  NpShopPaymentConflictError,
  npRequireShopPaymentProviderId,
  npRequireStoredShopPaymentReceipt,
  npShopPaymentEventDigest,
  npShopPaymentLimits,
  npShopPaymentReceiptStorageKey,
  type NpShopStoredPaymentReceipt,
  type NpShopVerifiedPaymentEvent,
} from "./payment-contract.js";
import {
  NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT,
  NP_SHOP_PAYMENT_ADJUSTMENT_STORAGE_CONTRACT,
  NpShopPaymentAdjustmentConflictError,
  npShopPaymentAdjustmentEventDigest,
  npProjectShopPaymentAdjustment,
  type NpShopStoredPaymentAdjustment,
  type NpShopStoredPaymentAdjustmentReceipt,
  type NpShopVerifiedPaymentAdjustmentEvent,
} from "./payment-adjustment-contract.js";
import {
  npPersistShopPaymentAdjustment,
  npPersistShopPaymentAdjustmentReceipt,
  npReadStoredShopPaymentAdjustment,
  npReadStoredShopPaymentAdjustmentReceipt,
} from "./payment-adjustment-service.js";
import {
  NP_SHOP_PAYMENT_DISPUTE_RECEIPT_CONTRACT,
  NP_SHOP_PAYMENT_DISPUTE_STORAGE_CONTRACT,
  NpShopPaymentDisputeConflictError,
  npShopPaymentDisputeEventDigest,
  npShopPaymentDisputeLimits,
  type NpShopStoredPaymentDispute,
  type NpShopStoredPaymentDisputeReceipt,
  type NpShopPaymentDisputeStatus,
  type NpShopVerifiedPaymentDisputeEvent,
} from "./payment-dispute-contract.js";
import {
  npPersistShopPaymentDispute,
  npPersistShopPaymentDisputeReceipt,
  npReadStoredShopPaymentDispute,
  npReadStoredShopPaymentDisputeReceipt,
  npReadStoredShopPaymentDisputesForOrder,
  npShopPaymentDisputeAllowsAdminActions,
  npShopPaymentDisputesMatchOrder,
  npShopPaymentDisputesRequireReview,
} from "./payment-dispute-service.js";
import {
  NP_SHOP_ORDER_CONTRACT,
  NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT,
  NP_SHOP_ORDER_PRIVATE_CONTRACT,
  NP_SHOP_ORDER_STORAGE_CONTRACT,
  NpShopOrderConflictError,
  NpShopOrderContractError,
  NpShopOrderNotFoundError,
  npRequireStoredShopOrder,
  npRequireStoredShopOrderPrivate,
  npRequireShopOrder,
  npShopOrderLimits,
  type NpShopOrderCancelInput,
  type NpShopOrderCreateInput,
  type NpShopStoredOrder,
  type NpShopStoredOrderPrivateData,
} from "./order-contract.js";
import {
  NP_SHOP_FULFILLMENT_STORAGE_CONTRACT,
  NpShopFulfillmentConflictError,
  NpShopFulfillmentContractError,
  npProjectShopFulfillment,
  npRequireStoredShopFulfillment,
  npShopFulfillmentLimits,
  type NpShopFulfillmentPrivateReadInput,
  type NpShopFulfillmentProcessInput,
  type NpShopFulfillmentShipInput,
  type NpShopStoredFulfillment,
} from "./fulfillment-contract.js";
import {
  NP_SHOP_PLUGIN_ID,
  npLockShopOrderDraft,
  npLockShopOrderDraftOwner,
  npReadStoredShopOrderDraftForUpdate,
  npShopOrderDraftStorageKey,
  type NpShopTransaction,
} from "./order-draft-service.js";
import { npStageShopOrderNotification } from "./order-notification-service.js";
import {
  npConsumeShopCartForOrder,
  npLockShopCart,
  npQuoteShopCart,
  npReAddShopCartLines,
  npShopCartOwnerStorageSegment,
  type NpShopCartOwner,
} from "./cart-service.js";
import type { NpShopCartReAddInput, NpShopCartReAddResult } from "./cart-contract.js";
import type { NpShopRuntime } from "./runtime.js";
import { listShopPromotions } from "./runtime.js";
import { npIsShopShippingProviderActive } from "./shipping-policy-service.js";
import { npReserveShopPromotions, npResolveShopPromotionReservation } from "./promotion-service.js";
import type { NpShopFulfillment, NpShopOrder, NpShopOrderList } from "./types.js";
import {
  NP_SHOP_REFUND_RESULT_CONTRACT,
  NP_SHOP_REFUND_STORAGE_CONTRACT,
  NpShopRefundConflictError,
  npProjectShopRefund,
  npRequireShopPaymentRefundResult,
  npRequireStoredShopRefund,
  npShopRefundLimits,
  type NpShopRefund,
  type NpShopRefundActionInput,
  type NpShopPaymentRefundResult,
  type NpShopStoredRefund,
} from "./refund-contract.js";
import {
  NP_SHOP_RETURN_STORAGE_CONTRACT,
  NpShopReturnConflictError,
  NpShopReturnContractError,
  npProjectShopReturn,
  npRequireStoredShopReturn,
  npShopReturnLimits,
  type NpShopReturn,
  type NpShopReturnCancelInput,
  type NpShopReturnRequestInput,
  type NpShopReturnStaffInput,
  type NpShopStoredReturn,
} from "./return-contract.js";
import {
  NpShopTrackingContractError,
  npProjectShopTracking,
  npRequireStoredShopTracking,
  npShopExchangeTrackingPollStorageKey,
  npShopExchangeTrackingStorageKey,
  npShopTrackingPollStorageKey,
  type NpShopStoredTracking,
} from "./tracking-contract.js";
import {
  npReadShopExchangeTrackingForOrder,
  npReadStoredShopExchangeTrackingForOrder,
  npReadShopTrackingForOrder,
} from "./tracking-service.js";
import { npReadShopReturnTrackingForOrder } from "./return-tracking-service.js";
import {
  npShopReturnTrackingPollStorageKey,
  npShopReturnTrackingStorageKey,
} from "./return-tracking-contract.js";
import {
  npRequireStoredShopCarrierPickup,
  type NpShopStoredCarrierPickup,
} from "./pickup-contract.js";
import {
  npReadShopCarrierLabelSource,
  npReadStoredShopCarrierLabelAcquisition,
  npRequireStoredShopCarrierLabelAcquisitionAtKey,
  npShopCarrierLabelAcquisitionMatchesSource,
  npShopCarrierLabelAcquisitionStorageKey,
} from "./label-acquisition-service.js";
import type { NpShopStoredCarrierLabelAcquisition } from "./label-acquisition-contract.js";
import {
  npReadShopReturnLogisticsForOrder,
  npShopReturnLogisticsStorageKey,
} from "./return-logistics-service.js";
import { npRequireStoredShopReturnLogistics } from "./return-logistics-contract.js";
import {
  npHasShopPartialRefund,
  npReadShopPartialRefundForOrder,
  npReadStoredShopPartialRefundForAdjustment,
  npShopPartialRefundStorageKey,
} from "./partial-refund-service.js";
import {
  NP_SHOP_EXCHANGE_STORAGE_CONTRACT,
  NpShopExchangeConflictError,
  NpShopExchangeContractError,
  npProjectShopExchange,
  npRequireStoredShopExchange,
  npShopExchangeLimits,
  npShopExchangeLinesFromOrder,
  type NpShopExchange,
  type NpShopExchangeCreateInput,
  type NpShopExchangeShipInput,
  type NpShopExchangeUpdateInput,
  type NpShopStoredExchange,
} from "./exchange-contract.js";
import {
  NP_SHOP_EXCHANGE_DESTINATION_AUTHORITY_CONTRACT,
  NP_SHOP_EXCHANGE_DESTINATION_PRIVATE_CONTRACT,
  NpShopExchangeDestinationConflictError,
  npRequireShopExchangeDestinationAuthority,
  npRequireStoredShopExchangeDestinationPrivate,
  npShopExchangeDestinationLimits,
  type NpShopExchangeDestinationAuthority,
  type NpShopExchangeDestinationReadInput,
  type NpShopExchangeDestinationSubmitInput,
  type NpShopStoredExchangeDestinationPrivate,
} from "./exchange-destination-contract.js";
import {
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_REQUEST_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_RESULT_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_CANCEL_RESULT_CONTRACT,
  NpShopExchangeCarrierConflictError,
  NpShopExchangeCarrierContractError,
  npRequireShopExchangeCarrierBookingRequest,
  npRequireShopExchangeCarrierParcelBookingRequest,
  npRequireShopExchangeCarrierBookingResult,
  npRequireShopExchangeCarrierCancelRequest,
  npRequireShopExchangeCarrierCancelResult,
  npRequireStoredShopExchangeCarrierBooking,
  type NpShopExchangeCarrierBookActionInput,
  type NpShopExchangeCarrierBookingResult,
  type NpShopExchangeCarrierCancelResult,
  type NpShopExchangeCarrierExistingActionInput,
  type NpShopStoredExchangeCarrierBooking,
} from "./exchange-carrier-contract.js";
import {
  NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT,
  NpShopExchangeParcelConflictError,
  NpShopExchangeParcelContractError,
  npRequireStoredShopExchangeParcels,
  type NpShopExchangeParcelsSaveInput,
  type NpShopStoredExchangeParcels,
} from "./exchange-parcel-contract.js";

interface NpShopOrderMaintenanceMarker {
  contract: "np.shop-order-maintenance.v1";
  orderId: string;
  ownerSegment: string;
  dueAt: string;
}

interface NpShopOrderLookup {
  contract: "np.shop-order-lookup.v1";
  orderId: string;
  ownerSegment: string;
  purgeAt: string;
}

interface NpShopExchangeDestinationAuthorityPayload {
  version: 1;
  siteId: string;
  ownerSegment: string;
  orderId: string;
  exchangeId: string;
  orderRevision: number;
  exchangeRevision: number;
  destinationRevision: number;
  issuedAt: number;
  expiresAt: number;
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;

function shopSecret(): string {
  const value = process.env.NP_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "NP_SECRET must contain at least 32 characters for Shop exchange destination authority.",
    );
  }
  return value;
}

function signExchangeDestinationAuthority(value: string): string {
  return createHmac("sha256", shopSecret())
    .update(`shop-exchange-destination:${value}`)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function encodeExchangeDestinationAuthority(
  payload: NpShopExchangeDestinationAuthorityPayload,
): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signExchangeDestinationAuthority(encoded)}`;
}

function invalidExchangeDestinationAuthority(): NpShopExchangeDestinationConflictError {
  return new NpShopExchangeDestinationConflictError(
    "exchange_destination_authority_invalid",
    "The exchange destination authority is invalid.",
  );
}

function decodeExchangeDestinationAuthority(
  token: string,
): NpShopExchangeDestinationAuthorityPayload {
  const [encoded, signature, ...remainder] = token.split(".");
  if (
    !encoded ||
    !signature ||
    remainder.length > 0 ||
    !safeEqual(signature, signExchangeDestinationAuthority(encoded))
  ) {
    throw invalidExchangeDestinationAuthority();
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  } catch {
    throw invalidExchangeDestinationAuthority();
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidExchangeDestinationAuthority();
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = [
    "destinationRevision",
    "exchangeId",
    "exchangeRevision",
    "expiresAt",
    "issuedAt",
    "orderId",
    "orderRevision",
    "ownerSegment",
    "siteId",
    "version",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    candidate.version !== 1 ||
    !npIsCanonicalSiteId(candidate.siteId) ||
    !isOwnerSegment(candidate.ownerSegment) ||
    typeof candidate.orderId !== "string" ||
    !canonicalUuidPattern.test(candidate.orderId) ||
    typeof candidate.exchangeId !== "string" ||
    !canonicalUuidPattern.test(candidate.exchangeId) ||
    !Number.isSafeInteger(candidate.orderRevision) ||
    (candidate.orderRevision as number) < 1 ||
    !Number.isSafeInteger(candidate.exchangeRevision) ||
    (candidate.exchangeRevision as number) < 1 ||
    !Number.isSafeInteger(candidate.destinationRevision) ||
    (candidate.destinationRevision as number) < 0 ||
    !Number.isSafeInteger(candidate.issuedAt) ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    (candidate.expiresAt as number) <= (candidate.issuedAt as number) ||
    (candidate.expiresAt as number) - (candidate.issuedAt as number) >
      npShopExchangeDestinationLimits.authorityTtlSeconds * 1_000
  ) {
    throw invalidExchangeDestinationAuthority();
  }
  return candidate as unknown as NpShopExchangeDestinationAuthorityPayload;
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerSegmentPattern.test(value) ||
      (value.startsWith("member:") && canonicalUuidPattern.test(value.slice("member:".length))))
  );
}

export interface NpShopPaymentApplyResult {
  receipt: NpShopStoredPaymentReceipt;
  duplicate: boolean;
  orderStatus: "paid" | "payment-failed" | "cancelled";
}

export interface NpShopPaymentAdjustmentApplyResult {
  receipt: NpShopStoredPaymentAdjustmentReceipt;
  duplicate: boolean;
}

export interface NpShopPaymentDisputeApplyResult {
  receipt: NpShopStoredPaymentDisputeReceipt;
  duplicate: boolean;
}

export interface NpShopAdminOrderRow {
  [key: string]: unknown;
  id: string;
  status: string;
  total: string;
  units: number;
  privateData: string;
  inventory: string;
  fulfillment: string;
  fulfillmentRevision: number | null;
  revision: number;
  refund: string;
  refundEligible: boolean;
  returnRequest: string;
  createdAt: string;
}

export interface NpShopAdminReturnRow {
  [key: string]: unknown;
  id: string;
  returnId: string;
  status: string;
  returnRevision: number;
  orderRevision: number;
  reason: string;
  detail: string;
  units: number;
  inventory: string;
  operatorNote: string;
  postageSettlement: string;
  exchange: string;
  updatedAt: string;
}

export interface NpShopAdminExchangeRow {
  [key: string]: unknown;
  id: string;
  exchangeId: string;
  returnId: string;
  status: string;
  exchangeRevision: number;
  orderRevision: number;
  destination: string;
  destinationRevision: number;
  destinationExpiresAt: string;
  carrierBooking: string;
  bookingId: string;
  shipmentId: string;
  bookingRevision: number;
  pickupAction: string;
  pickupRevision: number;
  pickupTarget: "replacement";
  pickupStatus: string;
  labelAction: string;
  labelDownloadEligible: boolean;
  expectedRevision: number;
  target: "replacement";
  provider: string;
  parcels: string;
  parcelRevision: number | null;
  packingWorkStatus: string;
  packingWorkRevision: number | null;
  packingWorkAction: string;
  parcelMutationEligible: boolean;
  processEligible: boolean;
  manualShipEligible: boolean;
  cancelEligible: boolean;
  carrierBookEligible: boolean;
  carrierResumeEligible: boolean;
  carrierShipEligible: boolean;
  carrierCancelEligible: boolean;
  units: number;
  inventory: string;
  carrier: string;
  trackingNumber: string;
  trackingStatus: string;
  trackingShipmentId: string;
  operatorNote: string;
  updatedAt: string;
}

export interface NpShopAdminRefundRow {
  [key: string]: unknown;
  id: string;
  refundId: string;
  revision: number;
  orderId: string;
  provider: string;
  status: string;
  total: string;
  inventory: string;
  fulfillment: string;
  providerError: string;
  updatedAt: string;
}

export interface NpShopAdminFulfillmentRow {
  [key: string]: unknown;
  id: string;
  status: string;
  fulfillmentRevision: number;
  parcelRevision: number | null;
  packingWorkStatus: string;
  packingWorkRevision: number | null;
  packingWorkAction: string;
  processEligible: boolean;
  parcelMutationEligible: boolean;
  manualShipmentEligible: boolean;
  carrierShipmentEligible: boolean;
  parcels: string;
  privateData: string;
  carrier: string;
  trackingNumber: string;
  operatorNote: string;
  updatedAt: string;
}

export interface NpShopAdminFulfillmentParcelRow {
  [key: string]: unknown;
  id: string;
  fulfillmentRevision: number;
  parcelRevision: number;
  status: string;
  parcelCount: number;
  units: number;
  weightGrams: number;
  shipmentId: string;
  updatedAt: string;
}

export interface NpShopAdminCarrierBookingRow {
  [key: string]: unknown;
  id: string;
  shipmentId: string;
  provider: string;
  status: string;
  fulfillmentRevision: number;
  carrier: string;
  trackingNumber: string;
  providerError: string;
  carrierResumeEligible: boolean;
  pickupAction: string;
  pickupRevision: number;
  pickupTarget: "outbound";
  exchangeId: null;
  labelAction: string;
  labelDownloadEligible: boolean;
  expectedRevision: number;
  target: "outbound";
  updatedAt: string;
}

export interface NpShopAdminPaymentEventRow {
  [key: string]: unknown;
  provider: string;
  eventId: string;
  type: string;
  orderId: string;
  outcome: string;
  orderStatus: string;
  processedAt: string;
}

function orderStorageKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

function privateStorageKey(ownerSegment: string, orderId: string): string {
  return `order-private:${ownerSegment}:${orderId}`;
}

function fulfillmentStorageKey(orderId: string): string {
  return `fulfillment:${orderId}`;
}

function carrierBookingStorageKey(orderId: string): string {
  return `carrier-booking:${orderId}`;
}

function fulfillmentParcelsStorageKey(orderId: string): string {
  return `fulfillment-parcels:${orderId}`;
}

function refundStorageKey(orderId: string): string {
  return `refund:${orderId}`;
}

function returnStorageKey(orderId: string): string {
  return `return:${orderId}`;
}

export function npShopExchangeStorageKey(orderId: string): string {
  return `exchange:${orderId}`;
}

export function npShopExchangeDestinationPrivateStorageKey(orderId: string): string {
  return `exchange-destination-private:${orderId}`;
}

export function npShopExchangeCarrierBookingStorageKey(orderId: string): string {
  return `exchange-carrier-booking:${orderId}`;
}

export function npShopExchangeParcelsStorageKey(orderId: string): string {
  return `exchange-parcels:${orderId}`;
}

function maintenanceStorageKey(ownerSegment: string, orderId: string): string {
  return `order-maintenance:${ownerSegment}:${orderId}`;
}

function orderScopedIdentityFromKey(
  key: string,
  prefix: "order-maintenance:" | "order-private:",
): { ownerSegment: string; orderId: string } | null {
  if (!key.startsWith(prefix)) return null;
  const suffix = key.slice(prefix.length);
  const separator = suffix.length - 37;
  if (separator <= 0 || suffix[separator] !== ":") return null;
  const ownerSegment = suffix.slice(0, separator);
  const orderId = suffix.slice(separator + 1);
  return isOwnerSegment(ownerSegment) && canonicalUuidPattern.test(orderId)
    ? { ownerSegment, orderId }
    : null;
}

function maintenanceIdentityFromKey(key: string): { ownerSegment: string; orderId: string } | null {
  return orderScopedIdentityFromKey(key, "order-maintenance:");
}

function privateIdentityFromKey(key: string): { ownerSegment: string; orderId: string } | null {
  return orderScopedIdentityFromKey(key, "order-private:");
}

function lookupStorageKey(orderId: string): string {
  return `order-lookup:${orderId}`;
}

function requireStoredOrder(value: unknown, expiresAt: Date | null): NpShopStoredOrder {
  const order = npRequireStoredShopOrder(value);
  if (expiresAt === null || expiresAt.toISOString() !== order.purgeAt) {
    throw new NpShopOrderContractError("Invalid Shop order storage metadata", [
      "Order storage expiry must match order.purgeAt.",
    ]);
  }
  return order;
}

function requireStoredOrderAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredOrder {
  const order = requireStoredOrder(value, expiresAt);
  if (key !== orderStorageKey(order.ownerSegment, order.id)) {
    throw new NpShopOrderContractError("Invalid Shop order storage key", [
      "Order storage key must match its owner segment and order id.",
    ]);
  }
  return order;
}

function requireStoredExchangeAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredExchange {
  const exchange = npRequireStoredShopExchange(value);
  if (
    key !== npShopExchangeStorageKey(exchange.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== exchange.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop exchange storage metadata", [
      "Exchange storage key and expiry must match its canonical value.",
    ]);
  }
  return exchange;
}

function requireStoredExchangeDestinationPrivateAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredExchangeDestinationPrivate {
  const destination = npRequireStoredShopExchangeDestinationPrivate(value);
  if (
    key !== npShopExchangeDestinationPrivateStorageKey(destination.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== destination.expiresAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop exchange destination storage metadata", [
      "Exchange destination key and expiry must match its canonical value.",
    ]);
  }
  return destination;
}

function requireStoredExchangeCarrierBookingAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredExchangeCarrierBooking {
  const booking = npRequireStoredShopExchangeCarrierBooking(value);
  if (
    key !== npShopExchangeCarrierBookingStorageKey(booking.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== booking.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop exchange carrier booking metadata", [
      "Exchange carrier booking key and expiry must match its canonical values.",
    ]);
  }
  return booking;
}

function requireStoredExchangeParcelsAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredExchangeParcels {
  const parcels = npRequireStoredShopExchangeParcels(value);
  if (
    key !== npShopExchangeParcelsStorageKey(parcels.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== parcels.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop exchange parcel storage metadata", [
      "Exchange parcel storage key and expiry must match their canonical values.",
    ]);
  }
  return parcels;
}

function requireStoredPrivate(
  value: unknown,
  expiresAt: Date | null,
): NpShopStoredOrderPrivateData {
  const privateData = npRequireStoredShopOrderPrivate(value);
  if (expiresAt === null || expiresAt.toISOString() !== privateData.expiresAt) {
    throw new NpShopOrderContractError("Invalid Shop order private storage metadata", [
      "Private order storage expiry must match private.expiresAt.",
    ]);
  }
  return privateData;
}

function requireStoredFulfillment(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredFulfillment {
  const fulfillment = npRequireStoredShopFulfillment(value);
  if (
    key !== fulfillmentStorageKey(fulfillment.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== fulfillment.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop fulfillment storage metadata", [
      "Fulfillment storage key and expiry must match its canonical value.",
    ]);
  }
  return fulfillment;
}

function requireStoredCarrierBookingAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredCarrierBooking {
  const booking = npRequireStoredShopCarrierBooking(value);
  if (
    key !== carrierBookingStorageKey(booking.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== booking.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop carrier booking storage metadata", [
      "Carrier booking storage key and expiry must match its canonical value.",
    ]);
  }
  return booking;
}

function requireStoredFulfillmentParcelsAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredFulfillmentParcels {
  const parcels = npRequireStoredShopFulfillmentParcels(value);
  if (
    key !== fulfillmentParcelsStorageKey(parcels.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== parcels.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop fulfillment parcel storage metadata", [
      "Fulfillment parcel storage key and expiry must match its canonical value.",
    ]);
  }
  return parcels;
}

function fulfillmentMatchesOrder(
  fulfillment: NpShopStoredFulfillment,
  order: NpShopStoredOrder,
): boolean {
  return (
    fulfillment.orderId === order.id &&
    fulfillment.ownerSegment === order.ownerSegment &&
    (order.status === "paid" || order.status === "refunded") &&
    fulfillment.privateDataStatus === order.privateDataStatus &&
    fulfillment.createdAt === order.paymentResolvedAt &&
    fulfillment.purgeAt === order.purgeAt
  );
}

function refundMatchesOrder(refund: NpShopStoredRefund, order: NpShopStoredOrder): boolean {
  // Refund intents use provider-compatible whole-second precision.
  const requestedAtEnd = new Date(refund.requestedAt).getTime() + 999;
  return (
    refund.orderId === order.id &&
    refund.providerId === order.paymentProvider &&
    refund.paymentReference === order.paymentReference &&
    refund.currency === order.currency &&
    refund.amountMinor === order.totalMinor &&
    refund.purgeAt === order.purgeAt &&
    order.paymentResolvedAt !== null &&
    requestedAtEnd >= new Date(order.paymentResolvedAt).getTime() &&
    (refund.status === "refunded"
      ? order.status === "refunded" && refund.orderRevision === order.revision
      : order.status === "paid" && refund.orderRevision <= order.revision)
  );
}

function requireStoredRefundAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredRefund {
  const refund = npRequireStoredShopRefund(value);
  if (
    key !== refundStorageKey(refund.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== refund.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop refund storage metadata", [
      "Refund storage key and expiry must match its canonical value.",
    ]);
  }
  return refund;
}

function requireStoredReturnAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredReturn {
  const returnRequest = npRequireStoredShopReturn(value);
  if (
    key !== returnStorageKey(returnRequest.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== returnRequest.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop return storage metadata", [
      "Return storage key and expiry must match its canonical value.",
    ]);
  }
  return returnRequest;
}

function returnMatchesOrder(returnRequest: NpShopStoredReturn, order: NpShopStoredOrder): boolean {
  return (
    returnRequest.orderId === order.id &&
    returnRequest.ownerSegment === order.ownerSegment &&
    returnRequest.purgeAt === order.purgeAt &&
    returnRequest.orderRevision <= order.revision &&
    (order.status === "paid" || order.status === "refunded") &&
    returnRequest.lines.every((requestedLine) => {
      const line = order.lines.find((candidate) => candidate.key === requestedLine.lineKey);
      return Boolean(line && requestedLine.quantity <= line.quantity);
    })
  );
}

function exchangeMatchesOrder(
  exchange: NpShopStoredExchange,
  order: NpShopStoredOrder,
  returnRequest: NpShopStoredReturn,
): boolean {
  const expectedLines = npShopExchangeLinesFromOrder(order.lines, returnRequest.lines);
  return (
    exchange.orderId === order.id &&
    exchange.returnId === returnRequest.id &&
    exchange.ownerSegment === order.ownerSegment &&
    exchange.purgeAt === order.purgeAt &&
    exchange.orderRevision === order.revision &&
    exchange.returnRevision === returnRequest.revision &&
    order.status === "paid" &&
    returnRequest.status === "received" &&
    exchange.lines.length === expectedLines.length &&
    exchange.lines.every((line, index) => {
      const expected = expectedLines[index];
      return Boolean(
        expected &&
        line.lineKey === expected.lineKey &&
        line.productId === expected.productId &&
        line.productSlug === expected.productSlug &&
        line.productName === expected.productName &&
        line.variantSku === expected.variantSku &&
        line.variantName === expected.variantName &&
        line.quantity === expected.quantity,
      );
    })
  );
}

function exchangeTrackingMatchesBooking(
  tracking: NpShopStoredTracking,
  booking: NpShopStoredExchangeCarrierBooking,
  exchange: NpShopStoredExchange,
): boolean {
  const lifecycleMatches =
    booking.completedOrderRevision !== null &&
    booking.completedExchangeRevision !== null &&
    booking.completedOrderRevision === booking.sourceOrderRevision + 1 &&
    booking.completedExchangeRevision === booking.sourceExchangeRevision + 1 &&
    ((exchange.status === "processing" &&
      exchange.orderRevision === booking.completedOrderRevision &&
      exchange.revision === booking.completedExchangeRevision) ||
      (exchange.status === "shipped" &&
        exchange.orderRevision === booking.completedOrderRevision + 1 &&
        exchange.revision === booking.completedExchangeRevision + 1));
  return (
    booking.status === "completed" &&
    lifecycleMatches &&
    booking.exchangeId === exchange.id &&
    booking.orderId === exchange.orderId &&
    booking.purgeAt === exchange.purgeAt &&
    booking.bookingReference !== null &&
    booking.carrier !== null &&
    booking.trackingNumber !== null &&
    exchange.carrier === booking.carrier &&
    exchange.trackingNumber === booking.trackingNumber &&
    tracking.orderId === exchange.orderId &&
    tracking.shipmentId === booking.id &&
    tracking.providerId === booking.providerId &&
    tracking.bookingReference === booking.bookingReference &&
    tracking.trackingNumber === booking.trackingNumber &&
    tracking.purgeAt === exchange.purgeAt
  );
}

function exchangeCarrierBookingMatchesCurrentSource(
  booking: NpShopStoredExchangeCarrierBooking,
  order: NpShopStoredOrder,
  exchange: NpShopStoredExchange,
): boolean {
  if (
    booking.orderId !== order.id ||
    booking.exchangeId !== exchange.id ||
    booking.purgeAt !== order.purgeAt ||
    exchange.orderId !== order.id ||
    exchange.ownerSegment !== order.ownerSegment ||
    exchange.purgeAt !== order.purgeAt ||
    exchange.orderRevision !== order.revision ||
    exchange.destinationRevision !== booking.destinationRevision
  ) {
    return false;
  }
  if (booking.status === "pending" || booking.status === "provider-confirmed") {
    return (
      booking.completedOrderRevision === null &&
      booking.completedExchangeRevision === null &&
      order.revision === booking.sourceOrderRevision &&
      exchange.status === "awaiting" &&
      exchange.revision === booking.sourceExchangeRevision
    );
  }
  if (
    booking.status === "manual-review" ||
    booking.completedOrderRevision === null ||
    booking.completedExchangeRevision === null ||
    booking.completedOrderRevision !== booking.sourceOrderRevision + 1 ||
    booking.completedExchangeRevision !== booking.sourceExchangeRevision + 1
  ) {
    return false;
  }
  if (booking.status === "cancelled") {
    return (
      order.revision === booking.completedOrderRevision + 1 &&
      exchange.status === "cancelled" &&
      exchange.revision === booking.completedExchangeRevision + 1 &&
      exchange.carrier === null &&
      exchange.trackingNumber === null
    );
  }
  if (booking.status === "cancel-pending" || booking.status === "cancel-confirmed") {
    return (
      order.revision === booking.completedOrderRevision &&
      exchange.status === "processing" &&
      exchange.revision === booking.completedExchangeRevision &&
      exchange.carrier === booking.carrier &&
      exchange.trackingNumber === booking.trackingNumber
    );
  }
  return (
    booking.status === "completed" &&
    ((order.revision === booking.completedOrderRevision &&
      exchange.status === "processing" &&
      exchange.revision === booking.completedExchangeRevision) ||
      (order.revision === booking.completedOrderRevision + 1 &&
        exchange.status === "shipped" &&
        exchange.revision === booking.completedExchangeRevision + 1)) &&
    exchange.carrier === booking.carrier &&
    exchange.trackingNumber === booking.trackingNumber
  );
}

function exchangeDestinationMatches(
  destination: NpShopStoredExchangeDestinationPrivate,
  exchange: NpShopStoredExchange,
): boolean {
  return (
    exchange.status === "awaiting" &&
    exchange.destinationRedactedAt === null &&
    exchange.destinationRevision > 0 &&
    destination.orderId === exchange.orderId &&
    destination.exchangeId === exchange.id &&
    destination.ownerSegment === exchange.ownerSegment &&
    destination.exchangeRevision === exchange.revision &&
    destination.destinationRevision === exchange.destinationRevision &&
    destination.submittedAt === exchange.destinationSubmittedAt &&
    destination.expiresAt <= exchange.purgeAt
  );
}

function requireMaintenanceMarker(
  value: unknown,
  expiresAt: Date | null,
): NpShopOrderMaintenanceMarker {
  const candidate = value as Record<string, unknown>;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 4 ||
    candidate.contract !== "np.shop-order-maintenance.v1" ||
    typeof candidate.orderId !== "string" ||
    !canonicalUuidPattern.test(candidate.orderId) ||
    !isOwnerSegment(candidate.ownerSegment) ||
    !isCanonicalIso(candidate.dueAt) ||
    expiresAt === null ||
    expiresAt.toISOString() !== candidate.dueAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop order maintenance marker", [
      "Order maintenance metadata is malformed.",
    ]);
  }
  return value as NpShopOrderMaintenanceMarker;
}

function requireOrderLookup(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopOrderLookup {
  const candidate = value as Record<string, unknown>;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 4 ||
    candidate.contract !== "np.shop-order-lookup.v1" ||
    typeof candidate.orderId !== "string" ||
    !canonicalUuidPattern.test(candidate.orderId) ||
    !isOwnerSegment(candidate.ownerSegment) ||
    !isCanonicalIso(candidate.purgeAt) ||
    key !== lookupStorageKey(candidate.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== candidate.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop order lookup", [
      "Order lookup metadata is malformed.",
    ]);
  }
  return value as NpShopOrderLookup;
}

async function lockOrder(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order:${siteId}:${ownerSegment}:${orderId}`}, 0))`,
  );
}

async function lockOrderLookup(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order-lookup:${siteId}:${orderId}`}, 0))`,
  );
}

async function lockPaymentEvent(
  tx: NpShopTransaction,
  siteId: string,
  providerId: string,
  eventId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-payment-event:${siteId}:${providerId}:${createHash("sha256").update(eventId).digest("hex")}`}, 0))`,
  );
}

async function lockPaymentAdjustmentEvent(
  tx: NpShopTransaction,
  siteId: string,
  providerId: string,
  eventId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-payment-adjustment:${siteId}:${providerId}:${createHash("sha256").update(eventId).digest("hex")}`}, 0))`,
  );
}

async function lockPaymentDisputeEvent(
  tx: NpShopTransaction,
  siteId: string,
  providerId: string,
  eventId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-payment-dispute:${siteId}:${providerId}:${createHash("sha256").update(eventId).digest("hex")}`}, 0))`,
  );
}

async function readStoredOrderForUpdate(
  tx: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
): Promise<NpShopStoredOrder | null> {
  const [row] = await tx
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, orderStorageKey(ownerSegment, orderId)),
      ),
    )
    .limit(1);
  return row ? requireStoredOrderAtKey(row.value, row.expiresAt, row.key) : null;
}

async function readOrderLookupForUpdate(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<NpShopOrderLookup | null> {
  const [row] = await tx
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, lookupStorageKey(orderId)),
      ),
    )
    .limit(1)
    .for("update");
  return row ? requireOrderLookup(row.value, row.expiresAt, row.key) : null;
}

async function readPaymentReceiptForUpdate(
  tx: NpShopTransaction,
  siteId: string,
  providerId: string,
  eventId: string,
): Promise<NpShopStoredPaymentReceipt | null> {
  const key = npShopPaymentReceiptStorageKey(providerId, eventId);
  const [row] = await tx
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, key),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) return null;
  const receipt = npRequireStoredShopPaymentReceipt(row.value);
  if (
    row.key !== key ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== receipt.purgeAt ||
    receipt.providerId !== providerId ||
    receipt.event.eventId !== eventId
  ) {
    throw new NpShopOrderContractError("Invalid Shop payment receipt storage metadata", [
      "Payment receipt key and expiry must match its canonical value.",
    ]);
  }
  return receipt;
}

async function readStoredPrivate(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredOrderPrivateData | null> {
  let query = db
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, privateStorageKey(ownerSegment, orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  if (!row) return null;
  const privateData = requireStoredPrivate(row.value, row.expiresAt);
  if (privateData.orderId !== orderId) {
    throw new NpShopOrderContractError("Invalid Shop order private storage key", [
      "Private order id must match its storage key.",
    ]);
  }
  return privateData;
}

async function readStoredPrivateForExpiry(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredOrderPrivateData | null> {
  try {
    return await readStoredPrivate(db, siteId, ownerSegment, orderId, forUpdate);
  } catch (error) {
    if (error instanceof NpShopOrderContractError) return null;
    throw error;
  }
}

async function readStoredFulfillment(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredFulfillment | null> {
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, fulfillmentStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row ? requireStoredFulfillment(row.value, row.expiresAt, row.key) : null;
}

async function readStoredCarrierBooking(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredCarrierBooking | null> {
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, carrierBookingStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row ? requireStoredCarrierBookingAtKey(row.value, row.expiresAt, row.key) : null;
}

async function readStoredFulfillmentParcels(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredFulfillmentParcels | null> {
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, fulfillmentParcelsStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row ? requireStoredFulfillmentParcelsAtKey(row.value, row.expiresAt, row.key) : null;
}

async function readStoredRefund(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredRefund | null> {
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, refundStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row ? requireStoredRefundAtKey(row.value, row.expiresAt, row.key) : null;
}

type NpShopAdminPackingWorkState = NpShopStoredPackingWork | "invalid" | null;

async function readAdminPackingWork(
  db: ReturnType<typeof getDb>,
  siteId: string,
  target: NpShopPackingWorkTarget,
  orderId: string,
): Promise<NpShopAdminPackingWorkState> {
  try {
    return await npReadStoredShopPackingWork(db, siteId, target, orderId);
  } catch (error) {
    if (error instanceof NpShopPackingWorkContractError) return "invalid";
    throw error;
  }
}

async function readStoredReturn(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredReturn | null> {
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, returnStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row ? requireStoredReturnAtKey(row.value, row.expiresAt, row.key) : null;
}

async function readStoredExchange(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredExchange | null> {
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopExchangeStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row ? requireStoredExchangeAtKey(row.value, row.expiresAt, row.key) : null;
}

async function readStoredExchangeDestinationPrivate(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredExchangeDestinationPrivate | null> {
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopExchangeDestinationPrivateStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row
    ? requireStoredExchangeDestinationPrivateAtKey(row.value, row.expiresAt, row.key)
    : null;
}

async function readStoredExchangeCarrierBooking(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredExchangeCarrierBooking | null> {
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopExchangeCarrierBookingStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row ? requireStoredExchangeCarrierBookingAtKey(row.value, row.expiresAt, row.key) : null;
}

async function readStoredExchangeParcels(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredExchangeParcels | null> {
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopExchangeParcelsStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row ? requireStoredExchangeParcelsAtKey(row.value, row.expiresAt, row.key) : null;
}

async function readStoredCarrierPickupByShipment(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  shipmentId: string,
  forUpdate = false,
): Promise<NpShopStoredCarrierPickup | null> {
  const key = `carrier-pickup:${shipmentId}`;
  let query = db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, key),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  if (!row) return null;
  const pickup = npRequireStoredShopCarrierPickup(row.value);
  if (
    row.key !== `carrier-pickup:${pickup.shipmentId}` ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== pickup.purgeAt
  ) {
    throw new NpShopCarrierContractError("Invalid carrier pickup storage metadata", [
      "pickup key and expiry must match their canonical values.",
    ]);
  }
  return pickup;
}

async function persistOrder(
  tx: NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
): Promise<void> {
  npRequireStoredShopOrder(order);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: orderStorageKey(order.ownerSegment, order.id),
      value: order,
      expiresAt: new Date(order.purgeAt),
      updatedAt: new Date(order.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: order,
        expiresAt: new Date(order.purgeAt),
        updatedAt: new Date(order.updatedAt),
      },
    });
}

async function persistOrderLookup(
  tx: NpShopTransaction,
  siteId: string,
  lookup: NpShopOrderLookup,
): Promise<void> {
  requireOrderLookup(lookup, new Date(lookup.purgeAt), lookupStorageKey(lookup.orderId));
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: lookupStorageKey(lookup.orderId),
    value: lookup,
    expiresAt: new Date(lookup.purgeAt),
    updatedAt: new Date(),
  });
}

async function persistPaymentReceipt(
  tx: NpShopTransaction,
  siteId: string,
  receipt: NpShopStoredPaymentReceipt,
): Promise<void> {
  npRequireStoredShopPaymentReceipt(receipt);
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: npShopPaymentReceiptStorageKey(receipt.providerId, receipt.event.eventId),
    value: receipt,
    expiresAt: new Date(receipt.purgeAt),
    updatedAt: new Date(receipt.processedAt),
  });
}

async function persistPrivate(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  privateData: NpShopStoredOrderPrivateData,
): Promise<void> {
  npRequireStoredShopOrderPrivate(privateData);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: privateStorageKey(ownerSegment, privateData.orderId),
      value: privateData,
      expiresAt: new Date(privateData.expiresAt),
      updatedAt: new Date(
        privateData.contract === NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT
          ? privateData.retainedAt
          : privateData.createdAt,
      ),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: privateData,
        expiresAt: new Date(privateData.expiresAt),
        updatedAt: new Date(
          privateData.contract === NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT
            ? privateData.retainedAt
            : privateData.createdAt,
        ),
      },
    });
}

async function persistFulfillment(
  tx: NpShopTransaction,
  siteId: string,
  fulfillment: NpShopStoredFulfillment,
): Promise<void> {
  npRequireStoredShopFulfillment(fulfillment);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: fulfillmentStorageKey(fulfillment.orderId),
      value: fulfillment,
      expiresAt: new Date(fulfillment.purgeAt),
      updatedAt: new Date(fulfillment.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: fulfillment,
        expiresAt: new Date(fulfillment.purgeAt),
        updatedAt: new Date(fulfillment.updatedAt),
      },
    });
}

async function persistCarrierBooking(
  tx: NpShopTransaction,
  siteId: string,
  booking: NpShopStoredCarrierBooking,
): Promise<void> {
  npRequireStoredShopCarrierBooking(booking);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: carrierBookingStorageKey(booking.orderId),
      value: booking,
      expiresAt: new Date(booking.purgeAt),
      updatedAt: new Date(booking.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: booking,
        expiresAt: new Date(booking.purgeAt),
        updatedAt: new Date(booking.updatedAt),
      },
    });
}

async function persistFulfillmentParcels(
  tx: NpShopTransaction,
  siteId: string,
  parcels: NpShopStoredFulfillmentParcels,
): Promise<void> {
  npRequireStoredShopFulfillmentParcels(parcels);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: fulfillmentParcelsStorageKey(parcels.orderId),
      value: parcels,
      expiresAt: new Date(parcels.purgeAt),
      updatedAt: new Date(parcels.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: parcels,
        expiresAt: new Date(parcels.purgeAt),
        updatedAt: new Date(parcels.updatedAt),
      },
    });
}

async function persistRefund(
  tx: NpShopTransaction,
  siteId: string,
  refund: NpShopStoredRefund,
): Promise<void> {
  npRequireStoredShopRefund(refund);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: refundStorageKey(refund.orderId),
      value: refund,
      expiresAt: new Date(refund.purgeAt),
      updatedAt: new Date(refund.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: refund,
        expiresAt: new Date(refund.purgeAt),
        updatedAt: new Date(refund.updatedAt),
      },
    });
}

async function persistReturn(
  tx: NpShopTransaction,
  siteId: string,
  returnRequest: NpShopStoredReturn,
): Promise<void> {
  npRequireStoredShopReturn(returnRequest);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: returnStorageKey(returnRequest.orderId),
      value: returnRequest,
      expiresAt: new Date(returnRequest.purgeAt),
      updatedAt: new Date(returnRequest.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: returnRequest,
        expiresAt: new Date(returnRequest.purgeAt),
        updatedAt: new Date(returnRequest.updatedAt),
      },
    });
}

async function persistExchange(
  tx: NpShopTransaction,
  siteId: string,
  exchange: NpShopStoredExchange,
): Promise<void> {
  npRequireStoredShopExchange(exchange);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopExchangeStorageKey(exchange.orderId),
      value: exchange,
      expiresAt: new Date(exchange.purgeAt),
      updatedAt: new Date(exchange.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: exchange,
        expiresAt: new Date(exchange.purgeAt),
        updatedAt: new Date(exchange.updatedAt),
      },
    });
}

async function persistExchangeDestinationPrivate(
  tx: NpShopTransaction,
  siteId: string,
  destination: NpShopStoredExchangeDestinationPrivate,
): Promise<void> {
  npRequireStoredShopExchangeDestinationPrivate(destination);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopExchangeDestinationPrivateStorageKey(destination.orderId),
      value: destination,
      expiresAt: new Date(destination.expiresAt),
      updatedAt: new Date(destination.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: destination,
        expiresAt: new Date(destination.expiresAt),
        updatedAt: new Date(destination.updatedAt),
      },
    });
}

async function persistExchangeCarrierBooking(
  tx: NpShopTransaction,
  siteId: string,
  booking: NpShopStoredExchangeCarrierBooking,
): Promise<void> {
  npRequireStoredShopExchangeCarrierBooking(booking);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopExchangeCarrierBookingStorageKey(booking.orderId),
      value: booking,
      expiresAt: new Date(booking.purgeAt),
      updatedAt: new Date(booking.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: booking,
        expiresAt: new Date(booking.purgeAt),
        updatedAt: new Date(booking.updatedAt),
      },
    });
}

async function persistExchangeParcels(
  tx: NpShopTransaction,
  siteId: string,
  parcels: NpShopStoredExchangeParcels,
): Promise<void> {
  npRequireStoredShopExchangeParcels(parcels);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopExchangeParcelsStorageKey(parcels.orderId),
      value: parcels,
      expiresAt: new Date(parcels.purgeAt),
      updatedAt: new Date(parcels.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: parcels,
        expiresAt: new Date(parcels.purgeAt),
        updatedAt: new Date(parcels.updatedAt),
      },
    });
}

async function deleteExchangeDestinationPrivate(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<void> {
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopExchangeDestinationPrivateStorageKey(orderId)),
      ),
    );
}

async function persistMaintenanceMarker(
  tx: NpShopTransaction,
  siteId: string,
  marker: NpShopOrderMaintenanceMarker,
): Promise<void> {
  requireMaintenanceMarker(marker, new Date(marker.dueAt));
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: maintenanceStorageKey(marker.ownerSegment, marker.orderId),
      value: marker,
      expiresAt: new Date(marker.dueAt),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: marker,
        expiresAt: new Date(marker.dueAt),
        updatedAt: new Date(),
      },
    });
}

async function removePrivateAndMaintenance(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
): Promise<void> {
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        sql`${npPluginStorage.key} in (${privateStorageKey(ownerSegment, orderId)}, ${maintenanceStorageKey(ownerSegment, orderId)})`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-notification-private:%"),
        sql`${npPluginStorage.value}->>'orderId' = ${orderId}`,
      ),
    );
}

async function projectOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
): Promise<NpShopOrder> {
  const privateData =
    order.privateDataStatus === "retained"
      ? await readStoredPrivate(db, siteId, order.ownerSegment, order.id)
      : null;
  if (
    order.privateDataStatus === "retained" &&
    (!privateData || new Date(privateData.expiresAt) <= new Date())
  ) {
    throw new NpShopOrderContractError("Shop order private data is missing", [
      "A retained order must have one live matching private sidecar.",
    ]);
  }
  if (
    privateData &&
    (privateData.orderId !== order.id ||
      privateData.createdAt !== order.createdAt ||
      (privateData.contract === NP_SHOP_ORDER_PRIVATE_CONTRACT &&
        privateData.expiresAt !== order.pendingExpiresAt))
  ) {
    throw new NpShopOrderContractError("Shop order private data does not match its order", [
      "Private order id and retention timestamps must match the commercial order.",
    ]);
  }
  const fulfillment = await readStoredFulfillment(db, siteId, order.id);
  if (fulfillment && !fulfillmentMatchesOrder(fulfillment, order)) {
    throw new NpShopOrderContractError("Shop fulfillment does not match its order", [
      "Fulfillment owner, paid status, retention, and private-data state must match the commercial order.",
    ]);
  }
  const refund = await readStoredRefund(db, siteId, order.id);
  if (refund && !refundMatchesOrder(refund, order)) {
    throw new NpShopOrderContractError("Shop refund does not match its order", [
      "Refund identity, payment, amount, retention, time, status, and revision must match the commercial order.",
    ]);
  }
  const paymentAdjustment = await npReadStoredShopPaymentAdjustment(db, siteId, order.id);
  const isClosedCancelledOrderAdjustment =
    paymentAdjustment?.status === "closed-unpaid-order" &&
    order.status === "cancelled" &&
    order.paymentProvider === null &&
    order.paymentReference === null;
  if (
    paymentAdjustment &&
    ((!isClosedCancelledOrderAdjustment &&
      (paymentAdjustment.providerId !== order.paymentProvider ||
        paymentAdjustment.paymentReference !== order.paymentReference)) ||
      paymentAdjustment.currency !== order.currency ||
      paymentAdjustment.originalAmountMinor !== order.totalMinor ||
      paymentAdjustment.purgeAt !== order.purgeAt ||
      paymentAdjustment.orderRevision > order.revision)
  ) {
    throw new NpShopOrderContractError("Shop payment adjustment does not match its order", [
      "Payment identity, amount, retention, and revision must match the commercial order.",
    ]);
  }
  const returnRequest = await readStoredReturn(db, siteId, order.id);
  if (returnRequest && !returnMatchesOrder(returnRequest, order)) {
    throw new NpShopOrderContractError("Shop return does not match its order", [
      "Return owner, order revision, retention, status, and line quantities must match the order.",
    ]);
  }
  if (returnRequest && fulfillment?.status !== "shipped") {
    throw new NpShopOrderContractError("Shop return requires shipped fulfillment", [
      "A physical return can exist only for one shipped fulfillment.",
    ]);
  }
  const returnTracking = returnRequest
    ? await npReadShopReturnTrackingForOrder(db, siteId, order.id)
    : null;
  const returnLogistics = returnRequest
    ? await npReadShopReturnLogisticsForOrder(db, siteId, returnRequest, returnTracking)
    : null;
  const partialRefund = await npReadShopPartialRefundForOrder(
    db,
    siteId,
    order,
    returnRequest,
    returnLogistics,
  );
  const exchange = await readStoredExchange(db, siteId, order.id);
  const exchangeDestination = exchange
    ? await readStoredExchangeDestinationPrivate(db, siteId, order.id)
    : null;
  const exchangeTracking = exchange
    ? await npReadShopExchangeTrackingForOrder(db, siteId, order.id)
    : null;
  if (
    exchange &&
    (!returnRequest ||
      !exchangeMatchesOrder(exchange, order, returnRequest) ||
      refund !== null ||
      partialRefund !== null)
  ) {
    throw new NpShopOrderContractError("Shop exchange does not match its order", [
      "Exchange identity, received return, exact lines, revision, retention, and refund exclusion must match.",
    ]);
  }
  if (
    exchangeDestination &&
    (!exchange || !exchangeDestinationMatches(exchangeDestination, exchange))
  ) {
    throw new NpShopOrderContractError("Shop exchange destination does not match", [
      "Private destination identity, owner, revisions, and submission time must match its awaiting exchange.",
    ]);
  }
  if (
    exchangeTracking &&
    (!exchange ||
      (exchange.status !== "processing" && exchange.status !== "shipped") ||
      exchange.carrier === null ||
      exchange.trackingNumber === null)
  ) {
    throw new NpShopOrderContractError("Shop exchange tracking does not match", [
      "Exchange tracking requires one active provider-booked replacement shipment.",
    ]);
  }
  if (
    privateData?.contract === NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT &&
    (!fulfillment ||
      privateData.retainedAt !== fulfillment.createdAt ||
      privateData.expiresAt !== fulfillment.privateExpiresAt)
  ) {
    throw new NpShopOrderContractError("Shop fulfillment private data does not match", [
      "The promoted private sidecar must match one fulfillment retention deadline.",
    ]);
  }
  const tracking = await npReadShopTrackingForOrder(db, siteId, order.id);
  if (tracking && fulfillment?.status !== "shipped") {
    throw new NpShopOrderContractError("Shop tracking requires shipped fulfillment", [
      "A carrier tracking state can exist only for one shipped fulfillment.",
    ]);
  }
  const { ownerSegment: _ownerSegment, ...publicFields } = order;
  return npRequireShopOrder({
    ...publicFields,
    contract: NP_SHOP_ORDER_CONTRACT,
    customer: privateData?.customer ?? null,
    shipping: privateData?.shipping ?? null,
    ...(fulfillment ? { fulfillment: npProjectShopFulfillment(fulfillment) } : {}),
    ...(tracking ? { tracking } : {}),
    ...(refund ? { refund: npProjectShopRefund(refund) } : {}),
    ...(partialRefund ? { partialRefund } : {}),
    ...(paymentAdjustment
      ? { paymentAdjustment: npProjectShopPaymentAdjustment(paymentAdjustment) }
      : {}),
    ...(returnRequest
      ? { returnRequest: npProjectShopReturn(returnRequest, returnLogistics) }
      : {}),
    ...(exchange
      ? {
          exchange: npProjectShopExchange(
            exchange,
            exchangeDestination
              ? {
                  expiresAt: exchangeDestination.expiresAt,
                  accessedAt: exchangeDestination.accessedAt,
                }
              : null,
            new Date(),
            exchangeTracking,
          ),
        }
      : {}),
  });
}

async function requirePendingCapacity(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
): Promise<void> {
  const rows = await tx
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `order:${ownerSegment}:%`),
        sql`${npPluginStorage.value}->>'status' = 'pending-payment'`,
        sql`(${npPluginStorage.value}->>'pendingExpiresAt')::timestamptz > now()`,
      ),
    )
    .limit(npShopOrderLimits.maximumPendingPerOwner + 1);
  for (const row of rows) requireStoredOrderAtKey(row.value, row.expiresAt, row.key);
  if (rows.length >= npShopOrderLimits.maximumPendingPerOwner) {
    throw new NpShopOrderConflictError(
      "order_pending_limit",
      `At most ${npShopOrderLimits.maximumPendingPerOwner.toString()} pending orders are allowed per browser identity.`,
    );
  }
}

function requireIdempotencyMatch(existing: NpShopStoredOrder, input: NpShopOrderCreateInput): void {
  if (existing.sourceDraftId !== input.draftId) {
    throw new NpShopOrderConflictError(
      "order_idempotency_conflict",
      "The idempotency key already belongs to a different order draft.",
    );
  }
}

async function cancelStoredOrder(
  tx: NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
  reason: "customer" | "payment-timeout",
  now: Date,
): Promise<NpShopStoredOrder> {
  if (order.status === "cancelled") return order;
  if (order.status !== "pending-payment") {
    throw new NpShopOrderConflictError(
      "order_not_cancellable",
      "Only a pending-payment order can be cancelled.",
    );
  }
  await npLockShopInventoryProducts(
    tx,
    siteId,
    order.lines.map((line) => line.productId),
  );
  if (order.inventoryReservationStatus === "held") {
    const reservedLineKeys = new Set(order.inventoryReservationLineKeys);
    await npReleaseShopInventoryReservations(
      tx,
      siteId,
      order.id,
      order.lines.filter((line) => reservedLineKeys.has(line.key)),
    );
  }
  await npResolveShopPromotionReservation(tx, siteId, order.id, "released", now);
  const cancelled = {
    ...order,
    status: "cancelled",
    revision: order.revision + 1,
    privateDataStatus: "redacted",
    inventoryReservationStatus:
      order.inventoryReservationStatus === "held" ? "released" : "not-required",
    updatedAt: now.toISOString(),
    cancelledAt: now.toISOString(),
    cancellationReason: reason,
  } satisfies NpShopStoredOrder;
  await persistOrder(tx, siteId, cancelled);
  await npStageShopOrderNotification(tx, siteId, {
    orderId: cancelled.id,
    ownerSegment: cancelled.ownerSegment,
    kind: "order.cancelled",
    orderRevision: cancelled.revision,
    occurredAt: cancelled.updatedAt,
    purgeAt: cancelled.purgeAt,
    email: null,
  });
  await removePrivateAndMaintenance(tx, siteId, order.ownerSegment, order.id);
  return cancelled;
}

async function redactStoredOrderPrivate(
  tx: NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
  now: Date,
): Promise<NpShopStoredOrder> {
  const redactedAt = new Date(
    Math.min(now.getTime(), new Date(order.purgeAt).getTime()),
  ).toISOString();
  await removePrivateAndMaintenance(tx, siteId, order.ownerSegment, order.id);
  let fulfillment: NpShopStoredFulfillment | null = null;
  try {
    fulfillment = await readStoredFulfillment(tx, siteId, order.id, true);
  } catch (error) {
    if (
      !(error instanceof NpShopFulfillmentContractError) &&
      !(error instanceof NpShopOrderContractError)
    ) {
      throw error;
    }
    // PII expiry cannot depend on repairing a malformed commercial row. The
    // fulfillment remains for health diagnostics while canonical private keys
    // are removed and the valid order projection is closed below.
  }
  // Private-sidecar expiry is not a commercial mutation. Keep both revisions stable so
  // durable parcel, carrier, and packing snapshots remain tied to the same exact source;
  // every PII-bearing action independently rechecks the retained status and sidecar.
  if (
    fulfillment?.privateDataStatus === "retained" &&
    fulfillmentMatchesOrder(fulfillment, order)
  ) {
    await persistFulfillment(tx, siteId, {
      ...fulfillment,
      privateDataStatus: "redacted",
      updatedAt: redactedAt,
    });
  }
  if (order.privateDataStatus === "redacted") {
    return order;
  }
  const redacted = {
    ...order,
    privateDataStatus: "redacted",
    updatedAt: redactedAt,
  } satisfies NpShopStoredOrder;
  await persistOrder(tx, siteId, redacted);
  return redacted;
}

export async function npApplyShopPaymentEvent(
  runtime: NpShopRuntime,
  providerId: string,
  event: NpShopVerifiedPaymentEvent,
  receivedAt: Date,
): Promise<NpShopPaymentApplyResult> {
  npRequireShopPaymentProviderId(providerId);
  const siteId = await requireSiteId();
  const eventDigest = npShopPaymentEventDigest(event);
  return getDb().transaction(async (tx) => {
    await lockPaymentEvent(tx, siteId, providerId, event.eventId);
    const existingReceipt = await readPaymentReceiptForUpdate(
      tx,
      siteId,
      providerId,
      event.eventId,
    );
    if (existingReceipt) {
      if (existingReceipt.eventDigest !== eventDigest) {
        throw new NpShopPaymentConflictError(
          "payment_event_conflict",
          "The provider event id was already used for a different canonical event.",
        );
      }
      return {
        receipt: existingReceipt,
        duplicate: true,
        orderStatus: existingReceipt.orderStatus,
      };
    }

    await lockOrderLookup(tx, siteId, event.orderId);
    const lookup = await readOrderLookupForUpdate(tx, siteId, event.orderId);
    if (!lookup) {
      throw new NpShopPaymentConflictError(
        "payment_order_not_found",
        "The verified payment event references no Shop order in this site.",
      );
    }
    await lockOrder(tx, siteId, lookup.ownerSegment, event.orderId);
    let order = await readStoredOrderForUpdate(tx, siteId, lookup.ownerSegment, event.orderId);
    if (!order) {
      throw new NpShopPaymentConflictError(
        "payment_order_not_found",
        "The verified payment event references a missing Shop order.",
      );
    }
    if (new Date(order.purgeAt) <= receivedAt) {
      throw new NpShopPaymentConflictError(
        "payment_order_expired",
        "The verified payment event references an order past its commercial retention window.",
      );
    }
    if (order.currency !== event.currency || order.totalMinor !== event.amountMinor) {
      throw new NpShopPaymentConflictError(
        "payment_amount_mismatch",
        "The verified payment amount or currency does not match the immutable order.",
      );
    }

    let outcome: NpShopStoredPaymentReceipt["outcome"];
    if (order.status === "paid" && order.privateDataStatus === "retained") {
      const privateData = await readStoredPrivateForExpiry(
        tx,
        siteId,
        order.ownerSegment,
        order.id,
      );
      if (!privateData || new Date(privateData.expiresAt) <= receivedAt) {
        order = await redactStoredOrderPrivate(tx, siteId, order, receivedAt);
      }
    }
    if (order.status !== "pending-payment") {
      outcome = "ignored-terminal";
    } else if (new Date(order.pendingExpiresAt) <= receivedAt) {
      order = await cancelStoredOrder(tx, siteId, order, "payment-timeout", receivedAt);
      outcome = "ignored-terminal";
    } else if (event.type === "payment.succeeded") {
      if (await readStoredFulfillment(tx, siteId, order.id, true)) {
        throw new NpShopOrderContractError("Shop fulfillment already exists", [
          "A pending order cannot already own a fulfillment row.",
        ]);
      }
      const privateData = await readStoredPrivate(tx, siteId, order.ownerSegment, order.id);
      if (!privateData) {
        throw new NpShopOrderContractError("Shop order private data is missing", [
          "A payable order must retain its exact customer and shipping sidecar.",
        ]);
      }
      await npLockShopInventoryProducts(
        tx,
        siteId,
        order.lines.map((line) => line.productId),
      );
      if (order.inventoryReservationStatus === "held") {
        const reservedLineKeys = new Set(order.inventoryReservationLineKeys);
        await npConsumeShopInventoryReservations(
          tx,
          siteId,
          runtime,
          order.id,
          order.lines.filter((line) => reservedLineKeys.has(line.key)),
        );
      }
      await npResolveShopPromotionReservation(tx, siteId, order.id, "redeemed", receivedAt);
      order = {
        ...order,
        status: "paid",
        revision: order.revision + 1,
        inventoryReservationStatus:
          order.inventoryReservationStatus === "held" ? "consumed" : "not-required",
        paymentProvider: providerId,
        paymentReference: event.paymentReference,
        paymentEventId: event.eventId,
        paymentResolvedAt: receivedAt.toISOString(),
        updatedAt: receivedAt.toISOString(),
      };
      const privateExpiresAt = new Date(
        receivedAt.getTime() + npShopFulfillmentLimits.privateRetentionSeconds * 1_000,
      ).toISOString();
      const fulfillment: NpShopStoredFulfillment = {
        contract: NP_SHOP_FULFILLMENT_STORAGE_CONTRACT,
        orderId: order.id,
        ownerSegment: order.ownerSegment,
        status: "awaiting",
        revision: 1,
        privateDataStatus: "retained",
        carrier: null,
        trackingNumber: null,
        operatorNote: null,
        createdAt: receivedAt.toISOString(),
        updatedAt: receivedAt.toISOString(),
        privateExpiresAt,
        shippedAt: null,
        purgeAt: order.purgeAt,
      };
      await persistOrder(tx, siteId, order);
      await persistFulfillment(tx, siteId, fulfillment);
      await persistPrivate(tx, siteId, order.ownerSegment, {
        contract: NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT,
        orderId: order.id,
        customer: privateData.customer,
        shipping: privateData.shipping,
        createdAt: order.createdAt,
        retainedAt: receivedAt.toISOString(),
        expiresAt: privateExpiresAt,
      });
      await persistMaintenanceMarker(tx, siteId, {
        contract: "np.shop-order-maintenance.v1",
        orderId: order.id,
        ownerSegment: order.ownerSegment,
        dueAt: privateExpiresAt,
      });
      await npStageShopOrderNotification(tx, siteId, {
        orderId: order.id,
        ownerSegment: order.ownerSegment,
        kind: "payment.succeeded",
        orderRevision: order.revision,
        occurredAt: receivedAt.toISOString(),
        purgeAt: order.purgeAt,
        email: privateData.customer.email,
      });
      outcome = "paid";
    } else {
      await npLockShopInventoryProducts(
        tx,
        siteId,
        order.lines.map((line) => line.productId),
      );
      if (order.inventoryReservationStatus === "held") {
        const reservedLineKeys = new Set(order.inventoryReservationLineKeys);
        const released = await npReleaseShopInventoryReservations(
          tx,
          siteId,
          order.id,
          order.lines.filter((line) => reservedLineKeys.has(line.key)),
        );
        if (released !== reservedLineKeys.size) {
          throw new NpShopPaymentConflictError(
            "payment_inventory_conflict",
            "The failed payment order is missing one or more exact inventory reservations.",
          );
        }
      }
      await npResolveShopPromotionReservation(tx, siteId, order.id, "released", receivedAt);
      order = {
        ...order,
        status: "payment-failed",
        revision: order.revision + 1,
        privateDataStatus: "redacted",
        inventoryReservationStatus:
          order.inventoryReservationStatus === "held" ? "released" : "not-required",
        paymentProvider: providerId,
        paymentReference: event.paymentReference,
        paymentEventId: event.eventId,
        paymentResolvedAt: receivedAt.toISOString(),
        updatedAt: receivedAt.toISOString(),
      };
      await persistOrder(tx, siteId, order);
      await npStageShopOrderNotification(tx, siteId, {
        orderId: order.id,
        ownerSegment: order.ownerSegment,
        kind: "payment.failed",
        orderRevision: order.revision,
        occurredAt: receivedAt.toISOString(),
        purgeAt: order.purgeAt,
        email: null,
      });
      await removePrivateAndMaintenance(tx, siteId, order.ownerSegment, order.id);
      outcome = "payment-failed";
    }

    const receipt: NpShopStoredPaymentReceipt = {
      contract: NP_SHOP_PAYMENT_RECEIPT_CONTRACT,
      providerId,
      event,
      eventDigest,
      outcome,
      orderStatus: order.status as NpShopStoredPaymentReceipt["orderStatus"],
      orderRevision: order.revision,
      processedAt: receivedAt.toISOString(),
      purgeAt: order.purgeAt,
    };
    await persistPaymentReceipt(tx, siteId, receipt);
    return {
      receipt,
      duplicate: false,
      orderStatus: receipt.orderStatus,
    };
  });
}

function paymentAdjustmentExtends(
  current: NpShopStoredPaymentAdjustment,
  event: NpShopVerifiedPaymentAdjustmentEvent,
): boolean {
  if (
    current.providerId.length === 0 ||
    current.orderId !== event.orderId ||
    current.paymentReference !== event.paymentReference ||
    current.currency !== event.currency ||
    current.originalAmountMinor !== event.originalAmountMinor ||
    event.remainingAmountMinor > current.remainingAmountMinor
  ) {
    return false;
  }
  const next = new Map(event.cancellations.map((item) => [item.reference, item]));
  return current.cancellations.every((item) => {
    const candidate = next.get(item.reference);
    return (
      candidate?.amountMinor === item.amountMinor && candidate.cancelledAt === item.cancelledAt
    );
  });
}

function paymentAdjustmentMatchesRefundReference(
  event: NpShopVerifiedPaymentAdjustmentEvent,
  reference: string | null,
): boolean {
  return reference === null || event.cancellations.some((item) => item.reference === reference);
}

export async function npApplyShopPaymentAdjustmentEvent(
  runtime: NpShopRuntime,
  providerId: string,
  event: NpShopVerifiedPaymentAdjustmentEvent,
  receivedAt: Date,
): Promise<NpShopPaymentAdjustmentApplyResult> {
  npRequireShopPaymentProviderId(providerId);
  const siteId = await requireSiteId();
  const eventDigest = npShopPaymentAdjustmentEventDigest(event);
  return getDb().transaction(async (tx) => {
    await lockPaymentAdjustmentEvent(tx, siteId, providerId, event.eventId);
    const existingReceipt = await npReadStoredShopPaymentAdjustmentReceipt(
      tx,
      siteId,
      providerId,
      event.eventId,
    );
    if (existingReceipt) {
      if (existingReceipt.eventDigest !== eventDigest) {
        throw new NpShopPaymentAdjustmentConflictError(
          "payment_adjustment_conflict",
          "The provider adjustment id was already used for a different cancellation snapshot.",
        );
      }
      return { receipt: existingReceipt, duplicate: true };
    }

    await lockOrderLookup(tx, siteId, event.orderId);
    const lookup = await readOrderLookupForUpdate(tx, siteId, event.orderId);
    if (!lookup) {
      throw new NpShopPaymentAdjustmentConflictError(
        "payment_adjustment_order_not_found",
        "The verified payment adjustment references no Shop order in this site.",
      );
    }
    await lockOrder(tx, siteId, lookup.ownerSegment, event.orderId);
    let order = await readStoredOrderForUpdate(tx, siteId, lookup.ownerSegment, event.orderId);
    if (!order) {
      throw new NpShopPaymentAdjustmentConflictError(
        "payment_adjustment_order_not_found",
        "The verified payment adjustment references a missing Shop order.",
      );
    }
    if (new Date(order.purgeAt) <= receivedAt) {
      throw new NpShopPaymentAdjustmentConflictError(
        "payment_adjustment_order_expired",
        "The verified payment adjustment references an expired Shop order.",
      );
    }
    if (order.currency !== event.currency || order.totalMinor !== event.originalAmountMinor) {
      throw new NpShopPaymentAdjustmentConflictError(
        "payment_adjustment_payment_mismatch",
        "The provider adjustment currency or original amount does not match the immutable order.",
      );
    }
    if (
      order.paymentProvider !== null &&
      (order.paymentProvider !== providerId || order.paymentReference !== event.paymentReference)
    ) {
      throw new NpShopPaymentAdjustmentConflictError(
        "payment_adjustment_payment_mismatch",
        "The provider adjustment does not match the order payment identity.",
      );
    }

    const currentAdjustment = await npReadStoredShopPaymentAdjustment(
      tx,
      siteId,
      event.orderId,
      true,
    );
    if (
      currentAdjustment &&
      (currentAdjustment.providerId !== providerId ||
        !paymentAdjustmentExtends(currentAdjustment, event))
    ) {
      throw new NpShopPaymentAdjustmentConflictError(
        "payment_adjustment_conflict",
        "The provider cancellation snapshot regressed or changed an already retained cancellation.",
      );
    }

    const reversedAmountMinor = event.originalAmountMinor - event.remainingAmountMinor;
    const fullRefund = await readStoredRefund(tx, siteId, order.id, true);
    const partialRefund = await npReadStoredShopPartialRefundForAdjustment(
      tx,
      siteId,
      order.id,
      true,
    );
    const exchange = await readStoredExchange(tx, siteId, order.id, true);
    const carrierBooking =
      order.status === "paid" ? await readStoredCarrierBooking(tx, siteId, order.id, true) : null;
    const adjustmentFulfillment =
      order.status === "paid" ? await readStoredFulfillment(tx, siteId, order.id, true) : null;
    const adjustmentParcels =
      order.status === "paid"
        ? await readStoredFulfillmentParcels(tx, siteId, order.id, true)
        : null;
    const packingWork =
      order.status === "paid"
        ? await npReadStoredShopPackingWork(tx, siteId, "outbound", order.id, true)
        : null;
    const packingWorkSafeForAdjustment = packingWorkAllowsFullRefund(
      packingWork,
      order,
      adjustmentFulfillment,
      carrierBooking,
      adjustmentParcels,
    );
    const paymentDisputeUnsafe = await paymentDisputeRequiresReviewForOrder(
      tx,
      siteId,
      order,
      true,
    );
    const matchesFullRefund =
      fullRefund !== null &&
      fullRefund.status !== "manual-review" &&
      fullRefund.providerId === providerId &&
      fullRefund.paymentReference === event.paymentReference &&
      fullRefund.currency === event.currency &&
      fullRefund.amountMinor === reversedAmountMinor &&
      event.cancellations.length === 1 &&
      event.cancellations[0]?.amountMinor === fullRefund.amountMinor &&
      paymentAdjustmentMatchesRefundReference(event, fullRefund.refundReference);
    const matchesPartialRefund =
      partialRefund !== null &&
      partialRefund.status !== "manual-review" &&
      partialRefund.providerId === providerId &&
      partialRefund.paymentReference === event.paymentReference &&
      partialRefund.currency === event.currency &&
      partialRefund.amountMinor === reversedAmountMinor &&
      event.cancellations.length === 1 &&
      event.cancellations[0]?.amountMinor === partialRefund.amountMinor &&
      paymentAdjustmentMatchesRefundReference(event, partialRefund.refundReference);

    let outcome: NpShopStoredPaymentAdjustmentReceipt["outcome"];
    let inventoryOutcome: NpShopStoredPaymentAdjustment["inventoryOutcome"] = "not-required";
    let fulfillmentOutcome: NpShopStoredPaymentAdjustment["fulfillmentOutcome"] = "unchanged";
    if (matchesFullRefund || matchesPartialRefund) {
      outcome = "matched-refund";
    } else if (
      currentAdjustment?.status === "manual-review" ||
      fullRefund !== null ||
      partialRefund !== null ||
      exchange !== null ||
      paymentDisputeUnsafe ||
      !packingWorkSafeForAdjustment ||
      (carrierBooking !== null && carrierBooking.status !== "completed") ||
      (event.remainingAmountMinor === 0 && event.cancellations.length !== 1)
    ) {
      outcome = "manual-review";
      inventoryOutcome = "pending";
      fulfillmentOutcome = "pending";
    } else if (order.status === "pending-payment") {
      await npLockShopInventoryProducts(
        tx,
        siteId,
        order.lines.map((line) => line.productId),
      );
      if (order.inventoryReservationStatus === "held") {
        const reservedLineKeys = new Set(order.inventoryReservationLineKeys);
        const released = await npReleaseShopInventoryReservations(
          tx,
          siteId,
          order.id,
          order.lines.filter((line) => reservedLineKeys.has(line.key)),
        );
        if (released !== reservedLineKeys.size) {
          throw new NpShopPaymentAdjustmentConflictError(
            "payment_adjustment_conflict",
            "The reversed unpaid order is missing one or more exact inventory reservations.",
          );
        }
      }
      await npResolveShopPromotionReservation(tx, siteId, order.id, "released", receivedAt);
      order = {
        ...order,
        status: "payment-failed",
        revision: order.revision + 1,
        privateDataStatus: "redacted",
        inventoryReservationStatus:
          order.inventoryReservationStatus === "held" ? "released" : "not-required",
        paymentProvider: providerId,
        paymentReference: event.paymentReference,
        paymentEventId: event.eventId,
        paymentResolvedAt: receivedAt.toISOString(),
        updatedAt: receivedAt.toISOString(),
      };
      await persistOrder(tx, siteId, order);
      await npStageShopOrderNotification(tx, siteId, {
        orderId: order.id,
        ownerSegment: order.ownerSegment,
        kind: "payment.failed",
        orderRevision: order.revision,
        occurredAt: receivedAt.toISOString(),
        purgeAt: order.purgeAt,
        email: null,
      });
      await removePrivateAndMaintenance(tx, siteId, order.ownerSegment, order.id);
      outcome = "closed-unpaid-order";
    } else if (
      order.status === "paid" &&
      event.remainingAmountMinor === 0 &&
      event.cancellations.length === 1 &&
      order.paymentResolvedAt !== null &&
      new Date(event.cancellations[0].cancelledAt) >= new Date(order.paymentResolvedAt)
    ) {
      const cancellation = event.cancellations[0];
      const fulfillment = adjustmentFulfillment;
      if (!fulfillment || !fulfillmentMatchesOrder(fulfillment, order)) {
        throw new NpShopOrderContractError("Reversed payment fulfillment is invalid", [
          "A fully reversed paid order must retain one exact fulfillment before compensation.",
        ]);
      }
      const shipped = fulfillment.status === "shipped";
      inventoryOutcome = shipped ? "not-applicable-shipped" : "not-required";
      if (!shipped && order.inventoryReservationStatus === "consumed") {
        await npLockShopInventoryProducts(
          tx,
          siteId,
          order.lines.map((line) => line.productId),
        );
        const trackedLineKeys = new Set(order.inventoryReservationLineKeys);
        inventoryOutcome = (await npRestoreShopOrderInventory(
          tx,
          siteId,
          runtime,
          order.lines.filter((line) => trackedLineKeys.has(line.key)),
        ))
          ? "restocked"
          : "manual-required";
      }
      const now = new Date(
        Math.max(receivedAt.getTime(), new Date(cancellation.cancelledAt).getTime()),
      ).toISOString();
      if (!shipped) {
        await persistFulfillment(tx, siteId, {
          ...fulfillment,
          status: "cancelled",
          revision: fulfillment.revision + 1,
          privateDataStatus: "redacted",
          updatedAt: now,
        });
      }
      order = {
        ...order,
        status: "refunded",
        revision: order.revision + 1,
        privateDataStatus: "redacted",
        updatedAt: now,
      };
      await persistOrder(tx, siteId, order);
      await npStageShopOrderNotification(tx, siteId, {
        orderId: order.id,
        ownerSegment: order.ownerSegment,
        kind: "refund.completed",
        orderRevision: order.revision,
        occurredAt: now,
        purgeAt: order.purgeAt,
        email: null,
      });
      await removePrivateAndMaintenance(tx, siteId, order.ownerSegment, order.id);
      const refund: NpShopStoredRefund = {
        contract: NP_SHOP_REFUND_STORAGE_CONTRACT,
        id: randomUUID(),
        orderId: order.id,
        providerId,
        status: "refunded",
        orderRevision: order.revision,
        paymentReference: event.paymentReference,
        refundReference: cancellation.reference,
        currency: event.currency,
        amountMinor: event.originalAmountMinor,
        reason: "Provider-initiated full reversal",
        inventoryOutcome,
        fulfillmentOutcome: shipped ? "shipped-retained" : "cancelled",
        providerErrorCode: null,
        requestedAt: cancellation.cancelledAt,
        updatedAt: now,
        refundedAt: cancellation.cancelledAt,
        purgeAt: order.purgeAt,
      };
      await persistRefund(tx, siteId, refund);
      await tx.insert(npAuditEvents).values({
        actorKind: "system",
        actorUserId: null,
        actorMemberId: null,
        action: "shop.payment-adjustment.full-reversal",
        targetType: "shop-order",
        targetId: order.id,
        payload: {
          providerId,
          eventId: event.eventId,
          refundId: refund.id,
          inventoryOutcome,
          fulfillmentOutcome: refund.fulfillmentOutcome,
        },
        siteId,
      });
      outcome = "applied-full-reversal";
      fulfillmentOutcome = shipped ? "shipped-retained" : "cancelled";
    } else if (order.status === "paid") {
      outcome = "manual-review";
      inventoryOutcome = "pending";
      fulfillmentOutcome = "pending";
    } else {
      outcome = "closed-unpaid-order";
    }

    const state: NpShopStoredPaymentAdjustment = {
      contract: NP_SHOP_PAYMENT_ADJUSTMENT_STORAGE_CONTRACT,
      providerId,
      orderId: event.orderId,
      paymentReference: event.paymentReference,
      currency: event.currency,
      originalAmountMinor: event.originalAmountMinor,
      remainingAmountMinor: event.remainingAmountMinor,
      cancellations: event.cancellations,
      status: outcome,
      latestEventId: event.eventId,
      orderRevision: order.revision,
      inventoryOutcome,
      fulfillmentOutcome,
      updatedAt: receivedAt.toISOString(),
      purgeAt: order.purgeAt,
    };
    await npPersistShopPaymentAdjustment(tx, siteId, state);
    const receipt: NpShopStoredPaymentAdjustmentReceipt = {
      contract: NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT,
      providerId,
      event,
      eventDigest,
      outcome,
      orderStatus: order.status as NpShopStoredPaymentAdjustmentReceipt["orderStatus"],
      orderRevision: order.revision,
      processedAt: receivedAt.toISOString(),
      purgeAt: order.purgeAt,
    };
    await npPersistShopPaymentAdjustmentReceipt(tx, siteId, receipt);
    return { receipt, duplicate: false };
  });
}

export async function npApplyShopPaymentDisputeEvent(
  providerId: string,
  event: NpShopVerifiedPaymentDisputeEvent,
  receivedAt: Date,
): Promise<NpShopPaymentDisputeApplyResult> {
  npRequireShopPaymentProviderId(providerId);
  const siteId = await requireSiteId();
  const eventDigest = npShopPaymentDisputeEventDigest(event);
  return getDb().transaction(async (tx) => {
    await lockPaymentDisputeEvent(tx, siteId, providerId, event.eventId);
    const existingReceipt = await npReadStoredShopPaymentDisputeReceipt(
      tx,
      siteId,
      providerId,
      event.eventId,
    );
    if (existingReceipt) {
      if (existingReceipt.eventDigest !== eventDigest) {
        throw new NpShopPaymentDisputeConflictError(
          "payment_dispute_conflict",
          "The provider dispute event id was already used for different evidence.",
        );
      }
      return { receipt: existingReceipt, duplicate: true };
    }

    await lockOrderLookup(tx, siteId, event.orderId);
    const lookup = await readOrderLookupForUpdate(tx, siteId, event.orderId);
    if (!lookup) {
      throw new NpShopPaymentDisputeConflictError(
        "payment_dispute_order_not_found",
        "The verified dispute references no Shop order in this site.",
      );
    }
    await lockOrder(tx, siteId, lookup.ownerSegment, event.orderId);
    const order = await readStoredOrderForUpdate(tx, siteId, lookup.ownerSegment, event.orderId);
    if (!order) {
      throw new NpShopPaymentDisputeConflictError(
        "payment_dispute_order_not_found",
        "The verified dispute references a missing Shop order.",
      );
    }
    if (new Date(order.purgeAt) <= receivedAt) {
      throw new NpShopPaymentDisputeConflictError(
        "payment_dispute_order_expired",
        "The verified dispute references an expired Shop order.",
      );
    }
    if (
      (order.status !== "paid" && order.status !== "refunded") ||
      order.paymentProvider !== providerId ||
      order.paymentReference !== event.paymentReference ||
      order.currency !== event.currency ||
      event.amountMinor > order.totalMinor ||
      order.paymentResolvedAt === null ||
      new Date(event.occurredAt) >= new Date(order.purgeAt)
    ) {
      throw new NpShopPaymentDisputeConflictError(
        "payment_dispute_payment_mismatch",
        "The dispute does not match one captured Shop payment and its immutable amount.",
      );
    }

    const disputes = await npReadStoredShopPaymentDisputesForOrder(tx, siteId, order.id, true);
    if (!npShopPaymentDisputesMatchOrder(disputes, order)) {
      throw new NpShopPaymentDisputeConflictError(
        "payment_dispute_conflict",
        "Stored dispute evidence no longer matches the immutable Shop payment.",
      );
    }
    const current = await npReadStoredShopPaymentDispute(
      tx,
      siteId,
      providerId,
      event.disputeReference,
      true,
    );
    if (!current && disputes.length >= npShopPaymentDisputeLimits.maximumPerOrder) {
      throw new NpShopPaymentDisputeConflictError(
        "payment_dispute_limit",
        "This order already retains the maximum bounded dispute evidence.",
      );
    }
    if (
      current &&
      (current.orderId !== event.orderId ||
        current.paymentReference !== event.paymentReference ||
        current.currency !== event.currency ||
        current.amountMinor !== event.amountMinor ||
        current.purgeAt !== order.purgeAt)
    ) {
      throw new NpShopPaymentDisputeConflictError(
        "payment_dispute_conflict",
        "The provider dispute reference changed its immutable payment identity.",
      );
    }

    let outcome: NpShopStoredPaymentDisputeReceipt["outcome"];
    let nextState: NpShopStoredPaymentDispute | null = current;
    if (!current) {
      outcome = "opened";
      nextState = {
        contract: NP_SHOP_PAYMENT_DISPUTE_STORAGE_CONTRACT,
        providerId,
        disputeReference: event.disputeReference,
        orderId: event.orderId,
        paymentReference: event.paymentReference,
        currency: event.currency,
        amountMinor: event.amountMinor,
        status: event.status,
        reasonCode: event.reasonCode,
        latestEventId: event.eventId,
        openedAt: event.occurredAt,
        updatedAt: event.occurredAt,
        purgeAt: order.purgeAt,
      };
    } else {
      const eventTime = new Date(event.occurredAt).getTime();
      const currentTime = new Date(current.updatedAt).getTime();
      const currentTerminal = ["won", "lost", "warning-closed", "prevented"].includes(
        current.status,
      );
      const statusRank = (status: NpShopPaymentDisputeStatus): number => {
        if (status === "needs-response" || status === "warning-needs-response") return 0;
        if (status === "under-review" || status === "warning-under-review") return 1;
        return 2;
      };
      const statusFamily = (status: NpShopPaymentDisputeStatus): "warning" | "standard" =>
        status.startsWith("warning-") ? "warning" : "standard";
      if (eventTime < currentTime) {
        outcome = "ignored-stale";
      } else if (eventTime === currentTime) {
        if (current.status === event.status && current.reasonCode === event.reasonCode) {
          outcome = currentTerminal ? "ignored-terminal" : "ignored-stale";
        } else if (
          !currentTerminal &&
          statusFamily(current.status) === statusFamily(event.status) &&
          statusRank(event.status) > statusRank(current.status)
        ) {
          outcome = "updated";
          nextState = {
            ...current,
            status: event.status,
            reasonCode: event.reasonCode,
            latestEventId: event.eventId,
          };
        } else if (
          !currentTerminal &&
          statusFamily(current.status) === statusFamily(event.status) &&
          statusRank(event.status) < statusRank(current.status)
        ) {
          outcome = "ignored-stale";
        } else {
          throw new NpShopPaymentDisputeConflictError(
            "payment_dispute_conflict",
            "Two dispute states share one provider timestamp but disagree.",
          );
        }
      } else if (currentTerminal) {
        if (current.status !== event.status || current.reasonCode !== event.reasonCode) {
          throw new NpShopPaymentDisputeConflictError(
            "payment_dispute_conflict",
            "A terminal dispute cannot reopen or change its provider outcome.",
          );
        }
        outcome = "ignored-terminal";
      } else {
        outcome = "updated";
        nextState = {
          ...current,
          status: event.status,
          reasonCode: event.reasonCode,
          latestEventId: event.eventId,
          updatedAt: event.occurredAt,
        };
      }
    }

    if (nextState !== current && nextState !== null) {
      await npPersistShopPaymentDispute(tx, siteId, nextState);
      await tx.insert(npAuditEvents).values({
        actorKind: "system",
        actorUserId: null,
        actorMemberId: null,
        action: "shop.payment-dispute.record",
        targetType: "shop-order",
        targetId: order.id,
        payload: {
          providerId,
          disputeReference: event.disputeReference,
          status: event.status,
          reasonCode: event.reasonCode,
          amountMinor: event.amountMinor,
        },
        siteId,
      });
    }
    const receipt: NpShopStoredPaymentDisputeReceipt = {
      contract: NP_SHOP_PAYMENT_DISPUTE_RECEIPT_CONTRACT,
      providerId,
      event,
      eventDigest,
      outcome,
      orderStatus: order.status,
      orderRevision: order.revision,
      processedAt: receivedAt.toISOString(),
      purgeAt: order.purgeAt,
    };
    await npPersistShopPaymentDisputeReceipt(tx, siteId, receipt);
    return { receipt, duplicate: false };
  });
}

async function paymentDisputeRequiresReviewForOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
  forUpdate = false,
): Promise<boolean> {
  const disputes = await npReadStoredShopPaymentDisputesForOrder(db, siteId, order.id, forUpdate);
  if (!npShopPaymentDisputesMatchOrder(disputes, order)) {
    throw new NpShopOrderContractError("Shop payment dispute does not match its order", [
      "Dispute provider, payment, amount, and retention must match the commercial order.",
    ]);
  }
  return npShopPaymentDisputesRequireReview(disputes);
}

function isPackingPurgeSourceContractError(error: unknown): boolean {
  return (
    error instanceof NpShopPackingWorkContractError ||
    error instanceof NpShopOrderContractError ||
    error instanceof NpShopFulfillmentContractError ||
    error instanceof NpShopFulfillmentParcelContractError ||
    error instanceof NpShopCarrierContractError ||
    error instanceof NpShopReturnContractError ||
    error instanceof NpShopExchangeContractError ||
    error instanceof NpShopExchangeParcelContractError ||
    error instanceof NpShopExchangeCarrierContractError ||
    error instanceof NpShopTrackingContractError
  );
}

async function readPackingWorkPurgeState(
  tx: NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
): Promise<{
  readonly works: readonly (NpShopStoredPackingWork | null)[];
  readonly source: NpShopPackingWorkPurgeSource;
} | null> {
  let outboundCandidate: NpShopStoredPackingWork | null;
  let replacementCandidate: NpShopStoredPackingWork | null;
  try {
    // Discover which commercial rows are needed without taking packing locks.
    // The caller already owns the canonical order lock, so no in-scope action
    // can create or replace a work before the locked re-read below.
    outboundCandidate = await npReadStoredShopPackingWork(tx, siteId, "outbound", order.id);
    replacementCandidate = await npReadStoredShopPackingWork(tx, siteId, "replacement", order.id);

    const fulfillment = outboundCandidate
      ? await readStoredFulfillment(tx, siteId, order.id, true)
      : null;
    const outboundBooking = outboundCandidate
      ? await readStoredCarrierBooking(tx, siteId, order.id, true)
      : null;
    const outboundParcels = outboundCandidate
      ? await readStoredFulfillmentParcels(tx, siteId, order.id, true)
      : null;
    const returnRequest = replacementCandidate
      ? await readStoredReturn(tx, siteId, order.id, true)
      : null;
    const exchange = replacementCandidate
      ? await readStoredExchange(tx, siteId, order.id, true)
      : null;
    const replacementBooking = replacementCandidate
      ? await readStoredExchangeCarrierBooking(tx, siteId, order.id, true)
      : null;
    const replacementParcels = replacementCandidate
      ? await readStoredExchangeParcels(tx, siteId, order.id, true)
      : null;

    // Packing is deliberately locked after its source, booking, and parcel
    // rows. This matches every mutation path and avoids purge/action inversion.
    const outboundWork = await npReadStoredShopPackingWork(tx, siteId, "outbound", order.id, true);
    const replacementWork = await npReadStoredShopPackingWork(
      tx,
      siteId,
      "replacement",
      order.id,
      true,
    );
    const replacementTracking =
      replacementWork?.attachedShipmentId !== null &&
      replacementWork?.attachedShipmentId !== undefined
        ? await npReadStoredShopExchangeTrackingForOrder(tx, siteId, order.id, true)
        : null;
    return {
      works: [outboundWork, replacementWork],
      source: {
        order,
        fulfillment,
        outboundParcels,
        outboundBooking,
        returnRequest,
        exchange,
        replacementParcels,
        replacementBooking,
        replacementTracking,
      },
    };
  } catch (error) {
    if (isPackingPurgeSourceContractError(error)) return null;
    throw error;
  }
}

async function purgeOrder(
  tx: NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
): Promise<boolean> {
  const packingState = await readPackingWorkPurgeState(tx, siteId, order);
  if (!packingState) return false;
  const [outboundPackingWork, replacementPackingWork] = packingState.works;
  const relatedPackingKeys = await tx
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "packing-work:%"),
        sql`${npPluginStorage.value}->>'orderId' = ${order.id}`,
      ),
    )
    .orderBy(asc(npPluginStorage.key))
    .for("update");
  const canonicalPackingKeys = new Set([
    npShopPackingWorkStorageKey("outbound", order.id),
    npShopPackingWorkStorageKey("replacement", order.id),
  ]);
  if (relatedPackingKeys.some((row) => !canonicalPackingKeys.has(row.key))) {
    return false;
  }
  if (
    [outboundPackingWork, replacementPackingWork].some(
      (work) =>
        work &&
        (work.purgeAt !== order.purgeAt ||
          !npShopPackingWorkIsPurgeTerminal(work, packingState.source)),
    )
  ) {
    return false;
  }
  await npLockShopInventoryProducts(
    tx,
    siteId,
    order.lines.map((line) => line.productId),
  );
  const reservedLineKeys = new Set(order.inventoryReservationLineKeys);
  await npPurgeShopInventoryReservations(
    tx,
    siteId,
    order.id,
    order.lines.filter((line) => reservedLineKeys.has(line.key)),
  );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        sql`${npPluginStorage.key} in (${orderStorageKey(order.ownerSegment, order.id)}, ${privateStorageKey(order.ownerSegment, order.id)}, ${maintenanceStorageKey(order.ownerSegment, order.id)}, ${lookupStorageKey(order.id)}, ${fulfillmentStorageKey(order.id)}, ${fulfillmentParcelsStorageKey(order.id)}, ${carrierBookingStorageKey(order.id)}, ${npShopPackingWorkStorageKey("outbound", order.id)}, ${npShopPackingWorkStorageKey("replacement", order.id)}, ${npShopPackingStatusStorageKey("outbound", order.id)}, ${npShopPackingStatusStorageKey("replacement", order.id)}, ${npShopPackingStatusPollStorageKey("outbound", order.id)}, ${npShopPackingStatusPollStorageKey("replacement", order.id)}, ${`tracking:${order.id}`}, ${npShopTrackingPollStorageKey(order.id)}, ${npShopExchangeTrackingStorageKey(order.id)}, ${npShopExchangeTrackingPollStorageKey(order.id)}, ${refundStorageKey(order.id)}, ${returnStorageKey(order.id)}, ${npShopExchangeStorageKey(order.id)}, ${npShopExchangeDestinationPrivateStorageKey(order.id)}, ${npShopExchangeCarrierBookingStorageKey(order.id)}, ${npShopExchangeParcelsStorageKey(order.id)}, ${`return-logistics:${order.id}`}, ${`return-logistics-private:${order.id}`}, ${npShopReturnTrackingStorageKey(order.id)}, ${npShopReturnTrackingPollStorageKey(order.id)}, ${`payment-adjustment:${order.id}`}, ${`promotion-reservation:${order.id}`})`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "carrier-pickup:%"),
        sql`${npPluginStorage.value}->>'orderId' = ${order.id}`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "carrier-pickup-availability:%"),
        sql`${npPluginStorage.value}->>'orderId' = ${order.id}`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "carrier-label-acquisition:%"),
        sql`${npPluginStorage.value}->>'orderId' = ${order.id}`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopPartialRefundStorageKey(order.id)),
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `payment-attempt:${order.ownerSegment}:${order.id}:%`),
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-event:%"),
        sql`${npPluginStorage.value}->'event'->>'orderId' = ${order.id}`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "packing-status-event:%"),
        sql`${npPluginStorage.value}->'event'->>'orderId' = ${order.id}`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        or(
          like(npPluginStorage.key, `order-notification:${order.id}:%`),
          and(
            like(npPluginStorage.key, "order-notification-private:%"),
            sql`${npPluginStorage.value}->>'orderId' = ${order.id}`,
          ),
        ),
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-adjustment-event:%"),
        sql`${npPluginStorage.value}->'event'->>'orderId' = ${order.id}`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-dispute:%"),
        sql`${npPluginStorage.value}->>'orderId' = ${order.id}`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-dispute-event:%"),
        sql`${npPluginStorage.value}->'event'->>'orderId' = ${order.id}`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "tracking-event:%"),
        sql`${npPluginStorage.value}->'event'->>'orderId' = ${order.id}`,
      ),
    );
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "return-tracking-event:%"),
        sql`${npPluginStorage.value}->'event'->>'orderId' = ${order.id}`,
      ),
    );
  return true;
}

async function rotateShopStorageMaintenanceCursor(
  siteId: string,
  key: string,
  selectedUpdatedAt: Date,
): Promise<void> {
  const rotatedAt = new Date(Math.max(Date.now(), selectedUpdatedAt.getTime() + 1));
  // Maintenance ordering uses row metadata as a bounded fair cursor. Contract
  // timestamps stay untouched, including for malformed rows that cannot be
  // safely materialized.
  await getDb()
    .update(npPluginStorage)
    .set({ updatedAt: rotatedAt })
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, key),
        eq(npPluginStorage.updatedAt, selectedUpdatedAt),
      ),
    );
}

export async function npCreateShopOrder(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopOrderCreateInput,
): Promise<NpShopOrder> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const result = await getDb().transaction(async (tx) => {
    await npLockShopOrderDraftOwner(tx, siteId, owner);
    await npLockShopCart(tx, siteId, owner);
    await npLockShopOrderDraft(tx, siteId, owner, input.draftId);
    await lockOrderLookup(tx, siteId, input.idempotencyKey);
    const existingLookup = await readOrderLookupForUpdate(tx, siteId, input.idempotencyKey);
    if (existingLookup && existingLookup.ownerSegment !== ownerSegment) {
      throw new NpShopOrderConflictError(
        "order_idempotency_conflict",
        "The idempotency key already belongs to another browser identity.",
      );
    }
    await lockOrder(tx, siteId, ownerSegment, input.idempotencyKey);
    const existingAfterLock = await readStoredOrderForUpdate(
      tx,
      siteId,
      ownerSegment,
      input.idempotencyKey,
    );
    if (existingAfterLock) {
      requireIdempotencyMatch(existingAfterLock, input);
      const now = new Date();
      let committedPrivacyMutation = false;
      let current = existingAfterLock;
      if (
        existingAfterLock.status === "pending-payment" &&
        new Date(existingAfterLock.pendingExpiresAt) <= now
      ) {
        current = await cancelStoredOrder(tx, siteId, existingAfterLock, "payment-timeout", now);
        committedPrivacyMutation = true;
      }
      if (current.status === "paid" && current.privateDataStatus === "retained") {
        const privateData = await readStoredPrivateForExpiry(
          tx,
          siteId,
          current.ownerSegment,
          current.id,
        );
        if (!privateData || new Date(privateData.expiresAt) <= now) {
          current = await redactStoredOrderPrivate(tx, siteId, current, now);
          committedPrivacyMutation = true;
        }
      }
      return committedPrivacyMutation
        ? ({ outcome: "project-after-commit", order: current } as const)
        : ({ outcome: "projected", order: await projectOrder(tx, siteId, current) } as const);
    }
    if (existingLookup) {
      throw new NpShopOrderContractError("Shop order lookup is orphaned", [
        "The global order lookup exists without its commercial order.",
      ]);
    }
    await requirePendingCapacity(tx, siteId, ownerSegment);
    const draft = await npReadStoredShopOrderDraftForUpdate(tx, siteId, owner, input.draftId);
    if (!draft) {
      throw new NpShopOrderConflictError("order_source_stale", "The order draft no longer exists.");
    }
    if (new Date(draft.expiresAt) <= new Date()) {
      throw new NpShopOrderConflictError("order_source_stale", "The order draft expired.");
    }
    if (draft.revision !== input.expectedRevision) {
      throw new NpShopOrderConflictError(
        "order_revision_conflict",
        "The order draft changed before order creation.",
      );
    }
    if (draft.status !== "reviewable" || !draft.customer || !draft.shipping) {
      throw new NpShopOrderConflictError(
        "order_source_stale",
        "The order draft is not reviewable.",
      );
    }
    await npLockShopInventoryProducts(
      tx,
      siteId,
      draft.lines.map((line) => line.productId),
    );
    const quote = await npQuoteShopCart(runtime, owner);
    if (quote.issues.includes("insufficient-stock")) {
      throw new NpShopOrderConflictError(
        "order_inventory_unavailable",
        "The requested inventory is no longer available.",
      );
    }
    if (
      !quote.ready ||
      quote.revision !== draft.cartRevision ||
      quote.fingerprint !== draft.cartFingerprint
    ) {
      throw new NpShopOrderConflictError(
        "order_source_stale",
        "The cart changed after the order draft was reviewed.",
      );
    }
    const now = new Date();
    if (new Date(draft.expiresAt) <= now) {
      throw new NpShopOrderConflictError("order_source_stale", "The order draft expired.");
    }
    if (
      (runtime.shippingAdapter &&
        (!draft.deliveryMethod ||
          draft.deliveryMethod.providerId !== runtime.shippingAdapter.id ||
          new Date(draft.deliveryMethod.quoteExpiresAt) <= now)) ||
      (!runtime.shippingAdapter &&
        draft.deliveryMethod !== null &&
        (!npIsShopShippingProviderActive(runtime, draft.deliveryMethod.providerId) ||
          new Date(draft.deliveryMethod.quoteExpiresAt) <= now))
    ) {
      throw new NpShopOrderConflictError(
        "order_source_stale",
        "The selected shipping method expired or its provider configuration changed.",
      );
    }
    if (
      (runtime.taxAdapter &&
        (!draft.taxQuote ||
          draft.taxQuote.providerId !== runtime.taxAdapter.id ||
          new Date(draft.taxQuote.expiresAt) <= now)) ||
      (!runtime.taxAdapter && draft.taxQuote !== null)
    ) {
      throw new NpShopOrderConflictError(
        "order_source_stale",
        "The tax quote expired or its provider configuration changed.",
      );
    }
    const pendingExpiresAt = new Date(
      now.getTime() + npShopOrderLimits.pendingTtlSeconds * 1_000,
    ).toISOString();
    const purgeAt = new Date(
      now.getTime() + npShopOrderLimits.commercialRetentionSeconds * 1_000,
    ).toISOString();
    const inventoryReservationLineKeys = quote.lines
      .filter((line) => line.stockQuantity !== null)
      .map((line) => line.key);
    const order: NpShopStoredOrder = {
      contract: NP_SHOP_ORDER_STORAGE_CONTRACT,
      id: input.idempotencyKey,
      status: "pending-payment",
      revision: 1,
      ownerSegment,
      sourceDraftId: draft.id,
      checkoutIntentId: draft.checkoutIntentId,
      cartRevision: draft.cartRevision,
      cartFingerprint: draft.cartFingerprint,
      currency: draft.currency,
      subtotalMinor: draft.subtotalMinor,
      discountMinor: draft.discountMinor,
      shippingMinor: draft.shippingMinor,
      taxMinor: draft.taxMinor,
      totalMinor: draft.totalMinor,
      totalUnits: draft.totalUnits,
      lines: draft.lines,
      promotions: draft.promotions,
      deliveryMethod: draft.deliveryMethod,
      taxQuote: draft.taxQuote,
      privateDataStatus: "retained",
      inventoryReservationStatus: inventoryReservationLineKeys.length > 0 ? "held" : "not-required",
      inventoryReservationLineKeys,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      pendingExpiresAt,
      paymentProvider: null,
      paymentReference: null,
      paymentEventId: null,
      paymentResolvedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      purgeAt,
    };
    const privateData: NpShopStoredOrderPrivateData = {
      contract: NP_SHOP_ORDER_PRIVATE_CONTRACT,
      orderId: order.id,
      customer: draft.customer,
      shipping: draft.shipping,
      createdAt: now.toISOString(),
      expiresAt: pendingExpiresAt,
    };
    try {
      await npReserveShopPromotions(
        tx,
        siteId,
        ownerSegment,
        order.id,
        order.promotions,
        await listShopPromotions(runtime),
        now,
        purgeAt,
      );
    } catch (error) {
      throw new NpShopOrderConflictError(
        "order_source_stale",
        error instanceof Error ? error.message : "The selected promotion is no longer available.",
      );
    }
    await persistOrder(tx, siteId, order);
    await persistOrderLookup(tx, siteId, {
      contract: "np.shop-order-lookup.v1",
      orderId: order.id,
      ownerSegment,
      purgeAt,
    });
    if (order.inventoryReservationStatus === "held") {
      const trackedLineKeys = new Set(order.inventoryReservationLineKeys);
      await npPersistShopInventoryReservations(
        tx,
        siteId,
        ownerSegment,
        order.id,
        order.lines.filter((line) => trackedLineKeys.has(line.key)),
        order.createdAt,
        order.pendingExpiresAt,
      );
    }
    await persistPrivate(tx, siteId, ownerSegment, privateData);
    await persistMaintenanceMarker(tx, siteId, {
      contract: "np.shop-order-maintenance.v1",
      orderId: order.id,
      ownerSegment,
      dueAt: pendingExpiresAt,
    });
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment: order.ownerSegment,
      kind: "order.created",
      orderRevision: order.revision,
      occurredAt: order.createdAt,
      purgeAt: order.purgeAt,
      email: privateData.customer.email,
    });
    if (!(await npConsumeShopCartForOrder(tx, siteId, owner, draft.cartRevision))) {
      throw new NpShopOrderConflictError(
        "order_source_stale",
        "The cart changed before the order could consume its source snapshot.",
      );
    }
    await tx
      .delete(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          eq(npPluginStorage.key, npShopOrderDraftStorageKey(owner, draft.id)),
        ),
      );
    return { outcome: "projected", order: await projectOrder(tx, siteId, order) } as const;
  });
  return result.outcome === "projected"
    ? result.order
    : projectOrder(getDb(), siteId, result.order);
}

export async function npReAddShopOrderLines(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopCartReAddInput,
): Promise<NpShopCartReAddResult> {
  const order = await npReadShopOrder(owner, input.orderId);
  if (order.status === "pending-payment") {
    throw new NpShopOrderConflictError(
      "order_not_readdable",
      "Cancel or complete the pending order before adding its items to the cart again.",
    );
  }
  return npReAddShopCartLines(runtime, owner, { ...input, lines: order.lines });
}

export async function npReadShopOrder(
  owner: NpShopCartOwner,
  orderId: string,
): Promise<NpShopOrder> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const result = await getDb().transaction(async (tx) => {
    await lockOrderLookup(tx, siteId, orderId);
    const lookup = await readOrderLookupForUpdate(tx, siteId, orderId);
    if (!lookup || lookup.ownerSegment !== ownerSegment) return null;
    await lockOrder(tx, siteId, ownerSegment, orderId);
    let order = await readStoredOrderForUpdate(tx, siteId, ownerSegment, orderId);
    if (!order) return null;
    const now = new Date();
    if (new Date(order.purgeAt) <= now) {
      // Preserve the canonical source -> packing lock order. If a missed privacy
      // pass left a sidecar behind, remove it before purgeOrder locks packing rows.
      if (order.privateDataStatus === "retained") {
        order = await redactStoredOrderPrivate(tx, siteId, order, now);
      }
      await purgeOrder(tx, siteId, order);
      return null;
    }
    let committedPrivacyMutation = false;
    if (order.status === "pending-payment" && new Date(order.pendingExpiresAt) <= now) {
      order = await cancelStoredOrder(tx, siteId, order, "payment-timeout", now);
      committedPrivacyMutation = true;
    } else if (order.status === "paid" && order.privateDataStatus === "retained") {
      const privateData = await readStoredPrivateForExpiry(
        tx,
        siteId,
        order.ownerSegment,
        order.id,
      );
      if (!privateData || new Date(privateData.expiresAt) <= now) {
        order = await redactStoredOrderPrivate(tx, siteId, order, now);
        committedPrivacyMutation = true;
      }
    }
    return committedPrivacyMutation
      ? ({ outcome: "project-after-commit", order } as const)
      : ({ outcome: "projected", order: await projectOrder(tx, siteId, order) } as const);
  });
  if (!result) throw new NpShopOrderNotFoundError();
  return result.outcome === "projected"
    ? result.order
    : projectOrder(getDb(), siteId, result.order);
}

export async function npListShopOrders(owner: NpShopCartOwner): Promise<NpShopOrderList> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `order:${ownerSegment}:%`),
        gt(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopOrderLimits.ownerListSize);
  const orders: NpShopOrder[] = [];
  for (const row of rows) {
    const stored = requireStoredOrderAtKey(row.value, row.expiresAt, row.key);
    try {
      orders.push(await npReadShopOrder(owner, stored.id));
    } catch (error) {
      if (!(error instanceof NpShopOrderNotFoundError)) throw error;
    }
  }
  const [{ currentTotal }] = await db
    .select({ currentTotal: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `order:${ownerSegment}:%`),
        gt(npPluginStorage.expiresAt, now),
      ),
    );
  return { contract: "np.shop-order-list.v1", orders, total: currentTotal };
}

export async function npCancelShopOrder(
  owner: NpShopCartOwner,
  input: NpShopOrderCancelInput,
): Promise<NpShopOrder> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  return getDb().transaction(async (tx) => {
    await npLockShopOrderDraftOwner(tx, siteId, owner);
    await lockOrder(tx, siteId, ownerSegment, input.orderId);
    const current = await readStoredOrderForUpdate(tx, siteId, ownerSegment, input.orderId);
    if (!current) throw new NpShopOrderNotFoundError();
    if (current.status === "cancelled") return projectOrder(tx, siteId, current);
    if (current.status !== "pending-payment") {
      throw new NpShopOrderConflictError(
        "order_not_cancellable",
        "Only a pending-payment order can be cancelled.",
      );
    }
    if (current.revision !== input.expectedRevision) {
      throw new NpShopOrderConflictError(
        "order_revision_conflict",
        "The order changed before cancellation.",
      );
    }
    const cancelled = await cancelStoredOrder(tx, siteId, current, "customer", new Date());
    return projectOrder(tx, siteId, cancelled);
  });
}

export async function npMaintainShopOrders(): Promise<{
  cancelled: number;
  privateRedacted: number;
  exchangeDestinationsCleaned: number;
  purged: number;
  reservationsCleaned: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const pendingRows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
      updatedAt: npPluginStorage.updatedAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-maintenance:%"),
        or(
          isNull(npPluginStorage.expiresAt),
          lte(npPluginStorage.expiresAt, now),
          lte(
            npPluginStorage.updatedAt,
            new Date(now.getTime() - npShopFulfillmentLimits.privateRetentionSeconds * 1_000),
          ),
        ),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopOrderLimits.cleanupBatchSize);
  let cancelled = 0;
  let privateRedacted = 0;
  for (const row of pendingRows) {
    let marker: NpShopOrderMaintenanceMarker;
    try {
      marker = requireMaintenanceMarker(row.value, row.expiresAt);
      if (row.key !== maintenanceStorageKey(marker.ownerSegment, marker.orderId)) {
        throw new NpShopOrderContractError("Invalid Shop order maintenance storage key", [
          "Order maintenance key must match its owner segment and order id.",
        ]);
      }
    } catch (error) {
      if (!(error instanceof NpShopOrderContractError)) throw error;
      const identity = maintenanceIdentityFromKey(row.key);
      if (identity) {
        await db.transaction(async (tx) => {
          await lockOrder(tx, siteId, identity.ownerSegment, identity.orderId);
          await removePrivateAndMaintenance(tx, siteId, identity.ownerSegment, identity.orderId);
        });
      } else {
        const privateKey = row.key.replace(/^order-maintenance:/u, "order-private:");
        await db
          .delete(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              inArray(npPluginStorage.key, [row.key, privateKey]),
            ),
          );
      }
      continue;
    }
    const outcome = await db.transaction(async (tx) => {
      await lockOrder(tx, siteId, marker.ownerSegment, marker.orderId);
      let order: NpShopStoredOrder | null;
      try {
        order = await readStoredOrderForUpdate(tx, siteId, marker.ownerSegment, marker.orderId);
      } catch (error) {
        if (!(error instanceof NpShopOrderContractError)) throw error;
        await removePrivateAndMaintenance(tx, siteId, marker.ownerSegment, marker.orderId);
        return "none" as const;
      }
      if (!order) {
        await removePrivateAndMaintenance(tx, siteId, marker.ownerSegment, marker.orderId);
        return "none" as const;
      }
      if (order.status === "paid" && order.privateDataStatus === "retained") {
        const privateData = await readStoredPrivateForExpiry(
          tx,
          siteId,
          marker.ownerSegment,
          marker.orderId,
          true,
        );
        const retentionBackstopDue =
          row.updatedAt <=
          new Date(now.getTime() - npShopFulfillmentLimits.privateRetentionSeconds * 1_000);
        if (privateData && new Date(privateData.expiresAt) > now && !retentionBackstopDue) {
          await persistMaintenanceMarker(tx, siteId, {
            ...marker,
            dueAt: privateData.expiresAt,
          });
          return "none" as const;
        }
        await redactStoredOrderPrivate(tx, siteId, order, now);
        return "redacted" as const;
      }
      if (order.status !== "pending-payment") {
        await removePrivateAndMaintenance(tx, siteId, marker.ownerSegment, marker.orderId);
        return "none" as const;
      }
      if (new Date(order.pendingExpiresAt) > now) {
        await persistMaintenanceMarker(tx, siteId, {
          ...marker,
          dueAt: order.pendingExpiresAt,
        });
        return "none" as const;
      }
      await cancelStoredOrder(tx, siteId, order, "payment-timeout", now);
      return "cancelled" as const;
    });
    if (outcome === "cancelled") cancelled += 1;
    if (outcome === "redacted") privateRedacted += 1;
  }

  // The private sidecar is the retention authority. A missing, stale, or
  // malformed maintenance marker must never extend its deadline, so this lane
  // independently advances the oldest expired sidecars under the canonical
  // order lock. It has its own quota and cannot be starved by marker backlog.
  const expiredPrivateRows = await db
    .select({
      key: npPluginStorage.key,
      expiresAt: npPluginStorage.expiresAt,
      updatedAt: npPluginStorage.updatedAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-private:%"),
        or(
          isNull(npPluginStorage.expiresAt),
          lte(npPluginStorage.expiresAt, now),
          lte(
            npPluginStorage.updatedAt,
            new Date(now.getTime() - npShopFulfillmentLimits.privateRetentionSeconds * 1_000),
          ),
        ),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopOrderLimits.cleanupBatchSize);
  for (const row of expiredPrivateRows) {
    const identity = privateIdentityFromKey(row.key);
    if (!identity) {
      await db
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, row.key),
            or(
              isNull(npPluginStorage.expiresAt),
              lte(npPluginStorage.expiresAt, now),
              lte(
                npPluginStorage.updatedAt,
                new Date(now.getTime() - npShopFulfillmentLimits.privateRetentionSeconds * 1_000),
              ),
            ),
          ),
        );
      continue;
    }
    const outcome = await db.transaction(async (tx) => {
      await lockOrder(tx, siteId, identity.ownerSegment, identity.orderId);
      const privateData = await readStoredPrivateForExpiry(
        tx,
        siteId,
        identity.ownerSegment,
        identity.orderId,
        true,
      );
      const retentionBackstopDue =
        row.updatedAt <=
        new Date(now.getTime() - npShopFulfillmentLimits.privateRetentionSeconds * 1_000);
      if (privateData && new Date(privateData.expiresAt) > now && !retentionBackstopDue) {
        return "none" as const;
      }
      let order: NpShopStoredOrder | null;
      try {
        order = await readStoredOrderForUpdate(tx, siteId, identity.ownerSegment, identity.orderId);
      } catch (error) {
        if (!(error instanceof NpShopOrderContractError)) throw error;
        await removePrivateAndMaintenance(tx, siteId, identity.ownerSegment, identity.orderId);
        return "none" as const;
      }
      if (!order) {
        await removePrivateAndMaintenance(tx, siteId, identity.ownerSegment, identity.orderId);
        return "none" as const;
      }
      if (order.status === "paid" && order.privateDataStatus === "retained") {
        await redactStoredOrderPrivate(tx, siteId, order, now);
        return "redacted" as const;
      }
      if (order.status === "pending-payment") {
        await cancelStoredOrder(tx, siteId, order, "payment-timeout", now);
        return "cancelled" as const;
      }
      await removePrivateAndMaintenance(tx, siteId, identity.ownerSegment, identity.orderId);
      return "none" as const;
    });
    if (outcome === "cancelled") cancelled += 1;
    if (outcome === "redacted") privateRedacted += 1;
  }
  const exchangeDestinationRows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange-destination-private:%"),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopOrderLimits.cleanupBatchSize);
  let exchangeDestinationsCleaned = 0;
  for (const row of exchangeDestinationRows) {
    const deleted = await db
      .delete(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          eq(npPluginStorage.key, row.key),
          lte(npPluginStorage.expiresAt, now),
        ),
      )
      .returning({ key: npPluginStorage.key });
    exchangeDestinationsCleaned += deleted.length;
  }

  const packingPurgeQuota = Math.ceil(npShopOrderLimits.cleanupBatchSize / 2);
  const terminalPackingRows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
      updatedAt: npPluginStorage.updatedAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "packing-work:%"),
        lte(npPluginStorage.expiresAt, now),
        sql`${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT}`,
        sql`${npPluginStorage.value}->>'status' in ('cancelled', 'consumed')`,
      ),
    )
    .orderBy(asc(npPluginStorage.updatedAt), asc(npPluginStorage.key))
    .limit(npShopOrderLimits.cleanupBatchSize);
  let purged = 0;
  const purgeTerminalPackingRows = async (
    selectedRows: typeof terminalPackingRows,
  ): Promise<void> => {
    for (const row of selectedRows) {
      let removed = false;
      try {
        const work = npRequireStoredShopPackingWorkAtKey(row.value, row.expiresAt, row.key);
        removed = await db.transaction(async (tx) => {
          await lockOrderLookup(tx, siteId, work.orderId);
          const lookup = await readOrderLookupForUpdate(tx, siteId, work.orderId);
          if (!lookup) return false;
          await lockOrder(tx, siteId, lookup.ownerSegment, work.orderId);
          const order = await readStoredOrderForUpdate(
            tx,
            siteId,
            lookup.ownerSegment,
            work.orderId,
          );
          if (!order || new Date(order.purgeAt) > now) return false;
          return purgeOrder(tx, siteId, order);
        });
      } catch {
        // A malformed terminal-looking row is retained for Admin diagnosis, but
        // cannot monopolize every future bounded cleanup batch.
      }
      if (removed) purged += 1;
      else await rotateShopStorageMaintenanceCursor(siteId, row.key, row.updatedAt);
    }
  };
  const primaryTerminalPackingRows = terminalPackingRows.slice(0, packingPurgeQuota);
  await purgeTerminalPackingRows(primaryTerminalPackingRows);

  const remainingPurgeCapacity = Math.max(
    0,
    npShopOrderLimits.cleanupBatchSize - primaryTerminalPackingRows.length,
  );
  let ordinaryPurgeRowsScanned = 0;
  if (remainingPurgeCapacity > 0) {
    const packingWorkRows = alias(npPluginStorage, "packing_work_retention");
    const purgeRows = await db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
        updatedAt: npPluginStorage.updatedAt,
      })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          like(npPluginStorage.key, "order:%"),
          lte(npPluginStorage.expiresAt, now),
          notExists(
            db
              .select({ key: packingWorkRows.key })
              .from(packingWorkRows)
              .where(
                and(
                  eq(packingWorkRows.pluginId, NP_SHOP_PLUGIN_ID),
                  eq(packingWorkRows.siteId, siteId),
                  sql`${packingWorkRows.key} in ('packing-work:outbound:' || (${npPluginStorage.value}->>'id'), 'packing-work:replacement:' || (${npPluginStorage.value}->>'id'))`,
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(npPluginStorage.updatedAt), asc(npPluginStorage.key))
      .limit(remainingPurgeCapacity);
    ordinaryPurgeRowsScanned = purgeRows.length;
    for (const row of purgeRows) {
      let removed = false;
      try {
        const order = requireStoredOrderAtKey(row.value, row.expiresAt, row.key);
        removed = await db.transaction(async (tx) => {
          await lockOrderLookup(tx, siteId, order.id);
          const lookup = await readOrderLookupForUpdate(tx, siteId, order.id);
          if (!lookup || lookup.ownerSegment !== order.ownerSegment) return false;
          await lockOrder(tx, siteId, order.ownerSegment, order.id);
          const current = await readStoredOrderForUpdate(tx, siteId, order.ownerSegment, order.id);
          if (!current || new Date(current.purgeAt) > now) return false;
          return purgeOrder(tx, siteId, current);
        });
      } catch {
        // Preserve malformed commercial state for diagnosis while rotating its
        // storage cursor so later valid orders can still make progress.
      }
      if (removed) purged += 1;
      else await rotateShopStorageMaintenanceCursor(siteId, row.key, row.updatedAt);
    }
  }
  const terminalBackfillCapacity = Math.max(
    0,
    npShopOrderLimits.cleanupBatchSize -
      primaryTerminalPackingRows.length -
      ordinaryPurgeRowsScanned,
  );
  if (terminalBackfillCapacity > 0) {
    await purgeTerminalPackingRows(
      terminalPackingRows.slice(
        primaryTerminalPackingRows.length,
        primaryTerminalPackingRows.length + terminalBackfillCapacity,
      ),
    );
  }
  const reservationsCleaned = await npCleanupExpiredShopInventoryReservations();
  return {
    cancelled,
    privateRedacted,
    exchangeDestinationsCleaned,
    purged,
    reservationsCleaned,
  };
}

export async function npCountShopOrders(): Promise<{
  total: number;
  pending: number;
  paid: number;
  refunded: number;
  paymentFailed: number;
  cancelled: number;
  due: number;
  invalidSample: number;
  invalidMetadata: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_ORDER_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'pending-payment')::int`,
      paid: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_ORDER_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'paid')::int`,
      refunded: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_ORDER_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'refunded')::int`,
      paymentFailed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_ORDER_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'payment-failed')::int`,
      cancelled: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_ORDER_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'cancelled')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order:%"),
      ),
    );
  const [dueCounts] = await db
    .select({ due: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-maintenance:%"),
        lte(npPluginStorage.expiresAt, new Date()),
      ),
    );
  const [privateCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      invalid: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' is distinct from ${NP_SHOP_ORDER_PRIVATE_CONTRACT} and ${npPluginStorage.value}->>'contract' is distinct from ${NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT})::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-private:%"),
      ),
    );
  const [retainedCounts] = await db
    .select({
      total: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'privateDataStatus' = 'retained')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order:%"),
      ),
    );
  const [markerCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      invalid: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' is distinct from 'np.shop-order-maintenance.v1')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-maintenance:%"),
      ),
    );
  const [lookupCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      invalid: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' is distinct from 'np.shop-order-lookup.v1')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-lookup:%"),
      ),
    );
  const lookupSample = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-lookup:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopOrderLimits.diagnosticSampleSize);
  const validLookups: NpShopOrderLookup[] = [];
  let invalidLookupSample = 0;
  for (const row of lookupSample) {
    try {
      validLookups.push(requireOrderLookup(row.value, row.expiresAt, row.key));
    } catch {
      invalidLookupSample += 1;
    }
  }
  const lookupOrderKeys = validLookups.map((lookup) =>
    orderStorageKey(lookup.ownerSegment, lookup.orderId),
  );
  const lookupOrderRows =
    lookupOrderKeys.length === 0
      ? []
      : await db
          .select({ key: npPluginStorage.key })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              inArray(npPluginStorage.key, lookupOrderKeys),
            ),
          );
  const lookupOrderKeySet = new Set(lookupOrderRows.map((row) => row.key));
  const orphanLookupSample = validLookups.filter(
    (lookup) => !lookupOrderKeySet.has(orderStorageKey(lookup.ownerSegment, lookup.orderId)),
  ).length;
  const sample = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopOrderLimits.diagnosticSampleSize);
  let invalidSample = 0;
  for (const row of sample) {
    try {
      requireStoredOrderAtKey(row.value, row.expiresAt, row.key);
    } catch {
      invalidSample += 1;
    }
  }
  const invalidMetadata =
    counts.total -
    counts.pending -
    counts.paid -
    counts.refunded -
    counts.paymentFailed -
    counts.cancelled +
    privateCounts.invalid +
    markerCounts.invalid +
    lookupCounts.invalid +
    invalidLookupSample +
    orphanLookupSample +
    Math.abs(privateCounts.total - retainedCounts.total) +
    Math.abs(markerCounts.total - retainedCounts.total) +
    Math.abs(lookupCounts.total - counts.total);
  return { ...counts, due: dueCounts.due, invalidSample, invalidMetadata };
}

export async function npListRecentShopOrders(): Promise<{
  rows: NpShopAdminOrderRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopOrderLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order:%"),
      ),
    );
  return {
    rows: await Promise.all(
      rows.map(async (row) => {
        const order = requireStoredOrderAtKey(row.value, row.expiresAt, row.key);
        const fulfillment = await readStoredFulfillment(db, siteId, order.id);
        const refund = await readStoredRefund(db, siteId, order.id);
        const returnRequest = await readStoredReturn(db, siteId, order.id);
        const carrierBooking = await readStoredCarrierBooking(db, siteId, order.id);
        const parcelSnapshot = await readStoredFulfillmentParcels(db, siteId, order.id);
        const packingWork = await readAdminPackingWork(db, siteId, "outbound", order.id);
        const paymentDisputeSafe = await npShopPaymentDisputeAllowsAdminActions(db, siteId, order);
        return {
          id: order.id,
          revision: order.revision,
          status: order.status,
          total: `${order.currency} ${order.totalMinor.toString()}`,
          units: order.totalUnits,
          privateData: order.privateDataStatus,
          inventory: order.inventoryReservationStatus,
          fulfillment: fulfillment?.status ?? "not-created",
          fulfillmentRevision: fulfillment?.revision ?? null,
          refund: refund?.status ?? "not-requested",
          refundEligible:
            order.status === "paid" &&
            paymentDisputeSafe &&
            packingWork !== "invalid" &&
            (refund !== null ||
              ((carrierBooking === null || carrierBooking.status === "completed") &&
                packingWorkAllowsFullRefund(
                  packingWork,
                  order,
                  fulfillment,
                  carrierBooking,
                  parcelSnapshot,
                ))),
          returnRequest: returnRequest?.status ?? "not-requested",
          createdAt: order.createdAt,
        };
      }),
    ),
    total,
  };
}

export async function npCountShopRefunds(): Promise<{
  total: number;
  pending: number;
  providerConfirmed: number;
  refunded: number;
  manualReview: number;
  manualInventory: number;
  invalidSample: number;
  orphanSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_REFUND_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'pending')::int`,
      providerConfirmed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_REFUND_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'provider-confirmed')::int`,
      refunded: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_REFUND_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'refunded')::int`,
      manualReview: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_REFUND_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'manual-review')::int`,
      manualInventory: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_REFUND_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'inventoryOutcome' = 'manual-required')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "refund:%"),
      ),
    );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "refund:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopRefundLimits.diagnosticSampleSize);
  let invalidSample = 0;
  let orphanSample = 0;
  const refunds: NpShopStoredRefund[] = [];
  for (const row of rows) {
    try {
      refunds.push(requireStoredRefundAtKey(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  const lookupRows =
    refunds.length === 0
      ? []
      : await db
          .select({
            key: npPluginStorage.key,
            value: npPluginStorage.value,
            expiresAt: npPluginStorage.expiresAt,
          })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              inArray(
                npPluginStorage.key,
                refunds.map((refund) => lookupStorageKey(refund.orderId)),
              ),
            ),
          );
  const lookupRowsByKey = new Map(lookupRows.map((row) => [row.key, row]));
  const resolved: Array<{ refund: NpShopStoredRefund; lookup: NpShopOrderLookup }> = [];
  for (const refund of refunds) {
    const lookupRow = lookupRowsByKey.get(lookupStorageKey(refund.orderId));
    if (!lookupRow) {
      orphanSample += 1;
      continue;
    }
    try {
      resolved.push({
        refund,
        lookup: requireOrderLookup(lookupRow.value, lookupRow.expiresAt, lookupRow.key),
      });
    } catch {
      invalidSample += 1;
    }
  }
  const orderRows =
    resolved.length === 0
      ? []
      : await db
          .select({
            key: npPluginStorage.key,
            value: npPluginStorage.value,
            expiresAt: npPluginStorage.expiresAt,
          })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              inArray(
                npPluginStorage.key,
                resolved.map(({ refund, lookup }) =>
                  orderStorageKey(lookup.ownerSegment, refund.orderId),
                ),
              ),
            ),
          );
  const orderRowsByKey = new Map(orderRows.map((row) => [row.key, row]));
  for (const { refund, lookup } of resolved) {
    const orderRow = orderRowsByKey.get(orderStorageKey(lookup.ownerSegment, refund.orderId));
    if (!orderRow) {
      orphanSample += 1;
      continue;
    }
    try {
      const order = requireStoredOrderAtKey(orderRow.value, orderRow.expiresAt, orderRow.key);
      if (!refundMatchesOrder(refund, order)) {
        invalidSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  return { ...counts, invalidSample, orphanSample };
}

export async function npListRecentShopRefunds(): Promise<{
  rows: NpShopAdminRefundRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "refund:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopRefundLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "refund:%"),
      ),
    );
  return {
    rows: rows.map((row) => {
      const refund = requireStoredRefundAtKey(row.value, row.expiresAt, row.key);
      return {
        id: refund.orderId,
        refundId: refund.id,
        revision: refund.orderRevision,
        orderId: refund.orderId,
        provider: refund.providerId,
        status: refund.status,
        total: `${refund.currency} ${refund.amountMinor.toString()}`,
        inventory: refund.inventoryOutcome,
        fulfillment: refund.fulfillmentOutcome,
        providerError: refund.providerErrorCode ?? "—",
        updatedAt: refund.updatedAt,
      };
    }),
    total,
  };
}

async function recordRequiredShopFulfillmentAudit(
  tx: NpShopTransaction,
  siteId: string,
  userId: string,
  action: string,
  orderId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(npAuditEvents).values({
    actorKind: "staff",
    actorUserId: userId,
    actorMemberId: null,
    action,
    targetType: "shop-order",
    targetId: orderId,
    payload,
    siteId,
  });
}

export async function npReadShopCarrierShippingLabel(
  runtime: NpShopRuntime,
  input: NpShopCarrierLabelReadInput,
  staffUserId: string,
): Promise<NpShopCarrierLabelResult> {
  const adapter = runtime.carrierLabelAdapter;
  if (!adapter) {
    throw new NpShopCarrierConflictError(
      "carrier_label_not_available",
      "The configured carrier does not expose shipping-label retrieval.",
    );
  }
  const siteId = await requireSiteId();
  const requestedAt = new Date();
  requestedAt.setMilliseconds(0);
  const prepared = await getDb().transaction(async (tx) => {
    const source = await npReadShopCarrierLabelSource(tx, siteId, input, adapter.id, true);
    const acquisition = runtime.carrierLabelAcquisitionAdapter
      ? await npReadStoredShopCarrierLabelAcquisition(tx, siteId, source.shipmentId, true)
      : null;
    if (
      runtime.carrierLabelAcquisitionAdapter &&
      (!acquisition ||
        acquisition.status !== "completed" ||
        !npShopCarrierLabelAcquisitionMatchesSource(acquisition, source))
    ) {
      throw new NpShopCarrierConflictError(
        "carrier_label_not_available",
        "A completed durable label acquisition is required before label retrieval.",
      );
    }
    const prepared = npRequireShopCarrierLabelRequest({
      contract: NP_SHOP_CARRIER_LABEL_REQUEST_CONTRACT,
      shipmentId: source.shipmentId,
      orderId: source.orderId,
      bookingReference: source.bookingReference,
      carrier: source.carrier,
      trackingNumber: source.trackingNumber,
      requestedAt: requestedAt.toISOString(),
    });
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      source.target === "replacement"
        ? "shop.exchange.carrier.label.read"
        : "shop.carrier.label.read",
      source.orderId,
      {
        ...(source.exchangeId ? { exchangeId: source.exchangeId } : {}),
        shipmentId: source.shipmentId,
        providerId: source.providerId,
      },
    );
    return { request: prepared, source, acquisition };
  });
  const { request, source, acquisition } = prepared;

  const result = npRequireShopCarrierLabelResult(await adapter.readShippingLabel(request));
  if (result.shipmentId !== request.shipmentId || result.orderId !== request.orderId) {
    throw new NpShopCarrierConflictError(
      "carrier_result_mismatch",
      "The carrier label result does not match the requested shipment.",
    );
  }
  const retrievedAt = new Date(result.retrievedAt).getTime();
  if (
    retrievedAt < requestedAt.getTime() - npShopCarrierLimits.futureToleranceSeconds * 1000 ||
    retrievedAt > Date.now() + npShopCarrierLimits.futureToleranceSeconds * 1000
  ) {
    throw new NpShopCarrierContractError("Invalid Shop carrier label result", [
      "carrier label result.retrievedAt must describe this retrieval attempt.",
    ]);
  }
  await getDb().transaction(async (tx) => {
    const current = await npReadShopCarrierLabelSource(tx, siteId, input, adapter.id, true);
    if (
      current.target !== source.target ||
      current.exchangeId !== source.exchangeId ||
      current.shipmentId !== request.shipmentId ||
      current.bookingReference !== request.bookingReference ||
      current.carrier !== request.carrier ||
      current.trackingNumber !== request.trackingNumber
    ) {
      throw new NpShopCarrierConflictError(
        "carrier_label_not_available",
        "The carrier booking changed before its label could be delivered.",
      );
    }
    if (acquisition) {
      const currentAcquisition = await npReadStoredShopCarrierLabelAcquisition(
        tx,
        siteId,
        current.shipmentId,
        true,
      );
      if (
        !currentAcquisition ||
        currentAcquisition.id !== acquisition.id ||
        currentAcquisition.status !== "completed" ||
        currentAcquisition.revision !== acquisition.revision ||
        currentAcquisition.generation !== acquisition.generation ||
        currentAcquisition.labelReference !== acquisition.labelReference ||
        !npShopCarrierLabelAcquisitionMatchesSource(currentAcquisition, current)
      ) {
        throw new NpShopCarrierConflictError(
          "carrier_label_not_available",
          "The current label generation changed before its bytes could be delivered.",
        );
      }
    }
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      current.target === "replacement"
        ? "shop.exchange.carrier.label.deliver"
        : "shop.carrier.label.deliver",
      current.orderId,
      {
        ...(current.exchangeId ? { exchangeId: current.exchangeId } : {}),
        shipmentId: current.shipmentId,
        providerId: current.providerId,
        format: result.format,
        bytes: result.content.byteLength,
      },
    );
  });
  return result;
}

export async function npRefundShopOrder(
  runtime: NpShopRuntime,
  input: NpShopRefundActionInput,
  staffUserId: string,
): Promise<{ refund: NpShopRefund; duplicate: boolean }> {
  const siteId = await requireSiteId();
  const prepared = await getDb().transaction(async (tx) => {
    await lockOrderLookup(tx, siteId, input.orderId);
    const lookup = await readOrderLookupForUpdate(tx, siteId, input.orderId);
    if (!lookup) {
      throw new NpShopRefundConflictError(
        "refund_order_not_found",
        "The Shop order does not exist in this site.",
      );
    }
    await lockOrder(tx, siteId, lookup.ownerSegment, input.orderId);
    const order = await readStoredOrderForUpdate(tx, siteId, lookup.ownerSegment, input.orderId);
    if (!order) {
      throw new NpShopRefundConflictError(
        "refund_order_not_found",
        "The Shop order disappeared before the refund could be prepared.",
      );
    }
    const existing = await readStoredRefund(tx, siteId, input.orderId, true);
    if (existing?.status === "refunded")
      return { order, refund: existing, complete: true as const };
    const paymentAdjustment = await npReadStoredShopPaymentAdjustment(
      tx,
      siteId,
      input.orderId,
      true,
    );
    if (paymentAdjustment?.status === "manual-review") {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "A provider-initiated payment adjustment requires reconciliation before a refund can start or resume.",
      );
    }
    if (await paymentDisputeRequiresReviewForOrder(tx, siteId, order, true)) {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "A payment dispute requires provider reconciliation before a refund can start or resume.",
      );
    }
    if (existing?.status === "manual-review") {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "The provider rejected this stable refund attempt; manual review is required.",
      );
    }
    if (existing) {
      if (
        existing.status === "pending" &&
        (!runtime.paymentRefundAdapter || existing.providerId !== runtime.paymentRefundAdapter.id)
      ) {
        throw new NpShopRefundConflictError(
          "refund_provider_mismatch",
          "The pending refund requires its original refund-capable payment provider.",
        );
      }
      return { order, refund: existing, complete: false as const };
    }
    if (await npHasShopPartialRefund(tx, siteId, input.orderId)) {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "A return-linked partial refund already owns part of this payment; a full provider cancellation is no longer safe.",
      );
    }
    if (await readStoredExchange(tx, siteId, input.orderId, true)) {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "A same-item exchange already consumed replacement inventory; a full refund is no longer safe.",
      );
    }
    const carrierBooking = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
    if (carrierBooking && carrierBooking.status !== "completed") {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "The carrier shipment must be reconciled before starting a full refund.",
      );
    }
    const fulfillment = await readStoredFulfillment(tx, siteId, input.orderId, true);
    const parcelSnapshot = await readStoredFulfillmentParcels(tx, siteId, input.orderId, true);
    const packingWork = await npReadStoredShopPackingWork(
      tx,
      siteId,
      "outbound",
      input.orderId,
      true,
    );
    if (
      !packingWorkAllowsFullRefund(packingWork, order, fulfillment, carrierBooking, parcelSnapshot)
    ) {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "Packing work must be cancelled before an unshipped full refund can start.",
      );
    }
    const adapter = runtime.paymentRefundAdapter;
    if (!adapter) {
      throw new NpShopRefundConflictError(
        "refund_not_supported",
        "The configured Shop payment provider does not support full refunds.",
      );
    }
    if (order.revision !== input.expectedRevision) {
      throw new NpShopRefundConflictError(
        "refund_order_revision_conflict",
        "The order changed before the refund was requested.",
      );
    }
    if (order.status !== "paid" || !order.paymentProvider || !order.paymentReference) {
      throw new NpShopRefundConflictError(
        "refund_order_not_paid",
        "Only one currently paid Shop order can be fully refunded.",
      );
    }
    if (new Date(order.purgeAt) <= new Date()) {
      throw new NpShopRefundConflictError(
        "refund_order_expired",
        "The Shop order is past its commercial retention window and cannot start a refund.",
      );
    }
    if (order.paymentProvider !== adapter.id) {
      throw new NpShopRefundConflictError(
        "refund_provider_mismatch",
        "The paid order belongs to a different configured payment provider.",
      );
    }
    const requestedAt = new Date();
    requestedAt.setMilliseconds(0);
    const now = requestedAt.toISOString();
    const refund: NpShopStoredRefund = {
      contract: NP_SHOP_REFUND_STORAGE_CONTRACT,
      id: randomUUID(),
      orderId: order.id,
      providerId: adapter.id,
      status: "pending",
      orderRevision: order.revision,
      paymentReference: order.paymentReference,
      refundReference: null,
      currency: order.currency,
      amountMinor: order.totalMinor,
      reason: input.reason,
      inventoryOutcome: "pending",
      fulfillmentOutcome: "pending",
      providerErrorCode: null,
      requestedAt: now,
      updatedAt: now,
      refundedAt: null,
      purgeAt: order.purgeAt,
    };
    await persistRefund(tx, siteId, refund);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.refund.request",
      order.id,
      { refundId: refund.id, orderRevision: order.revision, providerId: adapter.id },
    );
    return { order, refund, complete: false as const };
  });
  if (prepared.complete) {
    return { refund: npProjectShopRefund(prepared.refund), duplicate: true };
  }

  let providerResult: NpShopPaymentRefundResult;
  if (prepared.refund.status === "provider-confirmed") {
    if (!prepared.refund.refundReference || !prepared.refund.refundedAt) {
      throw new NpShopOrderContractError("Confirmed Shop refund metadata is missing", [
        "A provider-confirmed refund requires its exact reference and timestamp.",
      ]);
    }
    providerResult = {
      contract: NP_SHOP_REFUND_RESULT_CONTRACT,
      refundId: prepared.refund.id,
      orderId: prepared.refund.orderId,
      paymentReference: prepared.refund.paymentReference,
      refundReference: prepared.refund.refundReference,
      currency: prepared.refund.currency,
      amountMinor: prepared.refund.amountMinor,
      refundedAt: prepared.refund.refundedAt,
    };
  } else {
    const adapter = runtime.paymentRefundAdapter;
    if (!adapter || adapter.id !== prepared.refund.providerId) {
      throw new NpShopRefundConflictError(
        "refund_provider_mismatch",
        "The pending refund requires its original refund-capable payment provider.",
      );
    }
    try {
      providerResult = npRequireShopPaymentRefundResult(
        await adapter.refundPayment({
          refundId: prepared.refund.id,
          orderId: prepared.order.id,
          paymentReference: prepared.refund.paymentReference,
          currency: prepared.refund.currency,
          amountMinor: prepared.refund.amountMinor,
          reason: prepared.refund.reason,
          requestedAt: prepared.refund.requestedAt,
        }),
      );
    } catch (error) {
      if (error instanceof NpShopPaymentProviderError && !error.retryable) {
        await getDb().transaction(async (tx) => {
          const current = await readStoredRefund(tx, siteId, input.orderId, true);
          if (!current || current.id !== prepared.refund.id || current.status !== "pending") return;
          const code = error.code.trim().slice(0, npShopRefundLimits.providerErrorCodeLength);
          await persistRefund(tx, siteId, {
            ...current,
            status: "manual-review",
            providerErrorCode: code || "provider-error",
            updatedAt: new Date().toISOString(),
          });
        });
      }
      throw error;
    }
  }
  if (
    providerResult.refundId !== prepared.refund.id ||
    providerResult.orderId !== prepared.order.id ||
    providerResult.paymentReference !== prepared.refund.paymentReference ||
    providerResult.currency !== prepared.refund.currency ||
    providerResult.amountMinor !== prepared.refund.amountMinor ||
    new Date(providerResult.refundedAt) < new Date(prepared.refund.requestedAt) ||
    new Date(providerResult.refundedAt).getTime() >
      Date.now() + npShopPaymentLimits.futureToleranceSeconds * 1_000
  ) {
    await getDb().transaction(async (tx) => {
      const current = await readStoredRefund(tx, siteId, input.orderId, true);
      if (!current || current.id !== prepared.refund.id || current.status !== "pending") return;
      await persistRefund(tx, siteId, {
        ...current,
        status: "manual-review",
        providerErrorCode: "provider-result-mismatch",
        updatedAt: new Date().toISOString(),
      });
    });
    throw new NpShopRefundConflictError(
      "refund_provider_mismatch",
      "The provider refund result does not match the durable Shop refund intent.",
    );
  }

  const confirmed = await getDb().transaction(async (tx) => {
    const current = await readStoredRefund(tx, siteId, input.orderId, true);
    if (!current || current.id !== prepared.refund.id) {
      throw new NpShopRefundConflictError(
        "refund_order_not_found",
        "The durable refund disappeared after provider confirmation.",
      );
    }
    if (current.status === "refunded") return { refund: current, complete: true as const };
    if (current.status === "provider-confirmed") {
      if (
        current.refundReference !== providerResult.refundReference ||
        current.refundedAt !== providerResult.refundedAt
      ) {
        throw new NpShopRefundConflictError(
          "refund_provider_mismatch",
          "The provider returned conflicting results for one refund idempotency key.",
        );
      }
      return { refund: current, complete: false as const };
    }
    if (current.status !== "pending") {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "The durable refund entered manual review before provider confirmation was stored.",
      );
    }
    const next: NpShopStoredRefund = {
      ...current,
      status: "provider-confirmed",
      refundReference: providerResult.refundReference,
      refundedAt: providerResult.refundedAt,
      updatedAt: new Date(
        Math.max(Date.now(), new Date(providerResult.refundedAt).getTime()),
      ).toISOString(),
    };
    await persistRefund(tx, siteId, next);
    return { refund: next, complete: false as const };
  });
  if (confirmed.complete) {
    return { refund: npProjectShopRefund(confirmed.refund), duplicate: true };
  }

  return getDb().transaction(async (tx) => {
    await lockOrderLookup(tx, siteId, input.orderId);
    const lookup = await readOrderLookupForUpdate(tx, siteId, input.orderId);
    if (!lookup) {
      throw new NpShopRefundConflictError(
        "refund_order_not_found",
        "The refunded Shop order lookup is missing; manual reconciliation is required.",
      );
    }
    await lockOrder(tx, siteId, lookup.ownerSegment, input.orderId);
    const currentRefund = await readStoredRefund(tx, siteId, input.orderId, true);
    const order = await readStoredOrderForUpdate(tx, siteId, lookup.ownerSegment, input.orderId);
    if (!currentRefund || currentRefund.id !== prepared.refund.id || !order) {
      throw new NpShopRefundConflictError(
        "refund_order_not_found",
        "The durable refund or order is missing; manual reconciliation is required.",
      );
    }
    if (currentRefund.status === "refunded") {
      return { refund: npProjectShopRefund(currentRefund), duplicate: true };
    }
    if (
      currentRefund.status !== "provider-confirmed" ||
      !refundMatchesOrder(currentRefund, order)
    ) {
      throw new NpShopRefundConflictError(
        "refund_order_revision_conflict",
        "The provider refunded the payment but the local order changed; manual reconciliation is required.",
      );
    }
    if (await paymentDisputeRequiresReviewForOrder(tx, siteId, order, true)) {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "The provider refund is confirmed, but a payment dispute must be reconciled before local compensation can resume.",
      );
    }
    const carrierBooking = await readStoredCarrierBooking(tx, siteId, order.id, true);
    const fulfillment = await readStoredFulfillment(tx, siteId, order.id, true);
    const parcelSnapshot = await readStoredFulfillmentParcels(tx, siteId, order.id, true);
    if (!fulfillment || !fulfillmentMatchesOrder(fulfillment, order)) {
      throw new NpShopOrderContractError("Refund fulfillment is invalid", [
        "A refundable paid order must have one exact fulfillment.",
      ]);
    }
    const packingWork = await npReadStoredShopPackingWork(tx, siteId, "outbound", order.id, true);
    if (
      !packingWorkAllowsFullRefund(packingWork, order, fulfillment, carrierBooking, parcelSnapshot)
    ) {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "The provider refunded the payment, but packing work changed before local compensation; reconcile it before resuming the refund.",
      );
    }
    const shipped = fulfillment.status === "shipped";
    let inventoryOutcome: NpShopStoredRefund["inventoryOutcome"] = "not-required";
    if (shipped) {
      inventoryOutcome = "not-applicable-shipped";
    } else if (order.inventoryReservationStatus === "consumed") {
      await npLockShopInventoryProducts(
        tx,
        siteId,
        order.lines.map((line) => line.productId),
      );
      const reservedLineKeys = new Set(order.inventoryReservationLineKeys);
      inventoryOutcome = (await npRestoreShopOrderInventory(
        tx,
        siteId,
        runtime,
        order.lines.filter((line) => reservedLineKeys.has(line.key)),
      ))
        ? "restocked"
        : "manual-required";
    }
    const now = new Date(
      Math.max(Date.now(), new Date(currentRefund.refundedAt ?? 0).getTime()),
    ).toISOString();
    if (!shipped) {
      await persistFulfillment(tx, siteId, {
        ...fulfillment,
        status: "cancelled",
        revision: fulfillment.revision + 1,
        privateDataStatus: "redacted",
        operatorNote: fulfillment.operatorNote,
        updatedAt: now,
      });
    }
    const refundedOrder = {
      ...order,
      status: "refunded",
      revision: order.revision + 1,
      privateDataStatus: "redacted",
      updatedAt: now,
    } satisfies NpShopStoredOrder;
    await persistOrder(tx, siteId, refundedOrder);
    await npStageShopOrderNotification(tx, siteId, {
      orderId: refundedOrder.id,
      ownerSegment: refundedOrder.ownerSegment,
      kind: "refund.completed",
      orderRevision: refundedOrder.revision,
      occurredAt: now,
      purgeAt: refundedOrder.purgeAt,
      email: null,
    });
    await removePrivateAndMaintenance(tx, siteId, order.ownerSegment, order.id);
    const refunded: NpShopStoredRefund = {
      ...currentRefund,
      status: "refunded",
      orderRevision: refundedOrder.revision,
      refundReference: currentRefund.refundReference,
      inventoryOutcome,
      fulfillmentOutcome: shipped ? "shipped-retained" : "cancelled",
      providerErrorCode: null,
      updatedAt: now,
      refundedAt: currentRefund.refundedAt,
    };
    await persistRefund(tx, siteId, refunded);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.refund.complete",
      order.id,
      {
        refundId: refunded.id,
        orderRevision: refunded.orderRevision,
        inventoryOutcome,
        fulfillmentOutcome: refunded.fulfillmentOutcome,
      },
    );
    return { refund: npProjectShopRefund(refunded), duplicate: false };
  });
}

async function readFulfillmentForAction(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<{ fulfillment: NpShopStoredFulfillment; order: NpShopStoredOrder }> {
  const candidate = await readStoredFulfillment(tx, siteId, orderId);
  if (!candidate) {
    throw new NpShopFulfillmentConflictError(
      "fulfillment_not_found",
      "No fulfillment exists for this paid order.",
    );
  }
  await lockOrder(tx, siteId, candidate.ownerSegment, orderId);
  const refund = await readStoredRefund(tx, siteId, orderId, true);
  if (refund && refund.status !== "refunded") {
    throw new NpShopFulfillmentConflictError(
      "fulfillment_terminal",
      "Fulfillment cannot change while a full refund requires provider or operator reconciliation.",
    );
  }
  const paymentAdjustment = await npReadStoredShopPaymentAdjustment(tx, siteId, orderId, true);
  if (paymentAdjustment?.status === "manual-review") {
    throw new NpShopFulfillmentConflictError(
      "fulfillment_terminal",
      "Fulfillment cannot change while a provider-initiated payment adjustment requires reconciliation.",
    );
  }
  const locked = await readStoredFulfillment(tx, siteId, orderId, true);
  if (!locked) {
    throw new NpShopFulfillmentConflictError(
      "fulfillment_not_found",
      "The fulfillment disappeared before it could be updated.",
    );
  }
  const order = await readStoredOrderForUpdate(tx, siteId, locked.ownerSegment, locked.orderId);
  if (!order || !fulfillmentMatchesOrder(locked, order)) {
    throw new NpShopOrderContractError("Fulfillment order is invalid", [
      "A fulfillment must match one paid order and its payment, retention, and private-data state.",
    ]);
  }
  if (await paymentDisputeRequiresReviewForOrder(tx, siteId, order, true)) {
    throw new NpShopFulfillmentConflictError(
      "fulfillment_terminal",
      "Fulfillment cannot change while a payment dispute requires provider reconciliation.",
    );
  }
  return { fulfillment: locked, order };
}

function requireFulfillmentRevision(
  fulfillment: NpShopStoredFulfillment,
  expectedRevision: number,
): void {
  if (fulfillment.revision !== expectedRevision) {
    throw new NpShopFulfillmentConflictError(
      "fulfillment_revision_conflict",
      "The fulfillment changed before this action was applied.",
    );
  }
}

function requireFulfillmentParcelAllocation(
  order: NpShopStoredOrder,
  parcels: NpShopStoredFulfillmentParcels["parcels"],
): void {
  const allocated = new Map<string, number>();
  for (const parcel of parcels) {
    for (const item of parcel.items) {
      allocated.set(item.lineKey, (allocated.get(item.lineKey) ?? 0) + item.quantity);
    }
  }
  if (
    allocated.size !== order.lines.length ||
    order.lines.some((line) => allocated.get(line.key) !== line.quantity) ||
    [...allocated.keys()].some((lineKey) => !order.lines.some((line) => line.key === lineKey))
  ) {
    throw new NpShopFulfillmentParcelConflictError(
      "parcel_allocation_mismatch",
      "Parcel allocations must cover every immutable order line and exact quantity once in total.",
    );
  }
}

export async function npSaveShopFulfillmentParcels(
  input: NpShopFulfillmentParcelsSaveInput,
  staffUserId: string,
  proposal: { proposalId: string; providerId: string; expiresAt: string } | null = null,
): Promise<NpShopStoredFulfillmentParcels> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { fulfillment, order } = await readFulfillmentForAction(tx, siteId, input.orderId);
    if (fulfillment.status !== "processing") {
      throw new NpShopFulfillmentParcelConflictError(
        "parcel_fulfillment_not_processing",
        "Parcels can be prepared only for a processing fulfillment.",
      );
    }
    if (fulfillment.revision !== input.expectedFulfillmentRevision) {
      throw new NpShopFulfillmentParcelConflictError(
        "parcel_fulfillment_revision_conflict",
        "The fulfillment changed before the parcel snapshot was saved.",
      );
    }
    const booking = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
    const existing = await readStoredFulfillmentParcels(tx, siteId, input.orderId, true);
    const packingWork = await npReadStoredShopPackingWork(
      tx,
      siteId,
      "outbound",
      input.orderId,
      true,
    );
    requirePackingWorkAllowsParcelMutation(packingWork, {
      target: "outbound",
      orderId: order.id,
      exchangeId: null,
      purgeAt: order.purgeAt,
    });
    if (booking || existing?.lockedShipmentId) {
      throw new NpShopFulfillmentParcelConflictError(
        "parcel_locked",
        "The parcel snapshot is locked by a durable carrier booking.",
      );
    }
    if ((existing?.revision ?? null) !== input.expectedParcelRevision) {
      throw new NpShopFulfillmentParcelConflictError(
        "parcel_revision_conflict",
        "The parcel snapshot changed before this action was applied.",
      );
    }
    requireFulfillmentParcelAllocation(order, input.parcels);
    const nowDate = new Date();
    if (proposal && new Date(proposal.expiresAt).getTime() <= nowDate.getTime()) {
      throw new NpShopPackagingProposalUnavailableError(
        "The packaging proposal expired before it could be saved.",
      );
    }
    const now = nowDate.toISOString();
    const next = {
      contract: NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT,
      orderId: order.id,
      fulfillmentRevision: fulfillment.revision,
      revision: (existing?.revision ?? 0) + 1,
      parcels: input.parcels,
      lockedShipmentId: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      purgeAt: order.purgeAt,
    } satisfies NpShopStoredFulfillmentParcels;
    await persistFulfillmentParcels(tx, siteId, next);
    const totals = npShopFulfillmentParcelTotals(next.parcels);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      proposal ? "shop.fulfillment.parcels.propose" : "shop.fulfillment.parcels.save",
      order.id,
      {
        fulfillmentRevision: next.fulfillmentRevision,
        parcelRevision: next.revision,
        parcelCount: totals.parcelCount,
        unitCount: totals.unitCount,
        weightGrams: totals.weightGrams,
        ...(proposal ? { proposalId: proposal.proposalId, providerId: proposal.providerId } : {}),
      },
    );
    return next;
  });
}

export async function npProcessShopFulfillment(
  input: NpShopFulfillmentProcessInput,
  staffUserId: string,
): Promise<NpShopFulfillment> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const source = await readFulfillmentForAction(tx, siteId, input.orderId);
    let current = source.fulfillment;
    let order = source.order;
    if (await readStoredCarrierBooking(tx, siteId, input.orderId, true)) {
      throw new NpShopFulfillmentConflictError(
        "fulfillment_terminal",
        "A durable carrier booking owns this fulfillment transition.",
      );
    }
    requireFulfillmentRevision(current, input.expectedRevision);
    if (current.status !== "awaiting") {
      throw new NpShopFulfillmentConflictError(
        "fulfillment_terminal",
        "Only an awaiting fulfillment can move to processing once.",
      );
    }
    const packingWork = await npReadStoredShopPackingWork(
      tx,
      siteId,
      "outbound",
      input.orderId,
      true,
    );
    if (
      packingWork &&
      !packingWorkAllowsUnattachedFallback(packingWork, {
        target: "outbound",
        orderId: order.id,
        exchangeId: null,
        purgeAt: order.purgeAt,
      })
    ) {
      throw new NpShopPackingWorkConflictError(
        packingWork.status === "manual-review"
          ? "packing_work_manual_review"
          : "packing_work_state_conflict",
        "Reconcile the durable packing work before processing this fulfillment.",
      );
    }
    const transitionAt = new Date();
    const privateData = await readStoredPrivateForExpiry(tx, siteId, order.ownerSegment, order.id);
    const privateIsLive = Boolean(
      current.privateDataStatus === "retained" &&
      order.privateDataStatus === "retained" &&
      privateData?.contract === NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT &&
      privateData.retainedAt === current.createdAt &&
      privateData.expiresAt === current.privateExpiresAt &&
      new Date(privateData.expiresAt) > transitionAt,
    );
    if (!privateIsLive && order.privateDataStatus === "retained") {
      order = await redactStoredOrderPrivate(tx, siteId, order, transitionAt);
      current = { ...current, privateDataStatus: "redacted" };
    }
    const now = transitionAt.toISOString();
    const next = {
      ...current,
      status: "processing",
      revision: current.revision + 1,
      operatorNote: input.operatorNote ?? current.operatorNote,
      updatedAt: now,
    } satisfies NpShopStoredFulfillment;
    await persistFulfillment(tx, siteId, next);
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment: order.ownerSegment,
      kind: "fulfillment.processing",
      orderRevision: order.revision,
      occurredAt: now,
      purgeAt: order.purgeAt,
      email: privateIsLive ? (privateData?.customer.email ?? null) : null,
    });
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.fulfillment.process",
      input.orderId,
      { previousRevision: current.revision, revision: next.revision, status: next.status },
    );
    return npProjectShopFulfillment(next);
  });
}

export async function npShipShopFulfillment(
  input: NpShopFulfillmentShipInput,
  staffUserId: string,
): Promise<NpShopFulfillment> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { fulfillment: current, order } = await readFulfillmentForAction(
      tx,
      siteId,
      input.orderId,
    );
    const booking = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
    if (booking) {
      throw new NpShopFulfillmentConflictError(
        "fulfillment_terminal",
        "A durable carrier booking must be reconciled instead of manually shipping this order.",
      );
    }
    const parcelSnapshot = await readStoredFulfillmentParcels(tx, siteId, input.orderId, true);
    requireFulfillmentRevision(current, input.expectedRevision);
    if (current.status === "shipped" || current.status === "cancelled") {
      throw new NpShopFulfillmentConflictError(
        "fulfillment_terminal",
        "The fulfillment is already shipped or cancelled after refund.",
      );
    }
    await consumeShopPackingWork(
      tx,
      siteId,
      {
        target: "outbound",
        exchangeId: null,
        order,
        sourceRevision: current.revision,
        sourceStatus: current.status,
        booking,
        parcelSnapshot,
        lines: order.lines,
      },
      null,
      staffUserId,
    );
    const now = new Date().toISOString();
    const next = {
      ...current,
      status: "shipped",
      revision: current.revision + 1,
      privateDataStatus: "redacted",
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      operatorNote: input.operatorNote ?? current.operatorNote,
      updatedAt: now,
      shippedAt: now,
    } satisfies NpShopStoredFulfillment;
    await persistFulfillment(tx, siteId, next);
    if (order.privateDataStatus === "retained") {
      await persistOrder(tx, siteId, {
        ...order,
        revision: order.revision + 1,
        privateDataStatus: "redacted",
        updatedAt: now,
      });
    }
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment: order.ownerSegment,
      kind: "fulfillment.shipped",
      orderRevision: order.privateDataStatus === "retained" ? order.revision + 1 : order.revision,
      occurredAt: now,
      purgeAt: order.purgeAt,
      email: null,
    });
    await removePrivateAndMaintenance(tx, siteId, current.ownerSegment, current.orderId);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.fulfillment.ship",
      input.orderId,
      { previousRevision: current.revision, revision: next.revision, status: next.status },
    );
    return npProjectShopFulfillment(next);
  });
}

function closedCarrierProviderErrorCode(error: NpShopCarrierProviderError): string {
  const code = error.code.trim();
  return /^[a-z][a-z0-9-]{0,99}$/u.test(code) ? code : "provider-error";
}

async function updatePendingCarrierBooking(
  siteId: string,
  orderId: string,
  bookingId: string,
  update: (current: NpShopStoredCarrierBooking, now: string) => NpShopStoredCarrierBooking,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const current = await readStoredCarrierBooking(tx, siteId, orderId, true);
    if (!current || current.id !== bookingId || current.status !== "pending") return;
    await persistCarrierBooking(tx, siteId, update(current, new Date().toISOString()));
  });
}

async function markConfirmedCarrierBookingForManualReview(
  siteId: string,
  orderId: string,
  bookingId: string,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const current = await readStoredCarrierBooking(tx, siteId, orderId, true);
    if (!current || current.id !== bookingId || current.status !== "provider-confirmed") return;
    await persistCarrierBooking(tx, siteId, {
      ...current,
      status: "manual-review",
      providerErrorCode: "local-state-conflict",
      updatedAt: new Date(
        Math.max(Date.now(), new Date(current.bookedAt ?? 0).getTime()),
      ).toISOString(),
    });
  });
}

export async function npBookShopCarrierShipment(
  runtime: NpShopRuntime,
  input: NpShopCarrierBookingActionInput,
  staffUserId: string,
): Promise<{
  fulfillment: NpShopFulfillment;
  booking: NpShopStoredCarrierBooking;
  duplicate: boolean;
}> {
  const adapter = runtime.carrierAdapter;
  const parcelAdapter = runtime.carrierParcelAdapter;
  const siteId = await requireSiteId();
  const prepared = await getDb().transaction(async (tx) => {
    const { fulfillment, order } = await readFulfillmentForAction(tx, siteId, input.orderId);
    const existing = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
    let parcelSnapshot = await readStoredFulfillmentParcels(tx, siteId, input.orderId, true);
    if (existing?.status === "completed") {
      return { outcome: "complete" as const, fulfillment, booking: existing };
    }
    if (existing?.status === "manual-review") {
      throw new NpShopCarrierConflictError(
        "carrier_manual_review",
        "This carrier booking requires manual reconciliation.",
      );
    }
    if (existing?.status === "pending" && (!adapter || existing.providerId !== adapter.id)) {
      throw new NpShopCarrierConflictError(
        "carrier_provider_mismatch",
        "The durable booking belongs to a different carrier provider.",
      );
    }
    if (!existing && !adapter) {
      throw new NpShopCarrierConflictError(
        "carrier_not_supported",
        "No carrier booking adapter is configured for this Shop.",
      );
    }
    if (fulfillment.revision !== input.expectedRevision) {
      throw new NpShopCarrierConflictError(
        "carrier_fulfillment_revision_conflict",
        "The fulfillment changed before carrier booking started.",
      );
    }
    if (
      fulfillment.status !== "processing" ||
      (existing && existing.fulfillmentRevision !== fulfillment.revision)
    ) {
      throw new NpShopCarrierConflictError(
        "carrier_fulfillment_not_processing",
        "Only one unchanged processing fulfillment can be booked with a carrier.",
      );
    }
    if (
      parcelSnapshot?.lockedShipmentId &&
      (!existing || parcelSnapshot.lockedShipmentId !== existing.id)
    ) {
      throw new NpShopFulfillmentParcelConflictError(
        "parcel_locked",
        "The parcel snapshot belongs to a different durable shipment.",
      );
    }
    if (
      existing?.status === "pending" &&
      parcelSnapshot?.lockedShipmentId === existing.id &&
      !parcelAdapter
    ) {
      throw new NpShopCarrierConflictError(
        "carrier_provider_mismatch",
        "The durable parcel booking requires its original parcel-aware carrier capability.",
      );
    }
    const privateData = await readStoredPrivateForExpiry(
      tx,
      siteId,
      fulfillment.ownerSegment,
      fulfillment.orderId,
    );
    const privateIsLive = Boolean(
      fulfillment.privateDataStatus === "retained" &&
      order.privateDataStatus === "retained" &&
      privateData?.contract === NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT &&
      privateData.retainedAt === fulfillment.createdAt &&
      privateData.expiresAt === fulfillment.privateExpiresAt &&
      new Date(privateData.expiresAt) > new Date(),
    );
    if (!privateIsLive) {
      if (order.privateDataStatus === "retained") {
        await redactStoredOrderPrivate(tx, siteId, order, new Date());
      }
      if (existing && existing.status !== "provider-confirmed") {
        await persistCarrierBooking(tx, siteId, {
          ...existing,
          status: "manual-review",
          providerErrorCode: "private-data-expired",
          updatedAt: new Date(
            Math.max(Date.now(), new Date(existing.bookedAt ?? 0).getTime()),
          ).toISOString(),
        });
      }
      if (existing?.status !== "provider-confirmed") {
        return { outcome: "private-expired" as const };
      }
    }
    if (privateIsLive && !privateData?.shipping) {
      throw new NpShopOrderContractError("Shop carrier destination is missing", [
        "A retained fulfillment must have one exact shipping destination.",
      ]);
    }
    let booking = existing;
    if (booking && input.operatorNote !== null && input.operatorNote !== booking.operatorNote) {
      booking = {
        ...booking,
        operatorNote: input.operatorNote,
        updatedAt: new Date(
          Math.max(Date.now(), new Date(booking.bookedAt ?? 0).getTime()),
        ).toISOString(),
      };
      await persistCarrierBooking(tx, siteId, booking);
    }
    if (!booking) {
      if (!adapter) {
        throw new NpShopCarrierConflictError(
          "carrier_not_supported",
          "No carrier booking adapter is configured for this Shop.",
        );
      }
      const requestedAt = new Date();
      requestedAt.setMilliseconds(0);
      const now = requestedAt.toISOString();
      booking = {
        contract: NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT,
        id: randomUUID(),
        orderId: order.id,
        providerId: adapter.id,
        status: "pending",
        fulfillmentRevision: fulfillment.revision,
        operatorNote: input.operatorNote,
        bookingReference: null,
        carrier: null,
        trackingNumber: null,
        providerErrorCode: null,
        requestedAt: now,
        updatedAt: now,
        bookedAt: null,
        purgeAt: order.purgeAt,
      };
      if (parcelAdapter) {
        if (
          !parcelSnapshot ||
          parcelSnapshot.fulfillmentRevision !== fulfillment.revision ||
          parcelSnapshot.lockedShipmentId !== null
        ) {
          throw new NpShopFulfillmentParcelConflictError(
            "parcel_required",
            "The parcel-aware carrier requires one current unlocked parcel snapshot.",
          );
        }
        requireFulfillmentParcelAllocation(order, parcelSnapshot.parcels);
        parcelSnapshot = {
          ...parcelSnapshot,
          lockedShipmentId: booking.id,
          updatedAt: new Date(
            Math.max(Date.now(), new Date(parcelSnapshot.createdAt).getTime()),
          ).toISOString(),
        };
        await persistFulfillmentParcels(tx, siteId, parcelSnapshot);
      }
      await persistCarrierBooking(tx, siteId, booking);
      await recordRequiredShopFulfillmentAudit(
        tx,
        siteId,
        staffUserId,
        "shop.carrier.booking.request",
        order.id,
        {
          shipmentId: booking.id,
          fulfillmentRevision: booking.fulfillmentRevision,
          providerId: booking.providerId,
          parcelRevision:
            parcelSnapshot?.lockedShipmentId === booking.id ? parcelSnapshot.revision : null,
        },
      );
    }
    const attachedPackingWork = await attachShopPackingWorkToShipment(
      tx,
      siteId,
      {
        target: "outbound",
        exchangeId: null,
        order,
        sourceRevision: fulfillment.revision,
        sourceStatus: fulfillment.status,
        booking,
        parcelSnapshot,
        lines: order.lines,
      },
      booking.id,
      Boolean(parcelAdapter && parcelSnapshot?.lockedShipmentId === booking.id),
      staffUserId,
    );
    return {
      outcome: "prepared" as const,
      fulfillment,
      order,
      privateData: privateIsLive ? privateData : null,
      booking,
      parcelSnapshot: parcelSnapshot?.lockedShipmentId === booking.id ? parcelSnapshot : null,
      packingWorkId: attachedPackingWork?.status === "active" ? attachedPackingWork.workId : null,
    };
  });
  if (prepared.outcome === "private-expired") {
    throw new NpShopCarrierConflictError(
      "carrier_private_expired",
      "The private shipping destination expired before carrier booking.",
    );
  }
  if (prepared.outcome === "complete") {
    return {
      fulfillment: npProjectShopFulfillment(prepared.fulfillment),
      booking: prepared.booking,
      duplicate: true,
    };
  }

  let providerResult: NpShopCarrierBookingResult;
  if (prepared.booking.status === "provider-confirmed") {
    providerResult = {
      contract: NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT,
      shipmentId: prepared.booking.id,
      orderId: prepared.booking.orderId,
      bookingReference: prepared.booking.bookingReference ?? "",
      carrier: prepared.booking.carrier ?? "",
      trackingNumber: prepared.booking.trackingNumber ?? "",
      bookedAt: prepared.booking.bookedAt ?? "",
    };
    providerResult = npRequireShopCarrierBookingResult(providerResult);
  } else {
    if (!adapter || adapter.id !== prepared.booking.providerId) {
      throw new NpShopCarrierConflictError(
        "carrier_provider_mismatch",
        "The pending booking requires its original carrier provider.",
      );
    }
    // Provider I/O is intentionally outside the transaction. Re-read the
    // private authority immediately before materializing the request so a
    // sidecar that expired or was redacted after prepare is never sent.
    const invocationPrivate = await readStoredPrivateForExpiry(
      getDb(),
      siteId,
      prepared.fulfillment.ownerSegment,
      prepared.fulfillment.orderId,
    );
    const invocationNow = new Date();
    if (
      !invocationPrivate?.shipping ||
      invocationPrivate.contract !== NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT ||
      invocationPrivate.retainedAt !== prepared.fulfillment.createdAt ||
      invocationPrivate.expiresAt !== prepared.fulfillment.privateExpiresAt ||
      new Date(invocationPrivate.expiresAt) <= invocationNow
    ) {
      await updatePendingCarrierBooking(
        siteId,
        input.orderId,
        prepared.booking.id,
        (current, now) => ({
          ...current,
          status: "manual-review",
          providerErrorCode: "private-data-expired",
          updatedAt: now,
        }),
      );
      throw new NpShopCarrierConflictError(
        "carrier_private_expired",
        "The private shipping destination expired before carrier booking.",
      );
    }
    const destination = invocationPrivate.shipping;
    const commonRequest = {
      shipmentId: prepared.booking.id,
      orderId: prepared.order.id,
      fulfillmentRevision: prepared.fulfillment.revision,
      items: prepared.order.lines.map((line) => ({
        key: line.key,
        productId: line.productId,
        productName: line.productName,
        variantSku: line.variantSku,
        variantName: line.variantName,
        quantity: line.quantity,
      })),
      destination,
      deliveryMethod: prepared.order.deliveryMethod,
      requestedAt: prepared.booking.requestedAt,
    };
    let invokeProvider: () => NpShopCarrierBookingResult | Promise<NpShopCarrierBookingResult>;
    if (prepared.parcelSnapshot) {
      if (!parcelAdapter || parcelAdapter.id !== prepared.booking.providerId) {
        throw new NpShopCarrierConflictError(
          "carrier_provider_mismatch",
          "The pending parcel booking requires its original parcel-aware carrier provider.",
        );
      }
      const parcelRequest = npRequireShopCarrierParcelBookingRequest({
        ...commonRequest,
        contract: NP_SHOP_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT,
        parcelRevision: prepared.parcelSnapshot.revision,
        parcels: prepared.parcelSnapshot.parcels,
      });
      invokeProvider = () => parcelAdapter.bookShipmentWithParcels(parcelRequest);
    } else {
      const carrierRequest = npRequireShopCarrierBookingRequest({
        ...commonRequest,
        contract: NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT,
      });
      invokeProvider = () => adapter.bookShipment(carrierRequest);
    }
    try {
      providerResult = npRequireShopCarrierBookingResult(await invokeProvider());
    } catch (error) {
      const providerError =
        error instanceof NpShopCarrierProviderError ? closedCarrierProviderErrorCode(error) : null;
      const resultContractError = error instanceof NpShopCarrierContractError;
      await updatePendingCarrierBooking(
        siteId,
        input.orderId,
        prepared.booking.id,
        (current, now) => ({
          ...current,
          status:
            resultContractError || (error instanceof NpShopCarrierProviderError && !error.retryable)
              ? "manual-review"
              : "pending",
          providerErrorCode: resultContractError
            ? "provider-result-mismatch"
            : (providerError ?? "provider-error"),
          updatedAt: now,
        }),
      );
      if (resultContractError) {
        throw new NpShopCarrierConflictError(
          "carrier_result_mismatch",
          "The carrier returned a malformed result; manual review is required.",
        );
      }
      if (error instanceof NpShopCarrierProviderError && !error.retryable) {
        throw new NpShopCarrierConflictError(
          "carrier_manual_review",
          "The carrier rejected this stable booking; manual review is required.",
        );
      }
      throw new NpShopCarrierUnavailableError();
    }
  }

  if (
    providerResult.shipmentId !== prepared.booking.id ||
    providerResult.orderId !== prepared.order.id ||
    new Date(providerResult.bookedAt) < new Date(prepared.booking.requestedAt) ||
    new Date(providerResult.bookedAt).getTime() >
      Date.now() + npShopCarrierLimits.futureToleranceSeconds * 1_000
  ) {
    await updatePendingCarrierBooking(
      siteId,
      input.orderId,
      prepared.booking.id,
      (current, now) => ({
        ...current,
        status: "manual-review",
        providerErrorCode: "provider-result-mismatch",
        updatedAt: now,
      }),
    );
    throw new NpShopCarrierConflictError(
      "carrier_result_mismatch",
      "The carrier result does not match the durable shipment intent.",
    );
  }

  const confirmed = await getDb().transaction(async (tx) => {
    const current = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
    if (!current || current.id !== prepared.booking.id) {
      throw new NpShopCarrierConflictError(
        "carrier_fulfillment_not_found",
        "The durable carrier booking disappeared after provider confirmation.",
      );
    }
    if (current.status === "completed") return current;
    if (current.status === "provider-confirmed") {
      if (
        current.bookingReference !== providerResult.bookingReference ||
        current.carrier !== providerResult.carrier ||
        current.trackingNumber !== providerResult.trackingNumber ||
        current.bookedAt !== providerResult.bookedAt
      ) {
        const conflict = {
          ...current,
          status: "manual-review",
          providerErrorCode: "provider-result-mismatch",
          updatedAt: new Date(
            Math.max(Date.now(), new Date(current.bookedAt ?? 0).getTime()),
          ).toISOString(),
        } satisfies NpShopStoredCarrierBooking;
        await persistCarrierBooking(tx, siteId, conflict);
        return conflict;
      }
      return current;
    }
    if (current.status !== "pending") {
      throw new NpShopCarrierConflictError(
        "carrier_manual_review",
        "The carrier booking entered manual review before confirmation was stored.",
      );
    }
    const next = {
      ...current,
      status: "provider-confirmed",
      bookingReference: providerResult.bookingReference,
      carrier: providerResult.carrier,
      trackingNumber: providerResult.trackingNumber,
      providerErrorCode: null,
      updatedAt: new Date(
        Math.max(Date.now(), new Date(providerResult.bookedAt).getTime()),
      ).toISOString(),
      bookedAt: providerResult.bookedAt,
    } satisfies NpShopStoredCarrierBooking;
    await persistCarrierBooking(tx, siteId, next);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.carrier.booking.confirm",
      next.orderId,
      { shipmentId: next.id, providerId: next.providerId },
    );
    return next;
  });
  if (confirmed.status === "completed") {
    const latestFulfillment = await readStoredFulfillment(getDb(), siteId, input.orderId);
    if (!latestFulfillment) {
      throw new NpShopCarrierConflictError(
        "carrier_fulfillment_not_found",
        "The completed carrier booking has no matching fulfillment.",
      );
    }
    return {
      fulfillment: npProjectShopFulfillment(latestFulfillment),
      booking: confirmed,
      duplicate: true,
    };
  }
  if (confirmed.status === "manual-review") {
    throw new NpShopCarrierConflictError(
      "carrier_result_mismatch",
      "The carrier returned conflicting results for one shipment idempotency key.",
    );
  }

  try {
    return await getDb().transaction(async (tx) => {
      const { fulfillment: current, order } = await readFulfillmentForAction(
        tx,
        siteId,
        input.orderId,
      );
      const booking = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
      const parcelSnapshot = await readStoredFulfillmentParcels(tx, siteId, input.orderId, true);
      if (
        !booking ||
        booking.id !== confirmed.id ||
        booking.status !== "provider-confirmed" ||
        current.status !== "processing" ||
        current.revision !== booking.fulfillmentRevision
      ) {
        throw new NpShopCarrierConflictError(
          "carrier_manual_review",
          "The local fulfillment changed after carrier confirmation.",
        );
      }
      const consumedPackingWork = await consumeShopPackingWork(
        tx,
        siteId,
        {
          target: "outbound",
          exchangeId: null,
          order,
          sourceRevision: current.revision,
          sourceStatus: current.status,
          booking,
          parcelSnapshot,
          lines: order.lines,
        },
        booking.id,
        staffUserId,
      );
      if (
        prepared.packingWorkId &&
        (consumedPackingWork?.workId !== prepared.packingWorkId ||
          consumedPackingWork.status !== "consumed")
      ) {
        throw new NpShopPackingWorkConflictError(
          "packing_work_shipment_conflict",
          "Packing-work cancellation won while carrier booking was in progress.",
        );
      }
      const now = new Date(
        Math.max(Date.now(), new Date(booking.bookedAt ?? 0).getTime()),
      ).toISOString();
      const nextFulfillment = {
        ...current,
        status: "shipped",
        revision: current.revision + 1,
        privateDataStatus: "redacted",
        carrier: booking.carrier,
        trackingNumber: booking.trackingNumber,
        operatorNote: booking.operatorNote ?? current.operatorNote,
        updatedAt: now,
        shippedAt: now,
      } satisfies NpShopStoredFulfillment;
      await persistFulfillment(tx, siteId, nextFulfillment);
      await persistOrder(tx, siteId, {
        ...order,
        revision: order.revision + 1,
        privateDataStatus: "redacted",
        updatedAt: now,
      });
      await npStageShopOrderNotification(tx, siteId, {
        orderId: order.id,
        ownerSegment: order.ownerSegment,
        kind: "fulfillment.shipped",
        orderRevision: order.revision + 1,
        occurredAt: now,
        purgeAt: order.purgeAt,
        email: null,
      });
      await removePrivateAndMaintenance(tx, siteId, current.ownerSegment, current.orderId);
      const completed = {
        ...booking,
        status: "completed",
        providerErrorCode: null,
        updatedAt: now,
      } satisfies NpShopStoredCarrierBooking;
      await persistCarrierBooking(tx, siteId, completed);
      await recordRequiredShopFulfillmentAudit(
        tx,
        siteId,
        staffUserId,
        "shop.fulfillment.ship",
        input.orderId,
        {
          previousRevision: current.revision,
          revision: nextFulfillment.revision,
          status: nextFulfillment.status,
          shipmentId: booking.id,
          providerId: booking.providerId,
        },
      );
      return {
        fulfillment: npProjectShopFulfillment(nextFulfillment),
        booking: completed,
        duplicate: false,
      };
    });
  } catch (error) {
    if (
      !(error instanceof NpShopCarrierConflictError) &&
      !(error instanceof NpShopFulfillmentConflictError) &&
      !(error instanceof NpShopPackingWorkConflictError) &&
      !(error instanceof NpShopOrderContractError)
    ) {
      throw error;
    }
    await markConfirmedCarrierBookingForManualReview(siteId, input.orderId, prepared.booking.id);
    if (error instanceof NpShopOrderContractError) throw error;
    throw new NpShopCarrierConflictError(
      "carrier_manual_review",
      "The carrier confirmed shipment but local completion requires manual reconciliation.",
    );
  }
}

export async function npReadShopFulfillmentPrivate(
  input: NpShopFulfillmentPrivateReadInput,
  staffUserId: string,
): Promise<{
  customer: NpShopStoredOrderPrivateData["customer"];
  shipping: NpShopStoredOrderPrivateData["shipping"];
}> {
  const siteId = await requireSiteId();
  const result = await getDb().transaction(async (tx) => {
    const { fulfillment: current, order } = await readFulfillmentForAction(
      tx,
      siteId,
      input.orderId,
    );
    requireFulfillmentRevision(current, input.expectedRevision);
    const privateData = await readStoredPrivateForExpiry(
      tx,
      siteId,
      current.ownerSegment,
      current.orderId,
    );
    if (
      current.privateDataStatus !== "retained" ||
      !privateData ||
      privateData.contract !== NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT ||
      privateData.expiresAt !== current.privateExpiresAt ||
      new Date(privateData.expiresAt) <= new Date()
    ) {
      if (order.privateDataStatus === "retained") {
        await redactStoredOrderPrivate(tx, siteId, order, new Date());
      }
      return null;
    }
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.fulfillment.private.read",
      input.orderId,
      { fulfillmentRevision: current.revision },
    );
    return { customer: privateData.customer, shipping: privateData.shipping };
  });
  if (!result) {
    throw new NpShopFulfillmentConflictError(
      "fulfillment_private_expired",
      "Customer and shipping data has expired or was deleted after shipment.",
    );
  }
  return result;
}

export async function npListRecentShopFulfillments(
  carrierProviderId?: string,
  parcelAwareCarrier = false,
): Promise<{
  rows: NpShopAdminFulfillmentRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "fulfillment:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopFulfillmentLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "fulfillment:%"),
      ),
    );
  return {
    rows: await Promise.all(
      rows.map(async (row) => {
        const fulfillment = requireStoredFulfillment(row.value, row.expiresAt, row.key);
        const order = await readStoredOrderForUpdate(
          db,
          siteId,
          fulfillment.ownerSegment,
          fulfillment.orderId,
        );
        const privateData = order
          ? await readStoredPrivateForExpiry(db, siteId, order.ownerSegment, fulfillment.orderId)
          : null;
        const parcelSnapshot = await readStoredFulfillmentParcels(db, siteId, fulfillment.orderId);
        const packingWork = await readAdminPackingWork(db, siteId, "outbound", fulfillment.orderId);
        const exactPackingWork = packingWork === "invalid" ? null : packingWork;
        const carrierBooking = await readStoredCarrierBooking(db, siteId, fulfillment.orderId);
        const paymentDisputeSafe = order
          ? await npShopPaymentDisputeAllowsAdminActions(db, siteId, order)
          : false;
        const exactUnlockedParcelSnapshot = Boolean(
          parcelSnapshot &&
          parcelSnapshot.orderId === fulfillment.orderId &&
          parcelSnapshot.fulfillmentRevision === fulfillment.revision &&
          parcelSnapshot.purgeAt === fulfillment.purgeAt &&
          parcelSnapshot.lockedShipmentId === null,
        );
        const exactLockedParcelSnapshot = Boolean(
          parcelSnapshot &&
          carrierBooking &&
          parcelSnapshot.orderId === fulfillment.orderId &&
          parcelSnapshot.fulfillmentRevision === carrierBooking.fulfillmentRevision &&
          parcelSnapshot.purgeAt === fulfillment.purgeAt &&
          parcelSnapshot.lockedShipmentId === carrierBooking.id,
        );
        const commercialSourceValid = Boolean(order && fulfillmentMatchesOrder(fulfillment, order));
        const privateSourceAvailable = Boolean(
          order &&
          fulfillment.privateDataStatus === "retained" &&
          order.privateDataStatus === "retained" &&
          privateData?.contract === NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT &&
          privateData.retainedAt === fulfillment.createdAt &&
          privateData.expiresAt === fulfillment.privateExpiresAt &&
          new Date(privateData.expiresAt) > new Date(),
        );
        const packingSourceValid =
          commercialSourceValid &&
          packingWork !== "invalid" &&
          (exactPackingWork === null ||
            (order !== null &&
              packingWorkMatchesOutboundAdminSource(
                exactPackingWork,
                order,
                fulfillment,
                parcelSnapshot,
                carrierBooking,
              )));
        const carrierResumeEligible = Boolean(
          carrierBooking &&
          (carrierBooking.status === "pending" || carrierBooking.status === "provider-confirmed") &&
          packingSourceValid &&
          packingWorkAllowsCarrierShipment(
            exactPackingWork,
            carrierBooking.status === "pending" && parcelAwareCarrier,
            carrierBooking.id,
            {
              target: "outbound",
              orderId: fulfillment.orderId,
              exchangeId: null,
              purgeAt: fulfillment.purgeAt,
            },
          ) &&
          (carrierBooking.status === "provider-confirmed" ||
            (privateSourceAvailable &&
              carrierBooking.providerId === carrierProviderId &&
              ((parcelSnapshot?.lockedShipmentId ?? null) === null ||
                (parcelAwareCarrier && exactLockedParcelSnapshot)))),
        );
        return {
          id: fulfillment.orderId,
          status: fulfillment.status,
          fulfillmentRevision: fulfillment.revision,
          parcelRevision: parcelSnapshot?.revision ?? null,
          packingWorkStatus:
            packingWork === "invalid" ? "invalid" : (exactPackingWork?.status ?? "none"),
          packingWorkRevision: exactPackingWork?.revision ?? null,
          packingWorkAction:
            fulfillment.status === "processing" &&
            paymentDisputeSafe &&
            commercialSourceValid &&
            carrierBooking === null &&
            exactUnlockedParcelSnapshot &&
            packingWork === null
              ? "create"
              : "—",
          processEligible:
            fulfillment.status === "awaiting" &&
            paymentDisputeSafe &&
            carrierBooking === null &&
            commercialSourceValid &&
            packingWork !== "invalid" &&
            (exactPackingWork === null ||
              packingWorkAllowsUnattachedFallback(exactPackingWork, {
                target: "outbound",
                orderId: fulfillment.orderId,
                exchangeId: null,
                purgeAt: fulfillment.purgeAt,
              })),
          parcelMutationEligible:
            fulfillment.status === "processing" &&
            paymentDisputeSafe &&
            commercialSourceValid &&
            carrierBooking === null &&
            (parcelSnapshot?.lockedShipmentId ?? null) === null &&
            packingWork !== "invalid" &&
            packingWorkAllowsParcelMutation(exactPackingWork, {
              target: "outbound",
              orderId: fulfillment.orderId,
              exchangeId: null,
              purgeAt: fulfillment.purgeAt,
            }),
          manualShipmentEligible:
            (fulfillment.status === "awaiting" || fulfillment.status === "processing") &&
            paymentDisputeSafe &&
            carrierBooking === null &&
            packingSourceValid &&
            packingWorkAllowsManualShipment(exactPackingWork, {
              target: "outbound",
              orderId: fulfillment.orderId,
              exchangeId: null,
              purgeAt: fulfillment.purgeAt,
            }),
          carrierShipmentEligible:
            fulfillment.status === "processing" &&
            paymentDisputeSafe &&
            (carrierBooking === null
              ? carrierProviderId !== undefined &&
                privateSourceAvailable &&
                (!parcelAwareCarrier || exactUnlockedParcelSnapshot) &&
                packingWork !== "invalid" &&
                packingSourceValid &&
                packingWorkAllowsCarrierShipment(exactPackingWork, parcelAwareCarrier, null, {
                  target: "outbound",
                  orderId: fulfillment.orderId,
                  exchangeId: null,
                  purgeAt: fulfillment.purgeAt,
                })
              : carrierResumeEligible),
          parcels: parcelSnapshot
            ? parcelSnapshot.lockedShipmentId
              ? "locked"
              : "prepared"
            : "not-prepared",
          privateData: fulfillment.privateDataStatus,
          carrier: fulfillment.carrier ?? "—",
          trackingNumber: fulfillment.trackingNumber ?? "—",
          operatorNote: fulfillment.operatorNote ?? "—",
          updatedAt: fulfillment.updatedAt,
        };
      }),
    ),
    total,
  };
}

export async function npCountShopFulfillments(): Promise<{
  total: number;
  awaiting: number;
  processing: number;
  shipped: number;
  cancelled: number;
  privateDue: number;
  invalidSample: number;
  orphanSample: number;
  missingPaidSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      awaiting: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_FULFILLMENT_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'awaiting')::int`,
      processing: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_FULFILLMENT_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'processing')::int`,
      shipped: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_FULFILLMENT_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'shipped')::int`,
      cancelled: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_FULFILLMENT_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'cancelled')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "fulfillment:%"),
      ),
    );
  const [{ privateDue }] = await db
    .select({ privateDue: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-private:%"),
        sql`${npPluginStorage.value}->>'contract' = ${NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT}`,
        lte(npPluginStorage.expiresAt, new Date()),
      ),
    );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "fulfillment:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopFulfillmentLimits.diagnosticSampleSize);
  let invalidSample = 0;
  let orphanSample = 0;
  for (const row of rows) {
    try {
      const fulfillment = requireStoredFulfillment(row.value, row.expiresAt, row.key);
      const [order] = await db
        .select({
          key: npPluginStorage.key,
          value: npPluginStorage.value,
          expiresAt: npPluginStorage.expiresAt,
        })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, orderStorageKey(fulfillment.ownerSegment, fulfillment.orderId)),
          ),
        )
        .limit(1);
      const storedOrder = order
        ? requireStoredOrderAtKey(order.value, order.expiresAt, order.key)
        : null;
      if (!storedOrder || !fulfillmentMatchesOrder(fulfillment, storedOrder)) {
        orphanSample += 1;
        continue;
      }
      const privateData = await readStoredPrivate(
        db,
        siteId,
        fulfillment.ownerSegment,
        fulfillment.orderId,
      );
      if (
        (fulfillment.privateDataStatus === "retained" &&
          (!privateData ||
            privateData.contract !== NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT ||
            privateData.retainedAt !== fulfillment.createdAt ||
            privateData.expiresAt !== fulfillment.privateExpiresAt)) ||
        (fulfillment.privateDataStatus === "redacted" && privateData)
      ) {
        invalidSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  const paidRows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order:%"),
        sql`${npPluginStorage.value}->>'status' in ('paid', 'refunded')`,
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopFulfillmentLimits.diagnosticSampleSize);
  let missingPaidSample = 0;
  for (const row of paidRows) {
    const order = requireStoredOrderAtKey(row.value, row.expiresAt, row.key);
    if (!(await readStoredFulfillment(db, siteId, order.id))) missingPaidSample += 1;
  }
  return { ...counts, privateDue, invalidSample, orphanSample, missingPaidSample };
}

export async function npListRecentShopFulfillmentParcels(): Promise<{
  rows: NpShopAdminFulfillmentParcelRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "fulfillment-parcels:%"),
  );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(where)
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopFulfillmentParcelLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(where);
  return {
    rows: await Promise.all(
      rows.map(async (row) => {
        const snapshot = requireStoredFulfillmentParcelsAtKey(row.value, row.expiresAt, row.key);
        const [fulfillment, booking] = await Promise.all([
          readStoredFulfillment(db, siteId, snapshot.orderId),
          readStoredCarrierBooking(db, siteId, snapshot.orderId),
        ]);
        const totals = npShopFulfillmentParcelTotals(snapshot.parcels);
        const status = snapshot.lockedShipmentId
          ? "locked"
          : booking
            ? "frozen"
            : fulfillment &&
                fulfillment.status === "processing" &&
                fulfillment.revision === snapshot.fulfillmentRevision
              ? "prepared"
              : fulfillment
                ? "archived"
                : "orphan";
        return {
          id: snapshot.orderId,
          fulfillmentRevision: snapshot.fulfillmentRevision,
          parcelRevision: snapshot.revision,
          status,
          parcelCount: totals.parcelCount,
          units: totals.unitCount,
          weightGrams: totals.weightGrams,
          shipmentId: snapshot.lockedShipmentId ?? "—",
          updatedAt: snapshot.updatedAt,
        };
      }),
    ),
    total,
  };
}

export async function npCountShopFulfillmentParcels(): Promise<{
  total: number;
  unlocked: number;
  locked: number;
  invalidSample: number;
  orphanSample: number;
  allocationMismatchSample: number;
  lockMismatchSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "fulfillment-parcels:%"),
  );
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unlocked: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'lockedShipmentId' is null)::int`,
      locked: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'lockedShipmentId' is not null)::int`,
    })
    .from(npPluginStorage)
    .where(where);
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(where)
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopFulfillmentParcelLimits.diagnosticSampleSize);
  let invalidSample = 0;
  let orphanSample = 0;
  let allocationMismatchSample = 0;
  let lockMismatchSample = 0;
  for (const row of rows) {
    try {
      const snapshot = requireStoredFulfillmentParcelsAtKey(row.value, row.expiresAt, row.key);
      const fulfillment = await readStoredFulfillment(db, siteId, snapshot.orderId);
      if (!fulfillment) {
        orphanSample += 1;
        continue;
      }
      const order = await readStoredOrderForUpdate(
        db,
        siteId,
        fulfillment.ownerSegment,
        snapshot.orderId,
      );
      if (!order || !fulfillmentMatchesOrder(fulfillment, order)) {
        orphanSample += 1;
        continue;
      }
      try {
        requireFulfillmentParcelAllocation(order, snapshot.parcels);
      } catch (error) {
        if (error instanceof NpShopFulfillmentParcelConflictError) {
          allocationMismatchSample += 1;
          continue;
        }
        throw error;
      }
      const booking = await readStoredCarrierBooking(db, siteId, snapshot.orderId);
      if (snapshot.lockedShipmentId) {
        if (
          !booking ||
          booking.id !== snapshot.lockedShipmentId ||
          booking.fulfillmentRevision !== snapshot.fulfillmentRevision
        ) {
          lockMismatchSample += 1;
        }
      }
      if (
        fulfillment.revision < snapshot.fulfillmentRevision ||
        (fulfillment.revision === snapshot.fulfillmentRevision &&
          fulfillment.status !== "processing") ||
        (fulfillment.revision > snapshot.fulfillmentRevision &&
          fulfillment.status !== "shipped" &&
          fulfillment.status !== "cancelled")
      ) {
        invalidSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  return {
    ...counts,
    invalidSample,
    orphanSample,
    allocationMismatchSample,
    lockMismatchSample,
  };
}

export async function npListRecentShopCarrierBookings(
  carrierProviderId?: string,
  parcelAwareCarrier = false,
): Promise<{
  rows: NpShopAdminCarrierBookingRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "carrier-booking:%"),
  );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(where)
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopCarrierLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(where);
  const pickupRows = rows.length
    ? await db
        .select({
          key: npPluginStorage.key,
          value: npPluginStorage.value,
          expiresAt: npPluginStorage.expiresAt,
        })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            inArray(
              npPluginStorage.key,
              rows.map((row) => {
                const booking = requireStoredCarrierBookingAtKey(row.value, row.expiresAt, row.key);
                return `carrier-pickup:${booking.id}`;
              }),
            ),
          ),
        )
    : [];
  const pickups = new Map(
    pickupRows.map((row) => {
      const pickup = npRequireStoredShopCarrierPickup(row.value);
      if (
        row.key !== `carrier-pickup:${pickup.shipmentId}` ||
        row.expiresAt === null ||
        row.expiresAt.toISOString() !== pickup.purgeAt ||
        pickup.target !== "outbound" ||
        pickup.exchangeId !== null
      ) {
        throw new NpShopCarrierContractError("Invalid carrier pickup storage metadata", [
          "pickup key and expiry must match their canonical values.",
        ]);
      }
      return [pickup.shipmentId, pickup] as const;
    }),
  );
  const labelRows = rows.length
    ? await db
        .select({
          key: npPluginStorage.key,
          value: npPluginStorage.value,
          expiresAt: npPluginStorage.expiresAt,
        })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            inArray(
              npPluginStorage.key,
              rows.map((row) => {
                const booking = requireStoredCarrierBookingAtKey(row.value, row.expiresAt, row.key);
                return npShopCarrierLabelAcquisitionStorageKey(booking.id);
              }),
            ),
          ),
        )
    : [];
  const labelAcquisitions = new Map(
    labelRows.map((row) => {
      const acquisition = npRequireStoredShopCarrierLabelAcquisitionAtKey(
        row.value,
        row.expiresAt,
        row.key,
      );
      if (acquisition.target !== "outbound" || acquisition.exchangeId !== null) {
        throw new NpShopCarrierContractError("Invalid outbound label acquisition metadata", [
          "outbound label acquisition target must not identify an exchange.",
        ]);
      }
      return [acquisition.shipmentId, acquisition] as const;
    }),
  );
  const trackingRows = rows.length
    ? await db
        .select({
          key: npPluginStorage.key,
          value: npPluginStorage.value,
          expiresAt: npPluginStorage.expiresAt,
        })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            inArray(
              npPluginStorage.key,
              rows.map((row) => {
                const booking = requireStoredCarrierBookingAtKey(row.value, row.expiresAt, row.key);
                return `tracking:${booking.orderId}`;
              }),
            ),
          ),
        )
    : [];
  const trackedShipments = new Set(
    trackingRows.map((row) => {
      const tracking = npRequireStoredShopTracking(row.value);
      if (
        row.key !== `tracking:${tracking.orderId}` ||
        row.expiresAt === null ||
        row.expiresAt.toISOString() !== tracking.purgeAt
      ) {
        throw new NpShopCarrierContractError("Invalid outbound tracking metadata", [
          "tracking key and expiry must match their canonical values.",
        ]);
      }
      return tracking.shipmentId;
    }),
  );
  return {
    rows: await Promise.all(
      rows.map(async (row) => {
        const booking = requireStoredCarrierBookingAtKey(row.value, row.expiresAt, row.key);
        const pickup = pickups.get(booking.id);
        const labelAcquisition = labelAcquisitions.get(booking.id);
        const parcelSnapshot = await readStoredFulfillmentParcels(db, siteId, booking.orderId);
        const fulfillment = await readStoredFulfillment(db, siteId, booking.orderId);
        const order = fulfillment
          ? await readStoredOrderForUpdate(db, siteId, fulfillment.ownerSegment, booking.orderId)
          : null;
        const privateData = order
          ? await readStoredPrivateForExpiry(db, siteId, order.ownerSegment, booking.orderId)
          : null;
        const packingWork = await readAdminPackingWork(db, siteId, "outbound", booking.orderId);
        const exactPackingWork = packingWork === "invalid" ? null : packingWork;
        const commercialSourceValid = outboundCarrierBookingMatchesAdminSource(
          booking,
          fulfillment,
          order,
        );
        const privateSourceAvailable = Boolean(
          fulfillment &&
          order &&
          fulfillment.privateDataStatus === "retained" &&
          order.privateDataStatus === "retained" &&
          privateData?.contract === NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT &&
          privateData.retainedAt === fulfillment.createdAt &&
          privateData.expiresAt === fulfillment.privateExpiresAt &&
          new Date(privateData.expiresAt) > new Date(),
        );
        const packingSourceValid =
          commercialSourceValid &&
          packingWork !== "invalid" &&
          (exactPackingWork === null ||
            (fulfillment !== null &&
              order !== null &&
              packingWorkMatchesOutboundAdminSource(
                exactPackingWork,
                order,
                fulfillment,
                parcelSnapshot,
                booking,
              )));
        const exactLockedParcelSnapshot = Boolean(
          parcelSnapshot &&
          parcelSnapshot.orderId === booking.orderId &&
          parcelSnapshot.fulfillmentRevision === booking.fulfillmentRevision &&
          parcelSnapshot.purgeAt === booking.purgeAt &&
          parcelSnapshot.lockedShipmentId === booking.id,
        );
        const packingAllowsNewShipmentEffect =
          booking.providerId === carrierProviderId &&
          packingSourceValid &&
          npShopPackingWorkAllowsShipmentEffect(exactPackingWork, booking.id);
        const labelRelationshipValid = Boolean(
          labelAcquisition && outboundLabelAcquisitionMatchesBooking(labelAcquisition, booking),
        );
        const labelAction =
          booking.status !== "completed" || trackedShipments.has(booking.id)
            ? "—"
            : labelAcquisition?.status === "pending" ||
                labelAcquisition?.status === "provider-confirmed"
              ? packingWork === "invalid"
                ? "—"
                : labelRelationshipValid && booking.providerId === carrierProviderId
                  ? "resume"
                  : "—"
              : !packingAllowsNewShipmentEffect
                ? "—"
                : !labelAcquisition
                  ? "purchase"
                  : labelAcquisition.status === "completed" && labelRelationshipValid
                    ? "regenerate"
                    : "—";
        return {
          id: booking.orderId,
          shipmentId: booking.id,
          provider: booking.providerId,
          status: booking.status,
          fulfillmentRevision: booking.fulfillmentRevision,
          carrier: booking.carrier ?? "—",
          trackingNumber: booking.trackingNumber ?? "—",
          providerError: booking.providerErrorCode ?? "—",
          carrierResumeEligible:
            (booking.status === "pending" || booking.status === "provider-confirmed") &&
            packingSourceValid &&
            npShopPackingWorkAllowsShipmentEffect(exactPackingWork, booking.id) &&
            (booking.status === "provider-confirmed" ||
              (privateSourceAvailable &&
                booking.providerId === carrierProviderId &&
                ((parcelSnapshot?.lockedShipmentId ?? null) === null ||
                  (parcelSnapshot?.lockedShipmentId === booking.id && parcelAwareCarrier)))),
          pickupAction:
            booking.status === "completed" &&
            !trackedShipments.has(booking.id) &&
            !pickup &&
            exactLockedParcelSnapshot &&
            packingAllowsNewShipmentEffect
              ? "schedule"
              : "—",
          pickupRevision: pickup?.revision ?? 0,
          pickupTarget: "outbound",
          exchangeId: null,
          labelAction,
          labelDownloadEligible: Boolean(
            labelAcquisition?.status === "completed" &&
            labelRelationshipValid &&
            booking.providerId === carrierProviderId,
          ),
          expectedRevision: labelAcquisition?.revision ?? 0,
          target: "outbound",
          updatedAt: booking.updatedAt,
        };
      }),
    ),
    total,
  };
}

export async function npCountShopCarrierBookings(expectedProviderId?: string): Promise<{
  total: number;
  pending: number;
  providerConfirmed: number;
  completed: number;
  manualReview: number;
  invalidSample: number;
  orphanSample: number;
  providerMismatchSample: number;
  stateMismatchSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "carrier-booking:%"),
  );
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'pending')::int`,
      providerConfirmed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'provider-confirmed')::int`,
      completed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'completed')::int`,
      manualReview: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'manual-review')::int`,
    })
    .from(npPluginStorage)
    .where(where);
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(where)
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopCarrierLimits.diagnosticSampleSize);
  let invalidSample = 0;
  let orphanSample = 0;
  let providerMismatchSample = 0;
  let stateMismatchSample = 0;
  for (const row of rows) {
    try {
      const booking = requireStoredCarrierBookingAtKey(row.value, row.expiresAt, row.key);
      if (
        expectedProviderId &&
        booking.status !== "completed" &&
        booking.providerId !== expectedProviderId
      ) {
        providerMismatchSample += 1;
      }
      const fulfillment = await readStoredFulfillment(db, siteId, booking.orderId);
      if (!fulfillment) {
        orphanSample += 1;
        continue;
      }
      if (
        (booking.status === "completed" &&
          (fulfillment.status !== "shipped" ||
            fulfillment.revision !== booking.fulfillmentRevision + 1 ||
            fulfillment.carrier !== booking.carrier ||
            fulfillment.trackingNumber !== booking.trackingNumber)) ||
        ((booking.status === "pending" || booking.status === "provider-confirmed") &&
          (fulfillment.status !== "processing" ||
            fulfillment.revision !== booking.fulfillmentRevision))
      ) {
        stateMismatchSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  return {
    ...counts,
    invalidSample,
    orphanSample,
    providerMismatchSample,
    stateMismatchSample,
  };
}

export async function npCountShopPaymentEvents(): Promise<{
  total: number;
  invalidSample: number;
  orphanSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-event:%"),
      ),
    );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-event:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentLimits.diagnosticSampleSize);
  const receipts: NpShopStoredPaymentReceipt[] = [];
  let invalidSample = 0;
  for (const row of rows) {
    try {
      const receipt = npRequireStoredShopPaymentReceipt(row.value);
      if (
        row.key !== npShopPaymentReceiptStorageKey(receipt.providerId, receipt.event.eventId) ||
        row.expiresAt === null ||
        row.expiresAt.toISOString() !== receipt.purgeAt
      ) {
        throw new Error("payment receipt metadata mismatch");
      }
      receipts.push(receipt);
    } catch {
      invalidSample += 1;
    }
  }
  const lookupKeys = [
    ...new Set(receipts.map((receipt) => lookupStorageKey(receipt.event.orderId))),
  ];
  const existingLookups =
    lookupKeys.length === 0
      ? []
      : await db
          .select({ key: npPluginStorage.key })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              inArray(npPluginStorage.key, lookupKeys),
            ),
          );
  const lookupSet = new Set(existingLookups.map((row) => row.key));
  const orphanSample = receipts.filter(
    (receipt) => !lookupSet.has(lookupStorageKey(receipt.event.orderId)),
  ).length;
  return { total, invalidSample, orphanSample };
}

export async function npListRecentShopPaymentEvents(): Promise<{
  rows: NpShopAdminPaymentEventRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-event:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-event:%"),
      ),
    );
  return {
    rows: rows.map((row) => {
      const receipt = npRequireStoredShopPaymentReceipt(row.value);
      if (
        row.key !== npShopPaymentReceiptStorageKey(receipt.providerId, receipt.event.eventId) ||
        row.expiresAt === null ||
        row.expiresAt.toISOString() !== receipt.purgeAt
      ) {
        throw new NpShopOrderContractError("Invalid Shop payment receipt storage metadata", [
          "Payment receipt key and expiry must match its canonical value.",
        ]);
      }
      return {
        provider: receipt.providerId,
        eventId: receipt.event.eventId,
        type: receipt.event.type,
        orderId: receipt.event.orderId,
        outcome: receipt.outcome,
        orderStatus: receipt.orderStatus,
        processedAt: receipt.processedAt,
      };
    }),
    total,
  };
}

function requireReturnRevision(returnRequest: NpShopStoredReturn, expectedRevision: number): void {
  if (returnRequest.revision !== expectedRevision) {
    throw new NpShopReturnConflictError(
      "return_revision_conflict",
      "The return changed before this action was applied.",
    );
  }
}

function requireReturnOrderRetained(order: NpShopStoredOrder): void {
  if (new Date(order.purgeAt) <= new Date()) {
    throw new NpShopReturnConflictError(
      "return_order_expired",
      "The return order is past its commercial retention window.",
    );
  }
}

function requireReturnableOrderLines(
  order: NpShopStoredOrder,
  requestedLines: readonly { lineKey: string; quantity: number }[],
): void {
  for (const requestedLine of requestedLines) {
    const orderLine = order.lines.find((line) => line.key === requestedLine.lineKey);
    if (!orderLine || requestedLine.quantity > orderLine.quantity) {
      throw new NpShopReturnContractError("Invalid Shop return lines", [
        "Every returned line and quantity must be contained in the immutable order snapshot.",
      ]);
    }
  }
}

async function readReturnOrderForStaff(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<{ order: NpShopStoredOrder; returnRequest: NpShopStoredReturn }> {
  await lockOrderLookup(tx, siteId, orderId);
  const lookup = await readOrderLookupForUpdate(tx, siteId, orderId);
  if (!lookup) {
    throw new NpShopReturnConflictError("return_not_found", "The Shop return order is missing.");
  }
  await lockOrder(tx, siteId, lookup.ownerSegment, orderId);
  const order = await readStoredOrderForUpdate(tx, siteId, lookup.ownerSegment, orderId);
  const returnRequest = await readStoredReturn(tx, siteId, orderId, true);
  if (!order || !returnRequest || !returnMatchesOrder(returnRequest, order)) {
    throw new NpShopReturnConflictError(
      "return_not_found",
      "The Shop return or its exact order is missing.",
    );
  }
  requireReturnOrderRetained(order);
  const fulfillment = await readStoredFulfillment(tx, siteId, orderId, true);
  if (
    !fulfillment ||
    fulfillment.status !== "shipped" ||
    !fulfillmentMatchesOrder(fulfillment, order)
  ) {
    throw new NpShopReturnConflictError(
      "return_order_not_shipped",
      "A physical return requires one matching shipped fulfillment.",
    );
  }
  return { order, returnRequest };
}

export async function npRequestShopReturn(
  owner: NpShopCartOwner,
  input: NpShopReturnRequestInput,
): Promise<NpShopReturn> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  return getDb().transaction(async (tx) => {
    await lockOrder(tx, siteId, ownerSegment, input.orderId);
    const order = await readStoredOrderForUpdate(tx, siteId, ownerSegment, input.orderId);
    if (!order) {
      throw new NpShopReturnConflictError("return_not_found", "The Shop order does not exist.");
    }
    if (order.revision !== input.expectedOrderRevision) {
      throw new NpShopReturnConflictError(
        "return_order_revision_conflict",
        "The order changed before the return was requested.",
      );
    }
    requireReturnOrderRetained(order);
    if (order.status !== "paid" && order.status !== "refunded") {
      throw new NpShopReturnConflictError(
        "return_order_not_shipped",
        "Only one paid or refunded shipped order can request a return.",
      );
    }
    const fulfillment = await readStoredFulfillment(tx, siteId, order.id, true);
    if (
      !fulfillment ||
      fulfillment.status !== "shipped" ||
      !fulfillmentMatchesOrder(fulfillment, order)
    ) {
      throw new NpShopReturnConflictError(
        "return_order_not_shipped",
        "The order must have one exact shipped fulfillment before a return can be requested.",
      );
    }
    if (await readStoredReturn(tx, siteId, order.id, true)) {
      throw new NpShopReturnConflictError(
        "return_already_exists",
        "This order already has one durable return record.",
      );
    }
    requireReturnableOrderLines(order, input.lines);
    const now = new Date().toISOString();
    const returnRequest: NpShopStoredReturn = {
      contract: NP_SHOP_RETURN_STORAGE_CONTRACT,
      id: randomUUID(),
      orderId: order.id,
      ownerSegment,
      status: "requested",
      revision: 1,
      orderRevision: order.revision,
      lines: input.lines,
      reason: input.reason,
      detail: input.detail,
      operatorNote: null,
      inventoryOutcome: "pending",
      requestedAt: now,
      updatedAt: now,
      decidedAt: null,
      receivedAt: null,
      purgeAt: order.purgeAt,
    };
    await persistReturn(tx, siteId, returnRequest);
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment,
      kind: "return.requested",
      orderRevision: order.revision,
      occurredAt: now,
      purgeAt: order.purgeAt,
      email: null,
    });
    return npProjectShopReturn(returnRequest);
  });
}

export async function npCancelShopReturn(
  owner: NpShopCartOwner,
  input: NpShopReturnCancelInput,
): Promise<NpShopReturn> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  return getDb().transaction(async (tx) => {
    await lockOrder(tx, siteId, ownerSegment, input.orderId);
    const order = await readStoredOrderForUpdate(tx, siteId, ownerSegment, input.orderId);
    const current = await readStoredReturn(tx, siteId, input.orderId, true);
    if (!order || !current || !returnMatchesOrder(current, order)) {
      throw new NpShopReturnConflictError("return_not_found", "The Shop return does not exist.");
    }
    requireReturnOrderRetained(order);
    requireReturnRevision(current, input.expectedRevision);
    if (current.status !== "requested") {
      throw new NpShopReturnConflictError(
        "return_invalid_transition",
        "Only a return awaiting staff review can be cancelled by its owner.",
      );
    }
    const now = new Date().toISOString();
    const cancelled: NpShopStoredReturn = {
      ...current,
      status: "cancelled",
      revision: current.revision + 1,
      inventoryOutcome: "not-required",
      updatedAt: now,
      decidedAt: now,
    };
    await persistReturn(tx, siteId, cancelled);
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment,
      kind: "return.cancelled",
      orderRevision: order.revision,
      occurredAt: now,
      purgeAt: order.purgeAt,
      email: null,
    });
    return npProjectShopReturn(cancelled);
  });
}

export async function npApproveShopReturn(
  input: NpShopReturnStaffInput,
  staffUserId: string,
): Promise<NpShopReturn> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { order, returnRequest } = await readReturnOrderForStaff(tx, siteId, input.orderId);
    requireReturnRevision(returnRequest, input.expectedRevision);
    if (returnRequest.status !== "requested") {
      throw new NpShopReturnConflictError(
        "return_invalid_transition",
        "Only a requested return can be approved.",
      );
    }
    const now = new Date().toISOString();
    const approved: NpShopStoredReturn = {
      ...returnRequest,
      status: "approved",
      revision: returnRequest.revision + 1,
      operatorNote: input.operatorNote,
      updatedAt: now,
      decidedAt: now,
    };
    await persistReturn(tx, siteId, approved);
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment: order.ownerSegment,
      kind: "return.approved",
      orderRevision: order.revision,
      occurredAt: now,
      purgeAt: order.purgeAt,
      email: null,
    });
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.return.approve",
      input.orderId,
      {
        returnId: approved.id,
        returnRevision: approved.revision,
        lineCount: approved.lines.length,
      },
    );
    return npProjectShopReturn(approved);
  });
}

export async function npRejectShopReturn(
  input: NpShopReturnStaffInput,
  staffUserId: string,
): Promise<NpShopReturn> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { order, returnRequest } = await readReturnOrderForStaff(tx, siteId, input.orderId);
    requireReturnRevision(returnRequest, input.expectedRevision);
    if (returnRequest.status !== "requested") {
      throw new NpShopReturnConflictError(
        "return_invalid_transition",
        "Only a requested return can be rejected.",
      );
    }
    const now = new Date().toISOString();
    const rejected: NpShopStoredReturn = {
      ...returnRequest,
      status: "rejected",
      revision: returnRequest.revision + 1,
      operatorNote: input.operatorNote,
      inventoryOutcome: "not-required",
      updatedAt: now,
      decidedAt: now,
    };
    await persistReturn(tx, siteId, rejected);
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment: order.ownerSegment,
      kind: "return.rejected",
      orderRevision: order.revision,
      occurredAt: now,
      purgeAt: order.purgeAt,
      email: null,
    });
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.return.reject",
      input.orderId,
      {
        returnId: rejected.id,
        returnRevision: rejected.revision,
      },
    );
    return npProjectShopReturn(rejected);
  });
}

export async function npReceiveShopReturn(
  runtime: NpShopRuntime,
  input: NpShopReturnStaffInput,
  staffUserId: string,
): Promise<NpShopReturn> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { order, returnRequest } = await readReturnOrderForStaff(tx, siteId, input.orderId);
    requireReturnRevision(returnRequest, input.expectedRevision);
    if (returnRequest.status !== "approved") {
      throw new NpShopReturnConflictError(
        "return_invalid_transition",
        "Only an approved return can be marked received.",
      );
    }
    const requestedByKey = new Map(
      returnRequest.lines.map((line) => [line.lineKey, line.quantity]),
    );
    const trackedKeys = new Set(order.inventoryReservationLineKeys);
    const trackedLines = order.lines
      .filter((line) => trackedKeys.has(line.key) && requestedByKey.has(line.key))
      .map((line) => {
        const quantity = requestedByKey.get(line.key)!;
        return { ...line, quantity, lineTotalMinor: line.unitPriceMinor * quantity };
      });
    const inventoryOutcome =
      trackedLines.length === 0
        ? "not-required"
        : (await npRestoreShopOrderInventory(tx, siteId, runtime, trackedLines))
          ? "restocked"
          : "manual-required";
    const now = new Date().toISOString();
    const received: NpShopStoredReturn = {
      ...returnRequest,
      status: "received",
      revision: returnRequest.revision + 1,
      operatorNote: input.operatorNote ?? returnRequest.operatorNote,
      inventoryOutcome,
      updatedAt: now,
      receivedAt: now,
    };
    await persistReturn(tx, siteId, received);
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment: order.ownerSegment,
      kind: "return.received",
      orderRevision: order.revision,
      occurredAt: now,
      purgeAt: order.purgeAt,
      email: null,
    });
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.return.receive",
      input.orderId,
      {
        returnId: received.id,
        returnRevision: received.revision,
        inventoryOutcome,
        trackedLineCount: trackedLines.length,
      },
    );
    return npProjectShopReturn(received);
  });
}

function exchangeInventoryLines(
  order: NpShopStoredOrder,
  returnRequest: NpShopStoredReturn,
): NpShopStoredOrder["lines"] {
  const quantities = new Map(returnRequest.lines.map((line) => [line.lineKey, line.quantity]));
  return order.lines
    .filter((line) => quantities.has(line.key))
    .map((line) => {
      const quantity = quantities.get(line.key)!;
      return { ...line, quantity, lineTotalMinor: line.unitPriceMinor * quantity };
    });
}

async function readExchangeForAction(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<{
  order: NpShopStoredOrder;
  returnRequest: NpShopStoredReturn;
  exchange: NpShopStoredExchange;
}> {
  await lockOrderLookup(tx, siteId, orderId);
  const lookup = await readOrderLookupForUpdate(tx, siteId, orderId);
  if (!lookup) {
    throw new NpShopExchangeConflictError("exchange_not_found", "The Shop order is missing.");
  }
  await lockOrder(tx, siteId, lookup.ownerSegment, orderId);
  const order = await readStoredOrderForUpdate(tx, siteId, lookup.ownerSegment, orderId);
  const returnRequest = await readStoredReturn(tx, siteId, orderId, true);
  const exchange = await readStoredExchange(tx, siteId, orderId, true);
  if (
    !order ||
    !returnRequest ||
    !exchange ||
    !returnMatchesOrder(returnRequest, order) ||
    !exchangeMatchesOrder(exchange, order, returnRequest)
  ) {
    throw new NpShopExchangeConflictError(
      "exchange_not_found",
      "The same-item exchange or its exact received return is missing.",
    );
  }
  if (await paymentDisputeRequiresReviewForOrder(tx, siteId, order, true)) {
    throw new NpShopExchangeConflictError(
      "exchange_payment_conflict",
      "This exchange cannot change while a payment dispute requires provider reconciliation.",
    );
  }
  return { order, returnRequest, exchange };
}

function requireExchangeRevisions(
  order: NpShopStoredOrder,
  exchange: NpShopStoredExchange,
  input: NpShopExchangeUpdateInput,
): void {
  if (
    order.revision !== input.orderRevision ||
    exchange.id !== input.exchangeId ||
    exchange.revision !== input.exchangeRevision
  ) {
    throw new NpShopExchangeConflictError(
      "exchange_revision_conflict",
      "The order or exchange changed before this action was applied.",
    );
  }
}

export async function npIssueShopExchangeDestinationAuthority(
  owner: NpShopCartOwner,
  order: NpShopOrder,
): Promise<NpShopExchangeDestinationAuthority | null> {
  const exchange = order.exchange;
  if (
    !exchange ||
    exchange.status !== "awaiting" ||
    (exchange.destinationStatus !== "awaiting" && exchange.destinationStatus !== "expired")
  ) {
    return null;
  }
  const siteId = await requireSiteId();
  const now = Date.now();
  const expiresAt = now + npShopExchangeDestinationLimits.authorityTtlSeconds * 1_000;
  const payload: NpShopExchangeDestinationAuthorityPayload = {
    version: 1,
    siteId,
    ownerSegment: npShopCartOwnerStorageSegment(owner),
    orderId: order.id,
    exchangeId: exchange.id,
    orderRevision: order.revision,
    exchangeRevision: exchange.revision,
    destinationRevision: exchange.destinationRevision,
    issuedAt: now,
    expiresAt,
  };
  return npRequireShopExchangeDestinationAuthority({
    contract: NP_SHOP_EXCHANGE_DESTINATION_AUTHORITY_CONTRACT,
    orderId: order.id,
    exchangeId: exchange.id,
    orderRevision: order.revision,
    exchangeRevision: exchange.revision,
    destinationRevision: exchange.destinationRevision,
    token: encodeExchangeDestinationAuthority(payload),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  });
}

export async function npSubmitShopExchangeDestination(
  owner: NpShopCartOwner,
  input: NpShopExchangeDestinationSubmitInput,
): Promise<NpShopExchange> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const authority = decodeExchangeDestinationAuthority(input.authorityToken);
  if (
    authority.siteId !== siteId ||
    authority.ownerSegment !== ownerSegment ||
    authority.orderId !== input.orderId ||
    authority.exchangeId !== input.exchangeId ||
    authority.orderRevision !== input.orderRevision ||
    authority.exchangeRevision !== input.exchangeRevision ||
    authority.destinationRevision !== input.destinationRevision ||
    authority.expiresAt <= Date.now()
  ) {
    throw invalidExchangeDestinationAuthority();
  }
  return getDb().transaction(async (tx) => {
    await lockOrder(tx, siteId, ownerSegment, input.orderId);
    const order = await readStoredOrderForUpdate(tx, siteId, ownerSegment, input.orderId);
    const returnRequest = await readStoredReturn(tx, siteId, input.orderId, true);
    const exchange = await readStoredExchange(tx, siteId, input.orderId, true);
    if (
      !order ||
      !returnRequest ||
      !exchange ||
      !returnMatchesOrder(returnRequest, order) ||
      !exchangeMatchesOrder(exchange, order, returnRequest) ||
      exchange.id !== input.exchangeId
    ) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_not_found",
        "The exchange awaiting a replacement destination is missing.",
      );
    }
    if (
      order.revision !== input.orderRevision ||
      exchange.revision !== input.exchangeRevision ||
      exchange.destinationRevision !== input.destinationRevision
    ) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_revision_conflict",
        "The exchange changed before the replacement destination was submitted.",
      );
    }
    if (exchange.status !== "awaiting" || exchange.destinationRedactedAt !== null) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_unavailable",
        "This exchange no longer accepts a replacement destination.",
      );
    }
    const nowDate = new Date();
    const currentDestination = await readStoredExchangeDestinationPrivate(
      tx,
      siteId,
      input.orderId,
      true,
    );
    if (await readStoredExchangeCarrierBooking(tx, siteId, input.orderId, true)) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_unavailable",
        "A durable replacement carrier operation already owns this destination revision.",
      );
    }
    if (currentDestination && !exchangeDestinationMatches(currentDestination, exchange)) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_revision_conflict",
        "The retained replacement destination does not match this exchange revision.",
      );
    }
    if (currentDestination && new Date(currentDestination.expiresAt) > nowDate) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_already_submitted",
        "A replacement destination is already retained for this exchange.",
      );
    }
    if (currentDestination) {
      await deleteExchangeDestinationPrivate(tx, siteId, input.orderId);
    }
    const now = nowDate.toISOString();
    const expiresAt = new Date(
      Math.min(
        nowDate.getTime() + npShopExchangeDestinationLimits.privateRetentionSeconds * 1_000,
        new Date(order.purgeAt).getTime(),
      ),
    ).toISOString();
    if (expiresAt <= now) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_unavailable",
        "This order is no longer retained long enough to accept a destination.",
      );
    }
    const privacyOnlyResubmission = exchange.destinationRevision > 0;
    const updatedOrder: NpShopStoredOrder = privacyOnlyResubmission
      ? order
      : {
          ...order,
          revision: order.revision + 1,
          updatedAt: now,
        };
    const updatedExchange: NpShopStoredExchange = {
      ...exchange,
      revision: exchange.revision + (privacyOnlyResubmission ? 0 : 1),
      orderRevision: updatedOrder.revision,
      destinationRevision: exchange.destinationRevision + 1,
      destinationSubmittedAt: now,
      destinationRedactedAt: null,
      updatedAt: now,
    };
    const destination: NpShopStoredExchangeDestinationPrivate = {
      contract: NP_SHOP_EXCHANGE_DESTINATION_PRIVATE_CONTRACT,
      orderId: order.id,
      exchangeId: exchange.id,
      ownerSegment,
      exchangeRevision: updatedExchange.revision,
      destinationRevision: updatedExchange.destinationRevision,
      destination: input.destination,
      submittedAt: now,
      accessedAt: null,
      updatedAt: now,
      expiresAt,
    };
    if (!privacyOnlyResubmission) await persistOrder(tx, siteId, updatedOrder);
    await persistExchange(tx, siteId, updatedExchange);
    await persistExchangeDestinationPrivate(tx, siteId, destination);
    await tx.insert(npAuditEvents).values({
      actorKind: owner.kind === "member" ? "member" : "system",
      actorUserId: null,
      actorMemberId: owner.kind === "member" ? owner.memberId : null,
      action: "shop.exchange.destination.submit",
      targetType: "shop-order",
      targetId: order.id,
      payload: {
        exchangeId: exchange.id,
        exchangeRevision: updatedExchange.revision,
        destinationRevision: updatedExchange.destinationRevision,
        expiresAt,
      },
      siteId,
    });
    return npProjectShopExchange(updatedExchange, destination);
  });
}

export async function npReadShopExchangeDestination(
  input: NpShopExchangeDestinationReadInput,
  staffUserId: string,
): Promise<{
  destination: NpShopStoredExchangeDestinationPrivate["destination"];
  expiresAt: string;
}> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { order, exchange } = await readExchangeForAction(tx, siteId, input.orderId);
    if (
      exchange.id !== input.exchangeId ||
      order.revision !== input.orderRevision ||
      exchange.revision !== input.exchangeRevision ||
      exchange.destinationRevision !== input.destinationRevision
    ) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_revision_conflict",
        "The exchange destination changed before it was accessed.",
      );
    }
    if (exchange.status !== "awaiting" || exchange.destinationRedactedAt !== null) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_unavailable",
        "This exchange no longer retains a destination.",
      );
    }
    const current = await readStoredExchangeDestinationPrivate(tx, siteId, input.orderId, true);
    if (!current || !exchangeDestinationMatches(current, exchange)) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_not_found",
        "The replacement destination is missing.",
      );
    }
    const nowDate = new Date();
    if (new Date(current.expiresAt) <= nowDate) {
      throw new NpShopExchangeDestinationConflictError(
        "exchange_destination_expired",
        "The replacement destination expired and must be submitted again.",
      );
    }
    const accessed: NpShopStoredExchangeDestinationPrivate = current.accessedAt
      ? current
      : { ...current, accessedAt: nowDate.toISOString(), updatedAt: nowDate.toISOString() };
    if (accessed !== current) await persistExchangeDestinationPrivate(tx, siteId, accessed);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.exchange.destination.private.read",
      input.orderId,
      {
        exchangeId: exchange.id,
        exchangeRevision: exchange.revision,
        destinationRevision: exchange.destinationRevision,
        expiresAt: accessed.expiresAt,
      },
    );
    return { destination: accessed.destination, expiresAt: accessed.expiresAt };
  });
}

export async function npCreateShopExchange(
  runtime: NpShopRuntime,
  input: NpShopExchangeCreateInput,
  staffUserId: string,
): Promise<NpShopExchange> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    await lockOrderLookup(tx, siteId, input.orderId);
    const lookup = await readOrderLookupForUpdate(tx, siteId, input.orderId);
    if (!lookup) {
      throw new NpShopExchangeConflictError("exchange_not_found", "The Shop order is missing.");
    }
    await lockOrder(tx, siteId, lookup.ownerSegment, input.orderId);
    const order = await readStoredOrderForUpdate(tx, siteId, lookup.ownerSegment, input.orderId);
    const returnRequest = await readStoredReturn(tx, siteId, input.orderId, true);
    if (
      !order ||
      !returnRequest ||
      !returnMatchesOrder(returnRequest, order) ||
      returnRequest.id !== input.returnId
    ) {
      throw new NpShopExchangeConflictError(
        "exchange_not_found",
        "The exact Shop order and return are missing.",
      );
    }
    if (await readStoredExchange(tx, siteId, input.orderId, true)) {
      throw new NpShopExchangeConflictError(
        "exchange_already_exists",
        "This return already owns one same-item exchange.",
      );
    }
    if (order.revision !== input.orderRevision || returnRequest.revision !== input.returnRevision) {
      throw new NpShopExchangeConflictError(
        "exchange_revision_conflict",
        "The order or return changed before the exchange was created.",
      );
    }
    if (
      order.status !== "paid" ||
      returnRequest.status !== "received" ||
      (returnRequest.inventoryOutcome !== "restocked" &&
        returnRequest.inventoryOutcome !== "not-required")
    ) {
      throw new NpShopExchangeConflictError(
        "exchange_return_not_received",
        "A received return with reconciled inventory is required for an exchange.",
      );
    }
    const fulfillment = await readStoredFulfillment(tx, siteId, order.id, true);
    if (
      !fulfillment ||
      fulfillment.status !== "shipped" ||
      !fulfillmentMatchesOrder(fulfillment, order)
    ) {
      throw new NpShopExchangeConflictError(
        "exchange_return_not_received",
        "A same-item exchange requires the original shipped fulfillment.",
      );
    }
    const fullRefund = await readStoredRefund(tx, siteId, order.id, true);
    const partialRefund = await npReadStoredShopPartialRefundForAdjustment(
      tx,
      siteId,
      order.id,
      true,
    );
    const paymentAdjustment = await npReadStoredShopPaymentAdjustment(tx, siteId, order.id, true);
    if (fullRefund || partialRefund || paymentAdjustment?.status === "manual-review") {
      throw new NpShopExchangeConflictError(
        "exchange_payment_conflict",
        "A refund or unresolved payment adjustment prevents this exchange.",
      );
    }
    if (await paymentDisputeRequiresReviewForOrder(tx, siteId, order, true)) {
      throw new NpShopExchangeConflictError(
        "exchange_payment_conflict",
        "An unresolved or lost payment dispute prevents this exchange.",
      );
    }
    const allLines = exchangeInventoryLines(order, returnRequest);
    const trackedKeys = new Set(order.inventoryReservationLineKeys);
    const trackedLines = allLines.filter((line) => trackedKeys.has(line.key));
    await npLockShopInventoryProducts(
      tx,
      siteId,
      trackedLines.map((line) => line.productId),
    );
    try {
      await npConsumeShopReplacementInventory(tx, siteId, runtime, trackedLines);
    } catch (error) {
      if (error instanceof NpShopPaymentConflictError) {
        throw new NpShopExchangeConflictError(
          "exchange_inventory_unavailable",
          "Exact replacement inventory is unavailable or no longer matches the order snapshot.",
        );
      }
      throw error;
    }
    const now = new Date().toISOString();
    const updatedOrder: NpShopStoredOrder = {
      ...order,
      revision: order.revision + 1,
      updatedAt: now,
    };
    const exchange: NpShopStoredExchange = {
      contract: NP_SHOP_EXCHANGE_STORAGE_CONTRACT,
      id: randomUUID(),
      orderId: order.id,
      returnId: returnRequest.id,
      ownerSegment: order.ownerSegment,
      status: "awaiting",
      revision: 1,
      orderRevision: updatedOrder.revision,
      returnRevision: returnRequest.revision,
      destinationRevision: 0,
      destinationSubmittedAt: null,
      destinationRedactedAt: null,
      lines: npShopExchangeLinesFromOrder(order.lines, returnRequest.lines),
      inventoryOutcome: trackedLines.length === 0 ? "not-required" : "consumed",
      carrier: null,
      trackingNumber: null,
      operatorNote: input.operatorNote,
      createdAt: now,
      updatedAt: now,
      shippedAt: null,
      cancelledAt: null,
      purgeAt: order.purgeAt,
    };
    await persistOrder(tx, siteId, updatedOrder);
    await persistExchange(tx, siteId, exchange);
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment: order.ownerSegment,
      kind: "exchange.created",
      orderRevision: updatedOrder.revision,
      occurredAt: now,
      purgeAt: order.purgeAt,
      email: null,
    });
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.exchange.create",
      order.id,
      {
        exchangeId: exchange.id,
        returnId: exchange.returnId,
        units: exchange.lines.reduce((total, line) => total + line.quantity, 0),
        inventoryOutcome: exchange.inventoryOutcome,
      },
    );
    return npProjectShopExchange(exchange);
  });
}

async function updateShopExchange(
  runtime: NpShopRuntime,
  input: NpShopExchangeUpdateInput,
  staffUserId: string,
  action: "process" | "ship" | "cancel",
): Promise<NpShopExchange> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { order, returnRequest, exchange } = await readExchangeForAction(
      tx,
      siteId,
      input.orderId,
    );
    requireExchangeRevisions(order, exchange, input);
    const exchangeCarrierBooking = await readStoredExchangeCarrierBooking(
      tx,
      siteId,
      input.orderId,
      true,
    );
    const parcelSnapshot = await readStoredExchangeParcels(tx, siteId, input.orderId, true);
    const packingWork = await npReadStoredShopPackingWork(
      tx,
      siteId,
      "replacement",
      input.orderId,
      true,
    );
    const exchangeTracking =
      action === "ship"
        ? await npReadStoredShopExchangeTrackingForOrder(tx, siteId, input.orderId, true)
        : null;
    if (exchangeCarrierBooking) {
      if (
        action !== "ship" ||
        exchangeCarrierBooking.status !== "completed" ||
        exchangeCarrierBooking.exchangeId !== exchange.id ||
        !exchangeCarrierBookingMatchesCurrentSource(exchangeCarrierBooking, order, exchange)
      ) {
        throw new NpShopExchangeCarrierConflictError(
          exchangeCarrierBooking.status === "manual-review"
            ? "exchange_carrier_manual_review"
            : "exchange_carrier_state_conflict",
          "This exchange owns a carrier booking that must be reconciled or cancelled through its provider path.",
        );
      }
      const shipment = input as NpShopExchangeShipInput;
      if (
        shipment.carrier !== exchangeCarrierBooking.carrier ||
        shipment.trackingNumber !== exchangeCarrierBooking.trackingNumber
      ) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_state_conflict",
          "A booked exchange must ship with its exact provider carrier and tracking number.",
        );
      }
    }
    if (
      action === "ship" &&
      exchangeTracking &&
      (!exchangeCarrierBooking ||
        !exchangeTrackingMatchesBooking(exchangeTracking, exchangeCarrierBooking, exchange))
    ) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_state_conflict",
        "The verified replacement tracking state no longer matches its exact carrier booking.",
      );
    }
    if (exchange.status === "shipped" || exchange.status === "cancelled") {
      throw new NpShopExchangeConflictError(
        "exchange_terminal",
        "A shipped or cancelled exchange cannot transition again.",
      );
    }
    if (action === "process" && exchange.status !== "awaiting") {
      throw new NpShopExchangeConflictError(
        "exchange_revision_conflict",
        "Only an awaiting exchange can enter processing.",
      );
    }
    if (action === "ship" && exchange.status !== "processing") {
      throw new NpShopExchangeConflictError(
        "exchange_revision_conflict",
        "Only a processing exchange can be shipped.",
      );
    }
    const packingFallbackIdentity = {
      target: "replacement" as const,
      orderId: order.id,
      exchangeId: exchange.id,
      purgeAt: order.purgeAt,
    };
    if (
      action === "process" &&
      packingWork &&
      packingWork.status !== "active" &&
      !packingWorkAllowsUnattachedFallback(packingWork, packingFallbackIdentity)
    ) {
      throw new NpShopPackingWorkConflictError(
        packingWork.status === "manual-review"
          ? "packing_work_manual_review"
          : "packing_work_state_conflict",
        "Reconcile the replacement packing work before processing the exchange.",
      );
    }
    if (
      action === "process" &&
      packingWork?.status === "active" &&
      !packingWorkMatchesSource(packingWork, {
        target: "replacement",
        exchangeId: exchange.id,
        order,
        sourceRevision: exchange.revision,
        sourceStatus: exchange.status,
        booking: exchangeCarrierBooking,
        parcelSnapshot,
        lines: exchange.lines,
      })
    ) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_revision_conflict",
        "The active replacement packing work no longer matches its exact parcel source.",
      );
    }
    if (
      action === "cancel" &&
      packingWork &&
      !packingWorkAllowsUnattachedFallback(packingWork, packingFallbackIdentity)
    ) {
      throw new NpShopPackingWorkConflictError(
        packingWork.status === "manual-review"
          ? "packing_work_manual_review"
          : "packing_work_state_conflict",
        "Confirm packing-work cancellation before restoring replacement inventory.",
      );
    }
    if (action === "ship") {
      const packingSource = {
        target: "replacement" as const,
        exchangeId: exchange.id,
        order,
        sourceRevision: exchange.revision,
        sourceStatus: exchange.status,
        booking: exchangeCarrierBooking,
        parcelSnapshot,
        lines: exchange.lines,
      };
      const trackingWinsPackingCancellation = Boolean(
        exchangeTracking &&
        exchangeCarrierBooking &&
        exchangeTrackingMatchesBooking(exchangeTracking, exchangeCarrierBooking, exchange) &&
        packingWork?.attachedShipmentId === exchangeCarrierBooking.id &&
        packingWorkHasCancellationIntent(packingWork) &&
        packingWorkMatchesSnapshot(packingWork, packingSource),
      );
      if (!trackingWinsPackingCancellation) {
        await consumeShopPackingWork(
          tx,
          siteId,
          packingSource,
          exchangeCarrierBooking?.id ?? null,
          staffUserId,
        );
      }
    }
    const now = new Date().toISOString();
    if (action === "process") {
      const destination = await readStoredExchangeDestinationPrivate(
        tx,
        siteId,
        input.orderId,
        true,
      );
      if (!destination || !exchangeDestinationMatches(destination, exchange)) {
        throw new NpShopExchangeDestinationConflictError(
          "exchange_destination_access_required",
          "A current replacement destination must be submitted and accessed before processing.",
        );
      }
      if (destination.expiresAt <= now) {
        throw new NpShopExchangeDestinationConflictError(
          "exchange_destination_expired",
          "The replacement destination expired and must be submitted again.",
        );
      }
      if (destination.accessedAt === null) {
        throw new NpShopExchangeDestinationConflictError(
          "exchange_destination_access_required",
          "Staff must access the replacement destination before processing.",
        );
      }
    }
    let inventoryOutcome = exchange.inventoryOutcome;
    if (action === "cancel") {
      const trackedKeys = new Set(order.inventoryReservationLineKeys);
      const trackedLines = exchangeInventoryLines(order, returnRequest).filter((line) =>
        trackedKeys.has(line.key),
      );
      await npLockShopInventoryProducts(
        tx,
        siteId,
        trackedLines.map((line) => line.productId),
      );
      inventoryOutcome =
        trackedLines.length === 0
          ? "not-required"
          : (await npRestoreShopOrderInventory(tx, siteId, runtime, trackedLines))
            ? "restocked"
            : "manual-required";
    }
    const updatedOrder: NpShopStoredOrder = {
      ...order,
      revision: order.revision + 1,
      updatedAt: now,
    };
    const shipment = input as NpShopExchangeShipInput;
    const updated: NpShopStoredExchange = {
      ...exchange,
      status: action === "process" ? "processing" : action === "ship" ? "shipped" : "cancelled",
      revision: exchange.revision + 1,
      orderRevision: updatedOrder.revision,
      operatorNote: input.operatorNote ?? exchange.operatorNote,
      inventoryOutcome,
      carrier: action === "ship" ? shipment.carrier : null,
      trackingNumber: action === "ship" ? shipment.trackingNumber : null,
      destinationRedactedAt:
        action === "process"
          ? now
          : action === "cancel"
            ? (exchange.destinationRedactedAt ?? now)
            : exchange.destinationRedactedAt,
      updatedAt: now,
      shippedAt: action === "ship" ? now : null,
      cancelledAt: action === "cancel" ? now : null,
    };
    await persistOrder(tx, siteId, updatedOrder);
    await persistExchange(tx, siteId, updated);
    if (action === "process" || action === "cancel") {
      await deleteExchangeDestinationPrivate(tx, siteId, input.orderId);
    }
    await npStageShopOrderNotification(tx, siteId, {
      orderId: order.id,
      ownerSegment: order.ownerSegment,
      kind:
        action === "process"
          ? "exchange.processing"
          : action === "ship"
            ? "exchange.shipped"
            : "exchange.cancelled",
      orderRevision: updatedOrder.revision,
      occurredAt: now,
      purgeAt: order.purgeAt,
      email: null,
    });
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      `shop.exchange.${action}`,
      order.id,
      {
        exchangeId: exchange.id,
        previousRevision: exchange.revision,
        revision: updated.revision,
        inventoryOutcome: updated.inventoryOutcome,
        ...(action === "ship" ? { carrier: updated.carrier } : {}),
      },
    );
    return npProjectShopExchange(updated);
  });
}

function exchangeCarrierItems(exchange: NpShopStoredExchange) {
  return exchange.lines.map((line) => ({
    key: line.lineKey,
    productId: line.productId,
    productName: line.productName,
    variantSku: line.variantSku,
    variantName: line.variantName,
    quantity: line.quantity,
  }));
}

function requireExchangeParcelAllocation(
  exchange: Pick<NpShopStoredExchange, "lines">,
  parcels: NpShopStoredExchangeParcels["parcels"],
): void {
  const allocated = new Map<string, number>();
  for (const parcel of parcels) {
    for (const item of parcel.items) {
      allocated.set(item.lineKey, (allocated.get(item.lineKey) ?? 0) + item.quantity);
    }
  }
  if (
    allocated.size !== exchange.lines.length ||
    exchange.lines.some((line) => allocated.get(line.lineKey) !== line.quantity) ||
    [...allocated.keys()].some(
      (lineKey) => !exchange.lines.some((line) => line.lineKey === lineKey),
    )
  ) {
    throw new NpShopExchangeParcelConflictError(
      "exchange_parcel_allocation_mismatch",
      "Replacement parcel allocations must cover every immutable exchange line and exact quantity.",
    );
  }
}

export async function npSaveShopExchangeParcels(
  input: NpShopExchangeParcelsSaveInput,
  staffUserId: string,
  proposal: { proposalId: string; providerId: string; expiresAt: string } | null = null,
): Promise<NpShopStoredExchangeParcels> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { order, exchange } = await readExchangeForAction(tx, siteId, input.orderId);
    if (exchange.id !== input.exchangeId || exchange.status !== "awaiting") {
      throw new NpShopExchangeParcelConflictError(
        "exchange_parcel_not_awaiting",
        "Replacement parcels can be prepared only for the current awaiting exchange.",
      );
    }
    if (exchange.revision !== input.expectedExchangeRevision) {
      throw new NpShopExchangeParcelConflictError(
        "exchange_parcel_revision_conflict",
        "The exchange changed before the parcel snapshot was saved.",
      );
    }
    const booking = await readStoredExchangeCarrierBooking(tx, siteId, input.orderId, true);
    const existing = await readStoredExchangeParcels(tx, siteId, input.orderId, true);
    const packingWork = await npReadStoredShopPackingWork(
      tx,
      siteId,
      "replacement",
      input.orderId,
      true,
    );
    requirePackingWorkAllowsParcelMutation(packingWork, {
      target: "replacement",
      orderId: order.id,
      exchangeId: exchange.id,
      purgeAt: order.purgeAt,
    });
    if (booking || existing?.lockedShipmentId) {
      throw new NpShopExchangeParcelConflictError(
        "exchange_parcel_locked",
        "The replacement parcel snapshot is locked by a durable carrier booking.",
      );
    }
    if ((existing?.revision ?? null) !== input.expectedParcelRevision) {
      throw new NpShopExchangeParcelConflictError(
        "exchange_parcel_revision_conflict",
        "The replacement parcel snapshot changed before this action was applied.",
      );
    }
    requireExchangeParcelAllocation(exchange, input.parcels);
    const nowDate = new Date();
    if (proposal && new Date(proposal.expiresAt).getTime() <= nowDate.getTime()) {
      throw new NpShopPackagingProposalUnavailableError(
        "The packaging proposal expired before it could be saved.",
      );
    }
    const now = nowDate.toISOString();
    const next = {
      contract: NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT,
      orderId: order.id,
      exchangeId: exchange.id,
      exchangeRevision: exchange.revision,
      revision: (existing?.revision ?? 0) + 1,
      parcels: input.parcels,
      lockedShipmentId: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      purgeAt: order.purgeAt,
    } satisfies NpShopStoredExchangeParcels;
    await persistExchangeParcels(tx, siteId, next);
    const totals = npShopFulfillmentParcelTotals(next.parcels);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      proposal ? "shop.exchange.parcels.propose" : "shop.exchange.parcels.save",
      order.id,
      {
        exchangeId: exchange.id,
        exchangeRevision: exchange.revision,
        parcelRevision: next.revision,
        parcelCount: totals.parcelCount,
        unitCount: totals.unitCount,
        weightGrams: totals.weightGrams,
        ...(proposal ? { proposalId: proposal.proposalId, providerId: proposal.providerId } : {}),
      },
    );
    return next;
  });
}

type NpShopLockedPackingWorkSource =
  | {
      target: "outbound";
      exchangeId: null;
      order: NpShopStoredOrder;
      sourceRevision: number;
      sourceStatus: NpShopStoredFulfillment["status"];
      booking: NpShopStoredCarrierBooking | null;
      parcelSnapshot: NpShopStoredFulfillmentParcels | null;
      lines: NpShopStoredOrder["lines"];
    }
  | {
      target: "replacement";
      exchangeId: string;
      order: NpShopStoredOrder;
      sourceRevision: number;
      sourceStatus: NpShopStoredExchange["status"];
      booking: NpShopStoredExchangeCarrierBooking | null;
      parcelSnapshot: NpShopStoredExchangeParcels | null;
      lines: NpShopStoredExchange["lines"];
    };

async function readLockedPackingWorkSource(
  tx: NpShopTransaction,
  siteId: string,
  target: NpShopPackingWorkTarget,
  orderId: string,
): Promise<NpShopLockedPackingWorkSource> {
  if (target === "outbound") {
    const { fulfillment, order } = await readFulfillmentForAction(tx, siteId, orderId);
    const booking = await readStoredCarrierBooking(tx, siteId, orderId, true);
    const parcelSnapshot = await readStoredFulfillmentParcels(tx, siteId, orderId, true);
    return {
      target: "outbound",
      exchangeId: null,
      order,
      sourceRevision: fulfillment.revision,
      sourceStatus: fulfillment.status,
      booking,
      parcelSnapshot,
      lines: order.lines,
    };
  }
  const { exchange, order } = await readExchangeForAction(tx, siteId, orderId);
  const booking = await readStoredExchangeCarrierBooking(tx, siteId, orderId, true);
  const parcelSnapshot = await readStoredExchangeParcels(tx, siteId, orderId, true);
  return {
    target: "replacement",
    exchangeId: exchange.id,
    order,
    sourceRevision: exchange.revision,
    sourceStatus: exchange.status,
    booking,
    parcelSnapshot,
    lines: exchange.lines,
  };
}

async function readLockedPackingWorkCancellationSource(
  tx: NpShopTransaction,
  siteId: string,
  target: NpShopPackingWorkTarget,
  orderId: string,
): Promise<NpShopLockedPackingWorkSource> {
  if (target === "outbound") {
    const candidate = await readStoredFulfillment(tx, siteId, orderId);
    if (!candidate) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_not_found",
        "The packing-work fulfillment no longer exists.",
      );
    }
    await lockOrder(tx, siteId, candidate.ownerSegment, orderId);
    const fulfillment = await readStoredFulfillment(tx, siteId, orderId, true);
    const order = await readStoredOrderForUpdate(tx, siteId, candidate.ownerSegment, orderId);
    if (!fulfillment || !order || !fulfillmentMatchesOrder(fulfillment, order)) {
      throw new NpShopOrderContractError("Packing-work fulfillment source is invalid", [
        "Packing-work cancellation requires one exact retained order and fulfillment relationship.",
      ]);
    }
    const booking = await readStoredCarrierBooking(tx, siteId, orderId, true);
    const parcelSnapshot = await readStoredFulfillmentParcels(tx, siteId, orderId, true);
    return {
      target: "outbound",
      exchangeId: null,
      order,
      sourceRevision: fulfillment.revision,
      sourceStatus: fulfillment.status,
      booking,
      parcelSnapshot,
      lines: order.lines,
    };
  }
  const candidate = await readStoredExchange(tx, siteId, orderId);
  if (!candidate) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_not_found",
      "The replacement packing-work source no longer exists.",
    );
  }
  await lockOrder(tx, siteId, candidate.ownerSegment, orderId);
  const exchange = await readStoredExchange(tx, siteId, orderId, true);
  const order = await readStoredOrderForUpdate(tx, siteId, candidate.ownerSegment, orderId);
  if (
    !exchange ||
    !order ||
    exchange.ownerSegment !== order.ownerSegment ||
    exchange.orderId !== order.id ||
    exchange.purgeAt !== order.purgeAt
  ) {
    throw new NpShopOrderContractError("Replacement packing-work source is invalid", [
      "Packing-work cancellation requires one exact retained order and exchange relationship.",
    ]);
  }
  const booking = await readStoredExchangeCarrierBooking(tx, siteId, orderId, true);
  const parcelSnapshot = await readStoredExchangeParcels(tx, siteId, orderId, true);
  return {
    target: "replacement",
    exchangeId: exchange.id,
    order,
    sourceRevision: exchange.revision,
    sourceStatus: exchange.status,
    booking,
    parcelSnapshot,
    lines: exchange.lines,
  };
}

function packingWorkLines(source: NpShopLockedPackingWorkSource) {
  return source.target === "outbound"
    ? source.lines.map((line) => ({
        lineKey: line.key,
        productId: line.productId,
        productSlug: line.productSlug,
        variantSku: line.variantSku,
        quantity: line.quantity,
      }))
    : source.lines.map((line) => ({
        lineKey: line.lineKey,
        productId: line.productId,
        productSlug: line.productSlug,
        variantSku: line.variantSku,
        quantity: line.quantity,
      }));
}

function packingWorkParcels(source: NpShopLockedPackingWorkSource) {
  return (source.parcelSnapshot?.parcels ?? []).map((parcel) => ({
    id: parcel.id,
    lengthMm: parcel.lengthMm,
    widthMm: parcel.widthMm,
    heightMm: parcel.heightMm,
    weightGrams: parcel.weightGrams,
    items: parcel.items.map((item) => ({ lineKey: item.lineKey, quantity: item.quantity })),
  }));
}

function packingWorkFingerprint(
  source: Parameters<typeof npSerializeShopPackingWorkFingerprintSource>[0],
): string {
  return createHash("sha256")
    .update(npSerializeShopPackingWorkFingerprintSource(source), "utf8")
    .digest("hex");
}

function shopPackingWorkFingerprint(source: NpShopLockedPackingWorkSource): string {
  if (!source.parcelSnapshot) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_parcels_required",
      "Packing work requires one exact current parcel snapshot.",
    );
  }
  return packingWorkFingerprint({
    target: source.target,
    exchangeId: source.exchangeId,
    sourceRevision:
      source.target === "replacement"
        ? source.parcelSnapshot.exchangeRevision
        : source.sourceRevision,
    parcelRevision: source.parcelSnapshot.revision,
    lines: packingWorkLines(source),
    parcels: packingWorkParcels(source),
  });
}

function storedPackingWorkFingerprint(work: NpShopStoredPackingWork): string {
  return packingWorkFingerprint({
    target: work.target,
    exchangeId: work.exchangeId,
    sourceRevision: work.sourceRevision,
    parcelRevision: work.parcelRevision,
    lines: work.lines,
    parcels: work.parcels,
  });
}

function packingWorkCreateSourceRelationshipsMatch(source: NpShopLockedPackingWorkSource): boolean {
  if (
    !source.parcelSnapshot ||
    source.parcelSnapshot.orderId !== source.order.id ||
    source.parcelSnapshot.purgeAt !== source.order.purgeAt
  ) {
    return false;
  }
  return source.target === "outbound"
    ? source.parcelSnapshot.fulfillmentRevision === source.sourceRevision
    : source.parcelSnapshot.exchangeId === source.exchangeId &&
        source.parcelSnapshot.exchangeRevision === source.sourceRevision;
}

function packingWorkStoredSourceRelationshipsMatch(
  work: NpShopStoredPackingWork,
  source: NpShopLockedPackingWorkSource,
): boolean {
  if (
    !source.parcelSnapshot ||
    source.parcelSnapshot.orderId !== source.order.id ||
    source.parcelSnapshot.purgeAt !== source.order.purgeAt
  ) {
    return false;
  }
  if (source.target === "outbound") {
    return (
      source.parcelSnapshot.fulfillmentRevision === work.sourceRevision &&
      source.sourceRevision === work.sourceRevision
    );
  }
  return (
    source.parcelSnapshot.exchangeId === work.exchangeId &&
    source.parcelSnapshot.exchangeRevision === work.sourceRevision &&
    ((source.sourceStatus === "awaiting" && source.sourceRevision === work.sourceRevision) ||
      (source.sourceStatus === "processing" && source.sourceRevision === work.sourceRevision + 1))
  );
}

function requirePackingWorkCreateSource(
  source: NpShopLockedPackingWorkSource,
  input: NpShopPackingWorkCreateActionInput,
): void {
  if (
    source.target !== input.target ||
    source.exchangeId !== input.exchangeId ||
    source.sourceRevision !== input.expectedSourceRevision
  ) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_revision_conflict",
      "The packing-work source changed before this action was applied.",
    );
  }
  if (
    (source.target === "outbound" && source.sourceStatus !== "processing") ||
    (source.target === "replacement" && source.sourceStatus !== "awaiting")
  ) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_state_conflict",
      "Packing work can start only for a processing fulfillment or awaiting replacement.",
    );
  }
  if (!source.parcelSnapshot || source.parcelSnapshot.revision !== input.expectedParcelRevision) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_revision_conflict",
      "The parcel snapshot changed before packing work started.",
    );
  }
  if (!packingWorkCreateSourceRelationshipsMatch(source)) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_state_conflict",
      "The parcel snapshot no longer matches its retained order and source revision.",
    );
  }
  if (source.booking || source.parcelSnapshot.lockedShipmentId) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_shipment_conflict",
      "Packing work must start before a durable carrier booking locks the parcels.",
    );
  }
  if (source.target === "outbound") {
    requireFulfillmentParcelAllocation(source.order, source.parcelSnapshot.parcels);
  } else {
    requireExchangeParcelAllocation({ lines: source.lines }, source.parcelSnapshot.parcels);
  }
}

function packingWorkMatchesSource(
  work: NpShopStoredPackingWork,
  source: NpShopLockedPackingWorkSource,
): boolean {
  return (
    work.target === source.target &&
    work.orderId === source.order.id &&
    work.exchangeId === source.exchangeId &&
    work.purgeAt === source.order.purgeAt &&
    work.parcelFingerprint === storedPackingWorkFingerprint(work) &&
    packingWorkStoredSourceRelationshipsMatch(work, source) &&
    source.parcelSnapshot !== null &&
    work.sourceRevision ===
      (source.target === "replacement"
        ? source.parcelSnapshot.exchangeRevision
        : source.sourceRevision) &&
    work.parcelRevision === source.parcelSnapshot.revision &&
    work.parcelFingerprint === shopPackingWorkFingerprint(source)
  );
}

type NpShopPackingWorkFallbackIdentity = {
  target: NpShopPackingWorkTarget;
  orderId: string;
  exchangeId: string | null;
  purgeAt: string;
};

function packingWorkAllowsUnattachedFallback(
  work: NpShopStoredPackingWork,
  identity: NpShopPackingWorkFallbackIdentity,
): boolean {
  return npShopPackingWorkMatchesUnattachedTombstone(work, identity);
}

function packingWorkAllowsParcelMutation(
  work: NpShopStoredPackingWork | null,
  identity: NpShopPackingWorkFallbackIdentity,
): boolean {
  return work === null || packingWorkAllowsUnattachedFallback(work, identity);
}

function packingWorkHasCancellationIntent(work: NpShopStoredPackingWork): boolean {
  return (
    work.consumedAt === null &&
    (work.status === "cancel-pending" ||
      work.status === "cancel-confirmed" ||
      work.status === "cancelled" ||
      (work.status === "manual-review" &&
        work.cancellationId !== null &&
        work.cancelRequestedAt !== null))
  );
}

function packingWorkAllowsManualShipment(
  work: NpShopStoredPackingWork | null,
  identity: NpShopPackingWorkFallbackIdentity,
): boolean {
  return (
    work === null ||
    (work.status === "active" && work.attachedShipmentId === null) ||
    packingWorkAllowsUnattachedFallback(work, identity)
  );
}

function packingWorkAllowsCarrierShipment(
  work: NpShopStoredPackingWork | null,
  parcelAware: boolean,
  shipmentId: string | null,
  identity: NpShopPackingWorkFallbackIdentity,
): boolean {
  if (!work) return true;
  if (work.status === "cancelled") return packingWorkAllowsUnattachedFallback(work, identity);
  if (work.status !== "active") return false;
  if (shipmentId !== null && work.attachedShipmentId === shipmentId) return true;
  return parcelAware && work.attachedShipmentId === null;
}

function packingWorkAllowsShipmentCompletion(
  work: NpShopStoredPackingWork | null,
  shipmentId: string | null,
  identity: NpShopPackingWorkFallbackIdentity,
): boolean {
  if (!work) return true;
  if (work.status === "cancelled") return packingWorkAllowsUnattachedFallback(work, identity);
  if (work.status === "active" || work.status === "consumed") {
    return work.attachedShipmentId === shipmentId;
  }
  return false;
}

function packingWorkMatchesReplacementAdminSource(
  work: NpShopStoredPackingWork,
  exchange: NpShopStoredExchange,
  parcelSnapshot: NpShopStoredExchangeParcels | null,
  booking: NpShopStoredExchangeCarrierBooking,
): boolean {
  if (
    work.status === "cancelled" &&
    work.attachedShipmentId === null &&
    work.target === "replacement" &&
    work.orderId === exchange.orderId &&
    work.exchangeId === exchange.id &&
    work.purgeAt === exchange.purgeAt
  ) {
    return storedPackingWorkFingerprint(work) === work.parcelFingerprint;
  }
  if (
    work.target !== "replacement" ||
    work.orderId !== exchange.orderId ||
    work.exchangeId !== exchange.id ||
    work.purgeAt !== exchange.purgeAt ||
    work.attachedShipmentId !== booking.id ||
    booking.orderId !== exchange.orderId ||
    booking.exchangeId !== exchange.id ||
    booking.sourceExchangeRevision !== work.sourceRevision ||
    booking.purgeAt !== exchange.purgeAt ||
    !parcelSnapshot ||
    parcelSnapshot.orderId !== exchange.orderId ||
    parcelSnapshot.exchangeId !== exchange.id ||
    parcelSnapshot.exchangeRevision !== work.sourceRevision ||
    parcelSnapshot.revision !== work.parcelRevision ||
    parcelSnapshot.purgeAt !== exchange.purgeAt ||
    parcelSnapshot.lockedShipmentId !== booking.id ||
    storedPackingWorkFingerprint(work) !== work.parcelFingerprint
  ) {
    return false;
  }
  const lifecycleMatches =
    (exchange.status === "awaiting" && exchange.revision === work.sourceRevision) ||
    (exchange.status === "processing" && exchange.revision === work.sourceRevision + 1) ||
    (exchange.status === "shipped" && exchange.revision === work.sourceRevision + 2) ||
    (exchange.status === "cancelled" &&
      exchange.revision === work.sourceRevision + 2 &&
      booking.status === "cancelled");
  if (!lifecycleMatches) return false;
  return (
    packingWorkFingerprint({
      target: "replacement",
      exchangeId: exchange.id,
      sourceRevision: work.sourceRevision,
      parcelRevision: parcelSnapshot.revision,
      lines: exchange.lines.map((line) => ({
        lineKey: line.lineKey,
        productId: line.productId,
        productSlug: line.productSlug,
        variantSku: line.variantSku,
        quantity: line.quantity,
      })),
      parcels: parcelSnapshot.parcels,
    }) === work.parcelFingerprint
  );
}

function packingWorkMatchesOutboundAdminSource(
  work: NpShopStoredPackingWork,
  order: NpShopStoredOrder,
  fulfillment: NpShopStoredFulfillment,
  parcelSnapshot: NpShopStoredFulfillmentParcels | null,
  booking: NpShopStoredCarrierBooking | null,
): boolean {
  if (
    work.target !== "outbound" ||
    work.orderId !== order.id ||
    work.orderId !== fulfillment.orderId ||
    work.exchangeId !== null ||
    order.ownerSegment !== fulfillment.ownerSegment ||
    order.purgeAt !== fulfillment.purgeAt ||
    work.purgeAt !== fulfillment.purgeAt ||
    storedPackingWorkFingerprint(work) !== work.parcelFingerprint
  ) {
    return false;
  }
  if (work.status === "cancelled" && work.attachedShipmentId === null) return true;
  if (
    !parcelSnapshot ||
    parcelSnapshot.orderId !== fulfillment.orderId ||
    parcelSnapshot.fulfillmentRevision !== work.sourceRevision ||
    parcelSnapshot.revision !== work.parcelRevision ||
    parcelSnapshot.purgeAt !== fulfillment.purgeAt ||
    parcelSnapshot.lockedShipmentId !== work.attachedShipmentId ||
    (work.attachedShipmentId !== null &&
      (!booking ||
        booking.id !== work.attachedShipmentId ||
        booking.orderId !== fulfillment.orderId ||
        booking.fulfillmentRevision !== work.sourceRevision ||
        booking.purgeAt !== fulfillment.purgeAt))
  ) {
    return false;
  }
  const lifecycleMatches =
    (fulfillment.status === "processing" && fulfillment.revision === work.sourceRevision) ||
    (fulfillment.status === "shipped" && fulfillment.revision === work.sourceRevision + 1);
  if (!lifecycleMatches) return false;
  return (
    packingWorkFingerprint({
      target: "outbound",
      exchangeId: null,
      sourceRevision: work.sourceRevision,
      parcelRevision: parcelSnapshot.revision,
      lines: order.lines.map((line) => ({
        lineKey: line.key,
        productId: line.productId,
        productSlug: line.productSlug,
        variantSku: line.variantSku,
        quantity: line.quantity,
      })),
      parcels: parcelSnapshot.parcels,
    }) === work.parcelFingerprint
  );
}

function outboundLabelAcquisitionMatchesBooking(
  acquisition: NpShopStoredCarrierLabelAcquisition,
  booking: NpShopStoredCarrierBooking,
): boolean {
  return (
    booking.status === "completed" &&
    acquisition.target === "outbound" &&
    acquisition.exchangeId === null &&
    acquisition.shipmentId === booking.id &&
    acquisition.orderId === booking.orderId &&
    acquisition.providerId === booking.providerId &&
    acquisition.sourceRevision === booking.fulfillmentRevision &&
    acquisition.bookingReference === booking.bookingReference &&
    acquisition.carrier === booking.carrier &&
    acquisition.trackingNumber === booking.trackingNumber &&
    acquisition.purgeAt === booking.purgeAt
  );
}

function outboundCarrierBookingMatchesAdminSource(
  booking: NpShopStoredCarrierBooking,
  fulfillment: NpShopStoredFulfillment | null,
  order: NpShopStoredOrder | null,
): boolean {
  if (
    !fulfillment ||
    !order ||
    !fulfillmentMatchesOrder(fulfillment, order) ||
    booking.orderId !== order.id ||
    booking.purgeAt !== order.purgeAt
  ) {
    return false;
  }
  if (booking.status === "pending" || booking.status === "provider-confirmed") {
    return (
      fulfillment.status === "processing" && fulfillment.revision === booking.fulfillmentRevision
    );
  }
  if (booking.status === "completed") {
    return (
      fulfillment.status === "shipped" &&
      fulfillment.revision === booking.fulfillmentRevision + 1 &&
      fulfillment.carrier === booking.carrier &&
      fulfillment.trackingNumber === booking.trackingNumber
    );
  }
  return false;
}

function replacementLabelAcquisitionMatchesBooking(
  acquisition: NpShopStoredCarrierLabelAcquisition,
  booking: NpShopStoredExchangeCarrierBooking,
  exchange: NpShopStoredExchange,
): boolean {
  const exchangeLifecycleMatches =
    booking.completedExchangeRevision !== null &&
    ((exchange.status === "processing" &&
      exchange.revision === booking.completedExchangeRevision) ||
      (exchange.status === "shipped" &&
        exchange.revision === booking.completedExchangeRevision + 1));
  return (
    booking.status === "completed" &&
    booking.completedExchangeRevision !== null &&
    exchangeLifecycleMatches &&
    exchange.id === booking.exchangeId &&
    exchange.orderId === booking.orderId &&
    exchange.purgeAt === booking.purgeAt &&
    exchange.carrier === booking.carrier &&
    exchange.trackingNumber === booking.trackingNumber &&
    acquisition.target === "replacement" &&
    acquisition.exchangeId === booking.exchangeId &&
    acquisition.shipmentId === booking.id &&
    acquisition.orderId === booking.orderId &&
    acquisition.providerId === booking.providerId &&
    acquisition.sourceRevision === booking.completedExchangeRevision &&
    acquisition.bookingReference === booking.bookingReference &&
    acquisition.carrier === booking.carrier &&
    acquisition.trackingNumber === booking.trackingNumber &&
    acquisition.purgeAt === booking.purgeAt
  );
}

function packingWorkAllowsFullRefund(
  work: NpShopStoredPackingWork | null,
  order: NpShopStoredOrder,
  fulfillment: NpShopStoredFulfillment | null,
  carrierBooking: NpShopStoredCarrierBooking | null,
  parcelSnapshot: NpShopStoredFulfillmentParcels | null,
): boolean {
  if (!work) return true;
  if (work.status === "cancelled" && work.attachedShipmentId === null) {
    return npShopPackingWorkMatchesUnattachedTombstone(work, {
      target: "outbound",
      orderId: order.id,
      exchangeId: null,
      purgeAt: order.purgeAt,
    });
  }
  if (
    (work.status !== "cancelled" && work.status !== "consumed") ||
    !fulfillment ||
    fulfillment.status !== "shipped" ||
    (work.attachedShipmentId !== null &&
      (carrierBooking?.status !== "completed" || work.attachedShipmentId !== carrierBooking.id))
  ) {
    return false;
  }
  return packingWorkMatchesOutboundAdminSource(
    work,
    order,
    fulfillment,
    parcelSnapshot,
    carrierBooking,
  );
}

function requirePackingWorkAllowsParcelMutation(
  work: NpShopStoredPackingWork | null,
  identity: NpShopPackingWorkFallbackIdentity,
): void {
  if (work && !packingWorkAllowsParcelMutation(work, identity)) {
    throw new NpShopPackingWorkConflictError(
      work.status === "manual-review"
        ? "packing_work_manual_review"
        : "packing_work_state_conflict",
      "Cancel or reconcile the durable packing work before changing its parcel snapshot.",
    );
  }
}

function packingWorkMatchesSnapshot(
  work: NpShopStoredPackingWork,
  source: NpShopLockedPackingWorkSource,
): boolean {
  return packingWorkMatchesSource(work, source);
}

async function attachShopPackingWorkToShipment(
  tx: NpShopTransaction,
  siteId: string,
  source: NpShopLockedPackingWorkSource,
  shipmentId: string,
  parcelAware: boolean,
  staffUserId: string | null,
): Promise<NpShopStoredPackingWork | null> {
  const current = await npReadStoredShopPackingWork(
    tx,
    siteId,
    source.target,
    source.order.id,
    true,
  );
  if (!current) return null;
  if (current.status === "cancelled") {
    if (current.attachedShipmentId !== null) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_shipment_conflict",
        "Cancelled packing work remains attached to this interrupted carrier shipment and cannot be reused.",
      );
    }
    if (
      !npShopPackingWorkMatchesUnattachedTombstone(current, {
        target: source.target,
        orderId: source.order.id,
        exchangeId: source.exchangeId,
        purgeAt: source.order.purgeAt,
      })
    ) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_revision_conflict",
        "The cancelled packing-work tombstone is not internally consistent.",
      );
    }
    return current;
  }
  if (current.status === "consumed") {
    if (current.attachedShipmentId === shipmentId && packingWorkMatchesSnapshot(current, source)) {
      return current;
    }
    throw new NpShopPackingWorkConflictError(
      "packing_work_shipment_conflict",
      "The packing work was already consumed by another shipment transition.",
    );
  }
  if (current.status !== "active") {
    throw new NpShopPackingWorkConflictError(
      current.status === "manual-review"
        ? "packing_work_manual_review"
        : "packing_work_state_conflict",
      "Only active packing work can be attached to a carrier shipment.",
    );
  }
  if (!packingWorkMatchesSnapshot(current, source)) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_revision_conflict",
      "The carrier shipment does not match the packing-work parcel fingerprint.",
    );
  }
  if (current.attachedShipmentId && current.attachedShipmentId !== shipmentId) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_shipment_conflict",
      "The packing work is attached to a different durable shipment.",
    );
  }
  if (current.attachedShipmentId === shipmentId) return current;
  if (!parcelAware) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_shipment_conflict",
      "Active packing work requires the exact parcel-aware carrier capability.",
    );
  }
  const next = {
    ...current,
    revision: current.revision + 1,
    attachedShipmentId: shipmentId,
    updatedAt: nextPackingWorkTimestamp(current.updatedAt),
  } satisfies NpShopStoredPackingWork;
  await npPersistStoredShopPackingWork(tx, siteId, next);
  await recordShopPackingWorkAudit(tx, siteId, staffUserId, "shop.packing-work.attach", next, {
    shipmentId,
  });
  return next;
}

async function consumeShopPackingWork(
  tx: NpShopTransaction,
  siteId: string,
  source: NpShopLockedPackingWorkSource,
  shipmentId: string | null,
  staffUserId: string | null,
): Promise<NpShopStoredPackingWork | null> {
  const current = await npReadStoredShopPackingWork(
    tx,
    siteId,
    source.target,
    source.order.id,
    true,
  );
  if (!current) return null;
  if (current.status === "cancelled") {
    if (current.attachedShipmentId !== null) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_shipment_conflict",
        "Cancelled packing work remains attached to an interrupted carrier shipment.",
      );
    }
    if (
      !npShopPackingWorkMatchesUnattachedTombstone(current, {
        target: source.target,
        orderId: source.order.id,
        exchangeId: source.exchangeId,
        purgeAt: source.order.purgeAt,
      })
    ) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_revision_conflict",
        "The cancelled packing-work tombstone is not internally consistent.",
      );
    }
    return current;
  }
  if (current.status === "consumed") {
    if (current.attachedShipmentId === shipmentId && packingWorkMatchesSnapshot(current, source)) {
      return current;
    }
    throw new NpShopPackingWorkConflictError(
      "packing_work_shipment_conflict",
      "The packing work was consumed by a different shipment transition.",
    );
  }
  if (current.status !== "active" || !packingWorkMatchesSnapshot(current, source)) {
    throw new NpShopPackingWorkConflictError(
      current.status === "manual-review"
        ? "packing_work_manual_review"
        : "packing_work_state_conflict",
      "Only the exact active packing-work snapshot can be consumed by shipment.",
    );
  }
  if (shipmentId !== null && current.attachedShipmentId !== shipmentId) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_shipment_conflict",
      "The packing work is not attached to this durable shipment.",
    );
  }
  if (shipmentId === null && current.attachedShipmentId !== null) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_shipment_conflict",
      "Attached packing work must complete through its durable carrier shipment.",
    );
  }
  const now = nextPackingWorkTimestamp(current.updatedAt, current.activatedAt);
  const next = {
    ...current,
    status: "consumed",
    revision: current.revision + 1,
    consumedAt: now,
    updatedAt: now,
  } satisfies NpShopStoredPackingWork;
  await npPersistStoredShopPackingWork(tx, siteId, next);
  await recordShopPackingWorkAudit(tx, siteId, staffUserId, "shop.packing-work.consume", next, {
    shipmentId,
  });
  return next;
}

function nextPackingWorkTimestamp(...values: Array<string | null | undefined>): string {
  return new Date(
    Math.max(
      Date.now(),
      ...values.filter((value): value is string => Boolean(value)).map(Date.parse),
    ),
  ).toISOString();
}

async function recordShopPackingWorkAudit(
  tx: NpShopTransaction,
  siteId: string,
  staffUserId: string | null,
  action: string,
  work: NpShopStoredPackingWork,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(npAuditEvents).values({
    actorKind: staffUserId ? "staff" : "system",
    actorUserId: staffUserId,
    actorMemberId: null,
    action,
    targetType: "shop-order",
    targetId: work.orderId,
    payload: {
      workId: work.workId,
      target: work.target,
      exchangeId: work.exchangeId,
      providerId: work.providerId,
      sourceRevision: work.sourceRevision,
      parcelRevision: work.parcelRevision,
      parcelFingerprint: work.parcelFingerprint,
      workRevision: work.revision,
      ...payload,
    },
    siteId,
  });
}

function freezePackingWorkCreateRequest(
  work: NpShopStoredPackingWork,
): NpShopPackingWorkCreateRequest {
  const lines = Object.freeze(work.lines.map((line) => Object.freeze({ ...line })));
  const parcels = Object.freeze(
    work.parcels.map((parcel) =>
      Object.freeze({
        ...parcel,
        items: Object.freeze(parcel.items.map((item) => Object.freeze({ ...item }))),
      }),
    ),
  );
  return Object.freeze({
    contract: NP_SHOP_PACKING_WORK_CREATE_REQUEST_CONTRACT,
    workId: work.workId,
    orderId: work.orderId,
    target: work.target,
    exchangeId: work.exchangeId,
    sourceRevision: work.sourceRevision,
    parcelRevision: work.parcelRevision,
    parcelFingerprint: work.parcelFingerprint,
    lines,
    parcels,
    requestedAt: work.requestedAt,
  }) as NpShopPackingWorkCreateRequest;
}

function freezePackingWorkCancelRequest(
  work: NpShopStoredPackingWork,
): NpShopPackingWorkCancelRequest {
  if (!work.cancellationId || !work.cancelRequestedAt) {
    throw new NpShopPackingWorkContractError("Invalid stored packing-work cancellation", [
      "A cancel-pending packing work must retain its cancellation identity and request time.",
    ]);
  }
  return Object.freeze({
    contract: NP_SHOP_PACKING_WORK_CANCEL_REQUEST_CONTRACT,
    cancellationId: work.cancellationId,
    workId: work.workId,
    orderId: work.orderId,
    target: work.target,
    exchangeId: work.exchangeId,
    sourceRevision: work.sourceRevision,
    parcelRevision: work.parcelRevision,
    parcelFingerprint: work.parcelFingerprint,
    providerWorkReference: work.providerWorkReference,
    requestedAt: work.cancelRequestedAt,
  }) as NpShopPackingWorkCancelRequest;
}

export type NpShopPreparedPackingWorkCreate =
  | { outcome: "active"; work: NpShopStoredPackingWork }
  | { outcome: "activate"; work: NpShopStoredPackingWork }
  | { outcome: "manual-review"; work: NpShopStoredPackingWork }
  | {
      outcome: "provider";
      work: NpShopStoredPackingWork;
      request: NpShopPackingWorkCreateRequest;
    };

async function requireNoNoncanonicalPackingWork(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<void> {
  const outboundKey = npShopPackingWorkStorageKey("outbound", orderId);
  const replacementKey = npShopPackingWorkStorageKey("replacement", orderId);
  const [conflict] = await tx
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "packing-work:%"),
        sql`${npPluginStorage.value}->>'orderId' = ${orderId}`,
        sql`not coalesce(((${npPluginStorage.value}->>'target' = 'outbound' and ${npPluginStorage.key} = ${outboundKey}) or (${npPluginStorage.value}->>'target' = 'replacement' and ${npPluginStorage.key} = ${replacementKey})), false)`,
      ),
    )
    .limit(1)
    .for("update");
  if (conflict) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_state_conflict",
      "A noncanonical packing-work row already identifies this order and must be reconciled before provider I/O.",
    );
  }
}

export async function npPrepareShopPackingWorkCreate(
  input: NpShopPackingWorkCreateActionInput,
  providerId: string,
  staffUserId: string | null,
): Promise<NpShopPreparedPackingWorkCreate> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const source = await readLockedPackingWorkSource(tx, siteId, input.target, input.orderId);
    requirePackingWorkCreateSource(source, input);
    await requireNoNoncanonicalPackingWork(tx, siteId, input.orderId);
    const current = await npReadStoredShopPackingWork(
      tx,
      siteId,
      input.target,
      input.orderId,
      true,
    );
    if ((current?.revision ?? null) !== input.expectedWorkRevision) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_revision_conflict",
        "The packing work changed before this action was applied.",
      );
    }
    if (current && current.exchangeId !== input.exchangeId) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_state_conflict",
        "The packing work belongs to a different replacement identity.",
      );
    }
    if (current) {
      if (current.status === "cancelled") {
        throw new NpShopPackingWorkConflictError(
          "packing_work_already_exists",
          "Packing-work v1 retains one terminal cancellation tombstone per order target; use the manual fulfillment flow after cancellation.",
        );
      }
      if (current.providerId !== providerId) {
        throw new NpShopPackingWorkConflictError(
          "packing_work_state_conflict",
          "The durable packing work belongs to a different provider.",
        );
      }
      if (!packingWorkMatchesSource(current, source)) {
        const conflict = {
          ...current,
          status: "manual-review",
          revision: current.revision + 1,
          providerErrorCode: "local-state-conflict",
          updatedAt: nextPackingWorkTimestamp(current.updatedAt),
        } satisfies NpShopStoredPackingWork;
        await npPersistStoredShopPackingWork(tx, siteId, conflict);
        await recordShopPackingWorkAudit(
          tx,
          siteId,
          staffUserId,
          "shop.packing-work.create.manual-review",
          conflict,
        );
        return { outcome: "manual-review", work: conflict };
      }
      if (current.status === "pending") {
        return {
          outcome: "provider",
          work: current,
          request: freezePackingWorkCreateRequest(current),
        };
      }
      if (current.status === "provider-confirmed") {
        return { outcome: "activate", work: current };
      }
      if (current.status === "active") return { outcome: "active", work: current };
      throw new NpShopPackingWorkConflictError(
        current.status === "manual-review"
          ? "packing_work_manual_review"
          : "packing_work_already_exists",
        "The current packing work must be cancelled or reconciled before another create attempt.",
      );
    }
    const evaluatedAt = new Date();
    if (new Date(source.order.purgeAt) <= evaluatedAt) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_state_conflict",
        "The order is past its commercial retention window.",
      );
    }
    const requestedAt = new Date(evaluatedAt);
    requestedAt.setMilliseconds(0);
    const now = requestedAt.toISOString();
    const parcelSnapshot = source.parcelSnapshot;
    if (!parcelSnapshot) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_parcels_required",
        "Packing work requires one exact current parcel snapshot.",
      );
    }
    const workBase = {
      contract: NP_SHOP_PACKING_WORK_STORAGE_CONTRACT,
      workId: randomUUID(),
      orderId: source.order.id,
      providerId,
      status: "pending",
      revision: 1,
      sourceRevision: source.sourceRevision,
      parcelRevision: parcelSnapshot.revision,
      parcelFingerprint: shopPackingWorkFingerprint(source),
      lines: packingWorkLines(source),
      parcels: packingWorkParcels(source),
      providerWorkReference: null,
      providerErrorCode: null,
      cancellationId: null,
      attachedShipmentId: null,
      requestedAt: now,
      confirmedAt: null,
      activatedAt: null,
      cancelRequestedAt: null,
      cancelledAt: null,
      consumedAt: null,
      updatedAt: now,
      purgeAt: source.order.purgeAt,
    } as const;
    const work: NpShopStoredPackingWork =
      source.target === "outbound"
        ? { ...workBase, target: "outbound", exchangeId: null }
        : { ...workBase, target: "replacement", exchangeId: source.exchangeId };
    await npPersistStoredShopPackingWork(tx, siteId, work);
    await recordShopPackingWorkAudit(
      tx,
      siteId,
      staffUserId,
      "shop.packing-work.create.request",
      work,
    );
    return { outcome: "provider", work, request: freezePackingWorkCreateRequest(work) };
  });
}

function materializePackingWorkCreateResult(
  request: NpShopPackingWorkCreateRequest,
  value: unknown,
  evaluatedAt: Date,
): NpShopPackingWorkCreateResult {
  const raw = npRequireShopPackingWorkCreateResult(value);
  const result =
    raw.target === "outbound"
      ? {
          contract: raw.contract,
          workId: raw.workId,
          orderId: raw.orderId,
          target: "outbound" as const,
          exchangeId: null,
          sourceRevision: raw.sourceRevision,
          parcelRevision: raw.parcelRevision,
          parcelFingerprint: raw.parcelFingerprint,
          providerWorkReference: raw.providerWorkReference,
          confirmedAt: raw.confirmedAt,
        }
      : {
          contract: raw.contract,
          workId: raw.workId,
          orderId: raw.orderId,
          target: "replacement" as const,
          exchangeId: raw.exchangeId,
          sourceRevision: raw.sourceRevision,
          parcelRevision: raw.parcelRevision,
          parcelFingerprint: raw.parcelFingerprint,
          providerWorkReference: raw.providerWorkReference,
          confirmedAt: raw.confirmedAt,
        };
  const issues = npAnalyzeShopPackingWorkCreateResultForRequest(request, result, evaluatedAt);
  if (issues.length) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing-work create result", issues);
  }
  return Object.freeze(result);
}

function materializePackingWorkCancelResult(
  request: NpShopPackingWorkCancelRequest,
  value: unknown,
  evaluatedAt: Date,
): NpShopPackingWorkCancelResult {
  const raw = npRequireShopPackingWorkCancelResult(value);
  const result =
    raw.target === "outbound"
      ? {
          contract: raw.contract,
          cancellationId: raw.cancellationId,
          workId: raw.workId,
          orderId: raw.orderId,
          target: "outbound" as const,
          exchangeId: null,
          sourceRevision: raw.sourceRevision,
          parcelRevision: raw.parcelRevision,
          parcelFingerprint: raw.parcelFingerprint,
          providerWorkReference: raw.providerWorkReference,
          cancelledAt: raw.cancelledAt,
        }
      : {
          contract: raw.contract,
          cancellationId: raw.cancellationId,
          workId: raw.workId,
          orderId: raw.orderId,
          target: "replacement" as const,
          exchangeId: raw.exchangeId,
          sourceRevision: raw.sourceRevision,
          parcelRevision: raw.parcelRevision,
          parcelFingerprint: raw.parcelFingerprint,
          providerWorkReference: raw.providerWorkReference,
          cancelledAt: raw.cancelledAt,
        };
  const issues = npAnalyzeShopPackingWorkCancelResultForRequest(request, result, evaluatedAt);
  if (issues.length) {
    throw new NpShopPackingWorkContractError("Invalid Shop packing-work cancel result", issues);
  }
  return Object.freeze(result);
}

interface NpShopPackingWorkProviderFailure {
  readonly terminal: boolean;
  readonly code: string;
}

function classifyPackingWorkProviderFailure(error: unknown): NpShopPackingWorkProviderFailure {
  try {
    if (error instanceof NpShopPackingWorkContractError) {
      return { terminal: true, code: "invalid-result" };
    }
    if (error instanceof NpShopPackingWorkProviderError) {
      const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");
      const retryableDescriptor = Object.getOwnPropertyDescriptor(error, "retryable");
      if (
        codeDescriptor &&
        "value" in codeDescriptor &&
        typeof codeDescriptor.value === "string" &&
        /^[a-z][a-z0-9-]{0,99}$/u.test(codeDescriptor.value) &&
        retryableDescriptor &&
        "value" in retryableDescriptor &&
        typeof retryableDescriptor.value === "boolean"
      ) {
        return { terminal: !retryableDescriptor.value, code: codeDescriptor.value };
      }
    }
  } catch {
    // Hostile provider errors are retryable ambiguity; never inspect them again.
  }
  return { terminal: false, code: "provider-unavailable" };
}

async function persistPackingWorkProviderFailure(
  siteId: string,
  target: NpShopPackingWorkTarget,
  orderId: string,
  workId: string,
  expectedStatus: "pending" | "cancel-pending",
  failure: NpShopPackingWorkProviderFailure,
  staffUserId: string | null,
): Promise<void> {
  if (!failure.terminal) return;
  await getDb().transaction(async (tx) => {
    const current = await npReadStoredShopPackingWork(tx, siteId, target, orderId, true);
    if (!current || current.workId !== workId || current.status !== expectedStatus) return;
    const next = {
      ...current,
      status: "manual-review",
      revision: current.revision + 1,
      providerErrorCode: failure.code,
      updatedAt: nextPackingWorkTimestamp(current.updatedAt),
    } satisfies NpShopStoredPackingWork;
    await npPersistStoredShopPackingWork(tx, siteId, next);
    await recordShopPackingWorkAudit(
      tx,
      siteId,
      staffUserId,
      "shop.packing-work.provider.manual-review",
      next,
      { previousStatus: current.status, providerErrorCode: next.providerErrorCode },
    );
  });
}

export async function npStoreShopPackingWorkCreateConfirmation(
  work: Pick<NpShopStoredPackingWork, "target" | "orderId" | "workId">,
  result: NpShopPackingWorkCreateResult,
  staffUserId: string | null,
): Promise<NpShopStoredPackingWork> {
  const siteId = await requireSiteId();
  const outcome = await getDb().transaction(async (tx) => {
    const current = await npReadStoredShopPackingWork(tx, siteId, work.target, work.orderId, true);
    if (!current || current.workId !== work.workId) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_not_found",
        "The durable packing work disappeared before provider confirmation.",
      );
    }
    if (current.status === "cancel-pending") {
      return { kind: "stored" as const, work: current };
    }
    if (current.status === "cancel-confirmed" || current.status === "cancelled") {
      if (
        current.providerWorkReference !== null &&
        current.confirmedAt !== null &&
        current.providerWorkReference === result.providerWorkReference &&
        current.confirmedAt === result.confirmedAt
      ) {
        return { kind: "stored" as const, work: current };
      }
      const conflict = {
        ...current,
        status: "manual-review",
        revision: current.revision + 1,
        providerErrorCode: "cancellation-dominance-violation",
        updatedAt: nextPackingWorkTimestamp(current.updatedAt, result.confirmedAt),
      } satisfies NpShopStoredPackingWork;
      await npPersistStoredShopPackingWork(tx, siteId, conflict);
      await recordShopPackingWorkAudit(
        tx,
        siteId,
        staffUserId,
        "shop.packing-work.create.cancellation-dominance-violation",
        conflict,
      );
      return { kind: "cancellation-dominance-violation" as const, work: conflict };
    }
    if (
      current.status === "provider-confirmed" ||
      current.status === "active" ||
      current.status === "consumed"
    ) {
      if (
        current.providerWorkReference !== result.providerWorkReference ||
        current.confirmedAt !== result.confirmedAt
      ) {
        const conflict = {
          ...current,
          status: "manual-review",
          revision: current.revision + 1,
          providerErrorCode: "provider-result-mismatch",
          updatedAt: nextPackingWorkTimestamp(current.updatedAt, result.confirmedAt),
        } satisfies NpShopStoredPackingWork;
        await npPersistStoredShopPackingWork(tx, siteId, conflict);
        await recordShopPackingWorkAudit(
          tx,
          siteId,
          staffUserId,
          "shop.packing-work.create.result-conflict",
          conflict,
        );
        return { kind: "result-conflict" as const, work: conflict };
      }
      return { kind: "stored" as const, work: current };
    }
    if (current.status !== "pending") {
      throw new NpShopPackingWorkConflictError(
        "packing_work_state_conflict",
        "The packing work cannot accept a create confirmation in its current state.",
      );
    }
    const next = {
      ...current,
      status: "provider-confirmed",
      revision: current.revision + 1,
      providerWorkReference: result.providerWorkReference,
      confirmedAt: result.confirmedAt,
      updatedAt: nextPackingWorkTimestamp(current.updatedAt, result.confirmedAt),
    } satisfies NpShopStoredPackingWork;
    await npPersistStoredShopPackingWork(tx, siteId, next);
    await recordShopPackingWorkAudit(
      tx,
      siteId,
      staffUserId,
      "shop.packing-work.create.confirm",
      next,
    );
    return { kind: "stored" as const, work: next };
  });
  if (outcome.kind === "cancellation-dominance-violation") {
    throw new NpShopPackingWorkConflictError(
      "packing_work_result_mismatch",
      "The provider recreated packing work after its confirmed cancellation; manual review is required.",
    );
  }
  if (outcome.kind === "result-conflict") {
    throw new NpShopPackingWorkConflictError(
      "packing_work_result_mismatch",
      "The provider returned conflicting create results for one packing-work idempotency key.",
    );
  }
  return outcome.work;
}

export async function npActivateShopPackingWork(
  identity: Pick<NpShopStoredPackingWork, "target" | "orderId" | "workId">,
  staffUserId: string | null,
): Promise<NpShopStoredPackingWork> {
  const siteId = await requireSiteId();
  const result = await getDb().transaction(async (tx) => {
    const source = await readLockedPackingWorkSource(tx, siteId, identity.target, identity.orderId);
    const current = await npReadStoredShopPackingWork(
      tx,
      siteId,
      identity.target,
      identity.orderId,
      true,
    );
    if (!current || current.workId !== identity.workId) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_not_found",
        "The provider-confirmed packing work no longer exists.",
      );
    }
    if (current.status === "active") return { outcome: "active" as const, work: current };
    if (current.status !== "provider-confirmed") {
      throw new NpShopPackingWorkConflictError(
        "packing_work_state_conflict",
        "Only provider-confirmed packing work can become active.",
      );
    }
    if (
      !packingWorkMatchesSource(current, source) ||
      source.booking !== null ||
      source.parcelSnapshot?.lockedShipmentId !== null ||
      (source.target === "outbound" && source.sourceStatus !== "processing") ||
      (source.target === "replacement" && source.sourceStatus !== "awaiting")
    ) {
      const conflict = {
        ...current,
        status: "manual-review",
        revision: current.revision + 1,
        providerErrorCode: "local-state-conflict",
        updatedAt: nextPackingWorkTimestamp(current.updatedAt),
      } satisfies NpShopStoredPackingWork;
      await npPersistStoredShopPackingWork(tx, siteId, conflict);
      await recordShopPackingWorkAudit(
        tx,
        siteId,
        staffUserId,
        "shop.packing-work.activate.manual-review",
        conflict,
      );
      return { outcome: "manual-review" as const, work: conflict };
    }
    const now = nextPackingWorkTimestamp(current.updatedAt, current.confirmedAt);
    const next = {
      ...current,
      status: "active",
      revision: current.revision + 1,
      activatedAt: now,
      updatedAt: now,
    } satisfies NpShopStoredPackingWork;
    await npPersistStoredShopPackingWork(tx, siteId, next);
    await recordShopPackingWorkAudit(tx, siteId, staffUserId, "shop.packing-work.activate", next);
    return { outcome: "active" as const, work: next };
  });
  if (result.outcome === "manual-review") {
    throw new NpShopPackingWorkConflictError(
      "packing_work_manual_review",
      "The provider accepted packing work after its local source changed; manual review is required.",
    );
  }
  return result.work;
}

type NpShopPreparedPackingWorkCancellation =
  | { outcome: "cancelled"; work: NpShopStoredPackingWork }
  | { outcome: "finalize"; work: NpShopStoredPackingWork }
  | {
      outcome: "provider";
      work: NpShopStoredPackingWork;
      request: NpShopPackingWorkCancelRequest;
    };

async function requirePackingWorkCancellationHasNoTracking(
  tx: NpShopTransaction,
  siteId: string,
  work: NpShopStoredPackingWork,
): Promise<void> {
  if (work.target !== "replacement" || work.attachedShipmentId === null) return;
  const tracking = await npReadShopExchangeTrackingForOrder(tx, siteId, work.orderId, true);
  if (tracking) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_shipment_conflict",
      "Attached replacement packing work cannot be cancelled after verified tracking starts.",
    );
  }
}

export async function npPrepareShopPackingWorkCancellation(
  input: NpShopPackingWorkExistingActionInput,
  providerId: string,
  staffUserId: string | null,
): Promise<NpShopPreparedPackingWorkCancellation> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const source = await readLockedPackingWorkCancellationSource(
      tx,
      siteId,
      input.target,
      input.orderId,
    );
    const current = await npReadStoredShopPackingWork(
      tx,
      siteId,
      input.target,
      input.orderId,
      true,
    );
    if (
      !current ||
      current.workId !== input.workId ||
      current.revision !== input.expectedRevision ||
      current.exchangeId !== input.exchangeId
    ) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_revision_conflict",
        "The packing work changed before cancellation started.",
      );
    }
    if (current.providerId !== providerId) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_not_supported",
        "Packing-work cancellation requires its original provider.",
      );
    }
    if (
      !npShopPackingWorkMatchesIdentity(current, {
        target: source.target,
        orderId: source.order.id,
        exchangeId: source.exchangeId,
        purgeAt: source.order.purgeAt,
      })
    ) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_revision_conflict",
        "The packing work no longer matches its retained source identity.",
      );
    }
    if (current.status === "cancelled") return { outcome: "cancelled", work: current };
    if (current.status === "cancel-confirmed") return { outcome: "finalize", work: current };
    if (current.status === "consumed" || current.consumedAt !== null) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_shipment_conflict",
        "Carrier-consumed or manually shipped packing work cannot be cancelled.",
      );
    }
    if (
      current.target === "outbound" &&
      current.attachedShipmentId !== null &&
      !packingWorkHasCancellationIntent(current)
    ) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_shipment_conflict",
        "Attached outbound packing work must finish through its exact carrier booking.",
      );
    }
    if (current.status === "cancel-pending") {
      return {
        outcome: "provider",
        work: current,
        request: freezePackingWorkCancelRequest(current),
      };
    }
    if (!packingWorkHasCancellationIntent(current)) {
      await requirePackingWorkCancellationHasNoTracking(tx, siteId, current);
    }
    if (source.target !== current.target || source.exchangeId !== current.exchangeId) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_state_conflict",
        "The packing work no longer matches its order target.",
      );
    }
    const requestedAt = new Date();
    requestedAt.setMilliseconds(0);
    const cancellationId = current.cancellationId ?? randomUUID();
    const cancelRequestedAt =
      current.cancelRequestedAt ??
      nextPackingWorkTimestamp(
        current.updatedAt,
        current.confirmedAt,
        current.activatedAt,
        requestedAt.toISOString(),
      );
    const now = nextPackingWorkTimestamp(current.updatedAt, cancelRequestedAt);
    const next = {
      ...current,
      status: "cancel-pending",
      revision: current.revision + 1,
      providerErrorCode: null,
      cancellationId,
      cancelRequestedAt,
      cancelledAt: null,
      updatedAt: now,
    } satisfies NpShopStoredPackingWork;
    await npPersistStoredShopPackingWork(tx, siteId, next);
    await recordShopPackingWorkAudit(
      tx,
      siteId,
      staffUserId,
      "shop.packing-work.cancel.request",
      next,
      { attachedShipmentId: next.attachedShipmentId },
    );
    return { outcome: "provider", work: next, request: freezePackingWorkCancelRequest(next) };
  });
}

export async function npStoreShopPackingWorkCancellationConfirmation(
  work: Pick<NpShopStoredPackingWork, "target" | "orderId" | "workId">,
  result: NpShopPackingWorkCancelResult,
  staffUserId: string | null,
): Promise<NpShopStoredPackingWork> {
  const siteId = await requireSiteId();
  const outcome = await getDb().transaction(async (tx) => {
    const current = await npReadStoredShopPackingWork(tx, siteId, work.target, work.orderId, true);
    if (!current || current.workId !== work.workId) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_not_found",
        "The durable packing work disappeared before cancellation confirmation.",
      );
    }
    if (current.status === "cancel-confirmed" || current.status === "cancelled") {
      if (
        current.cancellationId !== result.cancellationId ||
        current.cancelledAt !== result.cancelledAt
      ) {
        const conflict = {
          ...current,
          status: "manual-review",
          revision: current.revision + 1,
          providerErrorCode: "provider-result-mismatch",
          updatedAt: nextPackingWorkTimestamp(current.updatedAt, result.cancelledAt),
        } satisfies NpShopStoredPackingWork;
        await npPersistStoredShopPackingWork(tx, siteId, conflict);
        await recordShopPackingWorkAudit(
          tx,
          siteId,
          staffUserId,
          "shop.packing-work.cancel.result-conflict",
          conflict,
        );
        return { kind: "result-conflict" as const, work: conflict };
      }
      return { kind: "stored" as const, work: current };
    }
    if (current.status !== "cancel-pending") {
      throw new NpShopPackingWorkConflictError(
        "packing_work_state_conflict",
        "The packing work cannot accept cancellation confirmation in its current state.",
      );
    }
    const next = {
      ...current,
      status: "cancel-confirmed",
      revision: current.revision + 1,
      cancelledAt: result.cancelledAt,
      updatedAt: nextPackingWorkTimestamp(current.updatedAt, result.cancelledAt),
    } satisfies NpShopStoredPackingWork;
    await npPersistStoredShopPackingWork(tx, siteId, next);
    await recordShopPackingWorkAudit(
      tx,
      siteId,
      staffUserId,
      "shop.packing-work.cancel.confirm",
      next,
      { attachedShipmentId: next.attachedShipmentId },
    );
    return { kind: "stored" as const, work: next };
  });
  if (outcome.kind === "result-conflict") {
    throw new NpShopPackingWorkConflictError(
      "packing_work_result_mismatch",
      "The provider returned conflicting cancellation results for one packing-work idempotency key.",
    );
  }
  return outcome.work;
}

export async function npFinalizeShopPackingWorkCancellation(
  identity: Pick<NpShopStoredPackingWork, "target" | "orderId" | "workId">,
  staffUserId: string | null,
): Promise<NpShopStoredPackingWork> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const source = await readLockedPackingWorkCancellationSource(
      tx,
      siteId,
      identity.target,
      identity.orderId,
    );
    const current = await npReadStoredShopPackingWork(
      tx,
      siteId,
      identity.target,
      identity.orderId,
      true,
    );
    if (!current || current.workId !== identity.workId) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_not_found",
        "The provider-confirmed packing-work cancellation no longer exists.",
      );
    }
    if (
      !npShopPackingWorkMatchesIdentity(current, {
        target: source.target,
        orderId: source.order.id,
        exchangeId: source.exchangeId,
        purgeAt: source.order.purgeAt,
      })
    ) {
      throw new NpShopPackingWorkConflictError(
        "packing_work_revision_conflict",
        "The provider-confirmed cancellation no longer matches its retained source identity.",
      );
    }
    if (current.status === "cancelled") return current;
    if (current.status !== "cancel-confirmed") {
      throw new NpShopPackingWorkConflictError(
        "packing_work_state_conflict",
        "Only provider-confirmed cancellation can complete locally.",
      );
    }
    const now = nextPackingWorkTimestamp(current.updatedAt, current.cancelledAt);
    const next = {
      ...current,
      status: "cancelled",
      revision: current.revision + 1,
      updatedAt: now,
    } satisfies NpShopStoredPackingWork;
    await npPersistStoredShopPackingWork(tx, siteId, next);
    await recordShopPackingWorkAudit(tx, siteId, staffUserId, "shop.packing-work.cancel", next);
    return next;
  });
}

export async function npCreateShopPackingWork(
  runtime: NpShopRuntime,
  input: NpShopPackingWorkCreateActionInput,
  staffUserId: string | null,
): Promise<{ work: NpShopStoredPackingWork; duplicate: boolean }> {
  const adapter = runtime.packingWorkAdapter;
  if (!adapter) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_not_supported",
      "No packing-work adapter is configured for this Shop.",
    );
  }
  const prepared = await npPrepareShopPackingWorkCreate(input, adapter.id, staffUserId);
  if (prepared.outcome === "active") return { work: prepared.work, duplicate: true };
  if (prepared.outcome === "manual-review") {
    throw new NpShopPackingWorkConflictError(
      "packing_work_manual_review",
      "The durable packing-work snapshot no longer matches its canonical fingerprint or source.",
    );
  }
  if (prepared.outcome === "activate") {
    return { work: await npActivateShopPackingWork(prepared.work, staffUserId), duplicate: true };
  }
  let result: NpShopPackingWorkCreateResult;
  try {
    const raw = await adapter.createPackingWork(prepared.request);
    result = materializePackingWorkCreateResult(prepared.request, raw, new Date());
  } catch (error) {
    await persistPackingWorkProviderFailure(
      await requireSiteId(),
      prepared.work.target,
      prepared.work.orderId,
      prepared.work.workId,
      "pending",
      classifyPackingWorkProviderFailure(error),
      staffUserId,
    );
    throw new NpShopPackingWorkUnavailableError();
  }
  const confirmed = await npStoreShopPackingWorkCreateConfirmation(
    prepared.work,
    result,
    staffUserId,
  );
  if (confirmed.status !== "provider-confirmed" && confirmed.status !== "active") {
    throw new NpShopPackingWorkConflictError(
      "packing_work_state_conflict",
      "Packing-work cancellation won a concurrent create attempt.",
    );
  }
  return {
    work:
      confirmed.status === "active"
        ? confirmed
        : await npActivateShopPackingWork(confirmed, staffUserId),
    duplicate: false,
  };
}

export async function npCancelShopPackingWork(
  runtime: NpShopRuntime,
  input: NpShopPackingWorkExistingActionInput,
  staffUserId: string | null,
): Promise<{ work: NpShopStoredPackingWork; duplicate: boolean }> {
  const adapter = runtime.packingWorkAdapter;
  if (!adapter) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_not_supported",
      "The packing-work cancellation requires its original provider.",
    );
  }
  const prepared = await npPrepareShopPackingWorkCancellation(input, adapter.id, staffUserId);
  if (prepared.outcome === "cancelled") return { work: prepared.work, duplicate: true };
  if (prepared.outcome === "finalize") {
    return {
      work: await npFinalizeShopPackingWorkCancellation(prepared.work, staffUserId),
      duplicate: true,
    };
  }
  if (adapter.id !== prepared.work.providerId) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_not_supported",
      "The pending cancellation requires its original packing-work provider.",
    );
  }
  let result: NpShopPackingWorkCancelResult;
  try {
    const raw = await adapter.cancelPackingWork(prepared.request);
    result = materializePackingWorkCancelResult(prepared.request, raw, new Date());
  } catch (error) {
    await persistPackingWorkProviderFailure(
      await requireSiteId(),
      prepared.work.target,
      prepared.work.orderId,
      prepared.work.workId,
      "cancel-pending",
      classifyPackingWorkProviderFailure(error),
      staffUserId,
    );
    throw new NpShopPackingWorkUnavailableError();
  }
  const confirmed = await npStoreShopPackingWorkCancellationConfirmation(
    prepared.work,
    result,
    staffUserId,
  );
  return {
    work:
      confirmed.status === "cancelled"
        ? confirmed
        : await npFinalizeShopPackingWorkCancellation(confirmed, staffUserId),
    duplicate: false,
  };
}

export async function npFinalizeConfirmedShopPackingWork(
  input: NpShopPackingWorkExistingActionInput,
  staffUserId: string | null,
): Promise<{ work: NpShopStoredPackingWork; duplicate: boolean }> {
  const siteId = await requireSiteId();
  const current = await npReadStoredShopPackingWork(getDb(), siteId, input.target, input.orderId);
  if (
    !current ||
    current.workId !== input.workId ||
    current.revision !== input.expectedRevision ||
    current.exchangeId !== input.exchangeId
  ) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_revision_conflict",
      "The packing work changed before local finalization started.",
    );
  }
  if (current.status === "provider-confirmed") {
    return { work: await npActivateShopPackingWork(current, staffUserId), duplicate: false };
  }
  if (current.status === "cancel-confirmed") {
    return {
      work: await npFinalizeShopPackingWorkCancellation(current, staffUserId),
      duplicate: false,
    };
  }
  throw new NpShopPackingWorkConflictError(
    current.status === "manual-review"
      ? "packing_work_manual_review"
      : "packing_work_state_conflict",
    "Only a provider-confirmed packing-work transition can be finalized without provider I/O.",
  );
}

export async function npReconcileShopPackingWork(
  runtime: NpShopRuntime,
  input: NpShopPackingWorkExistingActionInput,
  staffUserId: string | null,
): Promise<{ work: NpShopStoredPackingWork; duplicate: boolean }> {
  const siteId = await requireSiteId();
  const current = await npReadStoredShopPackingWork(getDb(), siteId, input.target, input.orderId);
  if (
    !current ||
    current.workId !== input.workId ||
    current.revision !== input.expectedRevision ||
    current.exchangeId !== input.exchangeId
  ) {
    throw new NpShopPackingWorkConflictError(
      "packing_work_revision_conflict",
      "The packing work changed before reconciliation started.",
    );
  }
  if (current.status === "provider-confirmed") {
    return { work: await npActivateShopPackingWork(current, staffUserId), duplicate: false };
  }
  if (current.status === "cancel-confirmed") {
    return {
      work: await npFinalizeShopPackingWorkCancellation(current, staffUserId),
      duplicate: false,
    };
  }
  if (current.status === "pending") {
    const createInput: NpShopPackingWorkCreateActionInput =
      current.target === "outbound"
        ? {
            orderId: current.orderId,
            target: "outbound",
            exchangeId: null,
            expectedSourceRevision: current.sourceRevision,
            expectedParcelRevision: current.parcelRevision,
            expectedWorkRevision: current.revision,
          }
        : {
            orderId: current.orderId,
            target: "replacement",
            exchangeId: current.exchangeId,
            expectedSourceRevision: current.sourceRevision,
            expectedParcelRevision: current.parcelRevision,
            expectedWorkRevision: current.revision,
          };
    return npCreateShopPackingWork(runtime, createInput, staffUserId);
  }
  if (current.status === "cancel-pending") {
    return npCancelShopPackingWork(runtime, input, staffUserId);
  }
  if (
    current.status === "active" ||
    current.status === "cancelled" ||
    current.status === "consumed"
  ) {
    return { work: current, duplicate: true };
  }
  throw new NpShopPackingWorkConflictError(
    "packing_work_manual_review",
    "This packing work requires manual reconciliation.",
  );
}

export async function npMaintainShopPackingWork(
  runtime: NpShopRuntime,
): Promise<{ scanned: number; reconciled: number; failed: number }> {
  const siteId = await requireSiteId();
  const providerId = runtime.packingWorkAdapter?.id;
  const batchSize = 25;
  const localRows = await getDb()
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
      updatedAt: npPluginStorage.updatedAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "packing-work:%"),
        sql`${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT}`,
        sql`${npPluginStorage.value}->>'status' in ('provider-confirmed', 'cancel-confirmed')`,
      ),
    )
    .orderBy(asc(npPluginStorage.updatedAt), asc(npPluginStorage.key))
    .limit(batchSize);
  const providerRows = providerId
    ? await getDb()
        .select({
          key: npPluginStorage.key,
          value: npPluginStorage.value,
          expiresAt: npPluginStorage.expiresAt,
          updatedAt: npPluginStorage.updatedAt,
        })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            like(npPluginStorage.key, "packing-work:%"),
            sql`${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT}`,
            sql`${npPluginStorage.value}->>'status' in ('pending', 'cancel-pending')`,
            sql`${npPluginStorage.value}->>'providerId' = ${providerId}`,
          ),
        )
        .orderBy(asc(npPluginStorage.updatedAt), asc(npPluginStorage.key))
        .limit(batchSize)
    : [];
  const localQuota = providerId ? Math.ceil(batchSize / 2) : batchSize;
  const selectedLocalRows = localRows.slice(0, localQuota);
  const selectedProviderRows = providerRows.slice(0, batchSize - selectedLocalRows.length);
  const rows = [
    ...selectedLocalRows,
    ...selectedProviderRows,
    ...localRows.slice(selectedLocalRows.length, batchSize - selectedProviderRows.length),
  ];
  let reconciled = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const work = npRequireStoredShopPackingWorkAtKey(row.value, row.expiresAt, row.key);
      const input: NpShopPackingWorkExistingActionInput =
        work.target === "outbound"
          ? {
              orderId: work.orderId,
              target: "outbound",
              exchangeId: null,
              workId: work.workId,
              expectedRevision: work.revision,
            }
          : {
              orderId: work.orderId,
              target: "replacement",
              exchangeId: work.exchangeId,
              workId: work.workId,
              expectedRevision: work.revision,
            };
      await npReconcileShopPackingWork(runtime, input, null);
      reconciled += 1;
    } catch {
      failed += 1;
      await rotateShopStorageMaintenanceCursor(siteId, row.key, row.updatedAt);
    }
  }
  return { scanned: rows.length, reconciled, failed };
}

interface NpShopPreparedPackagingProposalBase {
  orderId: string;
  sourceRevision: number;
  parcelRevision: number | null;
  lines: NpShopPackagingProposalLine[];
}

export type NpShopPreparedPackagingProposal = NpShopPreparedPackagingProposalBase &
  ({ target: "outbound"; exchangeId: null } | { target: "replacement"; exchangeId: string });

export async function npPrepareShopPackagingProposal(
  input: NpShopPackagingProposalInput,
): Promise<NpShopPreparedPackagingProposal> {
  const siteId = await requireSiteId();
  if (input.target === "outbound") {
    return getDb().transaction(async (tx) => {
      const { fulfillment, order } = await readFulfillmentForAction(tx, siteId, input.orderId);
      if (fulfillment.status !== "processing") {
        throw new NpShopFulfillmentParcelConflictError(
          "parcel_fulfillment_not_processing",
          "Parcels can be proposed only for a processing fulfillment.",
        );
      }
      if (fulfillment.revision !== input.expectedSourceRevision) {
        throw new NpShopFulfillmentParcelConflictError(
          "parcel_fulfillment_revision_conflict",
          "The fulfillment changed before parcel proposal started.",
        );
      }
      const booking = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
      const parcels = await readStoredFulfillmentParcels(tx, siteId, input.orderId, true);
      const packingWork = await npReadStoredShopPackingWork(
        tx,
        siteId,
        "outbound",
        input.orderId,
        true,
      );
      requirePackingWorkAllowsParcelMutation(packingWork, {
        target: "outbound",
        orderId: order.id,
        exchangeId: null,
        purgeAt: order.purgeAt,
      });
      if (booking || parcels?.lockedShipmentId) {
        throw new NpShopFulfillmentParcelConflictError(
          "parcel_locked",
          "The parcel snapshot is locked by a durable carrier booking.",
        );
      }
      if ((parcels?.revision ?? null) !== input.expectedParcelRevision) {
        throw new NpShopFulfillmentParcelConflictError(
          "parcel_revision_conflict",
          "The parcel snapshot changed before parcel proposal started.",
        );
      }
      return {
        orderId: order.id,
        target: "outbound",
        exchangeId: null,
        sourceRevision: fulfillment.revision,
        parcelRevision: parcels?.revision ?? null,
        lines: order.lines.map((line) => ({
          lineKey: line.key,
          productId: line.productId,
          productSlug: line.productSlug,
          variantSku: line.variantSku,
          quantity: line.quantity,
        })),
      };
    });
  }
  return getDb().transaction(async (tx) => {
    const { order, exchange } = await readExchangeForAction(tx, siteId, input.orderId);
    if (
      exchange.id !== input.exchangeId ||
      exchange.status !== "awaiting" ||
      exchange.revision !== input.expectedSourceRevision
    ) {
      throw new NpShopExchangeParcelConflictError(
        "exchange_parcel_revision_conflict",
        "The replacement exchange changed before parcel proposal started.",
      );
    }
    const booking = await readStoredExchangeCarrierBooking(tx, siteId, input.orderId, true);
    const parcels = await readStoredExchangeParcels(tx, siteId, input.orderId, true);
    const packingWork = await npReadStoredShopPackingWork(
      tx,
      siteId,
      "replacement",
      input.orderId,
      true,
    );
    requirePackingWorkAllowsParcelMutation(packingWork, {
      target: "replacement",
      orderId: order.id,
      exchangeId: exchange.id,
      purgeAt: order.purgeAt,
    });
    if (booking || parcels?.lockedShipmentId) {
      throw new NpShopExchangeParcelConflictError(
        "exchange_parcel_locked",
        "The replacement parcel snapshot is locked by a durable carrier booking.",
      );
    }
    if ((parcels?.revision ?? null) !== input.expectedParcelRevision) {
      throw new NpShopExchangeParcelConflictError(
        "exchange_parcel_revision_conflict",
        "The replacement parcel snapshot changed before parcel proposal started.",
      );
    }
    return {
      orderId: order.id,
      target: "replacement",
      exchangeId: exchange.id,
      sourceRevision: exchange.revision,
      parcelRevision: parcels?.revision ?? null,
      lines: exchange.lines.map((line) => ({
        lineKey: line.lineKey,
        productId: line.productId,
        productSlug: line.productSlug,
        variantSku: line.variantSku,
        quantity: line.quantity,
      })),
    };
  });
}

function nextExchangeCarrierTimestamp(...values: Array<string | null | undefined>): string {
  return new Date(
    Math.max(
      Date.now(),
      ...values.filter((value): value is string => Boolean(value)).map(Date.parse),
    ),
  ).toISOString();
}

function closedExchangeCarrierErrorCode(error: unknown): string {
  if (error instanceof NpShopExchangeCarrierContractError) return "invalid-result";
  if (error instanceof NpShopCarrierProviderError && /^[a-z][a-z0-9-]{0,99}$/u.test(error.code)) {
    return error.code;
  }
  return "provider-unavailable";
}

async function persistExchangeCarrierFailure(
  siteId: string,
  orderId: string,
  bookingId: string,
  expectedStatus: "pending" | "cancel-pending",
  error: unknown,
): Promise<void> {
  const terminal =
    error instanceof NpShopExchangeCarrierContractError ||
    (error instanceof NpShopCarrierProviderError && !error.retryable);
  await getDb().transaction(async (tx) => {
    const current = await readStoredExchangeCarrierBooking(tx, siteId, orderId, true);
    if (!current || current.id !== bookingId || current.status !== expectedStatus) return;
    await persistExchangeCarrierBooking(tx, siteId, {
      ...current,
      status: terminal ? "manual-review" : expectedStatus,
      revision: current.revision + 1,
      providerErrorCode: closedExchangeCarrierErrorCode(error),
      updatedAt: nextExchangeCarrierTimestamp(current.updatedAt),
    });
  });
}

async function markExchangeCarrierManualReview(
  siteId: string,
  orderId: string,
  bookingId: string,
  expectedStatuses: readonly NpShopStoredExchangeCarrierBooking["status"][],
  code: string,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const current = await readStoredExchangeCarrierBooking(tx, siteId, orderId, true);
    if (!current || current.id !== bookingId || !expectedStatuses.includes(current.status)) return;
    await persistExchangeCarrierBooking(tx, siteId, {
      ...current,
      status: "manual-review",
      revision: current.revision + 1,
      providerErrorCode: code,
      updatedAt: nextExchangeCarrierTimestamp(current.updatedAt, current.confirmedAt),
    });
  });
}

function isExchangeCarrierLocalStateConflict(error: unknown): boolean {
  return (
    error instanceof NpShopExchangeCarrierConflictError ||
    error instanceof NpShopExchangeConflictError ||
    error instanceof NpShopExchangeParcelConflictError ||
    error instanceof NpShopPackingWorkConflictError
  );
}

export async function npBookShopExchangeCarrierShipment(
  runtime: NpShopRuntime,
  input: NpShopExchangeCarrierBookActionInput | NpShopExchangeCarrierExistingActionInput,
  staffUserId: string,
): Promise<{
  exchange: NpShopExchange;
  booking: NpShopStoredExchangeCarrierBooking;
  duplicate: boolean;
}> {
  const adapter = runtime.carrierExchangeAdapter;
  const parcelAdapter = runtime.carrierExchangeParcelAdapter;
  const siteId = await requireSiteId();
  const resuming = "bookingId" in input;
  const prepared = await getDb().transaction(async (tx) => {
    const { order, exchange } = await readExchangeForAction(tx, siteId, input.orderId);
    const current = await readStoredExchangeCarrierBooking(tx, siteId, input.orderId, true);
    let parcelSnapshot = await readStoredExchangeParcels(tx, siteId, input.orderId, true);
    if (
      exchange.id !== input.exchangeId ||
      order.revision !== input.orderRevision ||
      exchange.revision !== input.exchangeRevision
    ) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_revision_conflict",
        "The order or exchange changed before replacement booking started.",
      );
    }
    if (current) {
      if (current.exchangeId !== exchange.id) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_provider_mismatch",
          "The durable replacement booking belongs to a different exchange.",
        );
      }
      if (current.status === "completed") {
        return { outcome: "complete" as const, order, exchange, booking: current };
      }
      if (current.status === "pending" && (!adapter || adapter.id !== current.providerId)) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_provider_mismatch",
          "The pending replacement booking requires its original carrier provider.",
        );
      }
      if (parcelSnapshot?.lockedShipmentId && parcelSnapshot.lockedShipmentId !== current.id) {
        throw new NpShopExchangeParcelConflictError(
          "exchange_parcel_locked",
          "The replacement parcel snapshot belongs to a different durable shipment.",
        );
      }
      if (
        current.status === "pending" &&
        parcelSnapshot?.lockedShipmentId === current.id &&
        (!parcelAdapter || parcelAdapter.id !== current.providerId)
      ) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_provider_mismatch",
          "The durable replacement parcel booking requires its original parcel-aware carrier capability.",
        );
      }
      if (
        !resuming ||
        current.id !== input.bookingId ||
        current.revision !== input.bookingRevision
      ) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_revision_conflict",
          "The existing replacement booking must be resumed with its current revision.",
        );
      }
      if (current.status !== "pending" && current.status !== "provider-confirmed") {
        throw new NpShopExchangeCarrierConflictError(
          current.status === "manual-review"
            ? "exchange_carrier_manual_review"
            : "exchange_carrier_state_conflict",
          "Only pending or provider-confirmed replacement bookings can be resumed.",
        );
      }
      if (
        current.sourceOrderRevision !== order.revision ||
        current.sourceExchangeRevision !== exchange.revision ||
        current.destinationRevision !== exchange.destinationRevision ||
        exchange.status !== "awaiting"
      ) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_revision_conflict",
          "The exchange changed after replacement booking was prepared.",
        );
      }
      const destination =
        current.status === "pending"
          ? await readStoredExchangeDestinationPrivate(tx, siteId, input.orderId, true)
          : null;
      if (
        current.status === "pending" &&
        (!destination ||
          !exchangeDestinationMatches(destination, exchange) ||
          destination.accessedAt === null ||
          destination.expiresAt <= new Date().toISOString())
      ) {
        await persistExchangeCarrierBooking(tx, siteId, {
          ...current,
          status: "manual-review",
          revision: current.revision + 1,
          providerErrorCode: "private-expired",
          updatedAt: nextExchangeCarrierTimestamp(current.updatedAt),
        });
        return { outcome: "private-expired" as const };
      }
      const booking =
        input.operatorNote !== null && input.operatorNote !== current.operatorNote
          ? {
              ...current,
              revision: current.revision + 1,
              operatorNote: input.operatorNote,
              updatedAt: nextExchangeCarrierTimestamp(current.updatedAt),
            }
          : current;
      if (booking !== current) await persistExchangeCarrierBooking(tx, siteId, booking);
      const packingSource = {
        target: "replacement" as const,
        exchangeId: exchange.id,
        order,
        sourceRevision: exchange.revision,
        sourceStatus: exchange.status,
        booking,
        parcelSnapshot,
        lines: exchange.lines,
      };
      const currentPackingWork = await npReadStoredShopPackingWork(
        tx,
        siteId,
        "replacement",
        order.id,
        true,
      );
      const packingCancellationWon = Boolean(
        currentPackingWork &&
        currentPackingWork.attachedShipmentId === booking.id &&
        packingWorkHasCancellationIntent(currentPackingWork) &&
        packingWorkMatchesSnapshot(currentPackingWork, packingSource),
      );
      const attachedPackingWork = packingCancellationWon
        ? currentPackingWork
        : await attachShopPackingWorkToShipment(
            tx,
            siteId,
            packingSource,
            booking.id,
            Boolean(parcelAdapter && parcelSnapshot?.lockedShipmentId === booking.id),
            staffUserId,
          );
      return {
        outcome: "prepared" as const,
        order,
        exchange,
        booking,
        destination,
        parcelSnapshot: parcelSnapshot?.lockedShipmentId === booking.id ? parcelSnapshot : null,
        packingWorkId:
          attachedPackingWork?.status === "active" || packingCancellationWon
            ? (attachedPackingWork?.workId ?? null)
            : null,
      };
    }
    if (resuming) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_not_found",
        "The resumable replacement booking does not exist.",
      );
    }
    if (!adapter) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_not_supported",
        "Replacement carrier booking is not configured for this Shop.",
      );
    }
    if (
      exchange.status !== "awaiting" ||
      exchange.destinationRedactedAt !== null ||
      exchange.destinationRevision !== input.destinationRevision
    ) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_state_conflict",
        "Only an awaiting exchange with the exact destination revision can be booked.",
      );
    }
    const destination = await readStoredExchangeDestinationPrivate(tx, siteId, input.orderId, true);
    if (
      !destination ||
      !exchangeDestinationMatches(destination, exchange) ||
      destination.accessedAt === null ||
      destination.expiresAt <= new Date().toISOString()
    ) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_destination_expired",
        "A current staff-accessed replacement destination is required for carrier booking.",
      );
    }
    const requestedAt = new Date().toISOString();
    const booking = {
      contract: NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT,
      id: randomUUID(),
      orderId: order.id,
      exchangeId: exchange.id,
      providerId: adapter.id,
      status: "pending",
      revision: 1,
      sourceOrderRevision: order.revision,
      sourceExchangeRevision: exchange.revision,
      destinationRevision: exchange.destinationRevision,
      completedOrderRevision: null,
      completedExchangeRevision: null,
      operatorNote: input.operatorNote,
      bookingReference: null,
      carrier: null,
      trackingNumber: null,
      providerErrorCode: null,
      cancellationId: null,
      requestedAt,
      confirmedAt: null,
      cancelRequestedAt: null,
      cancelledAt: null,
      updatedAt: requestedAt,
      purgeAt: order.purgeAt,
    } satisfies NpShopStoredExchangeCarrierBooking;
    if (parcelAdapter) {
      if (
        !parcelSnapshot ||
        parcelSnapshot.exchangeId !== exchange.id ||
        parcelSnapshot.exchangeRevision !== exchange.revision ||
        parcelSnapshot.lockedShipmentId !== null
      ) {
        throw new NpShopExchangeParcelConflictError(
          "exchange_parcel_required",
          "The parcel-aware replacement carrier requires one current unlocked parcel snapshot.",
        );
      }
      requireExchangeParcelAllocation(exchange, parcelSnapshot.parcels);
      parcelSnapshot = {
        ...parcelSnapshot,
        lockedShipmentId: booking.id,
        updatedAt: nextExchangeCarrierTimestamp(parcelSnapshot.updatedAt),
      };
      await persistExchangeParcels(tx, siteId, parcelSnapshot);
    }
    await persistExchangeCarrierBooking(tx, siteId, booking);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.exchange.carrier.booking.prepare",
      order.id,
      {
        exchangeId: exchange.id,
        shipmentId: booking.id,
        providerId: booking.providerId,
        destinationRevision: booking.destinationRevision,
        parcelRevision:
          parcelSnapshot?.lockedShipmentId === booking.id ? parcelSnapshot.revision : null,
      },
    );
    const attachedPackingWork = await attachShopPackingWorkToShipment(
      tx,
      siteId,
      {
        target: "replacement",
        exchangeId: exchange.id,
        order,
        sourceRevision: exchange.revision,
        sourceStatus: exchange.status,
        booking,
        parcelSnapshot,
        lines: exchange.lines,
      },
      booking.id,
      Boolean(parcelAdapter && parcelSnapshot?.lockedShipmentId === booking.id),
      staffUserId,
    );
    return {
      outcome: "prepared" as const,
      order,
      exchange,
      booking,
      destination,
      parcelSnapshot: parcelSnapshot?.lockedShipmentId === booking.id ? parcelSnapshot : null,
      packingWorkId: attachedPackingWork?.status === "active" ? attachedPackingWork.workId : null,
    };
  });
  if (prepared.outcome === "private-expired") {
    throw new NpShopExchangeCarrierConflictError(
      "exchange_carrier_destination_expired",
      "The replacement destination expired before provider confirmation.",
    );
  }
  if (prepared.outcome === "complete") {
    return {
      exchange: npProjectShopExchange(prepared.exchange),
      booking: prepared.booking,
      duplicate: true,
    };
  }

  let providerResult: NpShopExchangeCarrierBookingResult;
  if (prepared.booking.status === "provider-confirmed") {
    providerResult = npRequireShopExchangeCarrierBookingResult({
      contract: NP_SHOP_EXCHANGE_CARRIER_BOOKING_RESULT_CONTRACT,
      shipmentId: prepared.booking.id,
      orderId: prepared.booking.orderId,
      exchangeId: prepared.booking.exchangeId,
      bookingReference: prepared.booking.bookingReference,
      carrier: prepared.booking.carrier,
      trackingNumber: prepared.booking.trackingNumber,
      bookedAt: prepared.booking.confirmedAt,
    });
  } else {
    if (!adapter || adapter.id !== prepared.booking.providerId) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_provider_mismatch",
        "The pending replacement booking requires its original carrier provider.",
      );
    }
    let invocationDestination: NpShopStoredExchangeDestinationPrivate | null = null;
    try {
      invocationDestination = await readStoredExchangeDestinationPrivate(
        getDb(),
        siteId,
        input.orderId,
      );
    } catch (error) {
      if (!(error instanceof NpShopExchangeContractError)) throw error;
    }
    if (
      !invocationDestination ||
      !exchangeDestinationMatches(invocationDestination, prepared.exchange) ||
      invocationDestination.accessedAt === null ||
      new Date(invocationDestination.expiresAt) <= new Date()
    ) {
      await markExchangeCarrierManualReview(
        siteId,
        input.orderId,
        prepared.booking.id,
        ["pending"],
        "private-expired",
      );
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_destination_expired",
        "The pending replacement booking lost its private destination.",
      );
    }
    const commonRequest = {
      shipmentId: prepared.booking.id,
      orderId: prepared.order.id,
      exchangeId: prepared.exchange.id,
      exchangeRevision: prepared.exchange.revision,
      destinationRevision: prepared.exchange.destinationRevision,
      items: exchangeCarrierItems(prepared.exchange),
      destination: invocationDestination.destination,
      requestedAt: prepared.booking.requestedAt,
    };
    let invokeProvider: () =>
      NpShopExchangeCarrierBookingResult | Promise<NpShopExchangeCarrierBookingResult>;
    if (prepared.parcelSnapshot) {
      if (!parcelAdapter || parcelAdapter.id !== prepared.booking.providerId) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_provider_mismatch",
          "The pending replacement parcel booking requires its original parcel-aware carrier provider.",
        );
      }
      const request = npRequireShopExchangeCarrierParcelBookingRequest({
        ...commonRequest,
        contract: NP_SHOP_EXCHANGE_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT,
        parcelRevision: prepared.parcelSnapshot.revision,
        parcels: prepared.parcelSnapshot.parcels,
      });
      invokeProvider = () => parcelAdapter.bookExchangeShipmentWithParcels(request);
    } else {
      const request = npRequireShopExchangeCarrierBookingRequest({
        ...commonRequest,
        contract: NP_SHOP_EXCHANGE_CARRIER_BOOKING_REQUEST_CONTRACT,
      });
      invokeProvider = () => adapter.bookExchangeShipment(request);
    }
    try {
      providerResult = npRequireShopExchangeCarrierBookingResult(await invokeProvider());
    } catch (error) {
      await persistExchangeCarrierFailure(
        siteId,
        input.orderId,
        prepared.booking.id,
        "pending",
        error,
      );
      if (
        error instanceof NpShopExchangeCarrierContractError ||
        (error instanceof NpShopCarrierProviderError && !error.retryable)
      ) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_manual_review",
          "The replacement carrier result requires manual reconciliation.",
        );
      }
      throw new NpShopCarrierUnavailableError(
        "The replacement carrier is temporarily unavailable; resume the same booking.",
      );
    }
  }
  if (
    providerResult.shipmentId !== prepared.booking.id ||
    providerResult.orderId !== prepared.order.id ||
    providerResult.exchangeId !== prepared.exchange.id ||
    new Date(providerResult.bookedAt) < new Date(prepared.booking.requestedAt) ||
    new Date(providerResult.bookedAt).getTime() >
      Date.now() + npShopCarrierLimits.futureToleranceSeconds * 1_000
  ) {
    await markExchangeCarrierManualReview(
      siteId,
      input.orderId,
      prepared.booking.id,
      ["pending"],
      "invalid-result",
    );
    throw new NpShopExchangeCarrierConflictError(
      "exchange_carrier_result_mismatch",
      "The provider result does not match the durable replacement shipment intent.",
    );
  }

  const confirmed = await getDb().transaction(async (tx) => {
    const current = await readStoredExchangeCarrierBooking(tx, siteId, input.orderId, true);
    if (!current || current.id !== prepared.booking.id) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_manual_review",
        "The durable replacement booking disappeared after provider confirmation.",
      );
    }
    if (current.status === "completed") return current;
    if (current.status === "provider-confirmed") {
      if (
        current.bookingReference === providerResult.bookingReference &&
        current.carrier === providerResult.carrier &&
        current.trackingNumber === providerResult.trackingNumber &&
        current.confirmedAt === providerResult.bookedAt
      ) {
        return current;
      }
      const conflict = {
        ...current,
        status: "manual-review",
        revision: current.revision + 1,
        providerErrorCode: "idempotency-conflict",
        updatedAt: nextExchangeCarrierTimestamp(current.updatedAt, current.confirmedAt),
      } satisfies NpShopStoredExchangeCarrierBooking;
      await persistExchangeCarrierBooking(tx, siteId, conflict);
      return conflict;
    }
    if (current.status !== "pending") {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_manual_review",
        "The replacement booking changed before confirmation was stored.",
      );
    }
    const next = {
      ...current,
      status: "provider-confirmed",
      revision: current.revision + 1,
      bookingReference: providerResult.bookingReference,
      carrier: providerResult.carrier,
      trackingNumber: providerResult.trackingNumber,
      providerErrorCode: null,
      confirmedAt: providerResult.bookedAt,
      updatedAt: nextExchangeCarrierTimestamp(current.updatedAt, providerResult.bookedAt),
    } satisfies NpShopStoredExchangeCarrierBooking;
    await persistExchangeCarrierBooking(tx, siteId, next);
    await deleteExchangeDestinationPrivate(tx, siteId, next.orderId);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.exchange.carrier.booking.confirm",
      next.orderId,
      { exchangeId: next.exchangeId, shipmentId: next.id, providerId: next.providerId },
    );
    return next;
  });
  if (confirmed.status === "completed") {
    const exchange = await readStoredExchange(getDb(), siteId, input.orderId);
    if (!exchange) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_not_found",
        "The completed replacement booking has no exchange.",
      );
    }
    return { exchange: npProjectShopExchange(exchange), booking: confirmed, duplicate: true };
  }
  if (confirmed.status === "manual-review") {
    throw new NpShopExchangeCarrierConflictError(
      "exchange_carrier_manual_review",
      "The provider returned conflicting results for one replacement shipment id.",
    );
  }

  try {
    return await getDb().transaction(async (tx) => {
      const { order, exchange } = await readExchangeForAction(tx, siteId, input.orderId);
      const booking = await readStoredExchangeCarrierBooking(tx, siteId, input.orderId, true);
      const parcelSnapshot = await readStoredExchangeParcels(tx, siteId, input.orderId, true);
      if (
        !booking ||
        booking.id !== confirmed.id ||
        booking.status !== "provider-confirmed" ||
        exchange.id !== booking.exchangeId ||
        exchange.status !== "awaiting" ||
        order.revision !== booking.sourceOrderRevision ||
        exchange.revision !== booking.sourceExchangeRevision ||
        exchange.destinationRevision !== booking.destinationRevision
      ) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_manual_review",
          "The exchange changed after provider confirmation.",
        );
      }
      const packingSource = {
        target: "replacement" as const,
        exchangeId: exchange.id,
        order,
        sourceRevision: exchange.revision,
        sourceStatus: exchange.status,
        booking,
        parcelSnapshot,
        lines: exchange.lines,
      };
      const packingWorkAfterProvider = prepared.packingWorkId
        ? await npReadStoredShopPackingWork(tx, siteId, "replacement", order.id, true)
        : null;
      const packingCancellationWon = Boolean(
        prepared.packingWorkId &&
        packingWorkAfterProvider?.workId === prepared.packingWorkId &&
        packingWorkHasCancellationIntent(packingWorkAfterProvider) &&
        packingWorkAfterProvider.attachedShipmentId === booking.id &&
        packingWorkAfterProvider.consumedAt === null &&
        packingWorkMatchesSnapshot(packingWorkAfterProvider, packingSource),
      );
      const attachedPackingWork = packingCancellationWon
        ? packingWorkAfterProvider
        : await attachShopPackingWorkToShipment(
            tx,
            siteId,
            packingSource,
            booking.id,
            Boolean(parcelAdapter && parcelSnapshot?.lockedShipmentId === booking.id),
            staffUserId,
          );
      if (
        prepared.packingWorkId &&
        (attachedPackingWork?.workId !== prepared.packingWorkId ||
          (attachedPackingWork.status !== "active" && !packingCancellationWon))
      ) {
        throw new NpShopPackingWorkConflictError(
          "packing_work_shipment_conflict",
          "Packing-work cancellation won while replacement booking was in progress.",
        );
      }
      const now = nextExchangeCarrierTimestamp(exchange.updatedAt, booking.confirmedAt);
      const updatedOrder = {
        ...order,
        revision: order.revision + 1,
        updatedAt: now,
      } satisfies NpShopStoredOrder;
      const updatedExchange = {
        ...exchange,
        status: "processing",
        revision: exchange.revision + 1,
        orderRevision: updatedOrder.revision,
        carrier: booking.carrier,
        trackingNumber: booking.trackingNumber,
        operatorNote: booking.operatorNote ?? exchange.operatorNote,
        destinationRedactedAt: now,
        updatedAt: now,
      } satisfies NpShopStoredExchange;
      const completed = {
        ...booking,
        status: "completed",
        revision: booking.revision + 1,
        completedOrderRevision: updatedOrder.revision,
        completedExchangeRevision: updatedExchange.revision,
        providerErrorCode: null,
        updatedAt: now,
      } satisfies NpShopStoredExchangeCarrierBooking;
      await persistOrder(tx, siteId, updatedOrder);
      await persistExchange(tx, siteId, updatedExchange);
      await persistExchangeCarrierBooking(tx, siteId, completed);
      await npStageShopOrderNotification(tx, siteId, {
        orderId: order.id,
        ownerSegment: order.ownerSegment,
        kind: "exchange.processing",
        orderRevision: updatedOrder.revision,
        occurredAt: now,
        purgeAt: order.purgeAt,
        email: null,
      });
      await recordRequiredShopFulfillmentAudit(
        tx,
        siteId,
        staffUserId,
        "shop.exchange.carrier.booking.complete",
        order.id,
        {
          exchangeId: exchange.id,
          shipmentId: completed.id,
          providerId: completed.providerId,
          exchangeRevision: updatedExchange.revision,
          packingCancellationWon,
        },
      );
      return {
        exchange: npProjectShopExchange(updatedExchange),
        booking: completed,
        duplicate: false,
      };
    });
  } catch (error) {
    if (!isExchangeCarrierLocalStateConflict(error)) throw error;
    await markExchangeCarrierManualReview(
      siteId,
      input.orderId,
      prepared.booking.id,
      ["provider-confirmed"],
      "local-state-conflict",
    );
    throw new NpShopExchangeCarrierConflictError(
      "exchange_carrier_manual_review",
      "The provider confirmed replacement shipment but local completion requires reconciliation.",
    );
  }
}

export async function npCancelShopExchangeCarrierShipment(
  runtime: NpShopRuntime,
  input: NpShopExchangeCarrierExistingActionInput,
  staffUserId: string,
): Promise<{
  exchange: NpShopExchange;
  booking: NpShopStoredExchangeCarrierBooking;
  duplicate: boolean;
}> {
  const adapter = runtime.carrierExchangeAdapter;
  const siteId = await requireSiteId();
  const prepared = await getDb().transaction(async (tx) => {
    const { order, exchange } = await readExchangeForAction(tx, siteId, input.orderId);
    const current = await readStoredExchangeCarrierBooking(tx, siteId, input.orderId, true);
    if (!current || current.id !== input.bookingId || current.exchangeId !== input.exchangeId) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_not_found",
        "The provider-owned replacement booking does not exist.",
      );
    }
    if (
      (current.status === "completed" || current.status === "cancel-pending") &&
      (!adapter || adapter.id !== current.providerId)
    ) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_not_supported",
        "Provider cancellation requires the original replacement carrier adapter.",
      );
    }
    const tracking = await npReadShopExchangeTrackingForOrder(tx, siteId, input.orderId, true);
    if (tracking) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_state_conflict",
        "A replacement shipment with verified tracking state cannot be provider-cancelled or restocked.",
      );
    }
    const pickup = await readStoredCarrierPickupByShipment(tx, siteId, current.id, true);
    if (
      pickup &&
      (pickup.orderId !== order.id ||
        pickup.target !== "replacement" ||
        pickup.exchangeId !== exchange.id ||
        pickup.providerId !== current.providerId ||
        pickup.status !== "cancelled")
    ) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_state_conflict",
        "The replacement pickup must be fully cancelled before its shipment can be provider-cancelled or restocked.",
      );
    }
    const labelAcquisition = await npReadStoredShopCarrierLabelAcquisition(
      tx,
      siteId,
      current.id,
      true,
    );
    if (labelAcquisition && labelAcquisition.status !== "completed") {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_state_conflict",
        "The replacement label acquisition must complete or be manually reconciled before its shipment can be provider-cancelled or restocked.",
      );
    }
    const parcelSnapshot = await readStoredExchangeParcels(tx, siteId, input.orderId, true);
    const packingWork = await npReadStoredShopPackingWork(
      tx,
      siteId,
      "replacement",
      input.orderId,
      true,
    );
    const packingCancellationSafe =
      !packingWork ||
      (packingWork.status === "cancelled" &&
        (packingWork.attachedShipmentId === null
          ? npShopPackingWorkMatchesUnattachedTombstone(packingWork, {
              target: "replacement",
              orderId: order.id,
              exchangeId: exchange.id,
              purgeAt: order.purgeAt,
            })
          : packingWork.attachedShipmentId === current.id &&
            packingWorkMatchesReplacementAdminSource(
              packingWork,
              exchange,
              parcelSnapshot,
              current,
            )));
    if (!packingCancellationSafe) {
      throw new NpShopPackingWorkConflictError(
        packingWork.status === "manual-review"
          ? "packing_work_manual_review"
          : "packing_work_state_conflict",
        "Confirm packing-work cancellation before cancelling the replacement shipment.",
      );
    }
    if (current.status === "cancelled" && exchange.status === "cancelled") {
      return { outcome: "cancelled" as const, exchange, booking: current };
    }
    if (!exchangeCarrierBookingMatchesCurrentSource(current, order, exchange)) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_state_conflict",
        "The replacement booking no longer matches its exact completed order and exchange revisions.",
      );
    }
    if (
      order.revision !== input.orderRevision ||
      exchange.revision !== input.exchangeRevision ||
      current.revision !== input.bookingRevision
    ) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_revision_conflict",
        "The exchange or replacement booking changed before cancellation.",
      );
    }
    if (exchange.status !== "processing") {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_state_conflict",
        "Only a processing booked replacement can be cancelled.",
      );
    }
    if (
      current.status !== "completed" &&
      current.status !== "cancel-pending" &&
      current.status !== "cancel-confirmed"
    ) {
      throw new NpShopExchangeCarrierConflictError(
        current.status === "manual-review"
          ? "exchange_carrier_manual_review"
          : "exchange_carrier_state_conflict",
        "Only completed or already-cancelling replacement bookings can be cancelled.",
      );
    }
    if (current.status !== "completed") {
      const booking =
        input.operatorNote !== null && input.operatorNote !== current.operatorNote
          ? {
              ...current,
              revision: current.revision + 1,
              operatorNote: input.operatorNote,
              updatedAt: nextExchangeCarrierTimestamp(current.updatedAt),
            }
          : current;
      if (booking !== current) await persistExchangeCarrierBooking(tx, siteId, booking);
      return { outcome: "prepared" as const, exchange, booking };
    }
    const requestedAt = nextExchangeCarrierTimestamp(current.updatedAt);
    const booking = {
      ...current,
      status: "cancel-pending",
      revision: current.revision + 1,
      cancellationId: randomUUID(),
      operatorNote: input.operatorNote ?? current.operatorNote,
      providerErrorCode: null,
      cancelRequestedAt: requestedAt,
      updatedAt: requestedAt,
    } satisfies NpShopStoredExchangeCarrierBooking;
    await persistExchangeCarrierBooking(tx, siteId, booking);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.exchange.carrier.cancellation.prepare",
      order.id,
      { exchangeId: exchange.id, shipmentId: booking.id, cancellationId: booking.cancellationId },
    );
    return { outcome: "prepared" as const, exchange, booking };
  });
  if (prepared.outcome === "cancelled") {
    return {
      exchange: npProjectShopExchange(prepared.exchange),
      booking: prepared.booking,
      duplicate: true,
    };
  }
  let booking = prepared.booking;
  let providerResult: NpShopExchangeCarrierCancelResult;
  if (booking.status === "cancel-confirmed") {
    providerResult = npRequireShopExchangeCarrierCancelResult({
      contract: NP_SHOP_EXCHANGE_CARRIER_CANCEL_RESULT_CONTRACT,
      cancellationId: booking.cancellationId,
      shipmentId: booking.id,
      orderId: booking.orderId,
      exchangeId: booking.exchangeId,
      cancelledAt: booking.cancelledAt,
    });
  } else {
    if (!adapter || adapter.id !== booking.providerId) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_not_supported",
        "Provider cancellation requires the original replacement carrier adapter.",
      );
    }
    const request = npRequireShopExchangeCarrierCancelRequest({
      contract: NP_SHOP_EXCHANGE_CARRIER_CANCEL_REQUEST_CONTRACT,
      cancellationId: booking.cancellationId,
      shipmentId: booking.id,
      orderId: booking.orderId,
      exchangeId: booking.exchangeId,
      bookingReference: booking.bookingReference,
      requestedAt: booking.cancelRequestedAt,
    });
    try {
      providerResult = npRequireShopExchangeCarrierCancelResult(
        await adapter.cancelExchangeShipment(request),
      );
    } catch (error) {
      await persistExchangeCarrierFailure(
        siteId,
        input.orderId,
        booking.id,
        "cancel-pending",
        error,
      );
      if (
        error instanceof NpShopExchangeCarrierContractError ||
        (error instanceof NpShopCarrierProviderError && !error.retryable)
      ) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_manual_review",
          "Replacement carrier cancellation requires manual reconciliation.",
        );
      }
      throw new NpShopCarrierUnavailableError(
        "The replacement carrier cancellation is temporarily unavailable; resume it.",
      );
    }
  }
  if (
    providerResult.cancellationId !== booking.cancellationId ||
    providerResult.shipmentId !== booking.id ||
    providerResult.orderId !== booking.orderId ||
    providerResult.exchangeId !== booking.exchangeId ||
    new Date(providerResult.cancelledAt) < new Date(booking.cancelRequestedAt ?? 0) ||
    new Date(providerResult.cancelledAt).getTime() >
      Date.now() + npShopCarrierLimits.futureToleranceSeconds * 1_000
  ) {
    await markExchangeCarrierManualReview(
      siteId,
      input.orderId,
      booking.id,
      ["cancel-pending"],
      "invalid-result",
    );
    throw new NpShopExchangeCarrierConflictError(
      "exchange_carrier_result_mismatch",
      "The provider cancellation result does not match its durable intent.",
    );
  }
  booking = await getDb().transaction(async (tx) => {
    const current = await readStoredExchangeCarrierBooking(tx, siteId, input.orderId, true);
    if (!current || current.id !== booking.id) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_manual_review",
        "The replacement booking disappeared after provider cancellation.",
      );
    }
    if (current.status === "cancel-confirmed" || current.status === "cancelled") {
      if (current.cancelledAt === providerResult.cancelledAt) return current;
      const conflict = {
        ...current,
        status: "manual-review",
        revision: current.revision + 1,
        providerErrorCode: "idempotency-conflict",
        updatedAt: nextExchangeCarrierTimestamp(current.updatedAt, current.cancelledAt),
      } satisfies NpShopStoredExchangeCarrierBooking;
      await persistExchangeCarrierBooking(tx, siteId, conflict);
      return conflict;
    }
    if (current.status !== "cancel-pending") {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_manual_review",
        "The replacement booking changed before cancellation confirmation was stored.",
      );
    }
    const next = {
      ...current,
      status: "cancel-confirmed",
      revision: current.revision + 1,
      providerErrorCode: null,
      cancelledAt: providerResult.cancelledAt,
      updatedAt: nextExchangeCarrierTimestamp(current.updatedAt, providerResult.cancelledAt),
    } satisfies NpShopStoredExchangeCarrierBooking;
    await persistExchangeCarrierBooking(tx, siteId, next);
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.exchange.carrier.cancellation.confirm",
      next.orderId,
      { exchangeId: next.exchangeId, shipmentId: next.id, cancellationId: next.cancellationId },
    );
    return next;
  });
  if (booking.status === "manual-review") {
    throw new NpShopExchangeCarrierConflictError(
      "exchange_carrier_manual_review",
      "The provider returned conflicting replacement cancellation results.",
    );
  }
  if (booking.status === "cancelled") {
    const exchange = await readStoredExchange(getDb(), siteId, input.orderId);
    if (!exchange) {
      throw new NpShopExchangeCarrierConflictError(
        "exchange_carrier_not_found",
        "The cancelled replacement booking has no exchange.",
      );
    }
    return { exchange: npProjectShopExchange(exchange), booking, duplicate: true };
  }
  try {
    return await getDb().transaction(async (tx) => {
      const { order, returnRequest, exchange } = await readExchangeForAction(
        tx,
        siteId,
        input.orderId,
      );
      const current = await readStoredExchangeCarrierBooking(tx, siteId, input.orderId, true);
      if (
        !current ||
        current.id !== booking.id ||
        current.status !== "cancel-confirmed" ||
        exchange.status !== "processing" ||
        exchange.id !== current.exchangeId ||
        order.revision !== current.completedOrderRevision ||
        exchange.revision !== current.completedExchangeRevision ||
        !exchangeCarrierBookingMatchesCurrentSource(current, order, exchange)
      ) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_manual_review",
          "The exchange changed after provider cancellation.",
        );
      }
      if (await npReadShopExchangeTrackingForOrder(tx, siteId, input.orderId, true)) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_manual_review",
          "Tracking state was verified while provider cancellation was in progress; inventory cannot be restored automatically.",
        );
      }
      const pickup = await readStoredCarrierPickupByShipment(tx, siteId, current.id, true);
      if (
        pickup &&
        (pickup.orderId !== order.id ||
          pickup.target !== "replacement" ||
          pickup.exchangeId !== exchange.id ||
          pickup.providerId !== current.providerId ||
          pickup.status !== "cancelled")
      ) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_manual_review",
          "Replacement pickup state changed while shipment cancellation was in progress; inventory cannot be restored automatically.",
        );
      }
      const parcelSnapshot = await readStoredExchangeParcels(tx, siteId, input.orderId, true);
      const packingWork = await npReadStoredShopPackingWork(
        tx,
        siteId,
        "replacement",
        input.orderId,
        true,
      );
      const packingCancellationSafe =
        !packingWork ||
        (packingWork.status === "cancelled" &&
          (packingWork.attachedShipmentId === null
            ? npShopPackingWorkMatchesUnattachedTombstone(packingWork, {
                target: "replacement",
                orderId: order.id,
                exchangeId: exchange.id,
                purgeAt: order.purgeAt,
              })
            : packingWork.attachedShipmentId === current.id &&
              packingWorkMatchesReplacementAdminSource(
                packingWork,
                exchange,
                parcelSnapshot,
                current,
              )));
      if (!packingCancellationSafe) {
        throw new NpShopExchangeCarrierConflictError(
          "exchange_carrier_manual_review",
          "Packing-work cancellation is no longer confirmed; inventory cannot be restored automatically.",
        );
      }
      const trackedKeys = new Set(order.inventoryReservationLineKeys);
      const trackedLines = exchangeInventoryLines(order, returnRequest).filter((line) =>
        trackedKeys.has(line.key),
      );
      await npLockShopInventoryProducts(
        tx,
        siteId,
        trackedLines.map((line) => line.productId),
      );
      const inventoryOutcome =
        trackedLines.length === 0
          ? "not-required"
          : (await npRestoreShopOrderInventory(tx, siteId, runtime, trackedLines))
            ? "restocked"
            : "manual-required";
      const now = nextExchangeCarrierTimestamp(exchange.updatedAt, current.cancelledAt);
      const updatedOrder = {
        ...order,
        revision: order.revision + 1,
        updatedAt: now,
      } satisfies NpShopStoredOrder;
      const cancelledExchange = {
        ...exchange,
        status: "cancelled",
        revision: exchange.revision + 1,
        orderRevision: updatedOrder.revision,
        inventoryOutcome,
        carrier: null,
        trackingNumber: null,
        operatorNote: current.operatorNote ?? exchange.operatorNote,
        updatedAt: now,
        shippedAt: null,
        cancelledAt: now,
      } satisfies NpShopStoredExchange;
      const cancelledBooking = {
        ...current,
        status: "cancelled",
        revision: current.revision + 1,
        providerErrorCode: null,
        updatedAt: now,
      } satisfies NpShopStoredExchangeCarrierBooking;
      await tx
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, npShopExchangeTrackingPollStorageKey(order.id)),
          ),
        );
      await persistOrder(tx, siteId, updatedOrder);
      await persistExchange(tx, siteId, cancelledExchange);
      await persistExchangeCarrierBooking(tx, siteId, cancelledBooking);
      await npStageShopOrderNotification(tx, siteId, {
        orderId: order.id,
        ownerSegment: order.ownerSegment,
        kind: "exchange.cancelled",
        orderRevision: updatedOrder.revision,
        occurredAt: now,
        purgeAt: order.purgeAt,
        email: null,
      });
      await recordRequiredShopFulfillmentAudit(
        tx,
        siteId,
        staffUserId,
        "shop.exchange.carrier.cancellation.complete",
        order.id,
        {
          exchangeId: exchange.id,
          shipmentId: current.id,
          inventoryOutcome,
          exchangeRevision: cancelledExchange.revision,
        },
      );
      return {
        exchange: npProjectShopExchange(cancelledExchange),
        booking: cancelledBooking,
        duplicate: false,
      };
    });
  } catch (error) {
    if (!isExchangeCarrierLocalStateConflict(error)) throw error;
    await markExchangeCarrierManualReview(
      siteId,
      input.orderId,
      booking.id,
      ["cancel-confirmed"],
      "local-state-conflict",
    );
    throw new NpShopExchangeCarrierConflictError(
      "exchange_carrier_manual_review",
      "The provider cancelled replacement shipment but local completion requires reconciliation.",
    );
  }
}

export async function npShipBookedShopExchange(
  runtime: NpShopRuntime,
  input: NpShopExchangeCarrierExistingActionInput,
  staffUserId: string,
): Promise<NpShopExchange> {
  const siteId = await requireSiteId();
  const booking = await readStoredExchangeCarrierBooking(getDb(), siteId, input.orderId);
  if (
    !booking ||
    booking.id !== input.bookingId ||
    booking.exchangeId !== input.exchangeId ||
    booking.revision !== input.bookingRevision ||
    booking.status !== "completed" ||
    !booking.carrier ||
    !booking.trackingNumber
  ) {
    throw new NpShopExchangeCarrierConflictError(
      "exchange_carrier_revision_conflict",
      "The completed replacement booking changed before shipment handoff.",
    );
  }
  const shipment = {
    orderId: input.orderId,
    exchangeId: input.exchangeId,
    orderRevision: input.orderRevision,
    exchangeRevision: input.exchangeRevision,
    operatorNote: input.operatorNote,
    carrier: booking.carrier,
    trackingNumber: booking.trackingNumber,
  } satisfies NpShopExchangeShipInput;
  return updateShopExchange(runtime, shipment, staffUserId, "ship");
}

export function npProcessShopExchange(
  runtime: NpShopRuntime,
  input: NpShopExchangeUpdateInput,
  staffUserId: string,
): Promise<NpShopExchange> {
  return updateShopExchange(runtime, input, staffUserId, "process");
}

export function npShipShopExchange(
  runtime: NpShopRuntime,
  input: NpShopExchangeShipInput,
  staffUserId: string,
): Promise<NpShopExchange> {
  return updateShopExchange(runtime, input, staffUserId, "ship");
}

export function npCancelShopExchange(
  runtime: NpShopRuntime,
  input: NpShopExchangeUpdateInput,
  staffUserId: string,
): Promise<NpShopExchange> {
  return updateShopExchange(runtime, input, staffUserId, "cancel");
}

export async function npListRecentShopReturns(): Promise<{
  rows: NpShopAdminReturnRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "return:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopReturnLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "return:%"),
      ),
    );
  const returnRequests = rows.map((row) =>
    requireStoredReturnAtKey(row.value, row.expiresAt, row.key),
  );
  const logisticsKeys = returnRequests.map((returnRequest) =>
    npShopReturnLogisticsStorageKey(returnRequest.orderId),
  );
  const partialRefundKeys = returnRequests.map((returnRequest) =>
    npShopPartialRefundStorageKey(returnRequest.orderId),
  );
  const exchangeKeys = returnRequests.map((returnRequest) =>
    npShopExchangeStorageKey(returnRequest.orderId),
  );
  const refundKeys = returnRequests.map((returnRequest) => refundStorageKey(returnRequest.orderId));
  const relatedKeys = [...logisticsKeys, ...partialRefundKeys, ...exchangeKeys, ...refundKeys];
  const relatedRows =
    relatedKeys.length === 0
      ? []
      : await db
          .select({
            key: npPluginStorage.key,
            value: npPluginStorage.value,
            expiresAt: npPluginStorage.expiresAt,
          })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              inArray(npPluginStorage.key, relatedKeys),
            ),
          );
  const relatedByKey = new Map(relatedRows.map((row) => [row.key, row]));
  return {
    rows: returnRequests.map((returnRequest) => {
      const logisticsRow = relatedByKey.get(npShopReturnLogisticsStorageKey(returnRequest.orderId));
      const partialRefundRow = relatedByKey.get(
        npShopPartialRefundStorageKey(returnRequest.orderId),
      );
      const exchangeRow = relatedByKey.get(npShopExchangeStorageKey(returnRequest.orderId));
      const refundRow = relatedByKey.get(refundStorageKey(returnRequest.orderId));
      let postageSettlement = partialRefundRow ? "refund-exists" : "unavailable";
      if (!partialRefundRow && logisticsRow) {
        try {
          const logistics = npRequireStoredShopReturnLogistics(logisticsRow.value);
          if (
            logisticsRow.expiresAt !== null &&
            logisticsRow.expiresAt.toISOString() === logistics.purgeAt &&
            logistics.orderId === returnRequest.orderId &&
            logistics.returnId === returnRequest.id &&
            logistics.ownerSegment === returnRequest.ownerSegment &&
            logistics.purgeAt === returnRequest.purgeAt &&
            logistics.status === "active" &&
            logistics.postageMethod
          ) {
            postageSettlement =
              returnRequest.status === "received" ? "eligible" : "awaiting-receipt";
          }
        } catch {
          postageSettlement = "invalid";
        }
      }
      let exchange = "unavailable";
      if (exchangeRow) {
        try {
          exchange = `existing:${
            requireStoredExchangeAtKey(exchangeRow.value, exchangeRow.expiresAt, exchangeRow.key)
              .status
          }`;
        } catch {
          exchange = "invalid";
        }
      } else if (partialRefundRow || refundRow) {
        exchange = "refund-exists";
      } else if (returnRequest.status !== "received") {
        exchange = "awaiting-receipt";
      } else if (returnRequest.inventoryOutcome === "manual-required") {
        exchange = "manual-inventory";
      } else if (
        returnRequest.inventoryOutcome === "restocked" ||
        returnRequest.inventoryOutcome === "not-required"
      ) {
        exchange = "eligible";
      }
      return {
        id: returnRequest.orderId,
        returnId: returnRequest.id,
        status: returnRequest.status,
        returnRevision: returnRequest.revision,
        orderRevision: returnRequest.orderRevision,
        reason: returnRequest.reason,
        detail: returnRequest.detail ?? "—",
        units: returnRequest.lines.reduce((totalUnits, line) => totalUnits + line.quantity, 0),
        inventory: returnRequest.inventoryOutcome,
        operatorNote: returnRequest.operatorNote ?? "—",
        postageSettlement,
        exchange,
        updatedAt: returnRequest.updatedAt,
      };
    }),
    total,
  };
}

export async function npCountShopReturns(): Promise<{
  total: number;
  requested: number;
  approved: number;
  rejected: number;
  received: number;
  cancelled: number;
  manualInventory: number;
  invalidSample: number;
  orphanSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      requested: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_RETURN_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'requested')::int`,
      approved: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_RETURN_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'approved')::int`,
      rejected: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_RETURN_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'rejected')::int`,
      received: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_RETURN_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'received')::int`,
      cancelled: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_RETURN_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'cancelled')::int`,
      manualInventory: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_RETURN_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'inventoryOutcome' = 'manual-required')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "return:%"),
      ),
    );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "return:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopReturnLimits.diagnosticSampleSize);
  let invalidSample = 0;
  let orphanSample = 0;
  for (const row of rows) {
    try {
      const returnRequest = requireStoredReturnAtKey(row.value, row.expiresAt, row.key);
      const [lookupRow] = await db
        .select({
          key: npPluginStorage.key,
          value: npPluginStorage.value,
          expiresAt: npPluginStorage.expiresAt,
        })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, lookupStorageKey(returnRequest.orderId)),
          ),
        )
        .limit(1);
      if (!lookupRow) {
        orphanSample += 1;
        continue;
      }
      const lookup = requireOrderLookup(lookupRow.value, lookupRow.expiresAt, lookupRow.key);
      const [orderRow] = await db
        .select({
          key: npPluginStorage.key,
          value: npPluginStorage.value,
          expiresAt: npPluginStorage.expiresAt,
        })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, orderStorageKey(lookup.ownerSegment, returnRequest.orderId)),
          ),
        )
        .limit(1);
      const order = orderRow
        ? requireStoredOrderAtKey(orderRow.value, orderRow.expiresAt, orderRow.key)
        : null;
      const fulfillment = await readStoredFulfillment(db, siteId, returnRequest.orderId);
      if (
        !order ||
        !returnMatchesOrder(returnRequest, order) ||
        !fulfillment ||
        fulfillment.status !== "shipped" ||
        !fulfillmentMatchesOrder(fulfillment, order)
      ) {
        orphanSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  return { ...counts, invalidSample, orphanSample };
}

export async function npListRecentShopExchanges(
  carrierProviderId?: string,
  parcelAwareCarrier = false,
): Promise<{
  rows: NpShopAdminExchangeRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopExchangeLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange:%"),
      ),
    );
  return {
    rows: await Promise.all(
      rows.map(async (row) => {
        const exchange = requireStoredExchangeAtKey(row.value, row.expiresAt, row.key);
        const order = await readStoredOrderForUpdate(
          db,
          siteId,
          exchange.ownerSegment,
          exchange.orderId,
        );
        const returnRequest = await readStoredReturn(db, siteId, exchange.orderId);
        const destination = await readStoredExchangeDestinationPrivate(
          db,
          siteId,
          exchange.orderId,
        );
        const carrierBooking = await readStoredExchangeCarrierBooking(db, siteId, exchange.orderId);
        const parcelSnapshot = await readStoredExchangeParcels(db, siteId, exchange.orderId);
        const packingWork = await readAdminPackingWork(db, siteId, "replacement", exchange.orderId);
        const exactPackingWork = packingWork === "invalid" ? null : packingWork;
        const exactUnlockedParcelSnapshot = Boolean(
          parcelSnapshot &&
          parcelSnapshot.orderId === exchange.orderId &&
          parcelSnapshot.exchangeId === exchange.id &&
          parcelSnapshot.exchangeRevision === exchange.revision &&
          parcelSnapshot.purgeAt === exchange.purgeAt &&
          parcelSnapshot.lockedShipmentId === null,
        );
        const exactLockedParcelSnapshot = Boolean(
          parcelSnapshot &&
          carrierBooking &&
          parcelSnapshot.orderId === exchange.orderId &&
          parcelSnapshot.exchangeId === exchange.id &&
          parcelSnapshot.exchangeRevision === carrierBooking.sourceExchangeRevision &&
          parcelSnapshot.purgeAt === exchange.purgeAt &&
          parcelSnapshot.lockedShipmentId === carrierBooking.id,
        );
        const pickup = carrierBooking
          ? await readStoredCarrierPickupByShipment(db, siteId, carrierBooking.id)
          : null;
        const labelAcquisition = carrierBooking
          ? await npReadStoredShopCarrierLabelAcquisition(db, siteId, carrierBooking.id)
          : null;
        if (
          pickup &&
          (pickup.orderId !== exchange.orderId ||
            pickup.target !== "replacement" ||
            pickup.exchangeId !== exchange.id ||
            pickup.providerId !== carrierBooking?.providerId)
        ) {
          throw new NpShopCarrierContractError("Invalid replacement pickup relationship", [
            "replacement pickup must match its exact order, exchange, and shipment.",
          ]);
        }
        const storedTracking = await npReadStoredShopExchangeTrackingForOrder(
          db,
          siteId,
          exchange.orderId,
        );
        const tracking = storedTracking ? npProjectShopTracking(storedTracking) : null;
        const exactTracking = Boolean(
          storedTracking &&
          carrierBooking &&
          exchangeTrackingMatchesBooking(storedTracking, carrierBooking, exchange),
        );
        const trackingRelationshipValid = !storedTracking || exactTracking;
        const projected = npProjectShopExchange(
          exchange,
          destination && exchangeDestinationMatches(destination, exchange)
            ? { expiresAt: destination.expiresAt, accessedAt: destination.accessedAt }
            : null,
          new Date(),
          tracking,
        );
        const providerOwned = carrierBooking !== null && carrierBooking.status !== "cancelled";
        const adminStatus =
          providerOwned && (exchange.status === "awaiting" || exchange.status === "processing")
            ? `provider-${exchange.status}`
            : exchange.status;
        const adminCarrierBooking =
          carrierBooking?.status === "completed" && exchange.status === "shipped"
            ? "shipped"
            : (carrierBooking?.status ?? "none");
        const paymentDisputeSafe = order
          ? await npShopPaymentDisputeAllowsAdminActions(db, siteId, order)
          : false;
        const commercialSourceValid = Boolean(
          order &&
          paymentDisputeSafe &&
          returnRequest &&
          returnMatchesOrder(returnRequest, order) &&
          exchangeMatchesOrder(exchange, order, returnRequest),
        );
        const carrierBookingSourceValid = Boolean(
          !carrierBooking ||
          (order && exchangeCarrierBookingMatchesCurrentSource(carrierBooking, order, exchange)),
        );
        if (
          labelAcquisition &&
          (labelAcquisition.orderId !== exchange.orderId ||
            labelAcquisition.target !== "replacement" ||
            labelAcquisition.exchangeId !== exchange.id ||
            labelAcquisition.providerId !== carrierBooking?.providerId)
        ) {
          throw new NpShopCarrierContractError("Invalid replacement label relationship", [
            "replacement label acquisition must match its exact order, exchange, and shipment.",
          ]);
        }
        const packingCarrierSourceValid =
          commercialSourceValid &&
          carrierBookingSourceValid &&
          packingWork !== "invalid" &&
          (exactPackingWork === null ||
            (exactPackingWork.status === "cancelled" && exactPackingWork.attachedShipmentId === null
              ? npShopPackingWorkMatchesUnattachedTombstone(exactPackingWork, {
                  target: "replacement",
                  orderId: exchange.orderId,
                  exchangeId: exchange.id,
                  purgeAt: exchange.purgeAt,
                })
              : carrierBooking !== null &&
                packingWorkMatchesReplacementAdminSource(
                  exactPackingWork,
                  exchange,
                  parcelSnapshot,
                  carrierBooking,
                )));
        const packingAllowsNewShipmentEffect =
          carrierBooking !== null &&
          carrierBooking.providerId === carrierProviderId &&
          packingCarrierSourceValid &&
          npShopPackingWorkAllowsShipmentEffect(exactPackingWork, carrierBooking.id);
        const labelRelationshipValid = Boolean(
          labelAcquisition &&
          carrierBooking &&
          replacementLabelAcquisitionMatchesBooking(labelAcquisition, carrierBooking, exchange),
        );
        const labelAction =
          carrierBooking?.status !== "completed" || tracking
            ? "—"
            : labelAcquisition?.status === "pending" ||
                labelAcquisition?.status === "provider-confirmed"
              ? packingWork === "invalid"
                ? "—"
                : labelRelationshipValid && carrierBooking.providerId === carrierProviderId
                  ? "resume"
                  : "—"
              : packingAllowsNewShipmentEffect
                ? !labelAcquisition
                  ? "purchase"
                  : labelAcquisition.status === "completed" && labelRelationshipValid
                    ? "regenerate"
                    : "—"
                : "—";
        const packingFallbackIdentity = {
          target: "replacement" as const,
          orderId: exchange.orderId,
          exchangeId: exchange.id,
          purgeAt: exchange.purgeAt,
        };
        const activePackingMatchesProcessSource = Boolean(
          order &&
          exactPackingWork?.status === "active" &&
          packingWorkMatchesSource(exactPackingWork, {
            target: "replacement",
            exchangeId: exchange.id,
            order,
            sourceRevision: exchange.revision,
            sourceStatus: exchange.status,
            booking: carrierBooking,
            parcelSnapshot,
            lines: exchange.lines,
          }),
        );
        const packingAllowsExchangeProcess =
          commercialSourceValid &&
          packingWork !== "invalid" &&
          (exactPackingWork === null ||
            activePackingMatchesProcessSource ||
            (exactPackingWork !== null &&
              packingWorkAllowsUnattachedFallback(exactPackingWork, packingFallbackIdentity)));
        const packingAllowsExchangeCancellation =
          commercialSourceValid &&
          packingWork !== "invalid" &&
          (exactPackingWork === null ||
            (exactPackingWork !== null &&
              packingWorkAllowsUnattachedFallback(exactPackingWork, packingFallbackIdentity)));
        const packingAllowsProviderCarrierCancellation =
          commercialSourceValid &&
          packingWork !== "invalid" &&
          (exactPackingWork === null ||
            (exactPackingWork.status === "cancelled" &&
              ((exactPackingWork.attachedShipmentId === null &&
                packingWorkAllowsUnattachedFallback(exactPackingWork, packingFallbackIdentity)) ||
                (exactPackingWork.attachedShipmentId === carrierBooking?.id &&
                  packingCarrierSourceValid))));
        const providerCarrierCancellationStepEligible = Boolean(
          carrierBooking &&
          (carrierBooking.status === "cancel-confirmed" ||
            ((carrierBooking.status === "completed" ||
              carrierBooking.status === "cancel-pending") &&
              carrierBooking.providerId === carrierProviderId)),
        );
        const trackingAllowsShipmentAfterPackingCancellation = Boolean(
          exactTracking &&
          carrierBooking &&
          packingCarrierSourceValid &&
          exactPackingWork?.attachedShipmentId === carrierBooking.id &&
          packingWorkHasCancellationIntent(exactPackingWork),
        );
        const packingCancellationOwnsCarrierCompletion = Boolean(
          carrierBooking?.status === "provider-confirmed" &&
          packingCarrierSourceValid &&
          exactPackingWork?.attachedShipmentId === carrierBooking.id &&
          packingWorkHasCancellationIntent(exactPackingWork),
        );
        return {
          id: exchange.orderId,
          exchangeId: exchange.id,
          returnId: exchange.returnId,
          status: adminStatus,
          exchangeRevision: exchange.revision,
          orderRevision: exchange.orderRevision,
          destination: providerOwned ? "provider-owned" : projected.destinationStatus,
          destinationRevision: projected.destinationRevision,
          destinationExpiresAt: projected.destinationExpiresAt ?? "—",
          carrierBooking: adminCarrierBooking,
          bookingId: carrierBooking?.id ?? "—",
          shipmentId: carrierBooking?.id ?? "—",
          bookingRevision: carrierBooking?.revision ?? 0,
          pickupAction:
            carrierBooking?.status === "completed" &&
            exactLockedParcelSnapshot &&
            !tracking &&
            !pickup &&
            packingAllowsNewShipmentEffect
              ? "schedule"
              : "—",
          pickupRevision: pickup?.revision ?? 0,
          pickupTarget: "replacement",
          pickupStatus: pickup?.status ?? "none",
          labelAction,
          labelDownloadEligible: Boolean(
            labelAcquisition?.status === "completed" &&
            labelRelationshipValid &&
            carrierBooking?.providerId === carrierProviderId,
          ),
          expectedRevision: labelAcquisition?.revision ?? 0,
          target: "replacement",
          provider: carrierBooking?.providerId ?? "—",
          parcels: parcelSnapshot
            ? `${parcelSnapshot.parcels.length.toString()} package(s)${parcelSnapshot.lockedShipmentId ? " (locked)" : ""}`
            : "not prepared",
          parcelRevision: parcelSnapshot?.revision ?? null,
          packingWorkStatus:
            packingWork === "invalid" ? "invalid" : (exactPackingWork?.status ?? "none"),
          packingWorkRevision: exactPackingWork?.revision ?? null,
          packingWorkAction:
            exchange.status === "awaiting" &&
            commercialSourceValid &&
            projected.destinationStatus === "accessed" &&
            carrierBooking === null &&
            exactUnlockedParcelSnapshot &&
            packingWork === null
              ? "create"
              : "—",
          parcelMutationEligible:
            exchange.status === "awaiting" &&
            commercialSourceValid &&
            projected.destinationStatus === "accessed" &&
            carrierBooking === null &&
            (parcelSnapshot?.lockedShipmentId ?? null) === null &&
            packingWork !== "invalid" &&
            packingWorkAllowsParcelMutation(exactPackingWork, {
              target: "replacement",
              orderId: exchange.orderId,
              exchangeId: exchange.id,
              purgeAt: exchange.purgeAt,
            }),
          processEligible:
            exchange.status === "awaiting" &&
            commercialSourceValid &&
            projected.destinationStatus === "accessed" &&
            carrierBooking === null &&
            packingAllowsExchangeProcess,
          manualShipEligible:
            adminStatus === "processing" &&
            carrierBooking === null &&
            packingAllowsExchangeProcess &&
            packingWorkAllowsShipmentCompletion(exactPackingWork, null, {
              target: "replacement",
              orderId: exchange.orderId,
              exchangeId: exchange.id,
              purgeAt: exchange.purgeAt,
            }),
          cancelEligible:
            (adminStatus === "awaiting" || adminStatus === "processing") &&
            carrierBooking === null &&
            packingAllowsExchangeCancellation,
          carrierBookEligible:
            exchange.status === "awaiting" &&
            commercialSourceValid &&
            projected.destinationStatus === "accessed" &&
            carrierBooking === null &&
            (!parcelAwareCarrier || exactUnlockedParcelSnapshot) &&
            packingWork !== "invalid" &&
            packingWorkAllowsCarrierShipment(exactPackingWork, parcelAwareCarrier, null, {
              target: "replacement",
              orderId: exchange.orderId,
              exchangeId: exchange.id,
              purgeAt: exchange.purgeAt,
            }),
          carrierResumeEligible:
            (carrierBooking?.status === "pending" ||
              carrierBooking?.status === "provider-confirmed") &&
            packingCarrierSourceValid &&
            (packingWorkAllowsCarrierShipment(
              exactPackingWork,
              carrierBooking.status === "pending" && parcelAwareCarrier,
              carrierBooking.id,
              {
                target: "replacement",
                orderId: exchange.orderId,
                exchangeId: exchange.id,
                purgeAt: exchange.purgeAt,
              },
            ) ||
              packingCancellationOwnsCarrierCompletion) &&
            (carrierBooking.status === "provider-confirmed" ||
              (carrierBooking.providerId === carrierProviderId &&
                ((parcelSnapshot?.lockedShipmentId ?? null) === null ||
                  (parcelAwareCarrier && exactLockedParcelSnapshot)))),
          carrierShipEligible:
            exchange.status === "processing" &&
            carrierBooking?.status === "completed" &&
            trackingRelationshipValid &&
            packingCarrierSourceValid &&
            (packingWorkAllowsShipmentCompletion(exactPackingWork, carrierBooking.id, {
              target: "replacement",
              orderId: exchange.orderId,
              exchangeId: exchange.id,
              purgeAt: exchange.purgeAt,
            }) ||
              trackingAllowsShipmentAfterPackingCancellation),
          carrierCancelEligible:
            exchange.status === "processing" &&
            !tracking &&
            (!pickup || pickup.status === "cancelled") &&
            (!labelAcquisition || labelAcquisition.status === "completed") &&
            providerCarrierCancellationStepEligible &&
            packingCarrierSourceValid &&
            packingAllowsProviderCarrierCancellation,
          units: exchange.lines.reduce((sum, line) => sum + line.quantity, 0),
          inventory: exchange.inventoryOutcome,
          carrier: exchange.carrier ?? "—",
          trackingNumber: exchange.trackingNumber ?? "—",
          trackingStatus: tracking?.status ?? "—",
          trackingShipmentId: tracking?.shipmentId ?? "—",
          operatorNote: exchange.operatorNote ?? "—",
          updatedAt: exchange.updatedAt,
        };
      }),
    ),
    total,
  };
}

export async function npCountShopExchangeParcels(): Promise<{
  total: number;
  unlocked: number;
  locked: number;
  invalidSample: number;
  orphanSample: number;
  allocationMismatchSample: number;
  lockMismatchSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unlocked: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'lockedShipmentId' is null)::int`,
      locked: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'lockedShipmentId' is not null)::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange-parcels:%"),
      ),
    );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange-parcels:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopExchangeLimits.diagnosticSampleSize);
  let invalidSample = 0;
  let orphanSample = 0;
  let allocationMismatchSample = 0;
  let lockMismatchSample = 0;
  for (const row of rows) {
    try {
      const snapshot = requireStoredExchangeParcelsAtKey(row.value, row.expiresAt, row.key);
      const exchange = await readStoredExchange(db, siteId, snapshot.orderId);
      if (
        !exchange ||
        exchange.id !== snapshot.exchangeId ||
        exchange.purgeAt !== snapshot.purgeAt
      ) {
        orphanSample += 1;
        continue;
      }
      try {
        requireExchangeParcelAllocation(exchange, snapshot.parcels);
      } catch (error) {
        if (error instanceof NpShopExchangeParcelConflictError) {
          allocationMismatchSample += 1;
          continue;
        }
        throw error;
      }
      const booking = await readStoredExchangeCarrierBooking(db, siteId, snapshot.orderId);
      if (
        snapshot.lockedShipmentId !== null &&
        (!booking ||
          booking.id !== snapshot.lockedShipmentId ||
          booking.exchangeId !== snapshot.exchangeId ||
          booking.sourceExchangeRevision !== snapshot.exchangeRevision)
      ) {
        lockMismatchSample += 1;
      }
      if (
        exchange.revision < snapshot.exchangeRevision ||
        (exchange.revision === snapshot.exchangeRevision && exchange.status !== "awaiting") ||
        (exchange.revision > snapshot.exchangeRevision &&
          exchange.status !== "processing" &&
          exchange.status !== "shipped" &&
          exchange.status !== "cancelled")
      ) {
        invalidSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  return {
    ...counts,
    invalidSample,
    orphanSample,
    allocationMismatchSample,
    lockMismatchSample,
  };
}

export async function npCountShopExchanges(): Promise<{
  total: number;
  awaiting: number;
  processing: number;
  shipped: number;
  cancelled: number;
  manualInventory: number;
  destinationAwaitingSample: number;
  destinationSubmittedSample: number;
  destinationAccessedSample: number;
  destinationExpiredSample: number;
  expiredPrivateSample: number;
  invalidPrivateSample: number;
  orphanPrivateSample: number;
  invalidSample: number;
  orphanSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      awaiting: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'awaiting')::int`,
      processing: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'processing')::int`,
      shipped: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'shipped')::int`,
      cancelled: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'cancelled')::int`,
      manualInventory: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'inventoryOutcome' = 'manual-required')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange:%"),
      ),
    );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopExchangeLimits.diagnosticSampleSize);
  let invalidSample = 0;
  let orphanSample = 0;
  let destinationAwaitingSample = 0;
  let destinationSubmittedSample = 0;
  let destinationAccessedSample = 0;
  let destinationExpiredSample = 0;
  const invalidPrivateKeys = new Set<string>();
  for (const row of rows) {
    try {
      const exchange = requireStoredExchangeAtKey(row.value, row.expiresAt, row.key);
      const [lookupRow] = await db
        .select({
          key: npPluginStorage.key,
          value: npPluginStorage.value,
          expiresAt: npPluginStorage.expiresAt,
        })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, lookupStorageKey(exchange.orderId)),
          ),
        )
        .limit(1);
      if (!lookupRow) {
        orphanSample += 1;
        continue;
      }
      const lookup = requireOrderLookup(lookupRow.value, lookupRow.expiresAt, lookupRow.key);
      const [orderRow, returnRow] = await Promise.all([
        db
          .select({
            key: npPluginStorage.key,
            value: npPluginStorage.value,
            expiresAt: npPluginStorage.expiresAt,
          })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              eq(npPluginStorage.key, orderStorageKey(lookup.ownerSegment, exchange.orderId)),
            ),
          )
          .limit(1),
        db
          .select({
            key: npPluginStorage.key,
            value: npPluginStorage.value,
            expiresAt: npPluginStorage.expiresAt,
          })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              eq(npPluginStorage.key, returnStorageKey(exchange.orderId)),
            ),
          )
          .limit(1),
      ]);
      const order = orderRow[0]
        ? requireStoredOrderAtKey(orderRow[0].value, orderRow[0].expiresAt, orderRow[0].key)
        : null;
      const returnRequest = returnRow[0]
        ? requireStoredReturnAtKey(returnRow[0].value, returnRow[0].expiresAt, returnRow[0].key)
        : null;
      const [fulfillment, fullRefund, partialRefund] = await Promise.all([
        readStoredFulfillment(db, siteId, exchange.orderId),
        readStoredRefund(db, siteId, exchange.orderId),
        npReadStoredShopPartialRefundForAdjustment(db, siteId, exchange.orderId),
      ]);
      if (!order || !returnRequest || !fulfillment) {
        orphanSample += 1;
      } else if (
        !exchangeMatchesOrder(exchange, order, returnRequest) ||
        fulfillment.status !== "shipped" ||
        !fulfillmentMatchesOrder(fulfillment, order) ||
        fullRefund !== null ||
        partialRefund !== null
      ) {
        invalidSample += 1;
      }
      let destination: NpShopStoredExchangeDestinationPrivate | null;
      try {
        destination = await readStoredExchangeDestinationPrivate(db, siteId, exchange.orderId);
      } catch {
        invalidPrivateKeys.add(npShopExchangeDestinationPrivateStorageKey(exchange.orderId));
        continue;
      }
      if (exchange.status === "awaiting") {
        if (destination) {
          if (!exchangeDestinationMatches(destination, exchange)) {
            invalidPrivateKeys.add(npShopExchangeDestinationPrivateStorageKey(exchange.orderId));
          } else if (new Date(destination.expiresAt) <= new Date()) {
            destinationExpiredSample += 1;
          } else if (destination.accessedAt) {
            destinationAccessedSample += 1;
          } else {
            destinationSubmittedSample += 1;
          }
        } else if (exchange.destinationRevision > 0) {
          destinationExpiredSample += 1;
        } else {
          destinationAwaitingSample += 1;
        }
      } else if (destination) {
        invalidPrivateKeys.add(npShopExchangeDestinationPrivateStorageKey(exchange.orderId));
      }
    } catch {
      invalidSample += 1;
    }
  }
  const privateRows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange-destination-private:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopExchangeLimits.diagnosticSampleSize);
  let orphanPrivateSample = 0;
  let expiredPrivateSample = 0;
  for (const row of privateRows) {
    try {
      const destination = requireStoredExchangeDestinationPrivateAtKey(
        row.value,
        row.expiresAt,
        row.key,
      );
      const exchange = await readStoredExchange(db, siteId, destination.orderId);
      if (!exchange) orphanPrivateSample += 1;
      else if (!exchangeDestinationMatches(destination, exchange)) invalidPrivateKeys.add(row.key);
      else if (new Date(destination.expiresAt) <= new Date()) expiredPrivateSample += 1;
    } catch {
      invalidPrivateKeys.add(row.key);
    }
  }
  return {
    ...counts,
    destinationAwaitingSample,
    destinationSubmittedSample,
    destinationAccessedSample,
    destinationExpiredSample,
    expiredPrivateSample,
    invalidPrivateSample: invalidPrivateKeys.size,
    orphanPrivateSample,
    invalidSample,
    orphanSample,
  };
}

export async function npCountShopExchangeCarrierBookings(
  expectedProviderId: string | null | undefined,
): Promise<{
  total: number;
  pending: number;
  providerConfirmed: number;
  completed: number;
  cancelling: number;
  cancelled: number;
  manualReview: number;
  invalidSample: number;
  orphanSample: number;
  providerMismatchSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'pending')::int`,
      providerConfirmed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'provider-confirmed')::int`,
      completed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'completed')::int`,
      cancelling: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' in ('cancel-pending', 'cancel-confirmed'))::int`,
      cancelled: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'cancelled')::int`,
      manualReview: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'manual-review')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange-carrier-booking:%"),
      ),
    );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "exchange-carrier-booking:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopExchangeLimits.diagnosticSampleSize);
  let invalidSample = 0;
  let orphanSample = 0;
  let providerMismatchSample = 0;
  for (const row of rows) {
    try {
      const booking = requireStoredExchangeCarrierBookingAtKey(row.value, row.expiresAt, row.key);
      const exchange = await readStoredExchange(db, siteId, booking.orderId);
      if (!exchange || exchange.id !== booking.exchangeId || exchange.purgeAt !== booking.purgeAt) {
        orphanSample += 1;
        continue;
      }
      const order = await readStoredOrderForUpdate(
        db,
        siteId,
        exchange.ownerSegment,
        exchange.orderId,
      );
      if (!order) {
        orphanSample += 1;
        continue;
      }
      if (booking.providerId !== (expectedProviderId ?? null)) {
        providerMismatchSample += 1;
      }
      if (
        booking.status !== "manual-review" &&
        !exchangeCarrierBookingMatchesCurrentSource(booking, order, exchange)
      ) {
        invalidSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  return {
    ...counts,
    invalidSample,
    orphanSample,
    providerMismatchSample,
  };
}
