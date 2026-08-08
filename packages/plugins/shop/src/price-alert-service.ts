import { randomUUID } from "node:crypto";

import { findDocuments } from "@nexpress/core/collections";
import { createNotification } from "@nexpress/core/community";
import { getDb, npMembers, npNotifications, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, inArray, like, lte, or, sql } from "drizzle-orm";

import {
  NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT,
  NP_SHOP_PRICE_DROP_NOTIFICATION_KIND,
  NpShopPriceAlertContractError,
  npRequireShopPriceAlertStorage,
  npShopPriceAlertLimits,
  npToShopPriceAlertWire,
  type NpShopPriceAlertInput,
  type NpShopPriceAlertStorage,
  type NpShopPriceAlertWire,
} from "./price-alert-contract.js";
import {
  normalizeShopVariants,
  npRequireShopCurrency,
  npShopCatalogLimits,
  type NpShopRuntime,
  type ShopProductDocument,
} from "./runtime.js";
import type { NpShopCurrency } from "./types.js";

const NP_SHOP_PLUGIN_ID = "shop";
const PRICE_ALERT_KEY_PREFIX = "price-alert:";

interface StoredRow {
  key: string;
  value: unknown;
  expiresAt: Date | null;
}

export interface NpShopPriceAlertTargetState {
  currency: NpShopCurrency;
  priceMinor: number;
  label: string;
}

export interface NpShopPriceAlertProcessResult {
  inspected: number;
  notified: number;
  suppressed: number;
  unchanged: number;
  currencyMismatch: number;
  orphaned: number;
  invalid: number;
  cleaned: number;
}

export interface NpShopPriceAlertInspection {
  active: number;
  claimed: number;
  completed: number;
  expired: number;
  invalidSample: number;
  orphanSample: number;
  readySample: number;
  currencyMismatchSample: number;
  staleClaimSample: number;
  sampleBoundReached: boolean;
}

function storageKey(input: NpShopPriceAlertInput, memberId: string): string {
  return `${PRICE_ALERT_KEY_PREFIX}${input.productId}:${input.variantSku ?? "_"}:${memberId}`;
}

function plusSeconds(value: Date, seconds: number): string {
  return new Date(value.getTime() + seconds * 1_000).toISOString();
}

function requireStoredRow(row: StoredRow): NpShopPriceAlertStorage {
  const alert = npRequireShopPriceAlertStorage(row.value);
  if (
    row.key !== storageKey(alert, alert.memberId) ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== alert.expiresAt
  ) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert storage row", [
      "price alert storage key or expiry does not match its value.",
    ]);
  }
  return alert;
}

function requirePrice(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > npShopCatalogLimits.maximumPriceMinor
  ) {
    throw new NpShopPriceAlertContractError("Product price is invalid", [
      "price alert targets require one bounded integer catalog price.",
    ]);
  }
  return value as number;
}

export function npResolveShopPriceAlertTarget(
  product: ShopProductDocument,
  variantSku: string | null,
): NpShopPriceAlertTargetState | null {
  const currency = npRequireShopCurrency(product.currency);
  const basePrice = requirePrice(product.priceMinor);
  if (variantSku === null) {
    return { currency, priceMinor: basePrice, label: product.name };
  }
  const variant = normalizeShopVariants(product.variants).find(
    (candidate) => candidate.enabled && candidate.sku === variantSku,
  );
  if (!variant) return null;
  return {
    currency,
    priceMinor: variant.priceMinor ?? basePrice,
    label: variant.optionSummary ?? variant.name,
  };
}

