import { createHash, randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, gt, inArray, like, sql } from "drizzle-orm";

import {
  npRequireStoredShopCarrierBooking,
  type NpShopCarrierTrackingPollAdapter,
  type NpShopStoredCarrierBooking,
} from "./carrier-contract.js";
import {
  npRequireStoredShopFulfillment,
  type NpShopStoredFulfillment,
} from "./fulfillment-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import {
  NP_SHOP_TRACKING_RECEIPT_CONTRACT,
  NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT,
  NP_SHOP_TRACKING_POLL_CURSOR_KEY,
  NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT,
  NP_SHOP_TRACKING_POLL_STORAGE_CONTRACT,
  NP_SHOP_TRACKING_STORAGE_CONTRACT,
  NpShopTrackingConflictError,
  NpShopTrackingContractError,
  npProjectShopTracking,
  npRequireShopTrackingPollCursor,
  npRequireShopTrackingPollRequest,
  npRequireShopTrackingPollResult,
  npRequireShopTrackingProviderId,
  npRequireStoredShopTracking,
  npRequireStoredShopTrackingPoll,
  npRequireStoredShopTrackingReceipt,
  npShopTrackingPollBackoffSeconds,
  npShopTrackingPollStorageKey,
  npShopTrackingEventDigest,
  npShopTrackingLimits,
  npShopTrackingReceiptStorageKey,
  npShopTrackingStorageKey,
  type NpShopStoredTracking,
  type NpShopStoredTrackingPoll,
  type NpShopStoredTrackingReceipt,
  type NpShopTracking,
  type NpShopTrackingReceiptOutcome,
  type NpShopTrackingPollCursor,
  type NpShopTrackingPollErrorCode,
  type NpShopTrackingPollRequest,
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

export interface NpShopAdminTrackingPollRow {
  [key: string]: unknown;
  id: string;
  shipmentId: string;
  provider: string;
  failures: number;
  lastAttemptAt: string;
  lastSuccessAt: string;
  nextAttemptAt: string;
  lastError: string;
  lease: string;
}

export interface NpShopTrackingReconcileResult {
  scanned: number;
  claimed: number;
  succeeded: number;
  advanced: number;
  unchanged: number;
  failed: number;
  skipped: number;
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

function requirePollRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredTrackingPoll {
  const poll = npRequireStoredShopTrackingPoll(value);
  if (
    key !== npShopTrackingPollStorageKey(poll.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== poll.purgeAt
  ) {
    throw new NpShopTrackingContractError("Invalid tracking poll storage metadata", [
      "tracking poll key and expiry must match its value.",
    ]);
  }
  return poll;
}

function requireCursorRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopTrackingPollCursor {
  const cursor = npRequireShopTrackingPollCursor(value);
  if (key !== NP_SHOP_TRACKING_POLL_CURSOR_KEY || expiresAt !== null) {
    throw new NpShopTrackingContractError("Invalid tracking poll cursor metadata", [
      "tracking poll cursor must use its fixed non-expiring storage key.",
    ]);
  }
  return cursor;
}

async function readExactRow(
  tx: NpShopTransaction | ReturnType<typeof getDb>,
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

async function persistPoll(
  tx: NpShopTransaction,
  siteId: string,
  poll: NpShopStoredTrackingPoll,
): Promise<void> {
  npRequireStoredShopTrackingPoll(poll);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopTrackingPollStorageKey(poll.orderId),
      value: poll,
      expiresAt: new Date(poll.purgeAt),
      updatedAt: new Date(poll.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: poll,
        expiresAt: new Date(poll.purgeAt),
        updatedAt: new Date(poll.updatedAt),
      },
    });
}

async function persistCursor(
  tx: NpShopTransaction,
  siteId: string,
  cursor: NpShopTrackingPollCursor,
): Promise<void> {
  npRequireShopTrackingPollCursor(cursor);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: NP_SHOP_TRACKING_POLL_CURSOR_KEY,
      value: cursor,
      expiresAt: null,
      updatedAt: new Date(cursor.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: { value: cursor, expiresAt: null, updatedAt: new Date(cursor.updatedAt) },
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

interface NpShopTrackingPollCandidate {
  booking: NpShopStoredCarrierBooking;
}

interface NpShopTrackingPollClaim {
  booking: NpShopStoredCarrierBooking;
  request: NpShopTrackingPollRequest;
  leaseId: string;
}

async function readPollCursor(siteId: string): Promise<NpShopTrackingPollCursor | null> {
  const [row] = await getDb()
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
        eq(npPluginStorage.key, NP_SHOP_TRACKING_POLL_CURSOR_KEY),
      ),
    )
    .limit(1);
  return row ? requireCursorRow(row.value, row.expiresAt, row.key) : null;
}

async function writePollCursor(
  siteId: string,
  providerId: string,
  lastBookingKey: string | null,
  now: Date,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-tracking-poll-cursor:${siteId}`}, 0))`,
    );
    await persistCursor(tx, siteId, {
      contract: NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT,
      providerId,
      lastBookingKey,
      updatedAt: now.toISOString(),
    });
  });
}

