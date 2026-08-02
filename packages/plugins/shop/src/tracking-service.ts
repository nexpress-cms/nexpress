import { createHash } from "node:crypto";

import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

import {
  npRequireStoredShopCarrierBooking,
  type NpShopStoredCarrierBooking,
} from "./carrier-contract.js";
import {
  npRequireStoredShopFulfillment,
  type NpShopStoredFulfillment,
} from "./fulfillment-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import {
  NP_SHOP_TRACKING_RECEIPT_CONTRACT,
  NP_SHOP_TRACKING_STORAGE_CONTRACT,
  NpShopTrackingConflictError,
  NpShopTrackingContractError,
  npProjectShopTracking,
  npRequireShopTrackingProviderId,
  npRequireStoredShopTracking,
  npRequireStoredShopTrackingReceipt,
  npShopTrackingEventDigest,
  npShopTrackingLimits,
  npShopTrackingReceiptStorageKey,
  npShopTrackingStorageKey,
  type NpShopStoredTracking,
  type NpShopStoredTrackingReceipt,
  type NpShopTracking,
  type NpShopTrackingReceiptOutcome,
  type NpShopTrackingStatus,
  type NpShopVerifiedTrackingEvent,
} from "./tracking-contract.js";

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerSegmentPattern.test(value) ||
      (value.startsWith("member:") && canonicalUuidPattern.test(value.slice("member:".length))))
  );
}

export interface NpShopTrackingApplyResult {
  receipt: NpShopStoredTrackingReceipt;
  tracking: NpShopTracking;
  duplicate: boolean;
}

export interface NpShopAdminTrackingEventRow {
  [key: string]: unknown;
  provider: string;
  eventId: string;
  shipmentId: string;
  orderId: string;
  status: string;
  outcome: string;
  occurredAt: string;
  processedAt: string;
}

function carrierBookingStorageKey(orderId: string): string {
  return `carrier-booking:${orderId}`;
}

function fulfillmentStorageKey(orderId: string): string {
  return `fulfillment:${orderId}`;
}

function orderLookupStorageKey(orderId: string): string {
  return `order-lookup:${orderId}`;
}

function requireOrderLookupRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
  orderId: string,
  purgeAt: string,
): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ((Object.getPrototypeOf(value) as unknown) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new NpShopTrackingContractError("Invalid order lookup storage", [
      "tracking order lookup must be a plain object.",
    ]);
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = ["contract", "orderId", "ownerSegment", "purgeAt"];
  if (
    Object.keys(candidate).length !== expectedKeys.length ||
    expectedKeys.some((field) => !Object.hasOwn(candidate, field)) ||
    candidate.contract !== "np.shop-order-lookup.v1" ||
    candidate.orderId !== orderId ||
    candidate.purgeAt !== purgeAt ||
    !isOwnerSegment(candidate.ownerSegment) ||
    key !== orderLookupStorageKey(orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== purgeAt
  ) {
    throw new NpShopTrackingContractError("Invalid order lookup storage", [
      "tracking order lookup must exactly match its shipment retention.",
    ]);
  }
}

function requireBookingRow(
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
    throw new NpShopTrackingContractError("Invalid carrier booking storage metadata", [
      "carrier booking key and expiry must match its value.",
    ]);
  }
  return booking;
}

function requireFulfillmentRow(
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
    throw new NpShopTrackingContractError("Invalid fulfillment storage metadata", [
      "fulfillment key and expiry must match its value.",
    ]);
  }
  return fulfillment;
}

function requireTrackingRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredTracking {
  const tracking = npRequireStoredShopTracking(value);
  if (
    key !== npShopTrackingStorageKey(tracking.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== tracking.purgeAt
  ) {
    throw new NpShopTrackingContractError("Invalid tracking storage metadata", [
      "tracking key and expiry must match its value.",
    ]);
  }
  return tracking;
}

function requireReceiptRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredTrackingReceipt {
  const receipt = npRequireStoredShopTrackingReceipt(value);
  if (
    key !== npShopTrackingReceiptStorageKey(receipt.providerId, receipt.event.eventId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== receipt.purgeAt
  ) {
    throw new NpShopTrackingContractError("Invalid tracking receipt storage metadata", [
      "tracking receipt key and expiry must match its value.",
    ]);
  }
  return receipt;
}

async function readExactRow(
  tx: NpShopTransaction,
  siteId: string,
  key: string,
  forUpdate: boolean,
) {
  let query = tx
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
  return row ?? null;
}

async function persistTracking(
  tx: NpShopTransaction,
  siteId: string,
  tracking: NpShopStoredTracking,
): Promise<void> {
  npRequireStoredShopTracking(tracking);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopTrackingStorageKey(tracking.orderId),
      value: tracking,
      expiresAt: new Date(tracking.purgeAt),
      updatedAt: new Date(tracking.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: tracking,
        expiresAt: new Date(tracking.purgeAt),
        updatedAt: new Date(tracking.updatedAt),
      },
    });
}