function resolvePriceAlertTarget(
  product: ShopProductDocument | undefined,
  variantSku: string | null,
): NpShopPriceAlertTargetState | null {
  if (!product) return null;
  try {
    return npResolveShopPriceAlertTarget(product, variantSku);
  } catch {
    return null;
  }
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

function activeValue(
  memberId: string,
  input: NpShopPriceAlertInput,
  target: NpShopPriceAlertTargetState,
  now: Date,
): NpShopPriceAlertStorage {
  const createdAt = now.toISOString();
  return npRequireShopPriceAlertStorage({
    contract: NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT,
    eventId: randomUUID(),
    memberId,
    productId: input.productId,
    variantSku: input.variantSku,
    currency: target.currency,
    baselinePriceMinor: target.priceMinor,
    status: "active",
    outcome: null,
    createdAt,
    checkedAt: null,
    claimedAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    notificationId: null,
    expiresAt: plusSeconds(now, npShopPriceAlertLimits.activeTtlSeconds),
  });
}

export async function npSubscribeShopPriceAlert(
  runtime: NpShopRuntime,
  memberId: string,
  input: NpShopPriceAlertInput,
): Promise<NpShopPriceAlertWire> {
  const product = await findPublishedProduct(runtime, input.productId);
  if (!product) {
    throw new NpShopPriceAlertContractError("Product is unavailable", [
      "price alert product must be published on the current site.",
    ]);
  }
  const target = npResolveShopPriceAlertTarget(product, input.variantSku);
  if (!target) {
    throw new NpShopPriceAlertContractError("Price target is unavailable", [
      "price alerts require the product price or one exact enabled variant SKU.",
    ]);
  }
  if (target.priceMinor === 0) {
    throw new NpShopPriceAlertContractError("Price cannot decrease", [
      "a zero-price target cannot produce a lower bounded catalog price.",
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
      return npToShopPriceAlertWire(alert);
    }
  }
  const value = activeValue(memberId, input, target, now);
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
  if (!row) throw new Error("Price alert upsert returned no row.");
  return npToShopPriceAlertWire(requireStoredRow(row));
}

export async function npCancelShopPriceAlert(
  memberId: string,
  input: NpShopPriceAlertInput,
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
    throw new NpShopPriceAlertContractError("Price alert is already processing", [
      "the one-shot price-drop event has already been claimed for delivery.",
    ]);
  }
  return false;
}

export async function npListShopPriceAlerts(
  memberId: string,
  productId: string,
): Promise<NpShopPriceAlertWire[]> {
  const byProduct = await npListShopPriceAlertsForProducts(memberId, [productId]);
  return byProduct[productId] ?? [];
}

export async function npListShopPriceAlertsForProducts(
  memberId: string,
  productIds: readonly string[],
): Promise<Record<string, NpShopPriceAlertWire[]>> {
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length > npShopPriceAlertLimits.maximumProductsPerRead) {
    throw new NpShopPriceAlertContractError("Too many price alert products", [
      "price alert batch reads exceed the fixed product bound.",
    ]);
  }
  if (uniqueIds.length === 0) return {};
  const siteId = await requireSiteId();
  const now = new Date();
  const rows = await getDb()
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
        like(npPluginStorage.key, `${PRICE_ALERT_KEY_PREFIX}%`),
        inArray(sql<string>`${npPluginStorage.value}->>'productId'`, uniqueIds),
        sql`${npPluginStorage.value}->>'memberId' = ${memberId}`,
        sql`${npPluginStorage.value}->>'status' in ('active', 'claimed')`,
        sql`${npPluginStorage.expiresAt} > ${now}`,
      ),
    )
    .orderBy(asc(npPluginStorage.key))
    .limit(uniqueIds.length * npShopPriceAlertLimits.maximumTargetsPerProduct + 1);
  if (rows.length > uniqueIds.length * npShopPriceAlertLimits.maximumTargetsPerProduct) {
    throw new NpShopPriceAlertContractError("Invalid Shop price alert storage", [
      "price alert rows exceed the fixed product/target bound.",
    ]);
  }
  const result: Record<string, NpShopPriceAlertWire[]> = {};
  for (const row of rows) {
    const alert = requireStoredRow(row);
    (result[alert.productId] ??= []).push(npToShopPriceAlertWire(alert));
  }
  return result;
}

export async function npDeleteShopPriceAlertsForProduct(productId: string): Promise<number> {
  const siteId = await requireSiteId();
  const rows = await getDb()
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `${PRICE_ALERT_KEY_PREFIX}${productId}:%`),
        sql`${npPluginStorage.value}->>'productId' = ${productId}`,
      ),
    )
    .returning({ key: npPluginStorage.key });
  return rows.length;
}

export async function npCleanupShopPriceAlerts(now = new Date()): Promise<number> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `${PRICE_ALERT_KEY_PREFIX}%`),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopPriceAlertLimits.cleanupBatchSize);
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