async function readPollCandidatePage(
  siteId: string,
  providerId: string,
  afterKey: string | null,
  limit: number,
  now: Date,
) {
  return getDb()
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
        like(npPluginStorage.key, "carrier-booking:%"),
        sql`${npPluginStorage.value}->>'status' = 'completed'`,
        sql`${npPluginStorage.value}->>'providerId' = ${providerId}`,
        gt(npPluginStorage.expiresAt, now),
        afterKey ? gt(npPluginStorage.key, afterKey) : undefined,
      ),
    )
    .orderBy(asc(npPluginStorage.key))
    .limit(limit);
}

async function filterDuePollCandidates(
  siteId: string,
  rows: Awaited<ReturnType<typeof readPollCandidatePage>>,
  providerId: string,
  now: Date,
): Promise<NpShopTrackingPollCandidate[]> {
  if (rows.length === 0) return [];
  const bookings = rows.map((row) => requireBookingRow(row.value, row.expiresAt, row.key));
  const supportKeys = bookings.flatMap((booking) => [
    npShopTrackingPollStorageKey(booking.orderId),
    npShopTrackingStorageKey(booking.orderId),
  ]);
  const supportRows = await getDb()
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
        inArray(npPluginStorage.key, supportKeys),
      ),
    );
  const support = new Map(supportRows.map((row) => [row.key, row]));
  const due: NpShopTrackingPollCandidate[] = [];
  for (const booking of bookings) {
    if (booking.providerId !== providerId || booking.status !== "completed") continue;
    const trackingRow = support.get(npShopTrackingStorageKey(booking.orderId));
    const tracking = trackingRow
      ? requireTrackingRow(trackingRow.value, trackingRow.expiresAt, trackingRow.key)
      : null;
    if (tracking?.status === "delivered") continue;
    if (
      tracking &&
      (tracking.shipmentId !== booking.id ||
        tracking.providerId !== booking.providerId ||
        tracking.bookingReference !== booking.bookingReference ||
        tracking.trackingNumber !== booking.trackingNumber ||
        tracking.purgeAt !== booking.purgeAt)
    ) {
      throw new NpShopTrackingContractError("Invalid tracking poll shipment state", [
        "tracking state must match its completed carrier booking.",
      ]);
    }
    const pollRow = support.get(npShopTrackingPollStorageKey(booking.orderId));
    const poll = pollRow ? requirePollRow(pollRow.value, pollRow.expiresAt, pollRow.key) : null;
    if (
      poll &&
      (poll.providerId !== booking.providerId ||
        poll.shipmentId !== booking.id ||
        poll.purgeAt !== booking.purgeAt)
    ) {
      throw new NpShopTrackingContractError("Invalid tracking poll booking state", [
        "tracking poll state must match its completed carrier booking.",
      ]);
    }
    if (
      poll &&
      ((poll.leaseExpiresAt !== null && new Date(poll.leaseExpiresAt) > now) ||
        new Date(poll.nextAttemptAt) > now)
    ) {
      continue;
    }
    due.push({ booking });
  }
  return due;
}

