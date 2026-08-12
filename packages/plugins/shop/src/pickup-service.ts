import { randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, like, sql } from "drizzle-orm";

import {
  NpShopCarrierProviderError,
  NpShopCarrierUnavailableError,
  npRequireStoredShopCarrierBooking,
  type NpShopStoredCarrierBooking,
} from "./carrier-contract.js";
import {
  npRequireStoredShopExchangeCarrierBooking,
  type NpShopStoredExchangeCarrierBooking,
} from "./exchange-carrier-contract.js";
import {
  npRequireStoredShopExchangeParcels,
  type NpShopStoredExchangeParcels,
} from "./exchange-parcel-contract.js";
import { npRequireStoredShopExchange, type NpShopStoredExchange } from "./exchange-contract.js";
import {
  npRequireStoredShopFulfillment,
  type NpShopStoredFulfillment,
} from "./fulfillment-contract.js";
import { npRequireStoredShopOrder, type NpShopStoredOrder } from "./order-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import {
  npReadStoredShopPackingWork,
  npShopPackingWorkAllowsShipmentEffectForSource,
} from "./packing-work-storage.js";
import type { NpShopPackingWorkLine } from "./packing-contract.js";
import {
  npRequireStoredShopFulfillmentParcels,
  type NpShopStoredFulfillmentParcels,
} from "./parcel-contract.js";
import {
  NP_SHOP_CARRIER_PICKUP_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT,
  NpShopCarrierPickupConflictError,
  NpShopCarrierPickupContractError,
  npRequireShopCarrierPickupCancelRequest,
  npRequireShopCarrierPickupCancelResult,
  npRequireShopCarrierPickupRequest,
  npRequireShopCarrierPickupResult,
  npRequireStoredShopCarrierPickup,
  npShopCarrierPickupLimits,
  type NpShopCarrierPickupCancelResult,
  type NpShopCarrierPickupExistingActionInput,
  type NpShopCarrierPickupPackage,
  type NpShopCarrierPickupResult,
  type NpShopCarrierPickupScheduleInput,
  type NpShopCarrierPickupTarget,
  type NpShopStoredCarrierPickup,
} from "./pickup-contract.js";
import type { NpShopRuntime } from "./runtime.js";
import type { NpShopCarrierPickupAvailabilityQueryInput } from "./pickup-availability-contract.js";
import {
  npRequireStoredShopTracking,
  npShopExchangeTrackingStorageKey,
  npShopTrackingStorageKey,
  type NpShopStoredTracking,
} from "./tracking-contract.js";

export interface NpShopAdminCarrierPickupRow {
  [key: string]: unknown;
  id: string;
  pickupId: string;
  pickupRevision: number;
  shipmentId: string;
  pickupTarget: NpShopCarrierPickupTarget;
  exchangeId: string | null;
  provider: string;
  status: string;
  window: string;
  packages: number;
  weightGrams: number;
  providerError: string;
  resumeEligible: boolean;
  updatedAt: string;
}

export interface NpShopCarrierPickupSummary {
  pickupId: string;
  revision: number;
  status: NpShopStoredCarrierPickup["status"];
  readyAt: string;
  closeAt: string;
}

export function npShopCarrierPickupStorageKey(shipmentId: string): string {
  return `carrier-pickup:${shipmentId}`;
}

function carrierBookingStorageKey(orderId: string): string {
  return `carrier-booking:${orderId}`;
}

function fulfillmentParcelsStorageKey(orderId: string): string {
  return `fulfillment-parcels:${orderId}`;
}

function fulfillmentStorageKey(orderId: string): string {
  return `fulfillment:${orderId}`;
}

function orderStorageKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

function exchangeBookingStorageKey(orderId: string): string {
  return `exchange-carrier-booking:${orderId}`;
}

function exchangeParcelsStorageKey(orderId: string): string {
  return `exchange-parcels:${orderId}`;
}

function exchangeStorageKey(orderId: string): string {
  return `exchange:${orderId}`;
}

function requireBookingAtStorage(
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
    throw new NpShopCarrierPickupContractError("Invalid pickup carrier booking metadata", [
      "carrier booking key and expiry must match its canonical values.",
    ]);
  }
  return booking;
}

