import { randomUUID } from "node:crypto";

import { findDocuments } from "@nexpress/core/collections";
import { createNotification } from "@nexpress/core/community";
import { getDb, npMembers, npNotifications, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, inArray, like, lte, or, sql } from "drizzle-orm";

import {
  NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT,
  NP_SHOP_RESTOCK_NOTIFICATION_KIND,
  NpShopRestockAlertContractError,
  npRequireShopRestockAlertStorage,
  npShopRestockAlertLimits,
  npToShopRestockAlertWire,
  type NpShopRestockAlertInput,
  type NpShopRestockAlertStorage,
  type NpShopRestockAlertWire,
} from "./restock-alert-contract.js";
import { normalizeShopVariants, type NpShopRuntime, type ShopProductDocument } from "./runtime.js";

const NP_SHOP_PLUGIN_ID = "shop";
const RESTOCK_KEY_PREFIX = "restock-alert:";

interface StoredRow {
  key: string;
  value: unknown;
  expiresAt: Date | null;
}

export interface NpShopRestockTargetState {
  available: boolean;
  label: string;
}

export interface NpShopRestockProcessResult {
  inspected: number;
  notified: number;
  suppressed: number;
  unavailable: number;
  orphaned: number;
  invalid: number;
  cleaned: number;
}

export interface NpShopRestockAlertInspection {
  active: number;
  claimed: number;
  completed: number;
  expired: number;
  invalidSample: number;
  orphanSample: number;
  readySample: number;
  staleClaimSample: number;
  sampleBoundReached: boolean;
}

function storageKey(input: NpShopRestockAlertInput, memberId: string): string {
  return `${RESTOCK_KEY_PREFIX}${input.productId}:${input.variantSku ?? "_"}:${memberId}`;
}

function requireStoredRow(row: StoredRow): NpShopRestockAlertStorage {
  const alert = npRequireShopRestockAlertStorage(row.value);
  if (
    row.key !== storageKey(alert, alert.memberId) ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== alert.expiresAt
  ) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert storage row", [
      "restock alert storage key or expiry does not match its value.",
    ]);
  }
  return alert;
}

function plusSeconds(value: Date, seconds: number): string {
  return new Date(value.getTime() + seconds * 1_000).toISOString();
}

export function npResolveShopRestockTarget(
  product: ShopProductDocument,
  variantSku: string | null,
): NpShopRestockTargetState | null {
  if (product.trackInventory !== true) return null;
  const variants = normalizeShopVariants(product.variants).filter((variant) => variant.enabled);
  if (variants.length > 0) {
    if (variantSku === null) return null;
    const variant = variants.find((candidate) => candidate.sku === variantSku);
    if (!variant) return null;
    return {
      available: variant.stockQuantity > 0,
      label: variant.optionSummary ?? variant.name,
    };
  }
  if (variantSku !== null) return null;
  const stock = product.stockQuantity;
  if (!Number.isSafeInteger(stock) || (stock as number) < 0) return null;
  return { available: (stock as number) > 0, label: product.name };
}

async function findProducts(
  runtime: NpShopRuntime,
  productIds: readonly string[],
): Promise<Map<string, ShopProductDocument>> {
  if (productIds.length === 0) return new Map();
  const result = await findDocuments<ShopProductDocument>(runtime.collections.products, {
    where: { id: [...productIds], visibility: "*" },
    page: 1,
    limit: productIds.length,
  });
  return new Map(result.docs.map((product) => [product.id, product]));
}

async function findPublishedProduct(
  runtime: NpShopRuntime,
  productId: string,
): Promise<ShopProductDocument | null> {
  const result = await findDocuments<ShopProductDocument>(runtime.collections.products, {
    where: { id: productId, status: "published", visibility: "*" },
    page: 1,
    limit: 1,
  });
  return result.docs[0] ?? null;
}

function activeStorageValue(
  memberId: string,
  input: NpShopRestockAlertInput,
  now: Date,
): NpShopRestockAlertStorage {
  const createdAt = now.toISOString();
  return {
    contract: NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT,
    eventId: randomUUID(),
    memberId,
    productId: input.productId,
    variantSku: input.variantSku,
    status: "active",
    outcome: null,
    createdAt,
    checkedAt: null,
    claimedAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    notificationId: null,
    expiresAt: plusSeconds(now, npShopRestockAlertLimits.activeTtlSeconds),
  };
}