async function selectPollCandidates(
  siteId: string,
  providerId: string,
  now: Date,
): Promise<{ candidates: NpShopTrackingPollCandidate[]; scanned: number }> {
  const cursor = await readPollCursor(siteId);
  let afterKey = cursor?.providerId === providerId ? cursor.lastBookingKey : null;
  const startedAfterKey = afterKey;
  let wrapped = false;
  let scanned = 0;
  let lastBookingKey = afterKey;
  const seen = new Set<string>();
  const candidates: NpShopTrackingPollCandidate[] = [];
  while (
    scanned < npShopTrackingLimits.reconcileMaximumScanSize &&
    candidates.length < npShopTrackingLimits.reconcileBatchSize
  ) {
    const pageLimit = Math.min(
      npShopTrackingLimits.reconcileScanSize,
      npShopTrackingLimits.reconcileMaximumScanSize - scanned,
    );
    const rows = await readPollCandidatePage(siteId, providerId, afterKey, pageLimit, now);
    if (rows.length === 0) {
      if (wrapped || afterKey === null) {
        lastBookingKey = null;
        break;
      }
      afterKey = null;
      wrapped = true;
      continue;
    }
    const unseenRows = rows.filter((row) => !seen.has(row.key));
    for (const row of unseenRows) seen.add(row.key);
    scanned += unseenRows.length;
    lastBookingKey = rows.at(-1)?.key ?? lastBookingKey;
    afterKey = lastBookingKey;
    const due = await filterDuePollCandidates(siteId, unseenRows, providerId, now);
    candidates.push(...due.slice(0, npShopTrackingLimits.reconcileBatchSize - candidates.length));
    if (rows.length < pageLimit && !wrapped) {
      if (startedAfterKey === null) {
        lastBookingKey = null;
        break;
      }
      afterKey = null;
      wrapped = true;
    } else if (unseenRows.length === 0) {
      break;
    }
  }
  await writePollCursor(siteId, providerId, lastBookingKey, now);
  return { candidates, scanned };
}

async function claimTrackingPoll(
  siteId: string,
  adapter: NpShopCarrierTrackingPollAdapter,
  candidate: NpShopTrackingPollCandidate,
  options: { force: boolean; staffUserId?: string; expectedShipmentId?: string },
): Promise<NpShopTrackingPollClaim | null> {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const bookingRow = await readExactRow(
      tx,
      siteId,
      carrierBookingStorageKey(candidate.booking.orderId),
      true,
    );
    if (!bookingRow) return null;
    const booking = requireBookingRow(bookingRow.value, bookingRow.expiresAt, bookingRow.key);
    if (
      booking.status !== "completed" ||
      booking.providerId !== adapter.id ||
      booking.bookingReference === null ||
      booking.trackingNumber === null ||
      new Date(booking.purgeAt) <= now ||
      (options.expectedShipmentId !== undefined && booking.id !== options.expectedShipmentId)
    ) {
      return null;
    }
    const lookupRow = await readExactRow(tx, siteId, orderLookupStorageKey(booking.orderId), true);
    if (!lookupRow) return null;
    requireOrderLookupRow(
      lookupRow.value,
      lookupRow.expiresAt,
      lookupRow.key,
      booking.orderId,
      booking.purgeAt,
    );
    const fulfillmentRow = await readExactRow(
      tx,
      siteId,
      fulfillmentStorageKey(booking.orderId),
      true,
    );
    if (!fulfillmentRow) return null;
    const fulfillment = requireFulfillmentRow(
      fulfillmentRow.value,
      fulfillmentRow.expiresAt,
      fulfillmentRow.key,
    );
    if (
      fulfillment.status !== "shipped" ||
      fulfillment.privateDataStatus !== "redacted" ||
      fulfillment.trackingNumber !== booking.trackingNumber
    ) {
      return null;
    }
    const trackingRow = await readExactRow(
      tx,
      siteId,
      npShopTrackingStorageKey(booking.orderId),
      true,
    );
    const tracking = trackingRow
      ? requireTrackingRow(trackingRow.value, trackingRow.expiresAt, trackingRow.key)
      : null;
    if (tracking?.status === "delivered") return null;
    if (
      tracking &&
      (tracking.shipmentId !== booking.id ||
        tracking.providerId !== booking.providerId ||
        tracking.bookingReference !== booking.bookingReference ||
        tracking.trackingNumber !== booking.trackingNumber)
    ) {
      return null;
    }
    const pollKey = npShopTrackingPollStorageKey(booking.orderId);
    const pollRow = await readExactRow(tx, siteId, pollKey, true);
    const existing = pollRow ? requirePollRow(pollRow.value, pollRow.expiresAt, pollRow.key) : null;
    if (
      existing &&
      (existing.providerId !== booking.providerId ||
        existing.shipmentId !== booking.id ||
        existing.purgeAt !== booking.purgeAt)
    ) {
      return null;
    }
    if (existing?.leaseExpiresAt && new Date(existing.leaseExpiresAt) > now) {
      return null;
    }
    if (!options.force && existing && new Date(existing.nextAttemptAt) > now) return null;
    const leaseId = randomUUID();
    const requestedAt = now.toISOString();
    const leaseExpiresAt = new Date(
      now.getTime() + npShopTrackingLimits.pollLeaseSeconds * 1_000,
    ).toISOString();
    const poll: NpShopStoredTrackingPoll = {
      contract: NP_SHOP_TRACKING_POLL_STORAGE_CONTRACT,
      orderId: booking.orderId,
      shipmentId: booking.id,
      providerId: booking.providerId,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      lastAttemptAt: requestedAt,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      nextAttemptAt: leaseExpiresAt,
      lastErrorCode: existing?.lastErrorCode ?? null,
      leaseId,
      leaseExpiresAt,
      updatedAt: requestedAt,
      purgeAt: booking.purgeAt,
    };
    await persistPoll(tx, siteId, poll);
    if (options.staffUserId) {
      await tx.insert(npAuditEvents).values({
        actorKind: "staff",
        actorUserId: options.staffUserId,
        actorMemberId: null,
        action: "shop.carrier.tracking.poll",
        targetType: "shop-order",
        targetId: booking.orderId,
        payload: { shipmentId: booking.id, providerId: booking.providerId },
        siteId,
      });
    }
    return {
      booking,
      leaseId,
      request: npRequireShopTrackingPollRequest({
        contract: NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT,
        shipmentId: booking.id,
        orderId: booking.orderId,
        bookingReference: booking.bookingReference,
        trackingNumber: booking.trackingNumber,
        current: tracking
          ? {
              eventId: tracking.latestEventId,
              status: tracking.status,
              occurredAt: tracking.occurredAt,
            }
          : null,
        requestedAt,
      }),
    };
  });
}

