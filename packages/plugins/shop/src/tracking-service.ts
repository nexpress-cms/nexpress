import { createHash, randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, gt, inArray, like, or, sql } from "drizzle-orm";

import {
  npRequireStoredShopCarrierBooking,
  type NpShopCarrierTrackingPollAdapter,
  type NpShopStoredCarrierBooking,
} from "./carrier-contract.js";
import {
  npRequireStoredShopFulfillment,
  type NpShopStoredFulfillment,
} from "./fulfillment-contract.js";
import {
  npRequireStoredShopExchangeCarrierBooking,
  type NpShopStoredExchangeCarrierBooking,
} from "./exchange-carrier-contract.js";
import { npRequireStoredShopExchange, type NpShopStoredExchange } from "./exchange-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import { npStageShopOrderNotification } from "./order-notification-service.js";
import { npRequireStoredShopOrder } from "./order-contract.js";
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
  npShopExchangeTrackingPollStorageKey,
  npShopExchangeTrackingStorageKey,
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
  shipment: string;
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
  shipment: string;
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

function exchangeCarrierBookingStorageKey(orderId: string): string {
  return `exchange-carrier-booking:${orderId}`;
}

function exchangeStorageKey(orderId: string): string {
  return `exchange:${orderId}`;
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
): string {
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
  return candidate.ownerSegment;
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

function requireExchangeBookingRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredExchangeCarrierBooking {
  const booking = npRequireStoredShopExchangeCarrierBooking(value);
  if (
    key !== exchangeCarrierBookingStorageKey(booking.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== booking.purgeAt
  ) {
    throw new NpShopTrackingContractError("Invalid exchange carrier booking metadata", [
      "exchange carrier booking key and expiry must match its value.",
    ]);
  }
  return booking;
}

function requireExchangeRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredExchange {
  const exchange = npRequireStoredShopExchange(value);
  if (
    key !== exchangeStorageKey(exchange.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== exchange.purgeAt
  ) {
    throw new NpShopTrackingContractError("Invalid exchange storage metadata", [
      "exchange key and expiry must match its value.",
    ]);
  }
  return exchange;
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
  shipment: "outbound" | "exchange" = "outbound",
): NpShopStoredTracking {
  const tracking = npRequireStoredShopTracking(value);
  if (
    key !==
      (shipment === "exchange"
        ? npShopExchangeTrackingStorageKey(tracking.orderId)
        : npShopTrackingStorageKey(tracking.orderId)) ||
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
  shipment: "outbound" | "exchange" = "outbound",
): NpShopStoredTrackingPoll {
  const poll = npRequireStoredShopTrackingPoll(value);
  if (
    key !==
      (shipment === "exchange"
        ? npShopExchangeTrackingPollStorageKey(poll.orderId)
        : npShopTrackingPollStorageKey(poll.orderId)) ||
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
  shipment: "outbound" | "exchange" = "outbound",
): Promise<void> {
  npRequireStoredShopTracking(tracking);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key:
        shipment === "exchange"
          ? npShopExchangeTrackingStorageKey(tracking.orderId)
          : npShopTrackingStorageKey(tracking.orderId),
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
  shipment: "outbound" | "exchange" = "outbound",
): Promise<void> {
  npRequireStoredShopTrackingPoll(poll);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key:
        shipment === "exchange"
          ? npShopExchangeTrackingPollStorageKey(poll.orderId)
          : npShopTrackingPollStorageKey(poll.orderId),
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

function exchangeBookingMatchesExchange(
  booking: NpShopStoredExchangeCarrierBooking,
  exchange: NpShopStoredExchange,
): boolean {
  return (
    booking.status === "completed" &&
    booking.completedExchangeRevision !== null &&
    booking.carrier !== null &&
    booking.trackingNumber !== null &&
    exchange.id === booking.exchangeId &&
    exchange.purgeAt === booking.purgeAt &&
    exchange.carrier === booking.carrier &&
    exchange.trackingNumber === booking.trackingNumber &&
    ((exchange.status === "processing" &&
      exchange.revision === booking.completedExchangeRevision) ||
      (exchange.status === "shipped" &&
        exchange.revision === booking.completedExchangeRevision + 1))
  );
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
      const outboundStateRow = await readExactRow(
        tx,
        siteId,
        npShopTrackingStorageKey(event.orderId),
        true,
      );
      const exchangeStateRow = await readExactRow(
        tx,
        siteId,
        npShopExchangeTrackingStorageKey(event.orderId),
        true,
      );
      const matchingStates = [
        outboundStateRow
          ? {
              shipment: "outbound" as const,
              state: requireTrackingRow(
                outboundStateRow.value,
                outboundStateRow.expiresAt,
                outboundStateRow.key,
              ),
            }
          : null,
        exchangeStateRow
          ? {
              shipment: "exchange" as const,
              state: requireTrackingRow(
                exchangeStateRow.value,
                exchangeStateRow.expiresAt,
                exchangeStateRow.key,
                "exchange",
              ),
            }
          : null,
      ].filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== null && candidate.state.shipmentId === event.shipmentId,
      );
      if (matchingStates.length !== 1) {
        throw new NpShopTrackingConflictError(
          "tracking_booking_not_found",
          "The duplicate tracking event no longer has its durable state.",
        );
      }
      return {
        receipt,
        tracking: npProjectShopTracking(matchingStates[0].state),
        duplicate: true,
      };
    }

    const exchangeBookingCandidateRow = await readExactRow(
      tx,
      siteId,
      exchangeCarrierBookingStorageKey(event.orderId),
      false,
    );
    const exchangeBookingCandidate = exchangeBookingCandidateRow
      ? requireExchangeBookingRow(
          exchangeBookingCandidateRow.value,
          exchangeBookingCandidateRow.expiresAt,
          exchangeBookingCandidateRow.key,
        )
      : null;
    const outboundBookingCandidateRow = await readExactRow(
      tx,
      siteId,
      carrierBookingStorageKey(event.orderId),
      false,
    );
    const outboundBookingCandidate = outboundBookingCandidateRow
      ? requireBookingRow(
          outboundBookingCandidateRow.value,
          outboundBookingCandidateRow.expiresAt,
          outboundBookingCandidateRow.key,
        )
      : null;
    const outboundMatches =
      outboundBookingCandidate?.status === "completed" &&
      outboundBookingCandidate.id === event.shipmentId &&
      outboundBookingCandidate.bookingReference === event.bookingReference &&
      outboundBookingCandidate.trackingNumber === event.trackingNumber;
    const exchangeMatches =
      exchangeBookingCandidate?.status === "completed" &&
      exchangeBookingCandidate.id === event.shipmentId &&
      exchangeBookingCandidate.bookingReference === event.bookingReference &&
      exchangeBookingCandidate.trackingNumber === event.trackingNumber;
    if (Number(outboundMatches) + Number(exchangeMatches) !== 1) {
      throw new NpShopTrackingConflictError(
        "tracking_booking_not_found",
        "The tracking event must match exactly one durable carrier booking.",
      );
    }
    const shipment = exchangeMatches ? "exchange" : "outbound";
    const candidateBooking = exchangeMatches ? exchangeBookingCandidate : outboundBookingCandidate;
    if (!candidateBooking) {
      throw new NpShopTrackingConflictError(
        "tracking_booking_not_found",
        "The tracking event lost its resolved carrier booking.",
      );
    }
    let ownerSegmentForLock: string;
    if (shipment === "exchange") {
      const exchangeCandidateRow = await readExactRow(
        tx,
        siteId,
        exchangeStorageKey(event.orderId),
        false,
      );
      if (!exchangeCandidateRow) {
        throw new NpShopTrackingConflictError(
          "tracking_booking_not_found",
          "The replacement tracking event has no retained exchange.",
        );
      }
      ownerSegmentForLock = requireExchangeRow(
        exchangeCandidateRow.value,
        exchangeCandidateRow.expiresAt,
        exchangeCandidateRow.key,
      ).ownerSegment;
    } else {
      const lookupCandidateRow = await readExactRow(
        tx,
        siteId,
        orderLookupStorageKey(event.orderId),
        false,
      );
      if (!lookupCandidateRow) {
        throw new NpShopTrackingConflictError(
          "tracking_booking_not_found",
          "The outbound tracking event has no retained order lookup.",
        );
      }
      ownerSegmentForLock = requireOrderLookupRow(
        lookupCandidateRow.value,
        lookupCandidateRow.expiresAt,
        lookupCandidateRow.key,
        event.orderId,
        candidateBooking.purgeAt,
      );
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order:${siteId}:${ownerSegmentForLock}:${event.orderId}`}, 0))`,
    );
    let exchange: NpShopStoredExchange | null = null;
    let booking: NpShopStoredCarrierBooking | NpShopStoredExchangeCarrierBooking;
    if (shipment === "exchange") {
      const exchangeRow = await readExactRow(tx, siteId, exchangeStorageKey(event.orderId), true);
      const exchangeBookingRow = await readExactRow(
        tx,
        siteId,
        exchangeCarrierBookingStorageKey(event.orderId),
        true,
      );
      if (!exchangeRow || !exchangeBookingRow) {
        throw new NpShopTrackingConflictError(
          "tracking_booking_not_found",
          "The replacement tracking event lost its durable booking.",
        );
      }
      exchange = requireExchangeRow(exchangeRow.value, exchangeRow.expiresAt, exchangeRow.key);
      booking = requireExchangeBookingRow(
        exchangeBookingRow.value,
        exchangeBookingRow.expiresAt,
        exchangeBookingRow.key,
      );
    } else {
      const outboundBookingRow = await readExactRow(
        tx,
        siteId,
        carrierBookingStorageKey(event.orderId),
        true,
      );
      if (!outboundBookingRow) {
        throw new NpShopTrackingConflictError(
          "tracking_booking_not_found",
          "The outbound tracking event lost its durable booking.",
        );
      }
      booking = requireBookingRow(
        outboundBookingRow.value,
        outboundBookingRow.expiresAt,
        outboundBookingRow.key,
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
        "The tracking event changed while its exact booking was being locked.",
      );
    }
    if (new Date(booking.purgeAt) <= receivedAt) {
      throw new NpShopTrackingConflictError(
        "tracking_shipment_expired",
        "The carrier shipment is past its commercial retention window.",
      );
    }
    let order: ReturnType<typeof npRequireStoredShopOrder> | null = null;
    if (shipment === "outbound") {
      const lookupRow = await readExactRow(tx, siteId, orderLookupStorageKey(event.orderId), true);
      if (!lookupRow) {
        throw new NpShopTrackingConflictError(
          "tracking_booking_not_found",
          "The tracking event has no retained commercial order.",
        );
      }
      const ownerSegment = requireOrderLookupRow(
        lookupRow.value,
        lookupRow.expiresAt,
        lookupRow.key,
        event.orderId,
        booking.purgeAt,
      );
      const orderRow = await readExactRow(
        tx,
        siteId,
        `order:${ownerSegment}:${event.orderId}`,
        true,
      );
      if (!orderRow) {
        throw new NpShopTrackingConflictError(
          "tracking_booking_not_found",
          "The tracking event has no retained commercial order.",
        );
      }
      order = npRequireStoredShopOrder(orderRow.value);
      if (
        orderRow.expiresAt === null ||
        orderRow.expiresAt.toISOString() !== order.purgeAt ||
        order.id !== event.orderId ||
        order.ownerSegment !== ownerSegment ||
        order.purgeAt !== booking.purgeAt
      ) {
        throw new NpShopTrackingContractError("Invalid tracking order storage", [
          "tracking order must exactly match its lookup and shipment retention.",
        ]);
      }
      const fulfillmentRow = await readExactRow(
        tx,
        siteId,
        fulfillmentStorageKey(event.orderId),
        true,
      );
      const fulfillment = fulfillmentRow
        ? requireFulfillmentRow(fulfillmentRow.value, fulfillmentRow.expiresAt, fulfillmentRow.key)
        : null;
      if (
        !fulfillment ||
        fulfillment.status !== "shipped" ||
        fulfillment.carrier !== booking.carrier ||
        fulfillment.trackingNumber !== event.trackingNumber ||
        fulfillment.privateDataStatus !== "redacted" ||
        fulfillment.purgeAt !== booking.purgeAt
      ) {
        throw new NpShopTrackingConflictError(
          "tracking_fulfillment_mismatch",
          "The tracking event does not match one redacted shipped fulfillment.",
        );
      }
    } else if (
      !exchange ||
      !exchangeBookingMatchesExchange(booking as NpShopStoredExchangeCarrierBooking, exchange)
    ) {
      throw new NpShopTrackingConflictError(
        "tracking_fulfillment_mismatch",
        "The tracking event does not match one active replacement shipment.",
      );
    }

    const stateKey =
      shipment === "exchange"
        ? npShopExchangeTrackingStorageKey(event.orderId)
        : npShopTrackingStorageKey(event.orderId);
    const stateRow = await readExactRow(tx, siteId, stateKey, true);
    const existing = stateRow
      ? requireTrackingRow(stateRow.value, stateRow.expiresAt, stateRow.key, shipment)
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
    if (existing?.status === "delivered") {
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
    if (outcome === "advanced") {
      await persistTracking(tx, siteId, tracking, shipment);
      if (event.status === "delivered" && shipment === "outbound" && order) {
        await npStageShopOrderNotification(tx, siteId, {
          orderId: order.id,
          ownerSegment: order.ownerSegment,
          kind: "delivery.delivered",
          orderRevision: order.revision,
          occurredAt: event.occurredAt,
          purgeAt: order.purgeAt,
          email: null,
        });
      } else if (event.status === "delivered" && shipment === "exchange" && exchange) {
        await npStageShopOrderNotification(tx, siteId, {
          orderId: exchange.orderId,
          ownerSegment: exchange.ownerSegment,
          kind: "exchange.delivered",
          orderRevision: exchange.orderRevision,
          occurredAt: event.occurredAt,
          purgeAt: exchange.purgeAt,
          email: null,
        });
      }
    }
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
  shipment: "outbound" | "exchange";
  booking: NpShopStoredCarrierBooking | NpShopStoredExchangeCarrierBooking;
}

interface NpShopTrackingPollClaim {
  shipment: "outbound" | "exchange";
  booking: NpShopStoredCarrierBooking | NpShopStoredExchangeCarrierBooking;
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
        or(
          like(npPluginStorage.key, "carrier-booking:%"),
          like(npPluginStorage.key, "exchange-carrier-booking:%"),
        ),
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
  const candidates = rows.map((row) =>
    row.key.startsWith("exchange-carrier-booking:")
      ? ({
          shipment: "exchange" as const,
          booking: requireExchangeBookingRow(row.value, row.expiresAt, row.key),
        } satisfies NpShopTrackingPollCandidate)
      : ({
          shipment: "outbound" as const,
          booking: requireBookingRow(row.value, row.expiresAt, row.key),
        } satisfies NpShopTrackingPollCandidate),
  );
  const supportKeys = candidates.flatMap(({ booking, shipment }) => [
    shipment === "exchange"
      ? npShopExchangeTrackingPollStorageKey(booking.orderId)
      : npShopTrackingPollStorageKey(booking.orderId),
    shipment === "exchange"
      ? npShopExchangeTrackingStorageKey(booking.orderId)
      : npShopTrackingStorageKey(booking.orderId),
    ...(shipment === "exchange"
      ? [exchangeStorageKey(booking.orderId)]
      : [fulfillmentStorageKey(booking.orderId)]),
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
  for (const candidate of candidates) {
    const { booking, shipment } = candidate;
    if (booking.providerId !== providerId || booking.status !== "completed") continue;
    const trackingKey =
      shipment === "exchange"
        ? npShopExchangeTrackingStorageKey(booking.orderId)
        : npShopTrackingStorageKey(booking.orderId);
    const trackingRow = support.get(trackingKey);
    const tracking = trackingRow
      ? requireTrackingRow(trackingRow.value, trackingRow.expiresAt, trackingRow.key, shipment)
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
    const pollKey =
      shipment === "exchange"
        ? npShopExchangeTrackingPollStorageKey(booking.orderId)
        : npShopTrackingPollStorageKey(booking.orderId);
    const pollRow = support.get(pollKey);
    const poll = pollRow
      ? requirePollRow(pollRow.value, pollRow.expiresAt, pollRow.key, shipment)
      : null;
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
    const commercialRow = support.get(
      shipment === "exchange"
        ? exchangeStorageKey(booking.orderId)
        : fulfillmentStorageKey(booking.orderId),
    );
    if (!commercialRow) continue;
    if (shipment === "exchange") {
      const exchange = requireExchangeRow(
        commercialRow.value,
        commercialRow.expiresAt,
        commercialRow.key,
      );
      const exchangeBooking = booking;
      if (!exchangeBookingMatchesExchange(exchangeBooking, exchange)) continue;
    } else {
      const fulfillment = requireFulfillmentRow(
        commercialRow.value,
        commercialRow.expiresAt,
        commercialRow.key,
      );
      if (
        fulfillment.status !== "shipped" ||
        fulfillment.privateDataStatus !== "redacted" ||
        fulfillment.carrier !== booking.carrier ||
        fulfillment.trackingNumber !== booking.trackingNumber
      )
        continue;
    }
    due.push(candidate);
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
    const shipment = candidate.shipment;
    const exchangeRow =
      shipment === "exchange"
        ? await readExactRow(tx, siteId, exchangeStorageKey(candidate.booking.orderId), true)
        : null;
    const bookingRow = await readExactRow(
      tx,
      siteId,
      shipment === "exchange"
        ? exchangeCarrierBookingStorageKey(candidate.booking.orderId)
        : carrierBookingStorageKey(candidate.booking.orderId),
      true,
    );
    if (!bookingRow) return null;
    const booking =
      shipment === "exchange"
        ? requireExchangeBookingRow(bookingRow.value, bookingRow.expiresAt, bookingRow.key)
        : requireBookingRow(bookingRow.value, bookingRow.expiresAt, bookingRow.key);
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
    if (shipment === "exchange") {
      if (!exchangeRow) return null;
      const exchange = requireExchangeRow(
        exchangeRow.value,
        exchangeRow.expiresAt,
        exchangeRow.key,
      );
      const exchangeBooking = booking as NpShopStoredExchangeCarrierBooking;
      if (!exchangeBookingMatchesExchange(exchangeBooking, exchange)) return null;
    } else {
      const lookupRow = await readExactRow(
        tx,
        siteId,
        orderLookupStorageKey(booking.orderId),
        true,
      );
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
        fulfillment.carrier !== booking.carrier ||
        fulfillment.privateDataStatus !== "redacted" ||
        fulfillment.trackingNumber !== booking.trackingNumber ||
        fulfillment.purgeAt !== booking.purgeAt
      )
        return null;
    }
    const trackingRow = await readExactRow(
      tx,
      siteId,
      shipment === "exchange"
        ? npShopExchangeTrackingStorageKey(booking.orderId)
        : npShopTrackingStorageKey(booking.orderId),
      true,
    );
    const tracking = trackingRow
      ? requireTrackingRow(trackingRow.value, trackingRow.expiresAt, trackingRow.key, shipment)
      : null;
    if (tracking?.status === "delivered") return null;
    if (
      tracking &&
      (tracking.shipmentId !== booking.id ||
        tracking.providerId !== booking.providerId ||
        tracking.bookingReference !== booking.bookingReference ||
        tracking.trackingNumber !== booking.trackingNumber ||
        tracking.purgeAt !== booking.purgeAt)
    ) {
      return null;
    }
    const pollKey =
      shipment === "exchange"
        ? npShopExchangeTrackingPollStorageKey(booking.orderId)
        : npShopTrackingPollStorageKey(booking.orderId);
    const pollRow = await readExactRow(tx, siteId, pollKey, true);
    const existing = pollRow
      ? requirePollRow(pollRow.value, pollRow.expiresAt, pollRow.key, shipment)
      : null;
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
    await persistPoll(tx, siteId, poll, shipment);
    if (options.staffUserId) {
      await tx.insert(npAuditEvents).values({
        actorKind: "staff",
        actorUserId: options.staffUserId,
        actorMemberId: null,
        action:
          shipment === "exchange"
            ? "shop.exchange.carrier.tracking.poll"
            : "shop.carrier.tracking.poll",
        targetType: "shop-order",
        targetId: booking.orderId,
        payload: {
          shipment: shipment,
          shipmentId: booking.id,
          providerId: booking.providerId,
        },
        siteId,
      });
    }
    return {
      shipment,
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
    const key =
      claim.shipment === "exchange"
        ? npShopExchangeTrackingPollStorageKey(claim.booking.orderId)
        : npShopTrackingPollStorageKey(claim.booking.orderId);
    const row = await readExactRow(tx, siteId, key, true);
    if (!row) return;
    const current = requirePollRow(row.value, row.expiresAt, row.key, claim.shipment);
    if (current.leaseId !== claim.leaseId) return;
    if (result.ok) {
      await persistPoll(
        tx,
        siteId,
        {
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
        },
        claim.shipment,
      );
      return;
    }
    const consecutiveFailures = Math.min(
      current.consecutiveFailures + 1,
      npShopTrackingLimits.maximumConsecutiveFailures,
    );
    await persistPoll(
      tx,
      siteId,
      {
        ...current,
        consecutiveFailures,
        nextAttemptAt: new Date(
          finishedAt.getTime() + npShopTrackingPollBackoffSeconds(consecutiveFailures) * 1_000,
        ).toISOString(),
        lastErrorCode: result.errorCode,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: finishedAt.toISOString(),
      },
      claim.shipment,
    );
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
    const rows = await Promise.all([
      readExactRow(getDb(), siteId, carrierBookingStorageKey(options.orderId), false),
      readExactRow(getDb(), siteId, exchangeCarrierBookingStorageKey(options.orderId), false),
    ]);
    candidates = rows.flatMap((row, index) => {
      if (!row) return [];
      const candidate =
        index === 1
          ? ({
              shipment: "exchange" as const,
              booking: requireExchangeBookingRow(row.value, row.expiresAt, row.key),
            } satisfies NpShopTrackingPollCandidate)
          : ({
              shipment: "outbound" as const,
              booking: requireBookingRow(row.value, row.expiresAt, row.key),
            } satisfies NpShopTrackingPollCandidate);
      return options.expectedShipmentId && candidate.booking.id !== options.expectedShipmentId
        ? []
        : [candidate];
    });
    if (candidates.length !== 1) {
      throw new NpShopTrackingConflictError(
        "tracking_booking_not_found",
        "The tracking poll must identify exactly one durable carrier booking.",
      );
    }
    scanned = rows.filter(Boolean).length;
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

export async function npReadShopExchangeTrackingForOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopTracking | null> {
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
        eq(npPluginStorage.key, npShopExchangeTrackingStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row
    ? npProjectShopTracking(requireTrackingRow(row.value, row.expiresAt, row.key, "exchange"))
    : null;
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
    or(
      like(npPluginStorage.key, "tracking-poll:%"),
      like(npPluginStorage.key, "exchange-tracking-poll:%"),
    ),
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
      const shipment = row.key.startsWith("exchange-tracking-poll:")
        ? ("exchange" as const)
        : ("outbound" as const);
      const poll = requirePollRow(row.value, row.expiresAt, row.key, shipment);
      return {
        id: poll.orderId,
        shipmentId: poll.shipmentId,
        shipment,
        provider: poll.providerId,
        failures: poll.consecutiveFailures,
        lastAttemptAt: poll.lastAttemptAt,
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
    or(
      like(npPluginStorage.key, "tracking-poll:%"),
      like(npPluginStorage.key, "exchange-tracking-poll:%"),
    ),
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
          or(
            like(npPluginStorage.key, "carrier-booking:%"),
            like(npPluginStorage.key, "exchange-carrier-booking:%"),
          ),
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
  const polls: Array<{
    shipment: "outbound" | "exchange";
    poll: NpShopStoredTrackingPoll;
  }> = [];
  for (const row of pollRows) {
    try {
      const shipment = row.key.startsWith("exchange-tracking-poll:")
        ? ("exchange" as const)
        : ("outbound" as const);
      polls.push({ shipment, poll: requirePollRow(row.value, row.expiresAt, row.key, shipment) });
    } catch {
      invalidSample += 1;
    }
  }
  const pollSupportKeys = polls.flatMap(({ shipment, poll }) => [
    shipment === "exchange"
      ? exchangeCarrierBookingStorageKey(poll.orderId)
      : carrierBookingStorageKey(poll.orderId),
    shipment === "exchange"
      ? npShopExchangeTrackingStorageKey(poll.orderId)
      : npShopTrackingStorageKey(poll.orderId),
    shipment === "exchange"
      ? exchangeStorageKey(poll.orderId)
      : fulfillmentStorageKey(poll.orderId),
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
  const linkedBookings = new Map<
    string,
    NpShopStoredCarrierBooking | NpShopStoredExchangeCarrierBooking
  >();
  const linkedTracking = new Map<string, NpShopStoredTracking>();
  const linkedCommercial = new Map<string, NpShopStoredExchange | NpShopStoredFulfillment>();
  for (const row of linkedSupportRows) {
    try {
      if (row.key.startsWith("exchange:")) {
        const exchange = requireExchangeRow(row.value, row.expiresAt, row.key);
        linkedCommercial.set(`exchange:${exchange.orderId}`, exchange);
      } else if (row.key.startsWith("fulfillment:")) {
        const fulfillment = requireFulfillmentRow(row.value, row.expiresAt, row.key);
        linkedCommercial.set(`outbound:${fulfillment.orderId}`, fulfillment);
      } else if (row.key.startsWith("exchange-carrier-booking:")) {
        const booking = requireExchangeBookingRow(row.value, row.expiresAt, row.key);
        linkedBookings.set(`exchange:${booking.orderId}`, booking);
      } else if (row.key.startsWith("carrier-booking:")) {
        const booking = requireBookingRow(row.value, row.expiresAt, row.key);
        linkedBookings.set(`outbound:${booking.orderId}`, booking);
      } else {
        const shipment = row.key.startsWith("exchange-tracking:") ? "exchange" : "outbound";
        const tracking = requireTrackingRow(row.value, row.expiresAt, row.key, shipment);
        linkedTracking.set(`${shipment}:${tracking.orderId}`, tracking);
      }
    } catch {
      invalidSample += 1;
    }
  }
  for (const { shipment, poll } of polls) {
    const booking = linkedBookings.get(`${shipment}:${poll.orderId}`);
    const tracking = linkedTracking.get(`${shipment}:${poll.orderId}`);
    const commercial = linkedCommercial.get(`${shipment}:${poll.orderId}`);
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
    } else if (!commercial) {
      stateMismatchSample += 1;
    } else if (shipment === "exchange") {
      const exchange = commercial as NpShopStoredExchange;
      const exchangeBooking = booking as NpShopStoredExchangeCarrierBooking;
      if (!exchangeBookingMatchesExchange(exchangeBooking, exchange)) {
        stateMismatchSample += 1;
      }
    } else {
      const fulfillment = commercial as NpShopStoredFulfillment;
      if (
        fulfillment.status !== "shipped" ||
        fulfillment.privateDataStatus !== "redacted" ||
        fulfillment.carrier !== booking.carrier ||
        fulfillment.trackingNumber !== booking.trackingNumber
      ) {
        stateMismatchSample += 1;
      }
    }
  }
  const completedBookings: NpShopTrackingPollCandidate[] = [];
  for (const row of bookingRows) {
    try {
      completedBookings.push(
        row.key.startsWith("exchange-carrier-booking:")
          ? {
              shipment: "exchange",
              booking: requireExchangeBookingRow(row.value, row.expiresAt, row.key),
            }
          : {
              shipment: "outbound",
              booking: requireBookingRow(row.value, row.expiresAt, row.key),
            },
      );
    } catch {
      invalidSample += 1;
    }
  }
  const supportKeys = completedBookings.flatMap(({ shipment, booking }) => [
    shipment === "exchange"
      ? npShopExchangeTrackingPollStorageKey(booking.orderId)
      : npShopTrackingPollStorageKey(booking.orderId),
    shipment === "exchange"
      ? npShopExchangeTrackingStorageKey(booking.orderId)
      : npShopTrackingStorageKey(booking.orderId),
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
  for (const { shipment, booking } of completedBookings) {
    const pollKey =
      shipment === "exchange"
        ? npShopExchangeTrackingPollStorageKey(booking.orderId)
        : npShopTrackingPollStorageKey(booking.orderId);
    if (support.has(pollKey)) continue;
    const trackingRow = support.get(
      shipment === "exchange"
        ? npShopExchangeTrackingStorageKey(booking.orderId)
        : npShopTrackingStorageKey(booking.orderId),
    );
    try {
      const tracking = trackingRow
        ? requireTrackingRow(trackingRow.value, trackingRow.expiresAt, trackingRow.key, shipment)
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
  const receipts = rows.map((row) => requireReceiptRow(row.value, row.expiresAt, row.key));
  const exchangeStateKeys = [
    ...new Set(receipts.map((receipt) => npShopExchangeTrackingStorageKey(receipt.event.orderId))),
  ];
  const exchangeStates =
    exchangeStateKeys.length === 0
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
              inArray(npPluginStorage.key, exchangeStateKeys),
            ),
          );
  const exchangeShipmentIds = new Set(
    exchangeStates.map(
      (row) => requireTrackingRow(row.value, row.expiresAt, row.key, "exchange").shipmentId,
    ),
  );
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(where);
  return {
    rows: receipts.map((receipt) => ({
      provider: receipt.providerId,
      shipment: exchangeShipmentIds.has(receipt.event.shipmentId) ? "exchange" : "outbound",
      eventId: receipt.event.eventId,
      shipmentId: receipt.event.shipmentId,
      orderId: receipt.event.orderId,
      status: receipt.event.status,
      outcome: receipt.outcome,
      occurredAt: receipt.event.occurredAt,
      processedAt: receipt.processedAt,
    })),
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
    or(like(npPluginStorage.key, "tracking:%"), like(npPluginStorage.key, "exchange-tracking:%")),
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
  const states: Array<{
    shipment: "outbound" | "exchange";
    state: NpShopStoredTracking;
  }> = [];
  for (const row of stateRows) {
    try {
      const shipment = row.key.startsWith("exchange-tracking:")
        ? ("exchange" as const)
        : ("outbound" as const);
      const state = requireTrackingRow(row.value, row.expiresAt, row.key, shipment);
      states.push({ shipment, state });
      bookingKeys.push(
        shipment === "exchange"
          ? exchangeCarrierBookingStorageKey(state.orderId)
          : carrierBookingStorageKey(state.orderId),
      );
      if (shipment === "exchange") bookingKeys.push(exchangeStorageKey(state.orderId));
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
    ...new Set(
      receipts.flatMap((receipt) => [
        npShopTrackingStorageKey(receipt.event.orderId),
        npShopExchangeTrackingStorageKey(receipt.event.orderId),
      ]),
    ),
  ];
  const receiptStateRows =
    receiptStateKeys.length === 0
      ? []
      : await db
          .select({ key: npPluginStorage.key, value: npPluginStorage.value })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              inArray(npPluginStorage.key, receiptStateKeys),
            ),
          );
  const receiptShipmentIds = new Set(
    receiptStateRows.flatMap((row) => {
      try {
        const shipment = row.key.startsWith("exchange-tracking:") ? "exchange" : "outbound";
        return [npRequireStoredShopTracking(row.value).shipmentId + `:${shipment}`];
      } catch {
        invalidSample += 1;
        return [];
      }
    }),
  );
  orphanSample += receipts.filter(
    (receipt) =>
      !receiptShipmentIds.has(`${receipt.event.shipmentId}:outbound`) &&
      !receiptShipmentIds.has(`${receipt.event.shipmentId}:exchange`),
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
  const bookings = new Map<
    string,
    NpShopStoredCarrierBooking | NpShopStoredExchangeCarrierBooking
  >();
  const exchanges = new Map<string, NpShopStoredExchange>();
  for (const row of bookingRows) {
    try {
      if (row.key.startsWith("exchange:")) {
        const exchange = requireExchangeRow(row.value, row.expiresAt, row.key);
        exchanges.set(exchange.orderId, exchange);
      } else if (row.key.startsWith("exchange-carrier-booking:")) {
        const booking = requireExchangeBookingRow(row.value, row.expiresAt, row.key);
        bookings.set(`exchange:${booking.orderId}`, booking);
      } else {
        const booking = requireBookingRow(row.value, row.expiresAt, row.key);
        bookings.set(`outbound:${booking.orderId}`, booking);
      }
    } catch {
      invalidSample += 1;
    }
  }
  for (const { shipment, state } of states) {
    const booking = bookings.get(`${shipment}:${state.orderId}`);
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
    } else if (shipment === "exchange") {
      const exchange = exchanges.get(state.orderId);
      const exchangeBooking = booking as NpShopStoredExchangeCarrierBooking;
      if (!exchange || !exchangeBookingMatchesExchange(exchangeBooking, exchange)) {
        stateMismatchSample += 1;
      }
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