export async function npSubscribeShopRestockAlert(
  runtime: NpShopRuntime,
  memberId: string,
  input: NpShopRestockAlertInput,
): Promise<NpShopRestockAlertWire> {
  const product = await findPublishedProduct(runtime, input.productId);
  if (!product) {
    throw new NpShopRestockAlertContractError("Product is unavailable", [
      "restock alert product must be published on the current site.",
    ]);
  }
  const target = npResolveShopRestockTarget(product, input.variantSku);
  if (!target) {
    throw new NpShopRestockAlertContractError("Product does not support restock alerts", [
      "restock alerts require one tracked product or enabled variant target.",
    ]);
  }
  if (target.available) {
    throw new NpShopRestockAlertContractError("Product is already available", [
      "restock alerts can be requested only while the selected target is out of stock.",
    ]);
  }

  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const key = storageKey(input, memberId);
  const [existing] = await db
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
        sql`${npPluginStorage.expiresAt} > ${now}`,
      ),
    )
    .limit(1);
  if (existing) {
    const alert = requireStoredRow(existing);
    if (alert.status === "active" || alert.status === "claimed") {
      return npToShopRestockAlertWire(alert);
    }
  }
  const value = npRequireShopRestockAlertStorage(activeStorageValue(memberId, input, now));
  const [row] = await db
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key,
      value,
      expiresAt: new Date(value.expiresAt),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: { value, expiresAt: new Date(value.expiresAt), updatedAt: now },
    })
    .returning({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    });
  if (!row) throw new Error("Restock alert upsert returned no row.");
  return npToShopRestockAlertWire(requireStoredRow(row));
}

export async function npCancelShopRestockAlert(
  memberId: string,
  input: NpShopRestockAlertInput,
): Promise<boolean> {
  const siteId = await requireSiteId();
  const db = getDb();
  const deleted = await db
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(input, memberId)),
        sql`${npPluginStorage.value}->>'memberId' = ${memberId}`,
        sql`${npPluginStorage.value}->>'productId' = ${input.productId}`,
        sql`${npPluginStorage.value}->>'status' = 'active'`,
      ),
    )
    .returning({ key: npPluginStorage.key });
  if (deleted.length > 0) return true;
  const [processing] = await db
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(input, memberId)),
        sql`${npPluginStorage.value}->>'status' = 'claimed'`,
      ),
    )
    .limit(1);
  if (processing) {
    throw new NpShopRestockAlertContractError("Restock alert is already processing", [
      "the one-shot restock event has already been claimed for delivery.",
    ]);
  }
  return false;
}

export async function npListShopRestockAlerts(
  memberId: string,
  productId: string,
): Promise<NpShopRestockAlertWire[]> {
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
        like(npPluginStorage.key, `${RESTOCK_KEY_PREFIX}${productId}:%`),
        sql`${npPluginStorage.value}->>'memberId' = ${memberId}`,
        sql`${npPluginStorage.value}->>'productId' = ${productId}`,
        sql`${npPluginStorage.value}->>'status' in ('active', 'claimed')`,
        sql`${npPluginStorage.expiresAt} > ${now}`,
      ),
    )
    .orderBy(asc(npPluginStorage.key))
    .limit(npShopRestockAlertLimits.maximumTargetsPerProduct + 1);
  if (rows.length > npShopRestockAlertLimits.maximumTargetsPerProduct) {
    throw new NpShopRestockAlertContractError("Invalid Shop restock alert storage", [
      "restock alert rows exceed the product variant bound.",
    ]);
  }
  return rows.map((row) => npToShopRestockAlertWire(requireStoredRow(row)));
}

export async function npDeleteShopRestockAlertsForProduct(productId: string): Promise<number> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `${RESTOCK_KEY_PREFIX}${productId}:%`),
        sql`${npPluginStorage.value}->>'productId' = ${productId}`,
      ),
    )
    .returning({ key: npPluginStorage.key });
  return rows.length;
}

export async function npCleanupShopRestockAlerts(): Promise<number> {
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
        like(npPluginStorage.key, `${RESTOCK_KEY_PREFIX}%`),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopRestockAlertLimits.cleanupBatchSize);
  if (rows.length === 0) return 0;
  const deleted = await db
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
  return deleted.length;
}

async function touchUnavailable(
  row: StoredRow,
  alert: NpShopRestockAlertStorage,
  now: Date,
  siteId: string,
) {
  const next = npRequireShopRestockAlertStorage({
    ...alert,
    status: "active",
    outcome: null,
    checkedAt: now.toISOString(),
    claimedAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    notificationId: null,
  });
  const db = getDb();
  await db
    .update(npPluginStorage)
    .set({ value: next, updatedAt: now })
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, row.key),
        sql`${npPluginStorage.value}->>'eventId' = ${alert.eventId}`,
        alert.status === "claimed"
          ? and(
              sql`${npPluginStorage.value}->>'status' = 'claimed'`,
              sql`${npPluginStorage.value}->>'claimedAt' = ${alert.claimedAt}`,
            )
          : sql`${npPluginStorage.value}->>'status' = 'active'`,
      ),
    );
}