async function finishTrackingPoll(
  siteId: string,
  claim: NpShopTrackingPollClaim,
  result: { ok: true; delivered: boolean } | { ok: false; errorCode: NpShopTrackingPollErrorCode },
  finishedAt: Date,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const key = npShopTrackingPollStorageKey(claim.booking.orderId);
    const row = await readExactRow(tx, siteId, key, true);
    if (!row) return;
    const current = requirePollRow(row.value, row.expiresAt, row.key);
    if (current.leaseId !== claim.leaseId) return;
    if (result.ok) {
      await persistPoll(tx, siteId, {
        ...current,
        consecutiveFailures: 0,
        lastSuccessAt: finishedAt.toISOString(),
        nextAttemptAt: result.delivered
          ? current.purgeAt
          : new Date(
              finishedAt.getTime() + npShopTrackingLimits.pollIntervalSeconds * 1_000,
            ).toISOString(),
        lastErrorCode: null,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: finishedAt.toISOString(),
      });
      return;
    }
    const consecutiveFailures = Math.min(
      current.consecutiveFailures + 1,
      npShopTrackingLimits.maximumConsecutiveFailures,
    );
    await persistPoll(tx, siteId, {
      ...current,
      consecutiveFailures,
      nextAttemptAt: new Date(
        finishedAt.getTime() + npShopTrackingPollBackoffSeconds(consecutiveFailures) * 1_000,
      ).toISOString(),
      lastErrorCode: result.errorCode,
      leaseId: null,
      leaseExpiresAt: null,
      updatedAt: finishedAt.toISOString(),
    });
  });
}

