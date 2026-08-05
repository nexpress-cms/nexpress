import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import {
  npRequireStoredShopPaymentAdjustment,
  npRequireStoredShopPaymentAdjustmentReceipt,
  npShopPaymentAdjustmentLimits,
  npShopPaymentAdjustmentReceiptStorageKey,
  npShopPaymentAdjustmentStorageKey,
  type NpShopStoredPaymentAdjustment,
  type NpShopStoredPaymentAdjustmentReceipt,
} from "./payment-adjustment-contract.js";

export interface NpShopAdminPaymentAdjustmentRow {
  [key: string]: unknown;
  provider: string;
  eventId: string;
  orderId: string;
  reversed: string;
  remaining: string;
  cancellations: number;
  outcome: string;
  orderStatus: string;
  processedAt: string;
}

function lookupStorageKey(orderId: string): string {
  return `order-lookup:${orderId}`;
}

export async function npReadStoredShopPaymentAdjustment(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredPaymentAdjustment | null> {
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
        eq(npPluginStorage.key, npShopPaymentAdjustmentStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  if (!row) return null;
  const adjustment = npRequireStoredShopPaymentAdjustment(row.value);
  if (
    row.key !== npShopPaymentAdjustmentStorageKey(adjustment.orderId) ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== adjustment.purgeAt ||
    adjustment.orderId !== orderId
  ) {
    throw new Error("Shop payment adjustment storage metadata is invalid.");
  }
  return adjustment;
}

export async function npPersistShopPaymentAdjustment(
  tx: NpShopTransaction,
  siteId: string,
  adjustment: NpShopStoredPaymentAdjustment,
): Promise<void> {
  npRequireStoredShopPaymentAdjustment(adjustment);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopPaymentAdjustmentStorageKey(adjustment.orderId),
      value: adjustment,
      expiresAt: new Date(adjustment.purgeAt),
      updatedAt: new Date(adjustment.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: adjustment,
        expiresAt: new Date(adjustment.purgeAt),
        updatedAt: new Date(adjustment.updatedAt),
      },
    });
}

export async function npReadStoredShopPaymentAdjustmentReceipt(
  tx: NpShopTransaction,
  siteId: string,
  providerId: string,
  eventId: string,
): Promise<NpShopStoredPaymentAdjustmentReceipt | null> {
  const key = npShopPaymentAdjustmentReceiptStorageKey(providerId, eventId);
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
  const receipt = npRequireStoredShopPaymentAdjustmentReceipt(row.value);
  if (
    row.key !== key ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== receipt.purgeAt
  ) {
    throw new Error("Shop payment adjustment receipt metadata is invalid.");
  }
  return receipt;
}

export async function npPersistShopPaymentAdjustmentReceipt(
  tx: NpShopTransaction,
  siteId: string,
  receipt: NpShopStoredPaymentAdjustmentReceipt,
): Promise<void> {
  npRequireStoredShopPaymentAdjustmentReceipt(receipt);
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: npShopPaymentAdjustmentReceiptStorageKey(receipt.providerId, receipt.event.eventId),
    value: receipt,
    expiresAt: new Date(receipt.purgeAt),
    updatedAt: new Date(receipt.processedAt),
  });
}

export async function npCountShopPaymentAdjustments(): Promise<{
  total: number;
  manualReview: number;
  invalidSample: number;
  orphanSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      manualReview: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'manual-review')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-adjustment:%"),
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
        like(npPluginStorage.key, "payment-adjustment:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentAdjustmentLimits.diagnosticSampleSize);
  const valid: NpShopStoredPaymentAdjustment[] = [];
  const validReceiptOrderIds: string[] = [];
  let invalidSample = 0;
  for (const row of rows) {
    try {
      const adjustment = npRequireStoredShopPaymentAdjustment(row.value);
      if (
        row.key !== npShopPaymentAdjustmentStorageKey(adjustment.orderId) ||
        row.expiresAt === null ||
        row.expiresAt.toISOString() !== adjustment.purgeAt
      ) {
        throw new Error("metadata mismatch");
      }
      valid.push(adjustment);
    } catch {
      invalidSample += 1;
    }
  }
  const receiptRows = await db
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
        like(npPluginStorage.key, "payment-adjustment-event:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentAdjustmentLimits.diagnosticSampleSize);
  for (const row of receiptRows) {
    try {
      const receipt = npRequireStoredShopPaymentAdjustmentReceipt(row.value);
      if (
        row.key !==
          npShopPaymentAdjustmentReceiptStorageKey(receipt.providerId, receipt.event.eventId) ||
        row.expiresAt === null ||
        row.expiresAt.toISOString() !== receipt.purgeAt
      ) {
        throw new Error("metadata mismatch");
      }
      validReceiptOrderIds.push(receipt.event.orderId);
    } catch {
      invalidSample += 1;
    }
  }
  const sampledOrderIds = [...valid.map((item) => item.orderId), ...validReceiptOrderIds];
  const lookupKeys = [...new Set(sampledOrderIds.map(lookupStorageKey))];
  const lookups = lookupKeys.length
    ? await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            inArray(npPluginStorage.key, lookupKeys),
          ),
        )
    : [];
  const lookupSet = new Set(lookups.map((row) => row.key));
  const orphanSample = sampledOrderIds.filter(
    (orderId) => !lookupSet.has(lookupStorageKey(orderId)),
  ).length;
  return { total: counts.total, manualReview: counts.manualReview, invalidSample, orphanSample };
}

export async function npListRecentShopPaymentAdjustments(): Promise<{
  rows: NpShopAdminPaymentAdjustmentRow[];
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
        like(npPluginStorage.key, "payment-adjustment-event:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentAdjustmentLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-adjustment-event:%"),
      ),
    );
  return {
    rows: rows.map((row) => {
      const receipt = npRequireStoredShopPaymentAdjustmentReceipt(row.value);
      if (
        row.key !==
          npShopPaymentAdjustmentReceiptStorageKey(receipt.providerId, receipt.event.eventId) ||
        row.expiresAt === null ||
        row.expiresAt.toISOString() !== receipt.purgeAt
      ) {
        throw new Error("Shop payment adjustment receipt metadata is invalid.");
      }
      return {
        provider: receipt.providerId,
        eventId: receipt.event.eventId,
        orderId: receipt.event.orderId,
        reversed: `${receipt.event.currency} ${(receipt.event.originalAmountMinor - receipt.event.remainingAmountMinor).toString()}`,
        remaining: `${receipt.event.currency} ${receipt.event.remainingAmountMinor.toString()}`,
        cancellations: receipt.event.cancellations.length,
        outcome: receipt.outcome,
        orderStatus: receipt.orderStatus,
        processedAt: receipt.processedAt,
      };
    }),
    total,
  };
}