async function deleteAlertRow(
  row: StoredRow,
  alert: NpShopRestockAlertStorage,
  siteId: string,
): Promise<void> {
  await getDb()
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, row.key),
        sql`${npPluginStorage.value}->>'eventId' = ${alert.eventId}`,
      ),
    );
}

async function claimAlert(
  row: StoredRow,
  alert: NpShopRestockAlertStorage,
  now: Date,
): Promise<NpShopRestockAlertStorage | null> {
  const claimedAt = now.toISOString();
  const next = npRequireShopRestockAlertStorage({
    ...alert,
    status: "claimed",
    outcome: null,
    checkedAt: claimedAt,
    claimedAt,
    leaseExpiresAt: plusSeconds(now, npShopRestockAlertLimits.leaseSeconds),
    completedAt: null,
    notificationId: null,
  });
  const siteId = await requireSiteId();
  const db = getDb();
  const [claimed] = await db
    .update(npPluginStorage)
    .set({ value: next, updatedAt: now })
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, row.key),
        sql`${npPluginStorage.value}->>'eventId' = ${alert.eventId}`,
        alert.status === "active"
          ? sql`${npPluginStorage.value}->>'status' = 'active'`
          : and(
              sql`${npPluginStorage.value}->>'status' = 'claimed'`,
              sql`(${npPluginStorage.value}->>'leaseExpiresAt')::timestamptz <= ${now}`,
            ),
      ),
    )
    .returning({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    });
  return claimed ? requireStoredRow(claimed) : null;
}

async function existingNotificationId(memberId: string, eventId: string): Promise<string | null> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [row] = await db
    .select({ id: npNotifications.id })
    .from(npNotifications)
    .where(
      and(
        eq(npNotifications.siteId, siteId),
        eq(npNotifications.memberId, memberId),
        eq(npNotifications.kind, NP_SHOP_RESTOCK_NOTIFICATION_KIND),
        sql`${npNotifications.payload}->>'eventId' = ${eventId}`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function completeAlert(
  row: StoredRow,
  claimed: NpShopRestockAlertStorage,
  outcome: "notified" | "suppressed",
  notificationId: string | null,
  now: Date,
): Promise<void> {
  const completedAt = now.toISOString();
  const next = npRequireShopRestockAlertStorage({
    ...claimed,
    status: "completed",
    outcome,
    leaseExpiresAt: null,
    completedAt,
    notificationId,
    expiresAt: plusSeconds(now, npShopRestockAlertLimits.completedTtlSeconds),
  });
  const siteId = await requireSiteId();
  const db = getDb();
  await db
    .update(npPluginStorage)
    .set({ value: next, expiresAt: new Date(next.expiresAt), updatedAt: now })
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, row.key),
        sql`${npPluginStorage.value}->>'eventId' = ${claimed.eventId}`,
        sql`${npPluginStorage.value}->>'status' = 'claimed'`,
        sql`${npPluginStorage.value}->>'claimedAt' = ${claimed.claimedAt}`,
      ),
    );
}

