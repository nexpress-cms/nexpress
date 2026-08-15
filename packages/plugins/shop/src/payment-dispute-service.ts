import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, inArray, like, notLike, sql } from "drizzle-orm";

import { npRequireStoredShopOrder, type NpShopStoredOrder } from "./order-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import {
  NpShopPaymentDisputeConflictError,
  npRequireStoredShopPaymentDispute,
  npRequireStoredShopPaymentDisputeReceipt,
  npShopPaymentDisputeLimits,
  npShopPaymentDisputeReceiptStorageKey,
  npShopPaymentDisputeRequiresReview,
  npShopPaymentDisputeStorageKey,
  type NpShopStoredPaymentDispute,
  type NpShopStoredPaymentDisputeReceipt,
} from "./payment-dispute-contract.js";

export interface NpShopAdminPaymentDisputeRow {
  [key: string]: unknown;
  provider: string;
  eventId: string;
  dispute: string;
  orderId: string;
  amount: string;
  status: string;
  reason: string;
  outcome: string;
  occurredAt: string;
  processedAt: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerSegmentPattern.test(value) ||
      (value.startsWith("member:") && uuidPattern.test(value.slice("member:".length))))
  );
}

function lookupStorageKey(orderId: string): string {
  return `order-lookup:${orderId}`;
}

function orderStorageKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

function readLookupIdentity(row: {
  key: string;
  value: unknown;
  expiresAt: Date | null;
}): { orderId: string; ownerSegment: string; purgeAt: string } | null {
  try {
    if (typeof row.value !== "object" || row.value === null || Array.isArray(row.value)) {
      return null;
    }
    const value = row.value as Record<string, unknown>;
    if (
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== 4 ||
      value.contract !== "np.shop-order-lookup.v1" ||
      typeof value.orderId !== "string" ||
      !uuidPattern.test(value.orderId) ||
      !isOwnerSegment(value.ownerSegment) ||
      typeof value.purgeAt !== "string" ||
      row.key !== lookupStorageKey(value.orderId) ||
      row.expiresAt?.toISOString() !== value.purgeAt ||
      new Date(value.purgeAt).toISOString() !== value.purgeAt
    ) {
      return null;
    }
    return {
      orderId: value.orderId,
      ownerSegment: value.ownerSegment,
      purgeAt: value.purgeAt,
    };
  } catch {
    return null;
  }
}

function requireStateMetadata(
  row: { key: string; expiresAt: Date | null },
  state: NpShopStoredPaymentDispute,
): void {
  if (
    row.key !== npShopPaymentDisputeStorageKey(state.providerId, state.disputeReference) ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== state.purgeAt
  ) {
    throw new Error("Shop payment dispute storage metadata is invalid.");
  }
}

function requireReceiptMetadata(
  row: { key: string; expiresAt: Date | null },
  receipt: NpShopStoredPaymentDisputeReceipt,
): void {
  if (
    row.key !== npShopPaymentDisputeReceiptStorageKey(receipt.providerId, receipt.event.eventId) ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== receipt.purgeAt
  ) {
    throw new Error("Shop payment dispute receipt metadata is invalid.");
  }
}

export async function npReadStoredShopPaymentDispute(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  providerId: string,
  disputeReference: string,
  forUpdate = false,
): Promise<NpShopStoredPaymentDispute | null> {
  const key = npShopPaymentDisputeStorageKey(providerId, disputeReference);
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
  const state = npRequireStoredShopPaymentDispute(row.value);
  requireStateMetadata(row, state);
  return state;
}

export async function npReadStoredShopPaymentDisputesForOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredPaymentDispute[]> {
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
        like(npPluginStorage.key, "payment-dispute:%"),
        notLike(npPluginStorage.key, "payment-dispute-event:%"),
        sql`${npPluginStorage.value}->>'orderId' = ${orderId}`,
      ),
    )
    .orderBy(npPluginStorage.key)
    .limit(npShopPaymentDisputeLimits.maximumPerOrder + 1);
  if (forUpdate) query = query.for("update") as typeof query;
  const rows = await query;
  if (rows.length > npShopPaymentDisputeLimits.maximumPerOrder) {
    throw new NpShopPaymentDisputeConflictError(
      "payment_dispute_limit",
      "This order exceeds the bounded payment dispute evidence limit.",
    );
  }
  return rows.map((row) => {
    const state = npRequireStoredShopPaymentDispute(row.value);
    requireStateMetadata(row, state);
    if (state.orderId !== orderId) {
      throw new Error("Shop payment dispute order relation is invalid.");
    }
    return state;
  });
}