async function persistReceipt(
  tx: NpShopTransaction,
  siteId: string,
  receipt: NpShopStoredTrackingReceipt,
): Promise<void> {
  npRequireStoredShopTrackingReceipt(receipt);
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: npShopTrackingReceiptStorageKey(receipt.providerId, receipt.event.eventId),
    value: receipt,
    expiresAt: new Date(receipt.purgeAt),
    updatedAt: new Date(receipt.processedAt),
  });
}

function canAdvance(from: NpShopTrackingStatus | null, to: NpShopTrackingStatus): boolean {
  if (from === null || from === "exception") return true;
  if (from === "delivered") return to === "delivered";
  if (from === "in-transit") return true;
  return to !== "in-transit";
}

function statusPrecedence(status: NpShopTrackingStatus): number {
  switch (status) {
    case "in-transit":
      return 1;
    case "out-for-delivery":
      return 2;
    case "exception":
      return 3;
    case "delivered":
      return 4;
  }
}

export async function npApplyShopTrackingEvent(
  providerIdInput: string,
  event: NpShopVerifiedTrackingEvent,
  receivedAt: Date,
): Promise<NpShopTrackingApplyResult> {
  const providerId = npRequireShopTrackingProviderId(providerIdInput);
  const siteId = await requireSiteId();
  const eventDigest = npShopTrackingEventDigest(event);
  const receiptKey = npShopTrackingReceiptStorageKey(providerId, event.eventId);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-tracking-event:${siteId}:${providerId}:${createHash("sha256").update(event.eventId).digest("hex")}`}, 0))`,
    );
    const receiptRow = await readExactRow(tx, siteId, receiptKey, true);
    if (receiptRow) {
      const receipt = requireReceiptRow(receiptRow.value, receiptRow.expiresAt, receiptRow.key);
      if (receipt.eventDigest !== eventDigest) {
        throw new NpShopTrackingConflictError(
          "tracking_event_conflict",
          "The carrier event id was already used for different tracking data.",
        );
      }
      const stateRow = await readExactRow(
        tx,
        siteId,
        npShopTrackingStorageKey(event.orderId),
        true,
      );
      if (!stateRow) {
        throw new NpShopTrackingConflictError(
          "tracking_booking_not_found",
          "The duplicate tracking event no longer has its durable state.",
        );
      }
      return {
        receipt,
        tracking: npProjectShopTracking(
          requireTrackingRow(stateRow.value, stateRow.expiresAt, stateRow.key),
        ),
        duplicate: true,
      };
    }

    const bookingRow = await readExactRow(
      tx,
      siteId,
      carrierBookingStorageKey(event.orderId),
      true,
    );
    if (!bookingRow) {
      throw new NpShopTrackingConflictError(
        "tracking_booking_not_found",
        "The tracking event has no durable carrier booking.",
      );
    }
    const booking = requireBookingRow(bookingRow.value, bookingRow.expiresAt, bookingRow.key);
    const lookupRow = await readExactRow(tx, siteId, orderLookupStorageKey(event.orderId), true);
    if (!lookupRow) {
      throw new NpShopTrackingConflictError(
        "tracking_booking_not_found",
        "The tracking event has no retained commercial order.",
      );
    }
    requireOrderLookupRow(
      lookupRow.value,
      lookupRow.expiresAt,
      lookupRow.key,
      event.orderId,
      booking.purgeAt,
    );
    if (new Date(booking.purgeAt) <= receivedAt) {
      throw new NpShopTrackingConflictError(
        "tracking_shipment_expired",
        "The carrier shipment is past its commercial retention window.",
      );
    }
    if (booking.providerId !== providerId) {
      throw new NpShopTrackingConflictError(
        "tracking_provider_mismatch",
        "The tracking event belongs to a different carrier provider.",
      );
    }
    if (
      booking.status !== "completed" ||
      booking.id !== event.shipmentId ||
      booking.bookingReference !== event.bookingReference ||
      booking.trackingNumber !== event.trackingNumber
    ) {
      throw new NpShopTrackingConflictError(
        "tracking_shipment_mismatch",
        "The tracking event does not exactly match the completed carrier booking.",
      );
    }
    const fulfillmentRow = await readExactRow(
      tx,
      siteId,
      fulfillmentStorageKey(event.orderId),
      true,
    );
    if (!fulfillmentRow) {
      throw new NpShopTrackingConflictError(
        "tracking_fulfillment_mismatch",
        "The tracking event has no matching shipped fulfillment.",
      );
    }
    const fulfillment = requireFulfillmentRow(
      fulfillmentRow.value,
      fulfillmentRow.expiresAt,
      fulfillmentRow.key,
    );
    if (
      fulfillment.status !== "shipped" ||
      fulfillment.trackingNumber !== event.trackingNumber ||
      fulfillment.privateDataStatus !== "redacted"
    ) {
      throw new NpShopTrackingConflictError(
        "tracking_fulfillment_mismatch",
        "The tracking event does not match one redacted shipped fulfillment.",
      );
    }

    const stateKey = npShopTrackingStorageKey(event.orderId);
    const stateRow = await readExactRow(tx, siteId, stateKey, true);
    const existing = stateRow
      ? requireTrackingRow(stateRow.value, stateRow.expiresAt, stateRow.key)
      : null;
    if (
      existing &&
      (existing.providerId !== providerId ||
        existing.shipmentId !== event.shipmentId ||
        existing.bookingReference !== event.bookingReference ||
        existing.trackingNumber !== event.trackingNumber)
    ) {
      throw new NpShopTrackingConflictError(
        "tracking_shipment_mismatch",
        "The durable tracking state belongs to a different shipment.",
      );
    }

    let outcome: NpShopTrackingReceiptOutcome = "advanced";
    const eventTime = new Date(event.occurredAt).getTime();
    const existingTime = existing ? new Date(existing.occurredAt).getTime() : null;
    if (existing?.status === "delivered" && event.status !== "delivered") {
      outcome = "ignored-terminal";
    } else if (existing && existingTime !== null && eventTime < existingTime) {
      outcome = "ignored-stale";
    } else if (
      existing &&
      existingTime === eventTime &&
      statusPrecedence(event.status) <= statusPrecedence(existing.status)
    ) {
      outcome = event.status === existing.status ? "ignored-stale" : "ignored-regression";
    } else if (existing && !canAdvance(existing.status, event.status)) {
      outcome = "ignored-regression";
    }

    const processedAt = receivedAt.toISOString();
    const tracking: NpShopStoredTracking =
      outcome === "advanced"
        ? {
            contract: NP_SHOP_TRACKING_STORAGE_CONTRACT,
            orderId: event.orderId,
            shipmentId: event.shipmentId,
            providerId,
            bookingReference: event.bookingReference,
            trackingNumber: event.trackingNumber,
            status: event.status,
            latestEventId: event.eventId,
            occurredAt: event.occurredAt,
            deliveredAt: event.status === "delivered" ? event.occurredAt : null,
            updatedAt: processedAt,
            purgeAt: booking.purgeAt,
          }
        : (existing ??
          (() => {
            throw new NpShopTrackingContractError("Invalid initial tracking event", [
              "the first canonical tracking event must create durable state.",
            ]);
          })());
    if (outcome === "advanced") await persistTracking(tx, siteId, tracking);
    const receipt: NpShopStoredTrackingReceipt = {
      contract: NP_SHOP_TRACKING_RECEIPT_CONTRACT,
      providerId,
      event,
      eventDigest,
      outcome,
      trackingStatus: tracking.status,
      processedAt,
      purgeAt: booking.purgeAt,
    };
    await persistReceipt(tx, siteId, receipt);
    return {
      receipt,
      tracking: npProjectShopTracking(tracking),
      duplicate: false,
    };
  });
}