function requireParcelsAtStorage(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredFulfillmentParcels {
  const parcels = npRequireStoredShopFulfillmentParcels(value);
  if (
    key !== fulfillmentParcelsStorageKey(parcels.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== parcels.purgeAt
  ) {
    throw new NpShopCarrierPickupContractError("Invalid pickup parcel metadata", [
      "parcel key and expiry must match its canonical values.",
    ]);
  }
  return parcels;
}

function requireFulfillmentAtStorage(
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
    throw new NpShopCarrierPickupContractError("Invalid pickup fulfillment metadata", [
      "fulfillment key and expiry must match their canonical values.",
    ]);
  }
  return fulfillment;
}

function requireOrderAtStorage(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredOrder {
  const order = npRequireStoredShopOrder(value);
  if (
    key !== orderStorageKey(order.ownerSegment, order.id) ||
    expiresAt === null ||
    expiresAt.toISOString() !== order.purgeAt
  ) {
    throw new NpShopCarrierPickupContractError("Invalid pickup order metadata", [
      "order key and expiry must match their canonical values.",
    ]);
  }
  return order;
}

function requireExchangeBookingAtStorage(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredExchangeCarrierBooking {
  const booking = npRequireStoredShopExchangeCarrierBooking(value);
  if (
    key !== exchangeBookingStorageKey(booking.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== booking.purgeAt
  ) {
    throw new NpShopCarrierPickupContractError("Invalid replacement pickup booking metadata", [
      "replacement booking key and expiry must match its canonical values.",
    ]);
  }
  return booking;
}

function requireExchangeParcelsAtStorage(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredExchangeParcels {
  const parcels = npRequireStoredShopExchangeParcels(value);
  if (
    key !== exchangeParcelsStorageKey(parcels.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== parcels.purgeAt
  ) {
    throw new NpShopCarrierPickupContractError("Invalid replacement pickup parcel metadata", [
      "replacement parcel key and expiry must match its canonical values.",
    ]);
  }
  return parcels;
}

function requireExchangeAtStorage(
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
    throw new NpShopCarrierPickupContractError("Invalid replacement pickup exchange metadata", [
      "exchange key and expiry must match its canonical values.",
    ]);
  }
  return exchange;
}

function requirePickupAtStorage(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredCarrierPickup {
  const pickup = npRequireStoredShopCarrierPickup(value);
  if (
    key !== npShopCarrierPickupStorageKey(pickup.shipmentId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== pickup.purgeAt
  ) {
    throw new NpShopCarrierPickupContractError("Invalid pickup storage metadata", [
      "pickup key and expiry must match its canonical values.",
    ]);
  }
  return pickup;
}

async function readStorageRow(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  key: string,
  forUpdate: boolean,
) {
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
  return row ?? null;
}

async function readBooking(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredCarrierBooking | null> {
  const row = await readStorageRow(db, siteId, carrierBookingStorageKey(orderId), forUpdate);
  return row ? requireBookingAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function readParcels(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredFulfillmentParcels | null> {
  const row = await readStorageRow(db, siteId, fulfillmentParcelsStorageKey(orderId), forUpdate);
  return row ? requireParcelsAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function readFulfillment(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredFulfillment | null> {
  const row = await readStorageRow(db, siteId, fulfillmentStorageKey(orderId), forUpdate);
  return row ? requireFulfillmentAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function readOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredOrder | null> {
  const row = await readStorageRow(db, siteId, orderStorageKey(ownerSegment, orderId), forUpdate);
  return row ? requireOrderAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function readExchangeBooking(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredExchangeCarrierBooking | null> {
  const row = await readStorageRow(db, siteId, exchangeBookingStorageKey(orderId), forUpdate);
  return row ? requireExchangeBookingAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function readExchangeParcels(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredExchangeParcels | null> {
  const row = await readStorageRow(db, siteId, exchangeParcelsStorageKey(orderId), forUpdate);
  return row ? requireExchangeParcelsAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function readExchange(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredExchange | null> {
  const row = await readStorageRow(db, siteId, exchangeStorageKey(orderId), forUpdate);
  return row ? requireExchangeAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function readPickup(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  shipmentId: string,
  forUpdate = false,
): Promise<NpShopStoredCarrierPickup | null> {
  const row = await readStorageRow(
    db,
    siteId,
    npShopCarrierPickupStorageKey(shipmentId),
    forUpdate,
  );
  return row ? requirePickupAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function lockPickupOrderBeforeRow(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
  target: NpShopCarrierPickupTarget,
): Promise<void> {
  const ownerSegment =
    target === "replacement"
      ? (await readExchange(tx, siteId, orderId, false))?.ownerSegment
      : (await readFulfillment(tx, siteId, orderId, false))?.ownerSegment;
  if (!ownerSegment) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_booking_not_found",
      "The pickup order source no longer exists.",
    );
  }
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order:${siteId}:${ownerSegment}:${orderId}`}, 0))`,
  );
}

async function readTracking(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  shipmentId: string,
  target: NpShopCarrierPickupTarget,
  forUpdate = false,
): Promise<NpShopStoredTracking | null> {
  const key =
    target === "replacement"
      ? npShopExchangeTrackingStorageKey(orderId)
      : npShopTrackingStorageKey(orderId);
  const row = await readStorageRow(db, siteId, key, forUpdate);
  if (!row) return null;
  const tracking = npRequireStoredShopTracking(row.value);
  if (
    row.key !== key ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== tracking.purgeAt ||
    tracking.orderId !== orderId ||
    tracking.shipmentId !== shipmentId
  ) {
    throw new NpShopCarrierPickupContractError("Invalid pickup tracking metadata", [
      "tracking key and expiry must match its canonical values.",
    ]);
  }
  return tracking;
}

async function persistPickup(
  tx: NpShopTransaction,
  siteId: string,
  pickup: NpShopStoredCarrierPickup,
): Promise<void> {
  npRequireStoredShopCarrierPickup(pickup);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopCarrierPickupStorageKey(pickup.shipmentId),
      value: pickup,
      expiresAt: new Date(pickup.purgeAt),
      updatedAt: new Date(pickup.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: pickup,
        expiresAt: new Date(pickup.purgeAt),
        updatedAt: new Date(pickup.updatedAt),
      },
    });
}

async function recordPickupAudit(
  tx: NpShopTransaction,
  siteId: string,
  userId: string,
  action: string,
  pickup: NpShopStoredCarrierPickup,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(npAuditEvents).values({
    actorKind: "staff",
    actorUserId: userId,
    actorMemberId: null,
    action,
    targetType: "shop-order",
    targetId: pickup.orderId,
    payload: {
      pickupId: pickup.id,
      shipmentId: pickup.shipmentId,
      pickupTarget: pickup.target,
      exchangeId: pickup.exchangeId,
      ...payload,
    },
    siteId,
  });
}

function pickupPackages(
  parcels: NpShopStoredFulfillmentParcels | NpShopStoredExchangeParcels,
): NpShopCarrierPickupPackage[] {
  return parcels.parcels.map(({ id, lengthMm, widthMm, heightMm, weightGrams }) => ({
    id,
    lengthMm,
    widthMm,
    heightMm,
    weightGrams,
  }));
}

type NpShopPickupBooking = NpShopStoredCarrierBooking | NpShopStoredExchangeCarrierBooking;

export interface NpShopCarrierPickupAvailabilityContext {
  booking: NpShopPickupBooking;
  parcelRevision: number;
  packages: NpShopCarrierPickupPackage[];
  locationReference: string;
}

function replacementBookingMatchesCurrentSource(
  booking: NpShopStoredExchangeCarrierBooking,
  order: NpShopStoredOrder,
  exchange: NpShopStoredExchange,
): boolean {
  if (
    booking.orderId !== order.id ||
    booking.exchangeId !== exchange.id ||
    booking.purgeAt !== order.purgeAt ||
    exchange.orderId !== order.id ||
    exchange.ownerSegment !== order.ownerSegment ||
    exchange.purgeAt !== order.purgeAt ||
    exchange.orderRevision !== order.revision ||
    exchange.destinationRevision !== booking.destinationRevision ||
    order.status !== "paid" ||
    booking.completedOrderRevision === null ||
    booking.completedExchangeRevision === null ||
    booking.completedOrderRevision !== booking.sourceOrderRevision + 1 ||
    booking.completedExchangeRevision !== booking.sourceExchangeRevision + 1
  ) {
    return false;
  }
  if (booking.status === "cancelled") {
    return (
      order.revision === booking.completedOrderRevision + 1 &&
      exchange.status === "cancelled" &&
      exchange.revision === booking.completedExchangeRevision + 1 &&
      exchange.carrier === null &&
      exchange.trackingNumber === null
    );
  }
  if (booking.status === "cancel-pending" || booking.status === "cancel-confirmed") {
    return (
      order.revision === booking.completedOrderRevision &&
      exchange.status === "processing" &&
      exchange.revision === booking.completedExchangeRevision &&
      exchange.carrier === booking.carrier &&
      exchange.trackingNumber === booking.trackingNumber
    );
  }
  return (
    booking.status === "completed" &&
    ((order.revision === booking.completedOrderRevision &&
      exchange.status === "processing" &&
      exchange.revision === booking.completedExchangeRevision) ||
      (order.revision === booking.completedOrderRevision + 1 &&
        exchange.status === "shipped" &&
        exchange.revision === booking.completedExchangeRevision + 1)) &&
    exchange.carrier === booking.carrier &&
    exchange.trackingNumber === booking.trackingNumber
  );
}

function replacementPickupLifecycleMatches(
  booking: NpShopStoredExchangeCarrierBooking,
  order: NpShopStoredOrder,
  exchange: NpShopStoredExchange,
  pickup: NpShopStoredCarrierPickup,
): boolean {
  if (
    booking.exchangeId !== pickup.exchangeId ||
    booking.completedExchangeRevision === null ||
    booking.purgeAt !== pickup.purgeAt
  ) {
    return false;
  }
  if (booking.status !== "completed" && pickup.status !== "cancelled") return false;
  return replacementBookingMatchesCurrentSource(booking, order, exchange);
}

function samePackages(
  left: readonly NpShopCarrierPickupPackage[],
  right: readonly NpShopCarrierPickupPackage[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        item.id === candidate.id &&
        item.lengthMm === candidate.lengthMm &&
        item.widthMm === candidate.widthMm &&
        item.heightMm === candidate.heightMm &&
        item.weightGrams === candidate.weightGrams
      );
    })
  );
}

function closedProviderErrorCode(error: NpShopCarrierProviderError): string {
  const code = error.code.trim();
  return /^[a-z][a-z0-9-]{0,99}$/u.test(code) ? code : "provider-error";
}

function nextTimestamp(...values: Array<string | null>): string {
  return new Date(
    Math.max(Date.now(), ...values.flatMap((value) => (value ? [new Date(value).getTime()] : []))),
  ).toISOString();
}

export function npRequireLiveShopCarrierPickupWindow(
  readyAt: string,
  closeAt: string,
  now: Date,
): void {
  const ready = new Date(readyAt).getTime();
  const close = new Date(closeAt).getTime();
  if (
    ready < now.getTime() - npShopCarrierPickupLimits.futureToleranceSeconds * 1_000 ||
    ready > now.getTime() + npShopCarrierPickupLimits.maximumLeadSeconds * 1_000 ||
    close <= now.getTime()
  ) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_window_conflict",
      "The pickup window must be live and begin within the next 14 days.",
    );
  }
}

async function requireScheduleEligibility(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  shipmentId: string,
  target: NpShopCarrierPickupTarget,
  exchangeId: string | null,
  providerId: string,
  expectedPickup?: NpShopStoredCarrierPickup,
  forUpdate = true,
): Promise<{
  booking: NpShopPickupBooking;
  parcelRevision: number;
  packages: NpShopCarrierPickupPackage[];
}> {
  if (
    (target === "outbound" && exchangeId !== null) ||
    (target === "replacement" && exchangeId === null)
  ) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_booking_not_found",
      "The pickup target does not match its exchange identity.",
    );
  }
  let replacementExchange: NpShopStoredExchange | null = null;
  let replacementOrder: NpShopStoredOrder | null = null;
  let outboundFulfillment: NpShopStoredFulfillment | null = null;
  let outboundOrder: NpShopStoredOrder | null = null;
  if (target === "replacement") {
    const candidate = await readExchange(db, siteId, orderId, false);
    if (!candidate) {
      throw new NpShopCarrierPickupConflictError(
        "pickup_booking_not_found",
        "Replacement pickup requires its retained exchange.",
      );
    }
    if (forUpdate) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order:${siteId}:${candidate.ownerSegment}:${orderId}`}, 0))`,
      );
      replacementExchange = await readExchange(db, siteId, orderId, true);
      replacementOrder = replacementExchange
        ? await readOrder(db, siteId, replacementExchange.ownerSegment, orderId, true)
        : null;
    } else {
      replacementExchange = candidate;
      replacementOrder = await readOrder(db, siteId, candidate.ownerSegment, orderId, false);
    }
  } else {
    const candidate = await readFulfillment(db, siteId, orderId, false);
    if (!candidate) {
      throw new NpShopCarrierPickupConflictError(
        "pickup_booking_not_found",
        "Outbound pickup requires its retained fulfillment.",
      );
    }
    if (forUpdate) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order:${siteId}:${candidate.ownerSegment}:${orderId}`}, 0))`,
      );
      outboundFulfillment = await readFulfillment(db, siteId, orderId, true);
      outboundOrder = outboundFulfillment
        ? await readOrder(db, siteId, outboundFulfillment.ownerSegment, orderId, true)
        : null;
    } else {
      outboundFulfillment = candidate;
      outboundOrder = await readOrder(db, siteId, candidate.ownerSegment, orderId, false);
    }
    if (
      !outboundFulfillment ||
      !outboundOrder ||
      outboundFulfillment.orderId !== outboundOrder.id ||
      outboundFulfillment.ownerSegment !== outboundOrder.ownerSegment ||
      outboundFulfillment.purgeAt !== outboundOrder.purgeAt ||
      outboundFulfillment.privateDataStatus !== outboundOrder.privateDataStatus ||
      outboundFulfillment.createdAt !== outboundOrder.paymentResolvedAt ||
      (outboundOrder.status !== "paid" && outboundOrder.status !== "refunded")
    ) {
      throw new NpShopCarrierPickupConflictError(
        "pickup_booking_not_found",
        "Outbound pickup requires its exact retained order and fulfillment.",
      );
    }
  }
  const booking =
    target === "replacement"
      ? await readExchangeBooking(db, siteId, orderId, forUpdate)
      : await readBooking(db, siteId, orderId, forUpdate);
  if (
    !booking ||
    booking.id !== shipmentId ||
    booking.status !== "completed" ||
    booking.providerId !== providerId ||
    (target === "replacement" &&
      ("exchangeId" in booking ? booking.exchangeId !== exchangeId : true)) ||
    !booking.bookingReference ||
    !booking.carrier ||
    !booking.trackingNumber
  ) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_booking_not_found",
      "A completed booking owned by the configured carrier is required for pickup.",
    );
  }
  if (
    target === "outbound" &&
    (!outboundFulfillment ||
      !outboundOrder ||
      !("fulfillmentRevision" in booking) ||
      outboundFulfillment.status !== "shipped" ||
      outboundFulfillment.revision !== booking.fulfillmentRevision + 1 ||
      outboundFulfillment.carrier !== booking.carrier ||
      outboundFulfillment.trackingNumber !== booking.trackingNumber ||
      outboundFulfillment.purgeAt !== booking.purgeAt ||
      outboundOrder.purgeAt !== booking.purgeAt)
  ) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_booking_not_found",
      "Outbound pickup requires its exact shipped fulfillment and retained order.",
    );
  }
  const parcels =
    target === "replacement"
      ? await readExchangeParcels(db, siteId, orderId, forUpdate)
      : await readParcels(db, siteId, orderId, forUpdate);
  if (
    !parcels ||
    parcels.lockedShipmentId !== shipmentId ||
    parcels.purgeAt !== booking.purgeAt ||
    (target === "outbound" &&
      (!("fulfillmentRevision" in parcels) ||
        !("fulfillmentRevision" in booking) ||
        parcels.fulfillmentRevision !== booking.fulfillmentRevision)) ||
    (target === "replacement" &&
      ("exchangeId" in parcels ? parcels.exchangeId !== exchangeId : true))
  ) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_parcels_required",
      "Pickup requires the exact parcel snapshot locked to this shipment.",
    );
  }
  const packages = pickupPackages(parcels);
  if (
    expectedPickup &&
    (expectedPickup.orderId !== orderId ||
      expectedPickup.shipmentId !== shipmentId ||
      expectedPickup.target !== target ||
      expectedPickup.exchangeId !== exchangeId ||
      expectedPickup.providerId !== providerId ||
      expectedPickup.purgeAt !== booking.purgeAt ||
      expectedPickup.parcelRevision !== parcels.revision ||
      !samePackages(expectedPickup.packages, packages))
  ) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_parcels_required",
      "The locked parcel snapshot no longer matches the durable pickup intent.",
    );
  }
  if (target === "replacement") {
    const exchange = replacementExchange;
    if (
      !exchange ||
      !replacementOrder ||
      exchange.id !== exchangeId ||
      exchange.orderId !== orderId ||
      exchange.purgeAt !== booking.purgeAt ||
      (exchange.status !== "processing" && exchange.status !== "shipped") ||
      !("exchangeId" in booking) ||
      !("exchangeId" in parcels) ||
      booking.sourceExchangeRevision !== parcels.exchangeRevision ||
      !replacementBookingMatchesCurrentSource(booking, replacementOrder, exchange)
    ) {
      throw new NpShopCarrierPickupConflictError(
        "pickup_booking_not_found",
        "Replacement pickup requires its exact processing or shipped exchange.",
      );
    }
  }
  const packingWork = await npReadStoredShopPackingWork(db, siteId, target, orderId, forUpdate);
  const packingSourceRevision =
    target === "replacement" && "sourceExchangeRevision" in booking
      ? booking.sourceExchangeRevision
      : "fulfillmentRevision" in booking
        ? booking.fulfillmentRevision
        : -1;
  const packingLines: NpShopPackingWorkLine[] =
    target === "replacement"
      ? (replacementExchange?.lines ?? []).map((line) => ({
          lineKey: line.lineKey,
          productId: line.productId,
          productSlug: line.productSlug,
          variantSku: line.variantSku,
          quantity: line.quantity,
        }))
      : (outboundOrder?.lines ?? []).map((line) => ({
          lineKey: line.key,
          productId: line.productId,
          productSlug: line.productSlug,
          variantSku: line.variantSku,
          quantity: line.quantity,
        }));
  if (
    !expectedPickup &&
    !npShopPackingWorkAllowsShipmentEffectForSource(packingWork, {
      target,
      orderId,
      exchangeId,
      sourceRevision: packingSourceRevision,
      parcelRevision: parcels.revision,
      purgeAt: booking.purgeAt,
      shipmentId,
      lines: packingLines,
      parcels: parcels.parcels,
    })
  ) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_state_conflict",
      "Resolve the durable packing work before scheduling a new carrier pickup.",
    );
  }
  if (await readTracking(db, siteId, orderId, shipmentId, target, forUpdate)) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_tracking_started",
      "Pickup cannot change after carrier tracking has started.",
    );
  }
  return { booking, parcelRevision: parcels.revision, packages };
}