async function runTrackingPoll(
  siteId: string,
  adapter: NpShopCarrierTrackingPollAdapter,
  candidate: NpShopTrackingPollCandidate,
  options: { force: boolean; staffUserId?: string; expectedShipmentId?: string },
): Promise<"advanced" | "unchanged" | "failed" | "skipped"> {
  const claim = await claimTrackingPoll(siteId, adapter, candidate, options);
  if (!claim) return "skipped";
  let rawResult: unknown;
  try {
    rawResult = await adapter.readTracking(claim.request);
  } catch {
    await finishTrackingPoll(siteId, claim, { ok: false, errorCode: "provider-error" }, new Date());
    return "failed";
  }
  const receivedAt = new Date();
  let result;
  try {
    result = npRequireShopTrackingPollResult(rawResult, { request: claim.request, receivedAt });
  } catch {
    await finishTrackingPoll(siteId, claim, { ok: false, errorCode: "invalid-result" }, receivedAt);
    return "failed";
  }
  if (result.event === null) {
    await finishTrackingPoll(siteId, claim, { ok: true, delivered: false }, receivedAt);
    return "unchanged";
  }
  try {
    const applied = await npApplyShopTrackingEvent(adapter.id, result.event, receivedAt);
    await finishTrackingPoll(
      siteId,
      claim,
      { ok: true, delivered: applied.tracking.status === "delivered" },
      receivedAt,
    );
    return !applied.duplicate && applied.receipt.outcome === "advanced" ? "advanced" : "unchanged";
  } catch {
    await finishTrackingPoll(siteId, claim, { ok: false, errorCode: "state-conflict" }, receivedAt);
    return "failed";
  }
}

export async function npReconcileShopTracking(
  adapter: NpShopCarrierTrackingPollAdapter,
  options: {
    orderId?: string;
    expectedShipmentId?: string;
    force?: boolean;
    staffUserId?: string;
  } = {},
): Promise<NpShopTrackingReconcileResult> {
  const providerId = npRequireShopTrackingProviderId(adapter.id);
  if (typeof adapter.readTracking !== "function") {
    throw new NpShopTrackingContractError("Invalid Shop tracking poll adapter", [
      "tracking poll adapter.readTracking must be a function.",
    ]);
  }
  const siteId = await requireSiteId();
  let candidates: NpShopTrackingPollCandidate[];
  let scanned: number;
  if (options.orderId) {
    const row = await readExactRow(
      getDb(),
      siteId,
      carrierBookingStorageKey(options.orderId),
      false,
    );
    if (!row) {
      throw new NpShopTrackingConflictError(
        "tracking_booking_not_found",
        "The tracking poll has no durable carrier booking.",
      );
    }
    candidates = [{ booking: requireBookingRow(row.value, row.expiresAt, row.key) }];
    scanned = 1;
  } else {
    ({ candidates, scanned } = await selectPollCandidates(siteId, providerId, new Date()));
  }
  const summary: NpShopTrackingReconcileResult = {
    scanned,
    claimed: 0,
    succeeded: 0,
    advanced: 0,
    unchanged: 0,
    failed: 0,
    skipped: 0,
  };
  for (const candidate of candidates) {
    const outcome = await runTrackingPoll(siteId, adapter, candidate, {
      force: options.force ?? false,
      staffUserId: options.staffUserId,
      expectedShipmentId: options.expectedShipmentId,
    });
    if (outcome === "skipped") {
      summary.skipped += 1;
      continue;
    }
    summary.claimed += 1;
    if (outcome === "failed") summary.failed += 1;
    else {
      summary.succeeded += 1;
      summary[outcome] += 1;
    }
  }
  return summary;
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

export async function npListShopTrackingPolls(): Promise<{
  rows: NpShopAdminTrackingPollRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "tracking-poll:%"),
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
  const now = new Date();
  return {
    rows: rows.map((row) => {
      const poll = requirePollRow(row.value, row.expiresAt, row.key);
      return {
        id: poll.orderId,
        shipmentId: poll.shipmentId,
        provider: poll.providerId,
        failures: poll.consecutiveFailures,
        lastAttemptAt: poll.lastAttemptAt ?? "—",
        lastSuccessAt: poll.lastSuccessAt ?? "—",
        nextAttemptAt: poll.nextAttemptAt,
        lastError: poll.lastErrorCode ?? "—",
        lease:
          poll.leaseExpiresAt === null
            ? "—"
            : new Date(poll.leaseExpiresAt) > now
              ? "active"
              : "expired",
      };
    }),
    total,
  };
}

