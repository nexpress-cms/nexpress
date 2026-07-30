import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, gt, inArray, like, lte, sql } from "drizzle-orm";

import {
  NP_SHOP_INVENTORY_RESERVATION_CONTRACT,
  npRequireShopInventoryReservation,
  npShopInventoryReservationLimits,
  npShopInventoryReservationStorageKey,
  npShopInventoryStockKey,
  npShopReservationLineMatches,
  type NpShopInventoryReservation,
} from "./inventory-reservation-contract.js";
import { NP_SHOP_ORDER_STORAGE_CONTRACT, npRequireStoredShopOrder } from "./order-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import type { NpShopCheckoutIntentLine } from "./types.js";

type NpShopDb = ReturnType<typeof getDb> | NpShopTransaction;

export interface NpShopAdminInventoryReservationRow {
  [key: string]: unknown;
  orderId: string;
  productId: string;
  variantSku: string;
  quantity: number;
  expiresAt: string;
}

function orderStorageKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

function requireOrderAtKey(value: unknown, expiresAt: Date | null, key: string) {
  const order = npRequireStoredShopOrder(value);
  if (
    expiresAt === null ||
    expiresAt.toISOString() !== order.purgeAt ||
    key !== orderStorageKey(order.ownerSegment, order.id)
  ) {
    throw new Error("Shop inventory reservation order metadata is malformed.");
  }
  return order;
}

function requireReservationAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopInventoryReservation {
  const reservation = npRequireShopInventoryReservation(value);
  if (
    expiresAt === null ||
    expiresAt.toISOString() !== reservation.expiresAt ||
    key !==
      npShopInventoryReservationStorageKey(
        reservation.productId,
        reservation.variantSku,
        reservation.orderId,
      )
  ) {
    throw new Error("Shop inventory reservation storage metadata is malformed.");
  }
  return reservation;
}

export async function npLockShopInventoryProducts(
  tx: NpShopTransaction,
  siteId: string,
  productIds: readonly string[],
): Promise<void> {
  const uniqueIds = [...new Set(productIds)].sort();
  for (const productId of uniqueIds) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-inventory:${siteId}:${productId}`}, 0))`,
    );
  }
}

export async function npGetShopReservedQuantities(
  siteId: string,
  productIds: readonly string[],
  db: NpShopDb = getDb(),
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const productIdExpression = sql<string>`${npPluginStorage.value}->>'productId'`;
  const variantSkuExpression = sql<string | null>`${npPluginStorage.value}->>'variantSku'`;
  const rows = await db
    .select({
      productId: productIdExpression,
      variantSku: variantSkuExpression,
      quantity: sql<string>`sum((${npPluginStorage.value}->>'quantity')::numeric)::text`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "inventory-reservation:%"),
        gt(npPluginStorage.expiresAt, new Date()),
        sql`${npPluginStorage.value}->>'contract' = ${NP_SHOP_INVENTORY_RESERVATION_CONTRACT}`,
        inArray(productIdExpression, [...new Set(productIds)]),
      ),
    )
    .groupBy(productIdExpression, variantSkuExpression);
  const totals = new Map<string, number>();
  for (const row of rows) {
    const quantity = Number(row.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("Shop inventory reservation totals are malformed.");
    }
    totals.set(npShopInventoryStockKey(row.productId, row.variantSku), quantity);
  }
  return totals;
}

export async function npPersistShopInventoryReservations(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  lines: readonly NpShopCheckoutIntentLine[],
  createdAt: string,
  expiresAt: string,
): Promise<number> {
  if (lines.length === 0) return 0;
  const reservations = lines.map((line): NpShopInventoryReservation => ({
    contract: NP_SHOP_INVENTORY_RESERVATION_CONTRACT,
    orderId,
    ownerSegment,
    productId: line.productId,
    variantSku: line.variantSku,
    quantity: line.quantity,
    createdAt,
    expiresAt,
  }));
  for (const reservation of reservations) npRequireShopInventoryReservation(reservation);
  await tx.insert(npPluginStorage).values(
    reservations.map((reservation) => ({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopInventoryReservationStorageKey(
        reservation.productId,
        reservation.variantSku,
        reservation.orderId,
      ),
      value: reservation,
      expiresAt: new Date(reservation.expiresAt),
      updatedAt: new Date(reservation.createdAt),
    })),
  );
  return reservations.length;
}

export async function npReleaseShopInventoryReservations(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
  lines: readonly NpShopCheckoutIntentLine[],
): Promise<number> {
  if (lines.length === 0) return 0;
  const keys = lines.map((line) =>
    npShopInventoryReservationStorageKey(line.productId, line.variantSku, orderId),
  );
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
        inArray(npPluginStorage.key, keys),
      ),
    );
  for (const row of rows) {
    const reservation = requireReservationAtKey(row.value, row.expiresAt, row.key);
    const line = lines.find((candidate) => npShopReservationLineMatches(reservation, candidate));
    if (!line || reservation.orderId !== orderId) {
      throw new Error("Shop inventory reservation does not match its pending order.");
    }
  }
  if (rows.length > 0) {
    await tx.delete(npPluginStorage).where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        inArray(
          npPluginStorage.key,
          rows.map((row) => row.key),
        ),
      ),
    );
  }
  return rows.length;
}