async function lockPickupCreation(
  tx: NpShopTransaction,
  siteId: string,
  shipmentId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-carrier-pickup:${siteId}:${shipmentId}`}, 0))`,
  );
}

export async function npLockShopCarrierPickupAvailabilityContext(
  runtime: NpShopRuntime,
  input: NpShopCarrierPickupAvailabilityQueryInput,
  siteId: string,
  tx: NpShopTransaction,
): Promise<NpShopCarrierPickupAvailabilityContext> {
  const adapter = runtime.carrierPickupAdapter;
  const locationReference = runtime.carrierPickupLocationReference;
  if (!adapter || !locationReference) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_not_supported",
      "Carrier pickup scheduling is not configured.",
    );
  }
  await lockPickupCreation(tx, siteId, input.shipmentId);
  const existing = await readPickup(tx, siteId, input.shipmentId, true);
  const currentRevision = existing?.revision ?? 0;
  if (currentRevision !== input.expectedPickupRevision) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_revision_conflict",
      "The pickup state changed before availability could be checked.",
    );
  }
  if (existing) {
    throw new NpShopCarrierPickupConflictError(
      existing.status === "manual-review" ? "pickup_manual_review" : "pickup_state_conflict",
      "An existing durable pickup must be handled from the pickup table.",
    );
  }
  const eligible = await requireScheduleEligibility(
    tx,
    siteId,
    input.orderId,
    input.shipmentId,
    input.target,
    input.exchangeId,
    adapter.id,
  );
  return { ...eligible, locationReference };
}