async function touchUnchanged(
  row: StoredRow,
  alert: NpShopPriceAlertStorage,
  now: Date,
  siteId: string,
) {
  const next = npRequireShopPriceAlertStorage({
    ...alert,
    status: "active",
    outcome: null,
    checkedAt: now.toISOString(),
    claimedAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    notificationId: null,
  });
  await getDb()
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

async function deleteAlert(row: StoredRow, alert: NpShopPriceAlertStorage, siteId: string) {
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
  alert: NpShopPriceAlertStorage,
  now: Date,
  siteId: string,
): Promise<NpShopPriceAlertStorage | null> {
  const claimedAt = now.toISOString();
  const next = npRequireShopPriceAlertStorage({
    ...alert,
    status: "claimed",
    outcome: null,
    checkedAt: claimedAt,
    claimedAt,
    leaseExpiresAt: plusSeconds(now, npShopPriceAlertLimits.leaseSeconds),
    completedAt: null,
    notificationId: null,
  });
  const [claimed] = await getDb()
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

async function existingNotificationId(
  siteId: string,
  memberId: string,
  eventId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: npNotifications.id })
    .from(npNotifications)
    .where(
      and(
        eq(npNotifications.siteId, siteId),
        eq(npNotifications.memberId, memberId),
        eq(npNotifications.kind, NP_SHOP_PRICE_DROP_NOTIFICATION_KIND),
        sql`${npNotifications.payload}->>'eventId' = ${eventId}`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function completeAlert(
  row: StoredRow,
  claimed: NpShopPriceAlertStorage,
  outcome: "notified" | "suppressed",
  notificationId: string | null,
  now: Date,
  siteId: string,
) {
  const completedAt = now.toISOString();
  const next = npRequireShopPriceAlertStorage({
    ...claimed,
    status: "completed",
    outcome,
    leaseExpiresAt: null,
    completedAt,
    notificationId,
    expiresAt: plusSeconds(now, npShopPriceAlertLimits.completedTtlSeconds),
  });
  await getDb()
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

export async function npProcessShopPriceAlerts(
  runtime: NpShopRuntime,
  options: { productId?: string; limit?: number } = {},
): Promise<NpShopPriceAlertProcessResult> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const limit = Math.min(
    Math.max(options.limit ?? npShopPriceAlertLimits.processingBatchSize, 1),
    npShopPriceAlertLimits.processingBatchSize,
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
        like(npPluginStorage.key, `${PRICE_ALERT_KEY_PREFIX}%`),
        sql`${npPluginStorage.expiresAt} > ${now}`,
        sql`${npPluginStorage.value}->>'contract' = ${NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT}`,
        options.productId
          ? sql`${npPluginStorage.value}->>'productId' = ${options.productId}`
          : undefined,
        or(
          sql`${npPluginStorage.value}->>'status' = 'active'`,
          sql`${npPluginStorage.value}->>'status' = 'claimed'`,
        ),
      ),
    )
    .orderBy(asc(npPluginStorage.updatedAt), asc(npPluginStorage.key))
    .limit(limit);
  const parsed: Array<{ row: StoredRow; alert: NpShopPriceAlertStorage }> = [];
  let invalid = 0;
  for (const row of rows) {
    try {
      parsed.push({ row, alert: requireStoredRow(row) });
    } catch {
      invalid += 1;
    }
  }
  const memberIds = [...new Set(parsed.map(({ alert }) => alert.memberId))];
  const memberRows = memberIds.length
    ? await db.select({ id: npMembers.id }).from(npMembers).where(inArray(npMembers.id, memberIds))
    : [];
  const members = new Set(memberRows.map((member) => member.id));
  const products = await findProducts(runtime, [
    ...new Set(parsed.map(({ alert }) => alert.productId)),
  ]);
  let notified = 0;
  let suppressed = 0;
  let unchanged = 0;
  let currencyMismatch = 0;
  let orphaned = 0;
  for (const { row, alert } of parsed) {
    if (
      alert.status === "claimed" &&
      alert.leaseExpiresAt &&
      new Date(alert.leaseExpiresAt) > now
    ) {
      continue;
    }
    if (!members.has(alert.memberId)) {
      await deleteAlert(row, alert, siteId);
      orphaned += 1;
      continue;
    }
    const product = products.get(alert.productId);
    const target = resolvePriceAlertTarget(product, alert.variantSku);
    if (!product || !target) {
      await deleteAlert(row, alert, siteId);
      orphaned += 1;
      continue;
    }
    if (target.currency !== alert.currency) {
      await touchUnchanged(row, alert, now, siteId);
      currencyMismatch += 1;
      continue;
    }
    if (product.status !== "published" || target.priceMinor >= alert.baselinePriceMinor) {
      await touchUnchanged(row, alert, now, siteId);
      unchanged += 1;
      continue;
    }
    const claimed = await claimAlert(row, alert, now, siteId);
    if (!claimed) continue;
    let notificationId = await existingNotificationId(siteId, claimed.memberId, claimed.eventId);
    if (!notificationId) {
      const notification = await createNotification({
        memberId: claimed.memberId,
        kind: NP_SHOP_PRICE_DROP_NOTIFICATION_KIND,
        payload: {
          eventId: claimed.eventId,
          href: `${runtime.basePath}/products/${product.slug}`,
          title: product.name.slice(0, 180),
          option: target.label.slice(0, 120),
          productId: claimed.productId,
          variantSku: claimed.variantSku,
          currency: claimed.currency,
          previousPriceMinor: claimed.baselinePriceMinor,
          currentPriceMinor: target.priceMinor,
          targetType: runtime.collections.products,
          targetId: claimed.productId,
        },
      });
      notificationId = notification?.id ?? null;
    }
    if (notificationId) {
      await completeAlert(row, claimed, "notified", notificationId, new Date(), siteId);
      notified += 1;
    } else {
      await completeAlert(row, claimed, "suppressed", null, new Date(), siteId);
      suppressed += 1;
    }
  }
  return {
    inspected: rows.length,
    notified,
    suppressed,
    unchanged,
    currencyMismatch,
    orphaned,
    invalid,
    cleaned: await npCleanupShopPriceAlerts(now),
  };
}

export async function npInspectShopPriceAlerts(
  runtime: NpShopRuntime,
): Promise<NpShopPriceAlertInspection> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const base = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, `${PRICE_ALERT_KEY_PREFIX}%`),
  );
  const [counts] = await db
    .select({
      active: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} > ${now} and ${npPluginStorage.value}->>'status' = 'active')::int`,
      claimed: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} > ${now} and ${npPluginStorage.value}->>'status' = 'claimed')::int`,
      completed: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} > ${now} and ${npPluginStorage.value}->>'status' = 'completed')::int`,
      expired: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} <= ${now})::int`,
    })
    .from(npPluginStorage)
    .where(base);
  const sample = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(base)
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPriceAlertLimits.diagnosticSampleSize);
  const alerts: NpShopPriceAlertStorage[] = [];
  let invalidSample = 0;
  for (const row of sample) {
    try {
      alerts.push(requireStoredRow(row));
    } catch {
      invalidSample += 1;
    }
  }
  const memberIds = [...new Set(alerts.map((alert) => alert.memberId))];
  const memberRows = memberIds.length
    ? await db.select({ id: npMembers.id }).from(npMembers).where(inArray(npMembers.id, memberIds))
    : [];
  const members = new Set(memberRows.map((member) => member.id));
  const products = await findProducts(runtime, [
    ...new Set(alerts.map((alert) => alert.productId)),
  ]);
  let orphanSample = 0;
  let readySample = 0;
  let currencyMismatchSample = 0;
  let staleClaimSample = 0;
  for (const alert of alerts) {
    if (alert.status === "completed") continue;
    const product = products.get(alert.productId);
    const target = resolvePriceAlertTarget(product, alert.variantSku);
    if (!members.has(alert.memberId) || !product || !target) orphanSample += 1;
    if (
      product?.status === "published" &&
      target &&
      target.currency === alert.currency &&
      target.priceMinor < alert.baselinePriceMinor
    ) {
      readySample += 1;
    }
    if (target && target.currency !== alert.currency) currencyMismatchSample += 1;
    if (
      alert.status === "claimed" &&
      alert.leaseExpiresAt &&
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
    currencyMismatchSample,
    staleClaimSample,
    sampleBoundReached: sample.length === npShopPriceAlertLimits.diagnosticSampleSize,
  };
}