export function npShopPaymentDisputesMatchOrder(
  disputes: readonly NpShopStoredPaymentDispute[],
  order: NpShopStoredOrder,
): boolean {
  return disputes.every(
    (dispute) =>
      dispute.orderId === order.id &&
      dispute.providerId === order.paymentProvider &&
      dispute.paymentReference === order.paymentReference &&
      dispute.currency === order.currency &&
      dispute.amountMinor <= order.totalMinor &&
      dispute.purgeAt === order.purgeAt,
  );
}

export function npShopPaymentDisputesRequireReview(
  disputes: readonly NpShopStoredPaymentDispute[],
): boolean {
  return disputes.some(npShopPaymentDisputeRequiresReview);
}

export async function npShopPaymentDisputeAllowsAdminActions(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
): Promise<boolean> {
  try {
    const disputes = await npReadStoredShopPaymentDisputesForOrder(db, siteId, order.id);
    return (
      npShopPaymentDisputesMatchOrder(disputes, order) &&
      !npShopPaymentDisputesRequireReview(disputes)
    );
  } catch {
    return false;
  }
}

export async function npPersistShopPaymentDispute(
  tx: NpShopTransaction,
  siteId: string,
  state: NpShopStoredPaymentDispute,
): Promise<void> {
  npRequireStoredShopPaymentDispute(state);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopPaymentDisputeStorageKey(state.providerId, state.disputeReference),
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

export async function npReadStoredShopPaymentDisputeReceipt(
  tx: NpShopTransaction,
  siteId: string,
  providerId: string,
  eventId: string,
): Promise<NpShopStoredPaymentDisputeReceipt | null> {
  const key = npShopPaymentDisputeReceiptStorageKey(providerId, eventId);
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
  const receipt = npRequireStoredShopPaymentDisputeReceipt(row.value);
  requireReceiptMetadata(row, receipt);
  return receipt;
}

export async function npPersistShopPaymentDisputeReceipt(
  tx: NpShopTransaction,
  siteId: string,
  receipt: NpShopStoredPaymentDisputeReceipt,
): Promise<void> {
  npRequireStoredShopPaymentDisputeReceipt(receipt);
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: npShopPaymentDisputeReceiptStorageKey(receipt.providerId, receipt.event.eventId),
    value: receipt,
    expiresAt: new Date(receipt.purgeAt),
    updatedAt: new Date(receipt.processedAt),
  });
}