export async function npResolveShopCarrierPickupAvailabilityContext(
  runtime: NpShopRuntime,
  input: NpShopCarrierPickupAvailabilityQueryInput,
): Promise<NpShopCarrierPickupAvailabilityContext> {
  const siteId = await requireSiteId();
  return getDb().transaction((tx) =>
    npLockShopCarrierPickupAvailabilityContext(runtime, input, siteId, tx),
  );
}

export async function npInspectShopCarrierPickupAvailabilityContext(
  runtime: NpShopRuntime,
  input: NpShopCarrierPickupAvailabilityQueryInput,
): Promise<NpShopCarrierPickupAvailabilityContext> {
  const adapter = runtime.carrierPickupAdapter;
  const locationReference = runtime.carrierPickupLocationReference;
  if (!adapter || !locationReference) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_not_supported",
      "Carrier pickup scheduling is not configured.",
    );
  }
  const siteId = await requireSiteId();
  const db = getDb();
  const existing = await readPickup(db, siteId, input.shipmentId);
  const currentRevision = existing?.revision ?? 0;
  if (currentRevision !== input.expectedPickupRevision || existing) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_state_conflict",
      "An existing durable pickup no longer matches the availability snapshot.",
    );
  }
  const eligible = await requireScheduleEligibility(
    db,
    siteId,
    input.orderId,
    input.shipmentId,
    input.target,
    input.exchangeId,
    adapter.id,
    undefined,
    false,
  );
  return { ...eligible, locationReference };
}

async function requireCancellationEligibility(
  tx: NpShopTransaction,
  siteId: string,
  pickup: NpShopStoredCarrierPickup,
  providerId: string,
): Promise<NpShopPickupBooking> {
  const booking =
    pickup.target === "replacement"
      ? await readExchangeBooking(tx, siteId, pickup.orderId, true)
      : await readBooking(tx, siteId, pickup.orderId, true);
  if (
    !booking ||
    booking.id !== pickup.shipmentId ||
    booking.status !== "completed" ||
    booking.providerId !== providerId ||
    (pickup.target === "replacement" &&
      ("exchangeId" in booking ? booking.exchangeId !== pickup.exchangeId : true)) ||
    !booking.bookingReference
  ) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_booking_not_found",
      "The completed carrier booking no longer matches this pickup.",
    );
  }
  if (await readTracking(tx, siteId, pickup.orderId, pickup.shipmentId, pickup.target, true)) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_tracking_started",
      "Pickup cannot be cancelled after carrier tracking has started.",
    );
  }
  if (pickup.target === "replacement") {
    const exchange = await readExchange(tx, siteId, pickup.orderId, true);
    if (
      !exchange ||
      exchange.id !== pickup.exchangeId ||
      (exchange.status !== "processing" && exchange.status !== "shipped")
    ) {
      throw new NpShopCarrierPickupConflictError(
        "pickup_booking_not_found",
        "The replacement exchange no longer matches this pickup.",
      );
    }
  }
  return booking;
}

async function markManualReview(
  siteId: string,
  shipmentId: string,
  pickupId: string,
  errorCode: string,
  expectedStatuses: readonly NpShopStoredCarrierPickup["status"][],
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const current = await readPickup(tx, siteId, shipmentId, true);
    if (!current || current.id !== pickupId || !expectedStatuses.includes(current.status)) {
      return;
    }
    await persistPickup(tx, siteId, {
      ...current,
      status: "manual-review",
      revision: current.revision + 1,
      providerErrorCode: errorCode,
      updatedAt: nextTimestamp(current.updatedAt, current.scheduledAt, current.cancelledAt),
    });
  });
}