export async function npProcessShopRestockAlerts(
  runtime: NpShopRuntime,
  options: { productId?: string; limit?: number } = {},
): Promise<NpShopRestockProcessResult> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const limit = Math.min(
    Math.max(options.limit ?? npShopRestockAlertLimits.processingBatchSize, 1),
    npShopRestockAlertLimits.processingBatchSize,
  );
  const candidateWhere = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, `${RESTOCK_KEY_PREFIX}%`),
    sql`${npPluginStorage.expiresAt} > ${now}`,
    sql`${npPluginStorage.value}->>'contract' = ${NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT}`,
    options.productId
      ? sql`${npPluginStorage.value}->>'productId' = ${options.productId}`
      : undefined,
    or(
      sql`${npPluginStorage.value}->>'status' = 'active'`,
      sql`${npPluginStorage.value}->>'status' = 'claimed'`,
    ),
  );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(candidateWhere)
    .orderBy(asc(npPluginStorage.updatedAt), asc(npPluginStorage.key))
    .limit(limit);
  const parsed: Array<{ row: StoredRow; alert: NpShopRestockAlertStorage }> = [];
  let invalid = 0;
  for (const row of rows) {
    try {
      parsed.push({ row, alert: requireStoredRow(row) });
    } catch {
      invalid += 1;
    }
  }
  const memberIds = [...new Set(parsed.map(({ alert }) => alert.memberId))];
  const memberRows =
    memberIds.length === 0
      ? []
      : await db
          .select({ id: npMembers.id })
          .from(npMembers)
          .where(inArray(npMembers.id, memberIds));
  const members = new Set(memberRows.map((member) => member.id));
  const productIds = [...new Set(parsed.map(({ alert }) => alert.productId))];
  const products = await findProducts(runtime, productIds);
  let notified = 0;
  let suppressed = 0;
  let unavailable = 0;
  let orphaned = 0;

  for (const { row, alert } of parsed) {
    if (
      alert.status === "claimed" &&
      alert.leaseExpiresAt !== null &&
      new Date(alert.leaseExpiresAt) > now
    ) {
      continue;
    }
    if (!members.has(alert.memberId)) {
      await deleteAlertRow(row, alert, siteId);
      orphaned += 1;
      continue;
    }
    const product = products.get(alert.productId);
    const target = product ? npResolveShopRestockTarget(product, alert.variantSku) : null;
    if (!product || !target) {
      await deleteAlertRow(row, alert, siteId);
      orphaned += 1;
      continue;
    }
    if (product.status !== "published" || !target.available) {
      await touchUnavailable(row, alert, now, siteId);
      unavailable += 1;
      continue;
    }
    const claimed = await claimAlert(row, alert, now);
    if (!claimed) continue;
    let notificationId = await existingNotificationId(claimed.memberId, claimed.eventId);
    if (!notificationId) {
      const notification = await createNotification({
        memberId: claimed.memberId,
        kind: NP_SHOP_RESTOCK_NOTIFICATION_KIND,
        payload: {
          eventId: claimed.eventId,
          href: `${runtime.basePath}/products/${product.slug}`,
          title: product.name.slice(0, 180),
          option: target.label.slice(0, 120),
          productId: claimed.productId,
          variantSku: claimed.variantSku,
          targetType: runtime.collections.products,
          targetId: claimed.productId,
        },
      });
      notificationId = notification?.id ?? null;
    }
    if (notificationId) {
      await completeAlert(row, claimed, "notified", notificationId, new Date());
      notified += 1;
    } else {
      await completeAlert(row, claimed, "suppressed", null, new Date());
      suppressed += 1;
    }
  }

  return {
    inspected: rows.length,
    notified,
    suppressed,
    unavailable,
    orphaned,
    invalid,
    cleaned: await npCleanupShopRestockAlerts(),
  };
}

export async function npInspectShopRestockAlerts(
  runtime: NpShopRuntime,
): Promise<NpShopRestockAlertInspection> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const [counts] = await db
    .select({
      active: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} > ${now} and ${npPluginStorage.value}->>'status' = 'active')::int`,
      claimed: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} > ${now} and ${npPluginStorage.value}->>'status' = 'claimed')::int`,
      completed: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} > ${now} and ${npPluginStorage.value}->>'status' = 'completed')::int`,
      expired: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} <= ${now})::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `${RESTOCK_KEY_PREFIX}%`),
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
        like(npPluginStorage.key, `${RESTOCK_KEY_PREFIX}%`),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopRestockAlertLimits.diagnosticSampleSize);
  const alerts: NpShopRestockAlertStorage[] = [];
  let invalidSample = 0;
  for (const row of sample) {
    try {
      alerts.push(requireStoredRow(row));
    } catch {
      invalidSample += 1;
    }
  }
  const memberIds = [...new Set(alerts.map((alert) => alert.memberId))];
  const members = new Set(
    memberIds.length === 0
      ? []
      : (
          await db
            .select({ id: npMembers.id })
            .from(npMembers)
            .where(inArray(npMembers.id, memberIds))
        ).map((member) => member.id),
  );
  const products = await findProducts(runtime, [
    ...new Set(alerts.map((alert) => alert.productId)),
  ]);
  let orphanSample = 0;
  let readySample = 0;
  let staleClaimSample = 0;
  for (const alert of alerts) {
    if (alert.status === "completed") continue;
    const product = products.get(alert.productId);
    const target = product ? npResolveShopRestockTarget(product, alert.variantSku) : null;
    if (!members.has(alert.memberId) || !product || !target) orphanSample += 1;
    if (
      (alert.status === "active" || alert.status === "claimed") &&
      product?.status === "published" &&
      target?.available
    ) {
      readySample += 1;
    }
    if (
      alert.status === "claimed" &&
      alert.leaseExpiresAt !== null &&
      new Date(alert.leaseExpiresAt) <= now
    ) {
      staleClaimSample += 1;
    }
  }
  return {
    active: counts?.active ?? 0,
    claimed: counts?.claimed ?? 0,
    completed: counts?.completed ?? 0,
    expired: counts?.expired ?? 0,
    invalidSample,
    orphanSample,
    readySample,
    staleClaimSample,
    sampleBoundReached: sample.length === npShopRestockAlertLimits.diagnosticSampleSize,
  };
}