export async function npCountShopTrackingPolls(expectedProviderId?: string): Promise<{
  total: number;
  due: number;
  failed: number;
  leased: number;
  expiredLeases: number;
  invalidSample: number;
  orphanSample: number;
  providerMismatchSample: number;
  stateMismatchSample: number;
  unpolledBookingSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const pollWhere = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "tracking-poll:%"),
  );
  const [[counts], pollRows, bookingRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        due: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'nextAttemptAt' <= ${nowIso} and (${npPluginStorage.value}->>'leaseExpiresAt' is null or ${npPluginStorage.value}->>'leaseExpiresAt' <= ${nowIso}))::int`,
        failed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'consecutiveFailures' <> '0')::int`,
        leased: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'leaseExpiresAt' > ${nowIso})::int`,
        expiredLeases: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'leaseExpiresAt' is not null and ${npPluginStorage.value}->>'leaseExpiresAt' <= ${nowIso})::int`,
      })
      .from(npPluginStorage)
      .where(pollWhere),
    db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(pollWhere)
      .orderBy(desc(npPluginStorage.updatedAt))
      .limit(npShopTrackingLimits.diagnosticSampleSize),
    db
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
          like(npPluginStorage.key, "carrier-booking:%"),
          sql`${npPluginStorage.value}->>'status' = 'completed'`,
          expectedProviderId
            ? sql`${npPluginStorage.value}->>'providerId' = ${expectedProviderId}`
            : undefined,
        ),
      )
      .orderBy(desc(npPluginStorage.updatedAt))
      .limit(npShopTrackingLimits.diagnosticSampleSize),
  ]);
  let invalidSample = 0;
  let orphanSample = 0;
  let providerMismatchSample = 0;
  let stateMismatchSample = 0;
  const polls: NpShopStoredTrackingPoll[] = [];
  for (const row of pollRows) {
    try {
      const poll = requirePollRow(row.value, row.expiresAt, row.key);
      polls.push(poll);
    } catch {
      invalidSample += 1;
    }
  }
  const pollSupportKeys = polls.flatMap((poll) => [
    carrierBookingStorageKey(poll.orderId),
    npShopTrackingStorageKey(poll.orderId),
  ]);
  const linkedSupportRows =
    pollSupportKeys.length === 0
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
              inArray(npPluginStorage.key, pollSupportKeys),
            ),
          );
  const linkedBookings = new Map<string, NpShopStoredCarrierBooking>();
  const linkedTracking = new Map<string, NpShopStoredTracking>();
  for (const row of linkedSupportRows) {
    try {
      if (row.key.startsWith("carrier-booking:")) {
        const booking = requireBookingRow(row.value, row.expiresAt, row.key);
        linkedBookings.set(booking.orderId, booking);
      } else {
        const tracking = requireTrackingRow(row.value, row.expiresAt, row.key);
        linkedTracking.set(tracking.orderId, tracking);
      }
    } catch {
      invalidSample += 1;
    }
  }
  for (const poll of polls) {
    const booking = linkedBookings.get(poll.orderId);
    const tracking = linkedTracking.get(poll.orderId);
    if (
      expectedProviderId &&
      poll.providerId !== expectedProviderId &&
      tracking?.status !== "delivered"
    ) {
      providerMismatchSample += 1;
    }
    if (!booking) orphanSample += 1;
    else if (
      booking.status !== "completed" ||
      booking.id !== poll.shipmentId ||
      booking.providerId !== poll.providerId ||
      booking.purgeAt !== poll.purgeAt
    ) {
      stateMismatchSample += 1;
    }
  }
  const completedBookings: NpShopStoredCarrierBooking[] = [];
  for (const row of bookingRows) {
    try {
      completedBookings.push(requireBookingRow(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  const supportKeys = completedBookings.flatMap((booking) => [
    npShopTrackingPollStorageKey(booking.orderId),
    npShopTrackingStorageKey(booking.orderId),
  ]);
  const supportRows =
    supportKeys.length === 0
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
              inArray(npPluginStorage.key, supportKeys),
            ),
          );
  const support = new Map(supportRows.map((row) => [row.key, row]));
  let unpolledBookingSample = 0;
  for (const booking of completedBookings) {
    if (support.has(npShopTrackingPollStorageKey(booking.orderId))) continue;
    const trackingRow = support.get(npShopTrackingStorageKey(booking.orderId));
    try {
      const tracking = trackingRow
        ? requireTrackingRow(trackingRow.value, trackingRow.expiresAt, trackingRow.key)
        : null;
      if (tracking?.status !== "delivered") unpolledBookingSample += 1;
    } catch {
      invalidSample += 1;
    }
  }
  return {
    ...counts,
    invalidSample,
    orphanSample,
    providerMismatchSample,
    stateMismatchSample,
    unpolledBookingSample,
  };
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
