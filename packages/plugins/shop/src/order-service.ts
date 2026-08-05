import { createHash, randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, gt, inArray, like, lte, sql } from "drizzle-orm";

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
  npRequireStoredShopFulfillmentParcels,
  npShopFulfillmentParcelLimits,
  npShopFulfillmentParcelTotals,
  type NpShopFulfillmentParcelsSaveInput,
  type NpShopStoredFulfillmentParcels,
} from "./parcel-contract.js";
import {
  npCleanupExpiredShopInventoryReservations,
  npConsumeShopInventoryReservations,
  npLockShopInventoryProducts,
  npPersistShopInventoryReservations,
  npPurgeShopInventoryReservations,
  npReleaseShopInventoryReservations,
  npRestoreShopOrderInventory,
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
import {
  npLockShopCart,
  npQuoteShopCart,
  npShopCartOwnerStorageSegment,
  type NpShopCartOwner,
} from "./cart-service.js";
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
import { npShopTrackingPollStorageKey } from "./tracking-contract.js";
import { npReadShopTrackingForOrder } from "./tracking-service.js";
import { npReadShopReturnTrackingForOrder } from "./return-tracking-service.js";
import {
  npShopReturnTrackingPollStorageKey,
  npShopReturnTrackingStorageKey,
} from "./return-tracking-contract.js";
import { npRequireStoredShopCarrierPickup } from "./pickup-contract.js";
import { npReadShopReturnLogisticsForOrder } from "./return-logistics-service.js";
import {
  npHasShopPartialRefund,
  npReadShopPartialRefundForOrder,
  npReadStoredShopPartialRefundForAdjustment,
  npShopPartialRefundStorageKey,
} from "./partial-refund-service.js";

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

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;

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
  pickupAction: string;
  pickupRevision: number;
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

function maintenanceStorageKey(ownerSegment: string, orderId: string): string {
  return `order-maintenance:${ownerSegment}:${orderId}`;
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
): Promise<NpShopStoredOrderPrivateData | null> {
  const [row] = await db
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
  if (!row) return null;
  const privateData = requireStoredPrivate(row.value, row.expiresAt);
  if (privateData.orderId !== orderId) {
    throw new NpShopOrderContractError("Invalid Shop order private storage key", [
      "Private order id must match its storage key.",
    ]);
  }
  return privateData;
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
  if (order.privateDataStatus === "retained" && !privateData) {
    throw new NpShopOrderContractError("Shop order private data is missing", [
      "A retained order must have one matching private sidecar.",
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
  const partialRefund = await npReadShopPartialRefundForOrder(db, siteId, order, returnRequest);
  const returnTracking = returnRequest
    ? await npReadShopReturnTrackingForOrder(db, siteId, order.id)
    : null;
  const returnLogistics = returnRequest
    ? await npReadShopReturnLogisticsForOrder(db, siteId, returnRequest, returnTracking)
    : null;
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
  await removePrivateAndMaintenance(tx, siteId, order.ownerSegment, order.id);
  return cancelled;
}

async function redactStoredOrderPrivate(
  tx: NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
  now: Date,
): Promise<NpShopStoredOrder> {
  const fulfillment = await readStoredFulfillment(tx, siteId, order.id, true);
  if (fulfillment && !fulfillmentMatchesOrder(fulfillment, order)) {
    throw new NpShopOrderContractError("Shop fulfillment does not match its order", [
      "Fulfillment must match the paid order before private data can be redacted.",
    ]);
  }
  if (fulfillment?.privateDataStatus === "retained") {
    await persistFulfillment(tx, siteId, {
      ...fulfillment,
      revision: fulfillment.revision + 1,
      privateDataStatus: "redacted",
      updatedAt: now.toISOString(),
    });
  }
  if (order.privateDataStatus === "redacted") {
    await removePrivateAndMaintenance(tx, siteId, order.ownerSegment, order.id);
    return order;
  }
  const redacted = {
    ...order,
    revision: order.revision + 1,
    privateDataStatus: "redacted",
    updatedAt: now.toISOString(),
  } satisfies NpShopStoredOrder;
  await persistOrder(tx, siteId, redacted);
  await removePrivateAndMaintenance(tx, siteId, order.ownerSegment, order.id);
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
    if (
      order.status === "paid" &&
      order.privateDataStatus === "retained" &&
      new Date(
        (await readStoredPrivate(tx, siteId, order.ownerSegment, order.id))?.expiresAt ??
          order.pendingExpiresAt,
      ) <= receivedAt
    ) {
      order = await redactStoredOrderPrivate(tx, siteId, order, receivedAt);
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
    const carrierBooking =
      order.status === "paid" ? await readStoredCarrierBooking(tx, siteId, order.id, true) : null;
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
      const fulfillment = await readStoredFulfillment(tx, siteId, order.id, true);
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

async function purgeOrder(
  tx: NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
): Promise<void> {
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
        sql`${npPluginStorage.key} in (${orderStorageKey(order.ownerSegment, order.id)}, ${privateStorageKey(order.ownerSegment, order.id)}, ${maintenanceStorageKey(order.ownerSegment, order.id)}, ${lookupStorageKey(order.id)}, ${fulfillmentStorageKey(order.id)}, ${fulfillmentParcelsStorageKey(order.id)}, ${carrierBookingStorageKey(order.id)}, ${`carrier-pickup:${order.id}`}, ${`tracking:${order.id}`}, ${npShopTrackingPollStorageKey(order.id)}, ${refundStorageKey(order.id)}, ${returnStorageKey(order.id)}, ${`return-logistics:${order.id}`}, ${`return-logistics-private:${order.id}`}, ${npShopReturnTrackingStorageKey(order.id)}, ${npShopReturnTrackingPollStorageKey(order.id)}, ${`payment-adjustment:${order.id}`}, ${`promotion-reservation:${order.id}`})`,
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
}

export async function npCreateShopOrder(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopOrderCreateInput,
): Promise<NpShopOrder> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  return getDb().transaction(async (tx) => {
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
      const current =
        existingAfterLock.status === "pending-payment" &&
        new Date(existingAfterLock.pendingExpiresAt) <= new Date()
          ? await cancelStoredOrder(tx, siteId, existingAfterLock, "payment-timeout", new Date())
          : existingAfterLock;
      return projectOrder(tx, siteId, current);
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
    await tx
      .delete(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          eq(npPluginStorage.key, npShopOrderDraftStorageKey(owner, draft.id)),
        ),
      );
    return projectOrder(tx, siteId, order);
  });
}

export async function npReadShopOrder(
  owner: NpShopCartOwner,
  orderId: string,
): Promise<NpShopOrder> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const result = await getDb().transaction(async (tx) => {
    await lockOrder(tx, siteId, ownerSegment, orderId);
    let order = await readStoredOrderForUpdate(tx, siteId, ownerSegment, orderId);
    if (!order) return null;
    const now = new Date();
    if (new Date(order.purgeAt) <= now) {
      await purgeOrder(tx, siteId, order);
      return null;
    }
    if (order.status === "pending-payment" && new Date(order.pendingExpiresAt) <= now) {
      order = await cancelStoredOrder(tx, siteId, order, "payment-timeout", now);
    } else if (
      order.status === "paid" &&
      order.privateDataStatus === "retained" &&
      new Date(
        (await readStoredPrivate(tx, siteId, order.ownerSegment, order.id))?.expiresAt ??
          order.pendingExpiresAt,
      ) <= now
    ) {
      order = await redactStoredOrderPrivate(tx, siteId, order, now);
    }
    return projectOrder(tx, siteId, order);
  });
  if (!result) throw new NpShopOrderNotFoundError();
  return result;
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
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-maintenance:%"),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopOrderLimits.cleanupBatchSize);
  let cancelled = 0;
  let privateRedacted = 0;
  for (const row of pendingRows) {
    const marker = requireMaintenanceMarker(row.value, row.expiresAt);
    if (row.key !== maintenanceStorageKey(marker.ownerSegment, marker.orderId)) {
      throw new NpShopOrderContractError("Invalid Shop order maintenance storage key", [
        "Order maintenance key must match its owner segment and order id.",
      ]);
    }
    const outcome = await db.transaction(async (tx) => {
      await lockOrder(tx, siteId, marker.ownerSegment, marker.orderId);
      const order = await readStoredOrderForUpdate(tx, siteId, marker.ownerSegment, marker.orderId);
      if (!order) {
        await removePrivateAndMaintenance(tx, siteId, marker.ownerSegment, marker.orderId);
        return "none" as const;
      }
      if (order.status === "paid" && order.privateDataStatus === "retained") {
        const privateData = await readStoredPrivate(
          tx,
          siteId,
          marker.ownerSegment,
          marker.orderId,
        );
        if (privateData && new Date(privateData.expiresAt) > now) return "none" as const;
        await redactStoredOrderPrivate(tx, siteId, order, now);
        return "redacted" as const;
      }
      if (order.status !== "pending-payment") {
        await removePrivateAndMaintenance(tx, siteId, marker.ownerSegment, marker.orderId);
        return "none" as const;
      }
      if (new Date(order.pendingExpiresAt) > now) return "none" as const;
      await cancelStoredOrder(tx, siteId, order, "payment-timeout", now);
      return "cancelled" as const;
    });
    if (outcome === "cancelled") cancelled += 1;
    if (outcome === "redacted") privateRedacted += 1;
  }

  const purgeRows = await db
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
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopOrderLimits.cleanupBatchSize);
  let purged = 0;
  for (const row of purgeRows) {
    const order = requireStoredOrderAtKey(row.value, row.expiresAt, row.key);
    purged += await db.transaction(async (tx) => {
      await lockOrder(tx, siteId, order.ownerSegment, order.id);
      const current = await readStoredOrderForUpdate(tx, siteId, order.ownerSegment, order.id);
      if (!current || new Date(current.purgeAt) > now) return 0;
      await purgeOrder(tx, siteId, current);
      return 1;
    });
  }
  const reservationsCleaned = await npCleanupExpiredShopInventoryReservations();
  return { cancelled, privateRedacted, purged, reservationsCleaned };
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
  const request = await getDb().transaction(async (tx) => {
    const booking = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
    if (
      !booking ||
      booking.id !== input.shipmentId ||
      booking.status !== "completed" ||
      booking.providerId !== adapter.id ||
      !booking.bookingReference ||
      !booking.carrier ||
      !booking.trackingNumber
    ) {
      throw new NpShopCarrierConflictError(
        "carrier_label_not_available",
        "A completed booking owned by the configured carrier is required for label retrieval.",
      );
    }
    const prepared = npRequireShopCarrierLabelRequest({
      contract: NP_SHOP_CARRIER_LABEL_REQUEST_CONTRACT,
      shipmentId: booking.id,
      orderId: booking.orderId,
      bookingReference: booking.bookingReference,
      carrier: booking.carrier,
      trackingNumber: booking.trackingNumber,
      requestedAt: requestedAt.toISOString(),
    });
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.carrier.label.read",
      booking.orderId,
      {
        shipmentId: booking.id,
        providerId: booking.providerId,
      },
    );
    return prepared;
  });

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
    const current = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
    if (
      !current ||
      current.id !== request.shipmentId ||
      current.status !== "completed" ||
      current.providerId !== adapter.id ||
      current.bookingReference !== request.bookingReference ||
      current.carrier !== request.carrier ||
      current.trackingNumber !== request.trackingNumber
    ) {
      throw new NpShopCarrierConflictError(
        "carrier_label_not_available",
        "The carrier booking changed before its label could be delivered.",
      );
    }
    await recordRequiredShopFulfillmentAudit(
      tx,
      siteId,
      staffUserId,
      "shop.carrier.label.deliver",
      current.orderId,
      {
        shipmentId: current.id,
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
    const carrierBooking = await readStoredCarrierBooking(tx, siteId, input.orderId, true);
    if (carrierBooking && carrierBooking.status !== "completed") {
      throw new NpShopRefundConflictError(
        "refund_manual_review",
        "The carrier shipment must be reconciled before starting a full refund.",
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
    const fulfillment = await readStoredFulfillment(tx, siteId, order.id, true);
    if (!fulfillment || !fulfillmentMatchesOrder(fulfillment, order)) {
      throw new NpShopOrderContractError("Refund fulfillment is invalid", [
        "A refundable paid order must have one exact fulfillment.",
      ]);
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
    const existing = await readStoredFulfillmentParcels(tx, siteId, input.orderId, true);
    if (
      (await readStoredCarrierBooking(tx, siteId, input.orderId, true)) ||
      existing?.lockedShipmentId
    ) {
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
    const now = new Date().toISOString();
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
      "shop.fulfillment.parcels.save",
      order.id,
      {
        fulfillmentRevision: next.fulfillmentRevision,
        parcelRevision: next.revision,
        parcelCount: totals.parcelCount,
        unitCount: totals.unitCount,
        weightGrams: totals.weightGrams,
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
    const { fulfillment: current } = await readFulfillmentForAction(tx, siteId, input.orderId);
    if (await readStoredCarrierBooking(tx, siteId, input.orderId, true)) {
      throw new NpShopFulfillmentConflictError(
        "fulfillment_terminal",
        "A durable carrier booking owns this fulfillment transition.",
      );
    }
    requireFulfillmentRevision(current, input.expectedRevision);
    if (current.status === "shipped" || current.status === "cancelled") {
      throw new NpShopFulfillmentConflictError(
        "fulfillment_terminal",
        "A shipped or refunded fulfillment cannot return to processing.",
      );
    }
    const now = new Date().toISOString();
    const next = {
      ...current,
      status: "processing",
      revision: current.revision + 1,
      operatorNote: input.operatorNote ?? current.operatorNote,
      updatedAt: now,
    } satisfies NpShopStoredFulfillment;
    await persistFulfillment(tx, siteId, next);
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
    if (await readStoredCarrierBooking(tx, siteId, input.orderId, true)) {
      throw new NpShopFulfillmentConflictError(
        "fulfillment_terminal",
        "A durable carrier booking must be reconciled instead of manually shipping this order.",
      );
    }
    requireFulfillmentRevision(current, input.expectedRevision);
    if (current.status === "shipped" || current.status === "cancelled") {
      throw new NpShopFulfillmentConflictError(
        "fulfillment_terminal",
        "The fulfillment is already shipped or cancelled after refund.",
      );
    }
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
    const privateData = await readStoredPrivate(
      tx,
      siteId,
      fulfillment.ownerSegment,
      fulfillment.orderId,
    );
    if (
      fulfillment.privateDataStatus !== "retained" ||
      order.privateDataStatus !== "retained" ||
      !privateData ||
      privateData.contract !== NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT ||
      privateData.expiresAt !== fulfillment.privateExpiresAt ||
      new Date(privateData.expiresAt) <= new Date()
    ) {
      if (order.privateDataStatus === "retained") {
        await redactStoredOrderPrivate(tx, siteId, order, new Date());
      }
      if (existing) {
        await persistCarrierBooking(tx, siteId, {
          ...existing,
          status: "manual-review",
          providerErrorCode: "private-data-expired",
          updatedAt: new Date(
            Math.max(Date.now(), new Date(existing.bookedAt ?? 0).getTime()),
          ).toISOString(),
        });
      }
      return { outcome: "private-expired" as const };
    }
    if (!privateData.shipping) {
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
    return {
      outcome: "prepared" as const,
      fulfillment,
      order,
      privateData,
      booking,
      parcelSnapshot: parcelSnapshot?.lockedShipmentId === booking.id ? parcelSnapshot : null,
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
      destination: prepared.privateData.shipping,
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
      if (
        !booking ||
        booking.id !== confirmed.id ||
        booking.status !== "provider-confirmed" ||
        current.status !== "processing" ||
        current.revision !== booking.fulfillmentRevision ||
        current.privateDataStatus !== "retained" ||
        order.privateDataStatus !== "retained"
      ) {
        throw new NpShopCarrierConflictError(
          "carrier_manual_review",
          "The local fulfillment changed after carrier confirmation.",
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
    const privateData = await readStoredPrivate(tx, siteId, current.ownerSegment, current.orderId);
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

export async function npListRecentShopFulfillments(): Promise<{
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
        const parcelSnapshot = await readStoredFulfillmentParcels(db, siteId, fulfillment.orderId);
        return {
          id: fulfillment.orderId,
          status: fulfillment.status,
          fulfillmentRevision: fulfillment.revision,
          parcelRevision: parcelSnapshot?.revision ?? null,
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

export async function npListRecentShopCarrierBookings(): Promise<{
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
                return `carrier-pickup:${booking.orderId}`;
              }),
            ),
          ),
        )
    : [];
  const pickups = new Map(
    pickupRows.map((row) => {
      const pickup = npRequireStoredShopCarrierPickup(row.value);
      if (
        row.key !== `carrier-pickup:${pickup.orderId}` ||
        row.expiresAt === null ||
        row.expiresAt.toISOString() !== pickup.purgeAt
      ) {
        throw new NpShopCarrierContractError("Invalid carrier pickup storage metadata", [
          "pickup key and expiry must match their canonical values.",
        ]);
      }
      return [pickup.orderId, pickup] as const;
    }),
  );
  return {
    rows: rows.map((row) => {
      const booking = requireStoredCarrierBookingAtKey(row.value, row.expiresAt, row.key);
      const pickup = pickups.get(booking.orderId);
      return {
        id: booking.orderId,
        shipmentId: booking.id,
        provider: booking.providerId,
        status: booking.status,
        fulfillmentRevision: booking.fulfillmentRevision,
        carrier: booking.carrier ?? "—",
        trackingNumber: booking.trackingNumber ?? "—",
        providerError: booking.providerErrorCode ?? "—",
        pickupAction: booking.status === "completed" && !pickup ? "schedule" : "—",
        pickupRevision: pickup?.revision ?? 0,
        updatedAt: booking.updatedAt,
      };
    }),
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
    return npProjectShopReturn(cancelled);
  });
}

export async function npApproveShopReturn(
  input: NpShopReturnStaffInput,
  staffUserId: string,
): Promise<NpShopReturn> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { returnRequest } = await readReturnOrderForStaff(tx, siteId, input.orderId);
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
    const { returnRequest } = await readReturnOrderForStaff(tx, siteId, input.orderId);
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
  return {
    rows: rows.map((row) => {
      const returnRequest = requireStoredReturnAtKey(row.value, row.expiresAt, row.key);
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