export async function npCountShopPaymentDisputes(): Promise<{
  total: number;
  requiringReview: number;
  invalidSample: number;
  orphanSample: number;
  sourceMismatchSample: number;
  sampleBoundReached: boolean;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [{ total, requiringReview }] = await db
    .select({
      total: sql<number>`count(*)::int`,
      requiringReview: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' not in ('won', 'warning-closed', 'prevented'))::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-dispute:%"),
        notLike(npPluginStorage.key, "payment-dispute-event:%"),
      ),
    );
  const stateRows = await db
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
        like(npPluginStorage.key, "payment-dispute:%"),
        notLike(npPluginStorage.key, "payment-dispute-event:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentDisputeLimits.diagnosticSampleSize);
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
        like(npPluginStorage.key, "payment-dispute-event:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentDisputeLimits.diagnosticSampleSize);
  let invalidSample = 0;
  const sampledStates: NpShopStoredPaymentDispute[] = [];
  const sampledReceipts: NpShopStoredPaymentDisputeReceipt[] = [];
  for (const row of stateRows) {
    try {
      const state = npRequireStoredShopPaymentDispute(row.value);
      requireStateMetadata(row, state);
      sampledStates.push(state);
    } catch {
      invalidSample += 1;
    }
  }
  for (const row of receiptRows) {
    try {
      const receipt = npRequireStoredShopPaymentDisputeReceipt(row.value);
      requireReceiptMetadata(row, receipt);
      sampledReceipts.push(receipt);
    } catch {
      invalidSample += 1;
    }
  }
  const sampledOrderIds = [
    ...sampledStates.map((state) => state.orderId),
    ...sampledReceipts.map((receipt) => receipt.event.orderId),
  ];
  const lookupKeys = [...new Set(sampledOrderIds.map(lookupStorageKey))];
  const lookups = lookupKeys.length
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
            inArray(npPluginStorage.key, lookupKeys),
          ),
        )
    : [];
  const lookupByOrderId = new Map(
    lookups
      .map(readLookupIdentity)
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .map((value) => [value.orderId, value]),
  );
  const lookupRowKeys = new Set(lookups.map((row) => row.key));
  const orderKeys = [
    ...new Set(
      [...lookupByOrderId.values()].map((lookup) =>
        orderStorageKey(lookup.ownerSegment, lookup.orderId),
      ),
    ),
  ];
  const orderRows = orderKeys.length
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
            inArray(npPluginStorage.key, orderKeys),
          ),
        )
    : [];
  const orders = new Map<string, NpShopStoredOrder>();
  const invalidOrderIds = new Set<string>();
  for (const row of orderRows) {
    try {
      const order = npRequireStoredShopOrder(row.value);
      if (
        row.key !== orderStorageKey(order.ownerSegment, order.id) ||
        row.expiresAt?.toISOString() !== order.purgeAt
      ) {
        throw new Error("invalid order metadata");
      }
      orders.set(order.id, order);
    } catch {
      const lookup = [...lookupByOrderId.values()].find(
        (candidate) => orderStorageKey(candidate.ownerSegment, candidate.orderId) === row.key,
      );
      if (lookup) invalidOrderIds.add(lookup.orderId);
    }
  }
  let orphanSample = 0;
  let sourceMismatchSample = 0;
  const inspectSource = (orderId: string, matches: (order: NpShopStoredOrder) => boolean): void => {
    const lookup = lookupByOrderId.get(orderId);
    const order = orders.get(orderId);
    if (!lookup) {
      if (lookupRowKeys.has(lookupStorageKey(orderId))) sourceMismatchSample += 1;
      else orphanSample += 1;
    } else if (!order && !invalidOrderIds.has(orderId)) {
      orphanSample += 1;
    } else if (
      !order ||
      lookup.purgeAt !== order.purgeAt ||
      lookup.ownerSegment !== order.ownerSegment ||
      !matches(order)
    ) {
      sourceMismatchSample += 1;
    }
  };
  for (const state of sampledStates) {
    inspectSource(state.orderId, (order) => npShopPaymentDisputesMatchOrder([state], order));
  }
  for (const receipt of sampledReceipts) {
    inspectSource(
      receipt.event.orderId,
      (order) =>
        receipt.providerId === order.paymentProvider &&
        receipt.event.paymentReference === order.paymentReference &&
        receipt.event.currency === order.currency &&
        receipt.event.amountMinor <= order.totalMinor &&
        receipt.purgeAt === order.purgeAt,
    );
  }
  return {
    total,
    requiringReview,
    invalidSample,
    orphanSample,
    sourceMismatchSample,
    sampleBoundReached:
      stateRows.length === npShopPaymentDisputeLimits.diagnosticSampleSize ||
      receiptRows.length === npShopPaymentDisputeLimits.diagnosticSampleSize,
  };
}

export async function npListRecentShopPaymentDisputes(): Promise<{
  rows: NpShopAdminPaymentDisputeRow[];
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
        like(npPluginStorage.key, "payment-dispute-event:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentDisputeLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-dispute-event:%"),
      ),
    );
  const projected: NpShopAdminPaymentDisputeRow[] = [];
  for (const row of rows) {
    try {
      const receipt = npRequireStoredShopPaymentDisputeReceipt(row.value);
      requireReceiptMetadata(row, receipt);
      projected.push({
        provider: receipt.providerId,
        eventId: receipt.event.eventId,
        dispute: receipt.event.disputeReference,
        orderId: receipt.event.orderId,
        amount: `${receipt.event.currency} ${receipt.event.amountMinor.toString()}`,
        status: receipt.event.status,
        reason: receipt.event.reasonCode,
        outcome: receipt.outcome,
        occurredAt: receipt.event.occurredAt,
        processedAt: receipt.processedAt,
      });
    } catch {
      // Health retains the bounded malformed-row signal without projecting raw values.
    }
  }
  return { rows: projected, total };
}
