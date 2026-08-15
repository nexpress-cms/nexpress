import { npPluginStorage, type getDb } from "@nexpress/core/db";
import { and, eq } from "drizzle-orm";

import type { NpShopStoredCarrierLabelAcquisition } from "./label-acquisition-contract.js";
import {
  NpShopCarrierLabelVoidContractError,
  npRequireStoredShopCarrierLabelVoid,
  type NpShopStoredCarrierLabelVoid,
} from "./label-void-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";

export function npShopCarrierLabelVoidStorageKey(shipmentId: string): string {
  return `carrier-label-void:${shipmentId}`;
}

export function npShopCarrierLabelVoidMatchesAcquisition(
  state: NpShopStoredCarrierLabelVoid,
  acquisition: NpShopStoredCarrierLabelAcquisition,
): boolean {
  return (
    state.acquisitionId === acquisition.id &&
    state.shipmentId === acquisition.shipmentId &&
    state.orderId === acquisition.orderId &&
    state.target === acquisition.target &&
    state.exchangeId === acquisition.exchangeId &&
    state.providerId === acquisition.providerId &&
    state.sourceRevision === acquisition.sourceRevision &&
    state.generation === acquisition.generation &&
    state.bookingReference === acquisition.bookingReference &&
    state.labelReference === acquisition.labelReference &&
    state.purgeAt === acquisition.purgeAt
  );
}

export function npShopCarrierLabelVoidIsCompletedPredecessor(
  state: NpShopStoredCarrierLabelVoid,
  acquisition: NpShopStoredCarrierLabelAcquisition,
): boolean {
  return (
    state.status === "completed" &&
    state.shipmentId === acquisition.shipmentId &&
    state.orderId === acquisition.orderId &&
    state.target === acquisition.target &&
    state.exchangeId === acquisition.exchangeId &&
    state.providerId === acquisition.providerId &&
    state.sourceRevision === acquisition.sourceRevision &&
    state.generation < acquisition.generation &&
    state.bookingReference === acquisition.bookingReference &&
    state.purgeAt === acquisition.purgeAt
  );
}

export function npRequireStoredShopCarrierLabelVoidAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredCarrierLabelVoid {
  const state = npRequireStoredShopCarrierLabelVoid(value);
  if (
    key !== npShopCarrierLabelVoidStorageKey(state.shipmentId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== state.purgeAt
  ) {
    throw new NpShopCarrierLabelVoidContractError("Invalid carrier label void metadata", [
      "carrier label void key and expiry must match their canonical values.",
    ]);
  }
  return state;
}

export async function npReadStoredShopCarrierLabelVoid(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  shipmentId: string,
  forUpdate = false,
): Promise<NpShopStoredCarrierLabelVoid | null> {
  const key = npShopCarrierLabelVoidStorageKey(shipmentId);
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
  return row ? npRequireStoredShopCarrierLabelVoidAtKey(row.value, row.expiresAt, row.key) : null;
}

export async function npPersistShopCarrierLabelVoid(
  tx: NpShopTransaction,
  siteId: string,
  state: NpShopStoredCarrierLabelVoid,
): Promise<void> {
  npRequireStoredShopCarrierLabelVoid(state);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopCarrierLabelVoidStorageKey(state.shipmentId),
      value: state,
      expiresAt: new Date(state.purgeAt),
      updatedAt: new Date(state.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: state,
        expiresAt: new Date(state.purgeAt),
        updatedAt: new Date(state.updatedAt),
      },
    });
}