async function persistProviderFailure(
  siteId: string,
  shipmentId: string,
  pickupId: string,
  expectedStatus: "pending" | "cancel-pending",
  error: unknown,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const current = await readPickup(tx, siteId, shipmentId, true);
    if (!current || current.id !== pickupId || current.status !== expectedStatus) return;
    const contractError = error instanceof NpShopCarrierPickupContractError;
    const providerError = error instanceof NpShopCarrierProviderError;
    await persistPickup(tx, siteId, {
      ...current,
      status:
        contractError || (providerError && !error.retryable) ? "manual-review" : expectedStatus,
      revision: current.revision + 1,
      providerErrorCode: contractError
        ? "invalid-result"
        : providerError
          ? closedProviderErrorCode(error)
          : "provider-error",
      updatedAt: nextTimestamp(current.updatedAt),
    });
  });
}

function throwProviderFailure(error: unknown, operation: "schedule" | "cancel"): never {
  if (error instanceof NpShopCarrierPickupContractError) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_result_mismatch",
      `The carrier returned an invalid pickup ${operation} result; manual review is required.`,
    );
  }
  if (error instanceof NpShopCarrierProviderError && !error.retryable) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_manual_review",
      `The carrier rejected the pickup ${operation}; manual review is required.`,
    );
  }
  throw new NpShopCarrierUnavailableError(
    `The carrier pickup ${operation} is temporarily unavailable; retry the same durable intent.`,
  );
}

async function executeSchedule(
  runtime: NpShopRuntime,
  siteId: string,
  pickup: NpShopStoredCarrierPickup,
  booking: NpShopPickupBooking,
  staffUserId: string,
): Promise<{ pickup: NpShopStoredCarrierPickup; duplicate: boolean }> {
  const adapter = runtime.carrierPickupAdapter;
  if (!adapter || adapter.id !== pickup.providerId) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_not_supported",
      "The durable pickup requires its original carrier pickup adapter.",
    );
  }
  let providerResult: NpShopCarrierPickupResult;
  if (pickup.status === "provider-confirmed") {
    providerResult = npRequireShopCarrierPickupResult({
      contract: NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT,
      pickupId: pickup.id,
      shipmentId: pickup.shipmentId,
      orderId: pickup.orderId,
      pickupReference: pickup.pickupReference,
      readyAt: pickup.readyAt,
      closeAt: pickup.closeAt,
      scheduledAt: pickup.scheduledAt,
    });
  } else {
    const request = npRequireShopCarrierPickupRequest({
      contract: NP_SHOP_CARRIER_PICKUP_REQUEST_CONTRACT,
      pickupId: pickup.id,
      shipmentId: pickup.shipmentId,
      orderId: pickup.orderId,
      bookingReference: booking.bookingReference,
      carrier: booking.carrier,
      trackingNumber: booking.trackingNumber,
      locationReference: pickup.locationReference,
      readyAt: pickup.readyAt,
      closeAt: pickup.closeAt,
      parcelRevision: pickup.parcelRevision,
      packages: pickup.packages,
      requestedAt: pickup.requestedAt,
    });
    try {
      providerResult = npRequireShopCarrierPickupResult(await adapter.schedulePickup(request));
    } catch (error) {
      await persistProviderFailure(siteId, pickup.shipmentId, pickup.id, "pending", error);
      throwProviderFailure(error, "schedule");
    }
    if (
      providerResult.pickupId !== pickup.id ||
      providerResult.shipmentId !== pickup.shipmentId ||
      providerResult.orderId !== pickup.orderId ||
      providerResult.readyAt !== pickup.readyAt ||
      providerResult.closeAt !== pickup.closeAt ||
      new Date(providerResult.scheduledAt) < new Date(pickup.requestedAt) ||
      new Date(providerResult.scheduledAt).getTime() >
        Date.now() + npShopCarrierPickupLimits.futureToleranceSeconds * 1_000
    ) {
      await markManualReview(siteId, pickup.shipmentId, pickup.id, "invalid-result", ["pending"]);
      throw new NpShopCarrierPickupConflictError(
        "pickup_result_mismatch",
        "The carrier pickup result does not match the durable intent.",
      );
    }
  }

  let confirmed: NpShopStoredCarrierPickup;
  try {
    confirmed = await getDb().transaction(async (tx) => {
      const current = await readPickup(tx, siteId, pickup.shipmentId, true);
      if (!current || current.id !== pickup.id) {
        throw new NpShopCarrierPickupConflictError(
          "pickup_state_conflict",
          "The durable pickup disappeared after provider confirmation.",
        );
      }
      if (current.status === "scheduled" || current.status === "provider-confirmed") {
        if (
          current.pickupReference !== providerResult.pickupReference ||
          current.scheduledAt !== providerResult.scheduledAt
        ) {
          throw new NpShopCarrierPickupConflictError(
            "pickup_result_mismatch",
            "The carrier returned conflicting pickup results for one idempotency key.",
          );
        }
        return current;
      }
      if (current.status !== "pending") {
        throw new NpShopCarrierPickupConflictError(
          "pickup_manual_review",
          "The pickup state changed before provider confirmation was stored.",
        );
      }
      const next = {
        ...current,
        status: "provider-confirmed",
        revision: current.revision + 1,
        pickupReference: providerResult.pickupReference,
        providerErrorCode: null,
        scheduledAt: providerResult.scheduledAt,
        updatedAt: nextTimestamp(current.updatedAt, providerResult.scheduledAt),
      } satisfies NpShopStoredCarrierPickup;
      await persistPickup(tx, siteId, next);
      await recordPickupAudit(tx, siteId, staffUserId, "shop.carrier.pickup.confirm", next, {
        providerId: next.providerId,
        revision: next.revision,
      });
      return next;
    });
  } catch (error) {
    if (!(error instanceof NpShopCarrierPickupConflictError)) throw error;
    await markManualReview(siteId, pickup.shipmentId, pickup.id, "local-state-conflict", [
      "pending",
      "provider-confirmed",
      "scheduled",
    ]);
    throw new NpShopCarrierPickupConflictError(
      "pickup_manual_review",
      `The carrier scheduled pickup but its confirmation requires manual reconciliation: ${error.message}`,
    );
  }
  if (confirmed.status === "scheduled") return { pickup: confirmed, duplicate: true };

  try {
    return await getDb().transaction(async (tx) => {
      await lockPickupOrderBeforeRow(tx, siteId, pickup.orderId, pickup.target);
      const current = await readPickup(tx, siteId, pickup.shipmentId, true);
      if (current?.id === pickup.id && current.status === "scheduled") {
        return { pickup: current, duplicate: true };
      }
      if (!current || current.id !== pickup.id || current.status !== "provider-confirmed") {
        throw new NpShopCarrierPickupConflictError(
          "pickup_state_conflict",
          "The pickup changed before local scheduling completed.",
        );
      }
      npRequireLiveShopCarrierPickupWindow(current.readyAt, current.closeAt, new Date());
      await requireScheduleEligibility(
        tx,
        siteId,
        current.orderId,
        current.shipmentId,
        current.target,
        current.exchangeId,
        current.providerId,
        current,
      );
      const next = {
        ...current,
        status: "scheduled",
        revision: current.revision + 1,
        updatedAt: nextTimestamp(current.updatedAt, current.scheduledAt),
      } satisfies NpShopStoredCarrierPickup;
      await persistPickup(tx, siteId, next);
      await recordPickupAudit(tx, siteId, staffUserId, "shop.carrier.pickup.schedule", next, {
        providerId: next.providerId,
        revision: next.revision,
        readyAt: next.readyAt,
        closeAt: next.closeAt,
        packages: next.packages.length,
      });
      return { pickup: next, duplicate: false };
    });
  } catch (error) {
    if (!(error instanceof NpShopCarrierPickupConflictError)) throw error;
    await markManualReview(siteId, pickup.shipmentId, pickup.id, "local-state-conflict", [
      "provider-confirmed",
    ]);
    throw new NpShopCarrierPickupConflictError(
      "pickup_manual_review",
      `The carrier scheduled pickup but local completion requires manual reconciliation: ${error.message}`,
    );
  }
}

