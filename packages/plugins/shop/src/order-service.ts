import { createHash } from "node:crypto";

import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, gt, inArray, like, lte, sql } from "drizzle-orm";

import {
  npCleanupExpiredShopInventoryReservations,
  npConsumeShopInventoryReservations,
  npLockShopInventoryProducts,
  npPersistShopInventoryReservations,
  npPurgeShopInventoryReservations,
  npReleaseShopInventoryReservations,
} from "./inventory-reservation-service.js";
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
  type NpShopStoredOrderPrivate,
} from "./order-contract.js";
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
import type { NpShopOrder, NpShopOrderList } from "./types.js";

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

export interface NpShopAdminOrderRow {
  [key: string]: unknown;
  id: string;
  status: string;
  total: string;
  units: number;
  privateData: string;
  inventory: string;
  createdAt: string;
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

function requireStoredPrivate(value: unknown, expiresAt: Date | null): NpShopStoredOrderPrivate {
  const privateData = npRequireStoredShopOrderPrivate(value);
  if (expiresAt === null || expiresAt.toISOString() !== privateData.expiresAt) {
    throw new NpShopOrderContractError("Invalid Shop order private storage metadata", [
      "Private order storage expiry must match private.expiresAt.",
    ]);
  }
  return privateData;
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
): Promise<NpShopStoredOrderPrivate | null> {
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
  privateData: NpShopStoredOrderPrivate,
): Promise<void> {
  npRequireStoredShopOrderPrivate(privateData);
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: privateStorageKey(ownerSegment, privateData.orderId),
    value: privateData,
    expiresAt: new Date(privateData.expiresAt),
    updatedAt: new Date(privateData.createdAt),
  });
}

async function persistMaintenanceMarker(
  tx: NpShopTransaction,
  siteId: string,
  marker: NpShopOrderMaintenanceMarker,
): Promise<void> {
  requireMaintenanceMarker(marker, new Date(marker.dueAt));
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: maintenanceStorageKey(marker.ownerSegment, marker.orderId),
    value: marker,
    expiresAt: new Date(marker.dueAt),
    updatedAt: new Date(),
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
      privateData.expiresAt !== order.pendingExpiresAt)
  ) {
    throw new NpShopOrderContractError("Shop order private data does not match its order", [
      "Private order id and retention timestamps must match the commercial order.",
    ]);
  }
  const { ownerSegment: _ownerSegment, ...publicFields } = order;
  return npRequireShopOrder({
    ...publicFields,
    contract: NP_SHOP_ORDER_CONTRACT,
    customer: privateData?.customer ?? null,
    shipping: privateData?.shipping ?? null,
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
      new Date(order.pendingExpiresAt) <= receivedAt
    ) {
      order = await redactStoredOrderPrivate(tx, siteId, order, receivedAt);
    }
    if (order.status !== "pending-payment") {
      outcome = "ignored-terminal";
    } else if (new Date(order.pendingExpiresAt) <= receivedAt) {
      order = await cancelStoredOrder(tx, siteId, order, "payment-timeout", receivedAt);
      outcome = "ignored-terminal";
    } else if (event.type === "payment.succeeded") {
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
      await persistOrder(tx, siteId, order);
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
        sql`${npPluginStorage.key} in (${orderStorageKey(order.ownerSegment, order.id)}, ${privateStorageKey(order.ownerSegment, order.id)}, ${maintenanceStorageKey(order.ownerSegment, order.id)}, ${lookupStorageKey(order.id)})`,
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
    const privateData: NpShopStoredOrderPrivate = {
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
      new Date(order.pendingExpiresAt) <= now
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
  for (const row of pendingRows) {
    const marker = requireMaintenanceMarker(row.value, row.expiresAt);
    if (row.key !== maintenanceStorageKey(marker.ownerSegment, marker.orderId)) {
      throw new NpShopOrderContractError("Invalid Shop order maintenance storage key", [
        "Order maintenance key must match its owner segment and order id.",
      ]);
    }
    cancelled += await db.transaction(async (tx) => {
      await lockOrder(tx, siteId, marker.ownerSegment, marker.orderId);
      const order = await readStoredOrderForUpdate(tx, siteId, marker.ownerSegment, marker.orderId);
      if (!order) {
        await removePrivateAndMaintenance(tx, siteId, marker.ownerSegment, marker.orderId);
        return 0;
      }
      if (order.status === "paid" && order.privateDataStatus === "retained") {
        if (new Date(order.pendingExpiresAt) > now) return 0;
        await redactStoredOrderPrivate(tx, siteId, order, now);
        return 0;
      }
      if (order.status !== "pending-payment") {
        await removePrivateAndMaintenance(tx, siteId, marker.ownerSegment, marker.orderId);
        return 0;
      }
      if (new Date(order.pendingExpiresAt) > now) return 0;
      await cancelStoredOrder(tx, siteId, order, "payment-timeout", now);
      return 1;
    });
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
  return { cancelled, purged, reservationsCleaned };
}

export async function npCountShopOrders(): Promise<{
  total: number;
  pending: number;
  paid: number;
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
      invalid: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' is distinct from ${NP_SHOP_ORDER_PRIVATE_CONTRACT})::int`,
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
    rows: rows.map((row) => {
      const order = requireStoredOrderAtKey(row.value, row.expiresAt, row.key);
      return {
        id: order.id,
        status: order.status,
        total: `${order.currency} ${order.subtotalMinor.toString()}`,
        units: order.totalUnits,
        privateData: order.privateDataStatus,
        inventory: order.inventoryReservationStatus,
        createdAt: order.createdAt,
      };
    }),
    total,
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