export async function npReadShopTrackingForOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<NpShopTracking | null> {
  const [row] = await db
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
        eq(npPluginStorage.key, npShopTrackingStorageKey(orderId)),
      ),
    )
    .limit(1);
  return row ? npProjectShopTracking(requireTrackingRow(row.value, row.expiresAt, row.key)) : null;
}

export async function npListRecentShopTrackingEvents(): Promise<{
  rows: NpShopAdminTrackingEventRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "tracking-event:%"),
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
    .limit(npShopTrackingLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(where);
  return {
    rows: rows.map((row) => {
      const receipt = requireReceiptRow(row.value, row.expiresAt, row.key);
      return {
        provider: receipt.providerId,
        eventId: receipt.event.eventId,
        shipmentId: receipt.event.shipmentId,
        orderId: receipt.event.orderId,
        status: receipt.event.status,
        outcome: receipt.outcome,
        occurredAt: receipt.event.occurredAt,
        processedAt: receipt.processedAt,
      };
    }),
    total,
  };
}

export async function npCountShopTrackingEvents(expectedProviderId?: string): Promise<{
  total: number;
  states: number;
  active: number;
  delivered: number;
  exceptions: number;
  invalidSample: number;
  orphanSample: number;
  providerMismatchSample: number;
  stateMismatchSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const eventWhere = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "tracking-event:%"),
  );
  const stateWhere = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "tracking:%"),
  );
  const [[eventCounts], [stateCounts], stateRows, eventRows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(npPluginStorage)
      .where(eventWhere),
    db
      .select({
        states: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' <> 'delivered')::int`,
        delivered: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'delivered')::int`,
        exceptions: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'exception')::int`,
      })
      .from(npPluginStorage)
      .where(stateWhere),
    db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(stateWhere)
      .orderBy(desc(npPluginStorage.updatedAt))
      .limit(npShopTrackingLimits.diagnosticSampleSize),
    db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(eventWhere)
      .orderBy(desc(npPluginStorage.updatedAt))
      .limit(npShopTrackingLimits.diagnosticSampleSize),
  ]);
  let invalidSample = 0;
  let orphanSample = 0;
  let providerMismatchSample = 0;
  let stateMismatchSample = 0;
  const bookingKeys: string[] = [];
  const states: NpShopStoredTracking[] = [];
  for (const row of stateRows) {
    try {
      const state = requireTrackingRow(row.value, row.expiresAt, row.key);
      states.push(state);
      bookingKeys.push(carrierBookingStorageKey(state.orderId));
      if (
        expectedProviderId &&
        state.status !== "delivered" &&
        state.providerId !== expectedProviderId
      ) {
        providerMismatchSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  const receipts: NpShopStoredTrackingReceipt[] = [];
  for (const row of eventRows) {
    try {
      const receipt = requireReceiptRow(row.value, row.expiresAt, row.key);
      receipts.push(receipt);
    } catch {
      invalidSample += 1;
    }
  }
  const receiptStateKeys = [
    ...new Set(receipts.map((receipt) => npShopTrackingStorageKey(receipt.event.orderId))),
  ];
  const receiptStateRows =
    receiptStateKeys.length === 0
      ? []
      : await db
          .select({ key: npPluginStorage.key })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              inArray(npPluginStorage.key, receiptStateKeys),
            ),
          );
  const receiptStateSet = new Set(receiptStateRows.map((row) => row.key));
  orphanSample += receipts.filter(
    (receipt) => !receiptStateSet.has(npShopTrackingStorageKey(receipt.event.orderId)),
  ).length;
  const bookingRows =
    bookingKeys.length === 0
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
              inArray(npPluginStorage.key, bookingKeys),
            ),
          );
  const bookings = new Map<string, NpShopStoredCarrierBooking>();
  for (const row of bookingRows) {
    try {
      const booking = requireBookingRow(row.value, row.expiresAt, row.key);
      bookings.set(booking.orderId, booking);
    } catch {
      invalidSample += 1;
    }
  }
  for (const state of states) {
    const booking = bookings.get(state.orderId);
    if (!booking) {
      orphanSample += 1;
    } else if (
      booking.status !== "completed" ||
      booking.id !== state.shipmentId ||
      booking.providerId !== state.providerId ||
      booking.bookingReference !== state.bookingReference ||
      booking.trackingNumber !== state.trackingNumber ||
      booking.purgeAt !== state.purgeAt
    ) {
      stateMismatchSample += 1;
    }
  }
  return {
    total: eventCounts.total,
    states: stateCounts.states,
    active: stateCounts.active,
    delivered: stateCounts.delivered,
    exceptions: stateCounts.exceptions,
    invalidSample,
    orphanSample,
    providerMismatchSample,
    stateMismatchSample,
  };
}