export async function npScheduleShopCarrierPickup(
  runtime: NpShopRuntime,
  input: NpShopCarrierPickupScheduleInput,
  staffUserId: string,
): Promise<{ pickup: NpShopStoredCarrierPickup; duplicate: boolean }> {
  const adapter = runtime.carrierPickupAdapter;
  const locationReference = runtime.carrierPickupLocationReference;
  if (!adapter || !locationReference) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_not_supported",
      "Carrier pickup scheduling is not configured for this Shop.",
    );
  }
  const siteId = await requireSiteId();
  const prepared = await getDb().transaction(async (tx) => {
    await lockPickupCreation(tx, siteId, input.shipmentId);
    const existing = await readPickup(tx, siteId, input.shipmentId, true);
    if (existing?.status === "scheduled") {
      if (
        existing.orderId !== input.orderId ||
        existing.target !== input.target ||
        existing.exchangeId !== input.exchangeId
      ) {
        throw new NpShopCarrierPickupConflictError(
          "pickup_state_conflict",
          "The scheduled pickup belongs to a different shipment.",
        );
      }
      return { duplicate: true as const, pickup: existing, booking: null };
    }
    if (existing) {
      throw new NpShopCarrierPickupConflictError(
        existing.status === "manual-review" ? "pickup_manual_review" : "pickup_state_conflict",
        "An existing durable pickup must be resumed from the pickup table.",
      );
    }
    if (input.expectedRevision !== 0) {
      throw new NpShopCarrierPickupConflictError(
        "pickup_revision_conflict",
        "The pickup revision changed before scheduling started.",
      );
    }
    const requestedAt = new Date();
    requestedAt.setMilliseconds(0);
    npRequireLiveShopCarrierPickupWindow(input.readyAt, input.closeAt, requestedAt);
    const eligible = await requireScheduleEligibility(
      tx,
      siteId,
      input.orderId,
      input.shipmentId,
      input.target,
      input.exchangeId,
      adapter.id,
    );
    const pickup = {
      contract: NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT,
      id: randomUUID(),
      orderId: input.orderId,
      shipmentId: input.shipmentId,
      target: input.target,
      exchangeId: input.exchangeId,
      providerId: adapter.id,
      status: "pending",
      revision: 1,
      locationReference,
      readyAt: input.readyAt,
      closeAt: input.closeAt,
      parcelRevision: eligible.parcelRevision,
      packages: eligible.packages,
      pickupReference: null,
      providerErrorCode: null,
      cancellationId: null,
      requestedAt: requestedAt.toISOString(),
      scheduledAt: null,
      cancelRequestedAt: null,
      cancelledAt: null,
      updatedAt: requestedAt.toISOString(),
      purgeAt: eligible.booking.purgeAt,
    } satisfies NpShopStoredCarrierPickup;
    await persistPickup(tx, siteId, pickup);
    await recordPickupAudit(tx, siteId, staffUserId, "shop.carrier.pickup.request", pickup, {
      providerId: pickup.providerId,
      revision: pickup.revision,
      parcelRevision: pickup.parcelRevision,
      packages: pickup.packages.length,
    });
    return { duplicate: false as const, pickup, booking: eligible.booking };
  });
  if (prepared.duplicate) return { pickup: prepared.pickup, duplicate: true };
  return executeSchedule(runtime, siteId, prepared.pickup, prepared.booking, staffUserId);
}

export async function npResumeShopCarrierPickup(
  runtime: NpShopRuntime,
  input: NpShopCarrierPickupExistingActionInput,
  staffUserId: string,
): Promise<{ pickup: NpShopStoredCarrierPickup; duplicate: boolean }> {
  const adapter = runtime.carrierPickupAdapter;
  if (!adapter) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_not_supported",
      "The durable pickup requires its original carrier pickup adapter.",
    );
  }
  const siteId = await requireSiteId();
  let prepared:
    | { duplicate: true; pickup: NpShopStoredCarrierPickup; booking: null }
    | {
        duplicate: false;
        pickup: NpShopStoredCarrierPickup;
        booking: NpShopPickupBooking;
      };
  try {
    prepared = await getDb().transaction(async (tx) => {
      await lockPickupOrderBeforeRow(tx, siteId, input.orderId, input.target);
      const pickup = await readPickup(tx, siteId, input.shipmentId, true);
      if (
        !pickup ||
        pickup.id !== input.pickupId ||
        pickup.orderId !== input.orderId ||
        pickup.target !== input.target ||
        pickup.exchangeId !== input.exchangeId
      ) {
        throw new NpShopCarrierPickupConflictError(
          "pickup_state_conflict",
          "The durable pickup was not found.",
        );
      }
      if (pickup.status === "scheduled") return { duplicate: true as const, pickup, booking: null };
      if (pickup.revision !== input.expectedRevision) {
        throw new NpShopCarrierPickupConflictError(
          "pickup_revision_conflict",
          "The pickup changed before it could be resumed.",
        );
      }
      if (pickup.status !== "pending" && pickup.status !== "provider-confirmed") {
        throw new NpShopCarrierPickupConflictError(
          pickup.status === "manual-review" ? "pickup_manual_review" : "pickup_state_conflict",
          "Only a pending or provider-confirmed pickup can be resumed.",
        );
      }
      npRequireLiveShopCarrierPickupWindow(pickup.readyAt, pickup.closeAt, new Date());
      const eligible = await requireScheduleEligibility(
        tx,
        siteId,
        pickup.orderId,
        pickup.shipmentId,
        pickup.target,
        pickup.exchangeId,
        adapter.id,
        pickup,
      );
      return { duplicate: false as const, pickup, booking: eligible.booking };
    });
  } catch (error) {
    if (
      !(error instanceof NpShopCarrierPickupConflictError) ||
      ![
        "pickup_booking_not_found",
        "pickup_parcels_required",
        "pickup_tracking_started",
        "pickup_window_conflict",
      ].includes(error.code)
    ) {
      throw error;
    }
    await markManualReview(siteId, input.shipmentId, input.pickupId, "local-state-conflict", [
      "pending",
      "provider-confirmed",
    ]);
    throw new NpShopCarrierPickupConflictError(
      "pickup_manual_review",
      `The durable pickup can no longer be resumed automatically: ${error.message}`,
    );
  }
  if (prepared.duplicate) return { pickup: prepared.pickup, duplicate: true };
  return executeSchedule(runtime, siteId, prepared.pickup, prepared.booking, staffUserId);
}

