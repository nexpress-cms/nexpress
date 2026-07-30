import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, gt, like, lte, sql } from "drizzle-orm";

import {
  npCleanupExpiredShopInventoryReservations,
  npLockShopInventoryProducts,
  npPersistShopInventoryReservations,
  npPurgeShopInventoryReservations,
  npReleaseShopInventoryReservations,
} from "./inventory-reservation-service.js";
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

interface NpShopOrderPendingMarker {
  contract: "np.shop-order-pending.v1";
  orderId: string;
  ownerSegment: string;
  dueAt: string;
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

function orderStorageKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

function privateStorageKey(ownerSegment: string, orderId: string): string {
  return `order-private:${ownerSegment}:${orderId}`;
}

function pendingStorageKey(ownerSegment: string, orderId: string): string {
  return `order-pending:${ownerSegment}:${orderId}`;
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

function requirePendingMarker(value: unknown, expiresAt: Date | null): NpShopOrderPendingMarker {
  const candidate = value as Record<string, unknown>;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 4 ||
    candidate.contract !== "np.shop-order-pending.v1" ||
    typeof candidate.orderId !== "string" ||
    typeof candidate.ownerSegment !== "string" ||
    typeof candidate.dueAt !== "string" ||
    expiresAt === null ||
    expiresAt.toISOString() !== candidate.dueAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop pending order marker", [
      "Pending order maintenance metadata is malformed.",
    ]);
  }
  return value as NpShopOrderPendingMarker;
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

async function persistPendingMarker(
  tx: NpShopTransaction,
  siteId: string,
  marker: NpShopOrderPendingMarker,
): Promise<void> {
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: pendingStorageKey(marker.ownerSegment, marker.orderId),
    value: marker,
    expiresAt: new Date(marker.dueAt),
    updatedAt: new Date(),
  });
}

async function removePrivateAndPending(
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
        sql`${npPluginStorage.key} in (${privateStorageKey(ownerSegment, orderId)}, ${pendingStorageKey(ownerSegment, orderId)})`,
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
  await removePrivateAndPending(tx, siteId, order.ownerSegment, order.id);
  return cancelled;
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
        sql`${npPluginStorage.key} in (${orderStorageKey(order.ownerSegment, order.id)}, ${privateStorageKey(order.ownerSegment, order.id)}, ${pendingStorageKey(order.ownerSegment, order.id)})`,
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
    await persistPendingMarker(tx, siteId, {
      contract: "np.shop-order-pending.v1",
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
        like(npPluginStorage.key, "order-pending:%"),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopOrderLimits.cleanupBatchSize);
  let cancelled = 0;
  for (const row of pendingRows) {
    const marker = requirePendingMarker(row.value, row.expiresAt);
    if (row.key !== pendingStorageKey(marker.ownerSegment, marker.orderId)) {
      throw new NpShopOrderContractError("Invalid Shop pending order storage key", [
        "Pending order key must match its owner segment and order id.",
      ]);
    }
    cancelled += await db.transaction(async (tx) => {
      await lockOrder(tx, siteId, marker.ownerSegment, marker.orderId);
      const order = await readStoredOrderForUpdate(tx, siteId, marker.ownerSegment, marker.orderId);
      if (!order) {
        await removePrivateAndPending(tx, siteId, marker.ownerSegment, marker.orderId);
        return 0;
      }
      if (order.status !== "pending-payment") {
        await removePrivateAndPending(tx, siteId, marker.ownerSegment, marker.orderId);
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
        like(npPluginStorage.key, "order-pending:%"),
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
  const [markerCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      invalid: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' is distinct from 'np.shop-order-pending.v1')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-pending:%"),
      ),
    );
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
    counts.cancelled +
    privateCounts.invalid +
    markerCounts.invalid +
    Math.abs(privateCounts.total - counts.pending) +
    Math.abs(markerCounts.total - counts.pending);
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
