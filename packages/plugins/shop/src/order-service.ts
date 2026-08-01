import { createHash, randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, gt, inArray, like, lte, sql } from "drizzle-orm";

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
  orderStatus: "paid" | "refunded" | "payment-failed" | "cancelled";
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
  createdAt: string;
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
  privateData: string;
  carrier: string;
  trackingNumber: string;
  operatorNote: string;
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

function refundStorageKey(orderId: string): string {
  return `refund:${orderId}`;
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

async function readStoredOrderForUpdate(
  tx: NpShopTransaction,
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
  if (
    refund &&
    (refund.orderId !== order.id ||
      refund.providerId !== order.paymentProvider ||
      refund.paymentReference !== order.paymentReference ||
      refund.currency !== order.currency ||
      refund.amountMinor !== order.subtotalMinor ||
      (refund.status === "refunded" &&
        (order.status !== "refunded" || refund.orderRevision !== order.revision)))
  ) {
    throw new NpShopOrderContractError("Shop refund does not match its order", [
      "Refund identity, payment, amount, and terminal revision must match the commercial order.",
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
  const { ownerSegment: _ownerSegment, ...publicFields } = order;
  return npRequireShopOrder({
    ...publicFields,
    contract: NP_SHOP_ORDER_CONTRACT,
    customer: privateData?.customer ?? null,
    shipping: privateData?.shipping ?? null,
    ...(fulfillment ? { fulfillment: npProjectShopFulfillment(fulfillment) } : {}),
    ...(refund ? { refund: npProjectShopRefund(refund) } : {}),
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
    if (order.currency !== event.currency || order.subtotalMinor !== event.amountMinor) {
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
        sql`${npPluginStorage.key} in (${orderStorageKey(order.ownerSegment, order.id)}, ${privateStorageKey(order.ownerSegment, order.id)}, ${maintenanceStorageKey(order.ownerSegment, order.id)}, ${lookupStorageKey(order.id)}, ${fulfillmentStorageKey(order.id)}, ${refundStorageKey(order.id)})`,
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
      totalUnits: draft.totalUnits,
      lines: draft.lines,
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
        return {
          id: order.id,
          revision: order.revision,
          status: order.status,
          total: `${order.currency} ${order.subtotalMinor.toString()}`,
          units: order.totalUnits,
          privateData: order.privateDataStatus,
          inventory: order.inventoryReservationStatus,
          fulfillment: fulfillment?.status ?? "not-created",
          fulfillmentRevision: fulfillment?.revision ?? null,
          refund: refund?.status ?? "not-requested",
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
  for (const row of rows) {
    try {
      const refund = requireStoredRefundAtKey(row.value, row.expiresAt, row.key);
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
            eq(npPluginStorage.key, lookupStorageKey(refund.orderId)),
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
            eq(npPluginStorage.key, orderStorageKey(lookup.ownerSegment, refund.orderId)),
          ),
        )
        .limit(1);
      if (!orderRow) {
        orphanSample += 1;
        continue;
      }
      const order = requireStoredOrderAtKey(orderRow.value, orderRow.expiresAt, orderRow.key);
      if (
        refund.providerId !== order.paymentProvider ||
        refund.paymentReference !== order.paymentReference ||
        refund.currency !== order.currency ||
        refund.amountMinor !== order.subtotalMinor ||
        (refund.status === "refunded"
          ? order.status !== "refunded" || refund.orderRevision !== order.revision
          : order.status !== "paid" || refund.orderRevision > order.revision)
      ) {
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
      amountMinor: order.subtotalMinor,
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
      order.status !== "paid" ||
      order.paymentProvider !== currentRefund.providerId ||
      order.paymentReference !== currentRefund.paymentReference ||
      order.currency !== currentRefund.currency ||
      order.subtotalMinor !== currentRefund.amountMinor ||
      order.revision < currentRefund.orderRevision
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
  if (refund?.status === "pending" || refund?.status === "provider-confirmed") {
    throw new NpShopFulfillmentConflictError(
      "fulfillment_terminal",
      "Fulfillment cannot change while a full refund is pending reconciliation.",
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

export async function npProcessShopFulfillment(
  input: NpShopFulfillmentProcessInput,
  staffUserId: string,
): Promise<NpShopFulfillment> {
  const siteId = await requireSiteId();
  return getDb().transaction(async (tx) => {
    const { fulfillment: current } = await readFulfillmentForAction(tx, siteId, input.orderId);
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
    rows: rows.map((row) => {
      const fulfillment = requireStoredFulfillment(row.value, row.expiresAt, row.key);
      return {
        id: fulfillment.orderId,
        status: fulfillment.status,
        fulfillmentRevision: fulfillment.revision,
        privateData: fulfillment.privateDataStatus,
        carrier: fulfillment.carrier ?? "—",
        trackingNumber: fulfillment.trackingNumber ?? "—",
        operatorNote: fulfillment.operatorNote ?? "—",
        updatedAt: fulfillment.updatedAt,
      };
    }),
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