export async function npCancelShopCarrierPickup(
  runtime: NpShopRuntime,
  input: NpShopCarrierPickupExistingActionInput,
  staffUserId: string,
): Promise<{ pickup: NpShopStoredCarrierPickup; duplicate: boolean }> {
  const adapter = runtime.carrierPickupAdapter;
  if (!adapter) {
    throw new NpShopCarrierPickupConflictError(
      "pickup_not_supported",
      "The durable pickup requires its original carrier pickup adapter.",
    );
  }
  const siteId = await requireSiteId();
  const prepared = await getDb().transaction(async (tx) => {
    await lockPickupOrderBeforeRow(tx, siteId, input.orderId, input.target);
    const current = await readPickup(tx, siteId, input.shipmentId, true);
    if (
      !current ||
      current.id !== input.pickupId ||
      current.orderId !== input.orderId ||
      current.target !== input.target ||
      current.exchangeId !== input.exchangeId
    ) {
      throw new NpShopCarrierPickupConflictError(
        "pickup_state_conflict",
        "The durable pickup was not found.",
      );
    }
    if (current.status === "cancelled") return { duplicate: true as const, pickup: current };
    if (current.revision !== input.expectedRevision) {
      throw new NpShopCarrierPickupConflictError(
        "pickup_revision_conflict",
        "The pickup changed before cancellation started.",
      );
    }
    if (
      current.status !== "scheduled" &&
      current.status !== "cancel-pending" &&
      current.status !== "cancel-confirmed"
    ) {
      throw new NpShopCarrierPickupConflictError(
        current.status === "manual-review" ? "pickup_manual_review" : "pickup_state_conflict",
        "Only a scheduled or cancelling pickup can be cancelled.",
      );
    }
    await requireCancellationEligibility(tx, siteId, current, adapter.id);
    if (current.status !== "scheduled") return { duplicate: false as const, pickup: current };
    const requestedAt = nextTimestamp(current.updatedAt, current.scheduledAt);
    const next = {
      ...current,
      status: "cancel-pending",
      revision: current.revision + 1,
      cancellationId: randomUUID(),
      cancelRequestedAt: requestedAt,
      providerErrorCode: null,
      updatedAt: requestedAt,
    } satisfies NpShopStoredCarrierPickup;
    await persistPickup(tx, siteId, next);
    await recordPickupAudit(tx, siteId, staffUserId, "shop.carrier.pickup.cancel.request", next, {
      providerId: next.providerId,
      revision: next.revision,
    });
    return { duplicate: false as const, pickup: next };
  });
  if (prepared.duplicate) return { pickup: prepared.pickup, duplicate: true };
  let pickup = prepared.pickup;
  let providerResult: NpShopCarrierPickupCancelResult;
  if (pickup.status === "cancel-confirmed") {
    providerResult = npRequireShopCarrierPickupCancelResult({
      contract: NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT,
      cancellationId: pickup.cancellationId,
      pickupId: pickup.id,
      shipmentId: pickup.shipmentId,
      orderId: pickup.orderId,
      cancelledAt: pickup.cancelledAt,
    });
  } else {
    const request = npRequireShopCarrierPickupCancelRequest({
      contract: NP_SHOP_CARRIER_PICKUP_CANCEL_REQUEST_CONTRACT,
      cancellationId: pickup.cancellationId,
      pickupId: pickup.id,
      shipmentId: pickup.shipmentId,
      orderId: pickup.orderId,
      pickupReference: pickup.pickupReference,
      requestedAt: pickup.cancelRequestedAt,
    });
    try {
      providerResult = npRequireShopCarrierPickupCancelResult(await adapter.cancelPickup(request));
    } catch (error) {
      await persistProviderFailure(siteId, pickup.shipmentId, pickup.id, "cancel-pending", error);
      throwProviderFailure(error, "cancel");
    }
    if (
      providerResult.cancellationId !== pickup.cancellationId ||
      providerResult.pickupId !== pickup.id ||
      providerResult.shipmentId !== pickup.shipmentId ||
      providerResult.orderId !== pickup.orderId ||
      new Date(providerResult.cancelledAt) < new Date(pickup.cancelRequestedAt ?? 0) ||
      new Date(providerResult.cancelledAt).getTime() >
        Date.now() + npShopCarrierPickupLimits.futureToleranceSeconds * 1_000
    ) {
      await markManualReview(siteId, pickup.shipmentId, pickup.id, "invalid-result", [
        "cancel-pending",
      ]);
      throw new NpShopCarrierPickupConflictError(
        "pickup_result_mismatch",
        "The carrier pickup cancellation result does not match the durable intent.",
      );
    }
  }

  try {
    pickup = await getDb().transaction(async (tx) => {
      const current = await readPickup(tx, siteId, pickup.shipmentId, true);
      if (!current || current.id !== pickup.id) {
        throw new NpShopCarrierPickupConflictError(
          "pickup_state_conflict",
          "The pickup disappeared after cancellation confirmation.",
        );
      }
      if (current.status === "cancelled" || current.status === "cancel-confirmed") {
        if (current.cancelledAt !== providerResult.cancelledAt) {
          throw new NpShopCarrierPickupConflictError(
            "pickup_result_mismatch",
            "The carrier returned conflicting pickup cancellation results for one idempotency key.",
          );
        }
        return current;
      }
      if (current.status !== "cancel-pending") {
        throw new NpShopCarrierPickupConflictError(
          "pickup_manual_review",
          "The pickup changed before cancellation confirmation was stored.",
        );
      }
      const next = {
        ...current,
        status: "cancel-confirmed",
        revision: current.revision + 1,
        providerErrorCode: null,
        cancelledAt: providerResult.cancelledAt,
        updatedAt: nextTimestamp(current.updatedAt, providerResult.cancelledAt),
      } satisfies NpShopStoredCarrierPickup;
      await persistPickup(tx, siteId, next);
      await recordPickupAudit(tx, siteId, staffUserId, "shop.carrier.pickup.cancel.confirm", next, {
        providerId: next.providerId,
        revision: next.revision,
      });
      return next;
    });
  } catch (error) {
    if (!(error instanceof NpShopCarrierPickupConflictError)) throw error;
    await markManualReview(siteId, pickup.shipmentId, pickup.id, "local-state-conflict", [
      "cancel-pending",
      "cancel-confirmed",
      "cancelled",
    ]);
    throw new NpShopCarrierPickupConflictError(
      "pickup_manual_review",
      `The carrier cancelled pickup but its confirmation requires manual reconciliation: ${error.message}`,
    );
  }
  if (pickup.status === "cancelled") return { pickup, duplicate: true };

  try {
    return await getDb().transaction(async (tx) => {
      await lockPickupOrderBeforeRow(tx, siteId, pickup.orderId, pickup.target);
      const current = await readPickup(tx, siteId, pickup.shipmentId, true);
      if (current?.id === pickup.id && current.status === "cancelled") {
        return { pickup: current, duplicate: true };
      }
      if (!current || current.id !== pickup.id || current.status !== "cancel-confirmed") {
        throw new NpShopCarrierPickupConflictError(
          "pickup_state_conflict",
          "The pickup changed before local cancellation completed.",
        );
      }
      await requireCancellationEligibility(tx, siteId, current, adapter.id);
      const next = {
        ...current,
        status: "cancelled",
        revision: current.revision + 1,
        updatedAt: nextTimestamp(current.updatedAt, current.cancelledAt),
      } satisfies NpShopStoredCarrierPickup;
      await persistPickup(tx, siteId, next);
      await recordPickupAudit(tx, siteId, staffUserId, "shop.carrier.pickup.cancel", next, {
        providerId: next.providerId,
        revision: next.revision,
      });
      return { pickup: next, duplicate: false };
    });
  } catch (error) {
    if (!(error instanceof NpShopCarrierPickupConflictError)) throw error;
    await markManualReview(siteId, pickup.shipmentId, pickup.id, "local-state-conflict", [
      "cancel-confirmed",
    ]);
    throw new NpShopCarrierPickupConflictError(
      "pickup_manual_review",
      `The carrier cancelled pickup but local completion requires manual reconciliation: ${error.message}`,
    );
  }
}