export async function npPurgeShopInventoryReservations(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
  lines: readonly NpShopCheckoutIntentLine[],
): Promise<void> {
  const keys = lines.map((line) =>
    npShopInventoryReservationStorageKey(line.productId, line.variantSku, orderId),
  );
  if (keys.length === 0) return;
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        inArray(npPluginStorage.key, keys),
      ),
    );
}

export async function npCountShopInventoryReservations(): Promise<{
  active: number;
  expired: number;
  invalidSample: number;
  orphanSample: number;
  missingSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const [counts] = await db
    .select({
      active: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} > ${now})::int`,
      expired: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} <= ${now})::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "inventory-reservation:%"),
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
        like(npPluginStorage.key, "inventory-reservation:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopInventoryReservationLimits.diagnosticSampleSize);
  const reservations: NpShopInventoryReservation[] = [];
  let invalidSample = 0;
  for (const row of sample) {
    try {
      reservations.push(requireReservationAtKey(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  const orderKeys = [
    ...new Set(
      reservations.map((reservation) =>
        orderStorageKey(reservation.ownerSegment, reservation.orderId),
      ),
    ),
  ];
  const orderRows =
    orderKeys.length === 0
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
              inArray(npPluginStorage.key, orderKeys),
            ),
          );
  const orders = new Map(
    orderRows.map((row) => {
      try {
        return [row.key, requireOrderAtKey(row.value, row.expiresAt, row.key)] as const;
      } catch {
        return [row.key, null] as const;
      }
    }),
  );
  const orphanSample = reservations.filter((reservation) => {
    const order = orders.get(orderStorageKey(reservation.ownerSegment, reservation.orderId));
    const matchingLine = order?.lines.find((line) =>
      npShopReservationLineMatches(reservation, line),
    );
    return (
      !order ||
      order.contract !== NP_SHOP_ORDER_STORAGE_CONTRACT ||
      order.status !== "pending-payment" ||
      order.inventoryReservationStatus !== "held" ||
      order.pendingExpiresAt !== reservation.expiresAt ||
      !matchingLine ||
      !order.inventoryReservationLineKeys.includes(matchingLine.key)
    );
  }).length;

  const heldOrderRows = await db
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
        sql`${npPluginStorage.value}->>'contract' = ${NP_SHOP_ORDER_STORAGE_CONTRACT}`,
        sql`${npPluginStorage.value}->>'status' = 'pending-payment'`,
        sql`${npPluginStorage.value}->>'inventoryReservationStatus' = 'held'`,
        sql`(${npPluginStorage.value}->>'pendingExpiresAt')::timestamptz > ${now}`,
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopInventoryReservationLimits.diagnosticSampleSize);
  const expectedReservationKeys: string[] = [];
  for (const row of heldOrderRows) {
    let order;
    try {
      order = requireOrderAtKey(row.value, row.expiresAt, row.key);
    } catch {
      continue;
    }
    const reservedLineKeys = new Set(order.inventoryReservationLineKeys);
    for (const line of order.lines) {
      if (!reservedLineKeys.has(line.key)) continue;
      expectedReservationKeys.push(
        npShopInventoryReservationStorageKey(line.productId, line.variantSku, order.id),
      );
      if (expectedReservationKeys.length >= npShopInventoryReservationLimits.diagnosticSampleSize) {
        break;
      }
    }
    if (expectedReservationKeys.length >= npShopInventoryReservationLimits.diagnosticSampleSize) {
      break;
    }
  }
  const existingReservationKeys =
    expectedReservationKeys.length === 0
      ? []
      : await db
          .select({ key: npPluginStorage.key })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              inArray(npPluginStorage.key, expectedReservationKeys),
            ),
          );
  const existingKeySet = new Set(existingReservationKeys.map((row) => row.key));
  const missingSample = expectedReservationKeys.filter((key) => !existingKeySet.has(key)).length;
  return { ...counts, invalidSample, orphanSample, missingSample };
}

export async function npCleanupExpiredShopInventoryReservations(): Promise<number> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "inventory-reservation:%"),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopInventoryReservationLimits.cleanupBatchSize);
  if (rows.length === 0) return 0;
  const removed = await db
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        inArray(
          npPluginStorage.key,
          rows.map((row) => row.key),
        ),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .returning({ key: npPluginStorage.key });
  return removed.length;
}

export async function npListRecentShopInventoryReservations(): Promise<{
  rows: NpShopAdminInventoryReservationRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
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
        like(npPluginStorage.key, "inventory-reservation:%"),
        gt(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopInventoryReservationLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "inventory-reservation:%"),
        gt(npPluginStorage.expiresAt, now),
      ),
    );
  return {
    rows: rows.map((row) => {
      const reservation = requireReservationAtKey(row.value, row.expiresAt, row.key);
      return {
        orderId: reservation.orderId,
        productId: reservation.productId,
        variantSku: reservation.variantSku ?? "Base product",
        quantity: reservation.quantity,
        expiresAt: reservation.expiresAt,
      };
    }),
    total,
  };
}