export async function npReadShopCarrierPickupSummary(
  shipmentId: string,
): Promise<NpShopCarrierPickupSummary | null> {
  const siteId = await requireSiteId();
  const pickup = await readPickup(getDb(), siteId, shipmentId);
  return pickup
    ? {
        pickupId: pickup.id,
        revision: pickup.revision,
        status: pickup.status,
        readyAt: pickup.readyAt,
        closeAt: pickup.closeAt,
      }
    : null;
}

export async function npListRecentShopCarrierPickups(expectedProviderId?: string): Promise<{
  rows: NpShopAdminCarrierPickupRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "carrier-pickup:%"),
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
    .limit(npShopCarrierPickupLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(where)
    .limit(1);
  return {
    rows: await Promise.all(
      rows.map(async (row) => {
        const pickup = requirePickupAtStorage(row.value, row.expiresAt, row.key);
        let resumeEligible = false;
        if (
          expectedProviderId !== undefined &&
          pickup.providerId === expectedProviderId &&
          (pickup.status === "pending" || pickup.status === "provider-confirmed")
        ) {
          try {
            npRequireLiveShopCarrierPickupWindow(pickup.readyAt, pickup.closeAt, new Date());
            await requireScheduleEligibility(
              db,
              siteId,
              pickup.orderId,
              pickup.shipmentId,
              pickup.target,
              pickup.exchangeId,
              expectedProviderId,
              pickup,
              false,
            );
            resumeEligible = true;
          } catch {
            resumeEligible = false;
          }
        }
        return {
          id: pickup.orderId,
          pickupId: pickup.id,
          pickupRevision: pickup.revision,
          shipmentId: pickup.shipmentId,
          pickupTarget: pickup.target,
          exchangeId: pickup.exchangeId,
          provider: pickup.providerId,
          status: pickup.status,
          window: `${pickup.readyAt} – ${pickup.closeAt}`,
          packages: pickup.packages.length,
          weightGrams: pickup.packages.reduce(
            (totalWeight, item) => totalWeight + item.weightGrams,
            0,
          ),
          providerError: pickup.providerErrorCode ?? "—",
          resumeEligible,
          updatedAt: pickup.updatedAt,
        };
      }),
    ),
    total: Number(total),
  };
}

export async function npCountShopCarrierPickups(expectedProviderId?: string): Promise<{
  total: number;
  outbound: number;
  replacement: number;
  pending: number;
  providerConfirmed: number;
  scheduled: number;
  cancelling: number;
  cancelled: number;
  manualReview: number;
  invalidSample: number;
  orphanSample: number;
  bookingMismatchSample: number;
  parcelMismatchSample: number;
  providerMismatchSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "carrier-pickup:%"),
  );
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(where)
    .limit(1);
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(where)
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopCarrierPickupLimits.diagnosticSampleSize);
  const counts = {
    total: Number(total),
    outbound: 0,
    replacement: 0,
    pending: 0,
    providerConfirmed: 0,
    scheduled: 0,
    cancelling: 0,
    cancelled: 0,
    manualReview: 0,
    invalidSample: 0,
    orphanSample: 0,
    bookingMismatchSample: 0,
    parcelMismatchSample: 0,
    providerMismatchSample: 0,
  };
  for (const row of rows) {
    try {
      const pickup = requirePickupAtStorage(row.value, row.expiresAt, row.key);
      if (pickup.target === "replacement") counts.replacement += 1;
      else counts.outbound += 1;
      if (pickup.status === "pending") counts.pending += 1;
      else if (pickup.status === "provider-confirmed") counts.providerConfirmed += 1;
      else if (pickup.status === "scheduled") counts.scheduled += 1;
      else if (pickup.status === "cancel-pending" || pickup.status === "cancel-confirmed") {
        counts.cancelling += 1;
      } else if (pickup.status === "cancelled") counts.cancelled += 1;
      else counts.manualReview += 1;
      if (expectedProviderId && pickup.providerId !== expectedProviderId) {
        counts.providerMismatchSample += 1;
      }
      const [booking, parcels, exchange] = await Promise.all([
        pickup.target === "replacement"
          ? readExchangeBooking(db, siteId, pickup.orderId)
          : readBooking(db, siteId, pickup.orderId),
        pickup.target === "replacement"
          ? readExchangeParcels(db, siteId, pickup.orderId)
          : readParcels(db, siteId, pickup.orderId),
        pickup.target === "replacement"
          ? readExchange(db, siteId, pickup.orderId)
          : Promise.resolve(null),
      ]);
      const replacementOrder =
        pickup.target === "replacement" && exchange
          ? await readOrder(db, siteId, exchange.ownerSegment, pickup.orderId)
          : null;
      if (!booking && !parcels) {
        counts.orphanSample += 1;
        continue;
      }
      if (
        !booking ||
        booking.id !== pickup.shipmentId ||
        (booking.status !== "completed" &&
          !(
            pickup.target === "replacement" &&
            pickup.status === "cancelled" &&
            ["cancel-pending", "cancel-confirmed", "cancelled"].includes(booking.status)
          )) ||
        booking.providerId !== pickup.providerId ||
        (pickup.target === "replacement" &&
          ("exchangeId" in booking
            ? !exchange ||
              !replacementOrder ||
              !replacementPickupLifecycleMatches(booking, replacementOrder, exchange, pickup)
            : true))
      ) {
        counts.bookingMismatchSample += 1;
      }
      if (
        !parcels ||
        parcels.lockedShipmentId !== pickup.shipmentId ||
        parcels.revision !== pickup.parcelRevision ||
        parcels.purgeAt !== pickup.purgeAt ||
        (pickup.target === "replacement" &&
          ("exchangeId" in parcels
            ? parcels.exchangeId !== pickup.exchangeId ||
              !booking ||
              !("exchangeId" in booking) ||
              booking.sourceExchangeRevision !== parcels.exchangeRevision
            : true)) ||
        !samePackages(pickupPackages(parcels), pickup.packages)
      ) {
        counts.parcelMismatchSample += 1;
      }
      if (
        pickup.target === "replacement" &&
        (!exchange || exchange.id !== pickup.exchangeId || exchange.purgeAt !== pickup.purgeAt)
      ) {
        counts.orphanSample += 1;
      }
    } catch {
      counts.invalidSample += 1;
    }
  }
  return counts;
}
