import { createHash } from "node:crypto";

import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

import {
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
import {
  npRequireStoredShopExchange,
  npShopExchangeLinesFromOrder,
  type NpShopStoredExchange,
} from "./exchange-contract.js";
import {
  npRequireStoredShopFulfillment,
  type NpShopStoredFulfillment,
} from "./fulfillment-contract.js";
import {
  NP_SHOP_PACKING_WORK_STORAGE_CONTRACT,
  npSerializeShopPackingWorkFingerprintSource,
  npShopPackingWorkLimits,
  type NpShopPackingWorkLine,
  type NpShopPackingWorkStatus,
  type NpShopStoredPackingWork,
} from "./packing-contract.js";
import {
  npRequireStoredShopPackingWorkAtKey,
  npShopPackingWorkIsPurgeTerminal,
} from "./packing-work-storage.js";
import { npRequireStoredShopOrder, type NpShopStoredOrder } from "./order-contract.js";
import { NP_SHOP_PLUGIN_ID } from "./order-draft-service.js";
import {
  npRequireStoredShopFulfillmentParcels,
  type NpShopStoredFulfillmentParcels,
} from "./parcel-contract.js";
import { npRequireStoredShopReturn, type NpShopStoredReturn } from "./return-contract.js";
import { npRequireStoredShopTracking, type NpShopStoredTracking } from "./tracking-contract.js";

const STORAGE_PREFIX = "packing-work:";
const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;

interface StorageRow {
  readonly key: string;
  readonly value: unknown;
  readonly expiresAt: Date | null;
}

interface Parsed<T> {
  readonly value: T | null;
  readonly invalid: boolean;
}

interface OrderLookup {
  readonly contract: "np.shop-order-lookup.v1";
  readonly orderId: string;
  readonly ownerSegment: string;
  readonly purgeAt: string;
}

export interface NpShopAdminPackingWorkRow {
  [key: string]: unknown;
  id: string;
  packingWorkId: string;
  packingWorkRevision: number;
  packingWorkTarget: "outbound" | "replacement";
  exchangeId: string | null;
  provider: string;
  status: NpShopPackingWorkStatus;
  sourceRevision: number;
  parcelRevision: number;
  parcels: number;
  units: number;
  weightGrams: number;
  shipmentId: string;
  providerError: string;
  localFinalizeEligible: boolean;
  providerRetryEligible: boolean;
  providerCancelEligible: boolean;
  statusPollEligible: boolean;
  updatedAt: string;
}

export interface NpShopPackingWorkCounts {
  readonly total: number;
  readonly outbound: number;
  readonly replacement: number;
  readonly pending: number;
  readonly providerConfirmed: number;
  readonly active: number;
  readonly cancelling: number;
  readonly cancelled: number;
  readonly consumed: number;
  readonly manualReview: number;
  readonly unresolved: number;
  readonly invalidSample: number;
  readonly expiredSample: number;
  readonly retainedPastPurgeSample: number;
  readonly unresolvedAttachedCancellationSample: number;
  readonly providerMismatchSample: number;
  readonly orphanSourceSample: number;
  readonly sourceMismatchSample: number;
  readonly exchangeIdentityMismatchSample: number;
  readonly parcelMismatchSample: number;
  readonly fingerprintMismatchSample: number;
  readonly attachedShipmentMismatchSample: number;
  readonly trackingMismatchSample: number;
  readonly trackingConflictSample: number;
  readonly sampleSize: number;
  readonly sampleBoundReached: boolean;
}

function fulfillmentKey(orderId: string): string {
  return `fulfillment:${orderId}`;
}

function orderKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

function orderLookupKey(orderId: string): string {
  return `order-lookup:${orderId}`;
}

function outboundParcelKey(orderId: string): string {
  return `fulfillment-parcels:${orderId}`;
}

function replacementExchangeKey(orderId: string): string {
  return `exchange:${orderId}`;
}

function returnKey(orderId: string): string {
  return `return:${orderId}`;
}

function replacementParcelKey(orderId: string): string {
  return `exchange-parcels:${orderId}`;
}

function outboundBookingKey(orderId: string): string {
  return `carrier-booking:${orderId}`;
}

function replacementBookingKey(orderId: string): string {
  return `exchange-carrier-booking:${orderId}`;
}

function replacementTrackingKey(orderId: string): string {
  return `exchange-tracking:${orderId}`;
}

function requireCanonicalExpiry(expiresAt: Date | null, purgeAt: string): void {
  if (expiresAt === null || expiresAt.toISOString() !== purgeAt) {
    throw new Error("Shop operational storage expiry is not canonical.");
  }
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerSegmentPattern.test(value) ||
      (value.startsWith("member:") && canonicalUuidPattern.test(value.slice("member:".length))))
  );
}

function parseRow<T>(row: StorageRow | undefined, requireValue: (row: StorageRow) => T): Parsed<T> {
  if (!row) return { value: null, invalid: false };
  try {
    return { value: requireValue(row), invalid: false };
  } catch {
    return { value: null, invalid: true };
  }
}

function requireFulfillment(row: StorageRow): NpShopStoredFulfillment {
  const value = npRequireStoredShopFulfillment(row.value);
  if (row.key !== fulfillmentKey(value.orderId)) throw new Error("Invalid fulfillment key.");
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value;
}

function requireOrder(row: StorageRow): NpShopStoredOrder {
  const value = npRequireStoredShopOrder(row.value);
  if (row.key !== orderKey(value.ownerSegment, value.id)) throw new Error("Invalid order key.");
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value;
}

function requireOrderLookup(row: StorageRow): OrderLookup {
  if (typeof row.value !== "object" || row.value === null || Array.isArray(row.value)) {
    throw new Error("Invalid order lookup.");
  }
  const value = row.value as Record<string, unknown>;
  if (
    Object.getPrototypeOf(row.value) !== Object.prototype ||
    Object.keys(value).length !== 4 ||
    value.contract !== "np.shop-order-lookup.v1" ||
    typeof value.orderId !== "string" ||
    !canonicalUuidPattern.test(value.orderId) ||
    !isOwnerSegment(value.ownerSegment) ||
    !isCanonicalIso(value.purgeAt) ||
    row.key !== orderLookupKey(value.orderId)
  ) {
    throw new Error("Invalid order lookup.");
  }
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value as unknown as OrderLookup;
}

function requireExchange(row: StorageRow): NpShopStoredExchange {
  const value = npRequireStoredShopExchange(row.value);
  if (row.key !== replacementExchangeKey(value.orderId)) throw new Error("Invalid exchange key.");
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value;
}

function requireReturn(row: StorageRow): NpShopStoredReturn {
  const value = npRequireStoredShopReturn(row.value);
  if (row.key !== returnKey(value.orderId)) throw new Error("Invalid return key.");
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value;
}

function requireOutboundParcels(row: StorageRow): NpShopStoredFulfillmentParcels {
  const value = npRequireStoredShopFulfillmentParcels(row.value);
  if (row.key !== outboundParcelKey(value.orderId)) throw new Error("Invalid parcel key.");
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value;
}

function requireReplacementParcels(row: StorageRow): NpShopStoredExchangeParcels {
  const value = npRequireStoredShopExchangeParcels(row.value);
  if (row.key !== replacementParcelKey(value.orderId)) throw new Error("Invalid parcel key.");
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value;
}

function requireOutboundBooking(row: StorageRow): NpShopStoredCarrierBooking {
  const value = npRequireStoredShopCarrierBooking(row.value);
  if (row.key !== outboundBookingKey(value.orderId)) throw new Error("Invalid booking key.");
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value;
}

function requireReplacementBooking(row: StorageRow): NpShopStoredExchangeCarrierBooking {
  const value = npRequireStoredShopExchangeCarrierBooking(row.value);
  if (row.key !== replacementBookingKey(value.orderId)) throw new Error("Invalid booking key.");
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value;
}

function requireReplacementTracking(row: StorageRow): NpShopStoredTracking {
  const value = npRequireStoredShopTracking(row.value);
  if (row.key !== replacementTrackingKey(value.orderId)) {
    throw new Error("Invalid replacement tracking key.");
  }
  requireCanonicalExpiry(row.expiresAt, value.purgeAt);
  return value;
}

function fingerprint(
  value: Parameters<typeof npSerializeShopPackingWorkFingerprintSource>[0],
): string {
  return createHash("sha256")
    .update(npSerializeShopPackingWorkFingerprintSource(value), "utf8")
    .digest("hex");
}

function packingLinesFromOrder(order: NpShopStoredOrder): NpShopPackingWorkLine[] {
  return order.lines.map((line) => ({
    lineKey: line.key,
    productId: line.productId,
    productSlug: line.productSlug,
    variantSku: line.variantSku,
    quantity: line.quantity,
  }));
}

function packingLinesFromExchange(exchange: NpShopStoredExchange): NpShopPackingWorkLine[] {
  return exchange.lines.map((line) => ({
    lineKey: line.lineKey,
    productId: line.productId,
    productSlug: line.productSlug,
    variantSku: line.variantSku,
    quantity: line.quantity,
  }));
}

function returnMatchesOrder(returnRequest: NpShopStoredReturn, order: NpShopStoredOrder): boolean {
  return (
    returnRequest.orderId === order.id &&
    returnRequest.ownerSegment === order.ownerSegment &&
    returnRequest.purgeAt === order.purgeAt &&
    returnRequest.orderRevision <= order.revision &&
    (order.status === "paid" || order.status === "refunded") &&
    returnRequest.lines.every((requestedLine) => {
      const line = order.lines.find((candidate) => candidate.key === requestedLine.lineKey);
      return Boolean(line && requestedLine.quantity <= line.quantity);
    })
  );
}

function exchangeMatchesOrder(
  exchange: NpShopStoredExchange,
  order: NpShopStoredOrder,
  returnRequest: NpShopStoredReturn,
): boolean {
  let expectedLines: ReturnType<typeof npShopExchangeLinesFromOrder>;
  try {
    expectedLines = npShopExchangeLinesFromOrder(order.lines, returnRequest.lines);
  } catch {
    return false;
  }
  return (
    exchange.orderId === order.id &&
    exchange.returnId === returnRequest.id &&
    exchange.ownerSegment === order.ownerSegment &&
    exchange.purgeAt === order.purgeAt &&
    exchange.orderRevision === order.revision &&
    exchange.returnRevision === returnRequest.revision &&
    order.status === "paid" &&
    returnRequest.status === "received" &&
    exchange.lines.length === expectedLines.length &&
    exchange.lines.every((line, index) => {
      const expected = expectedLines[index];
      return Boolean(
        expected &&
        line.lineKey === expected.lineKey &&
        line.productId === expected.productId &&
        line.productSlug === expected.productSlug &&
        line.productName === expected.productName &&
        line.variantSku === expected.variantSku &&
        line.variantName === expected.variantName &&
        line.quantity === expected.quantity,
      );
    })
  );
}

function workFingerprint(work: NpShopStoredPackingWork): string {
  return fingerprint({
    target: work.target,
    exchangeId: work.exchangeId,
    sourceRevision: work.sourceRevision,
    parcelRevision: work.parcelRevision,
    lines: work.lines,
    parcels: work.parcels,
  });
}

function currentFingerprint(
  work: NpShopStoredPackingWork,
  lines: readonly NpShopPackingWorkLine[],
  parcels: NpShopStoredFulfillmentParcels | NpShopStoredExchangeParcels,
): string {
  return fingerprint({
    target: work.target,
    exchangeId: work.exchangeId,
    sourceRevision: work.sourceRevision,
    parcelRevision: parcels.revision,
    lines,
    parcels: parcels.parcels,
  });
}

function sourceLifecycleMatches(
  work: NpShopStoredPackingWork,
  source: NpShopStoredFulfillment | NpShopStoredExchange,
  trackingWinsCancellation = false,
  carrierCancellationCompleted = false,
): boolean {
  if (source.revision < work.sourceRevision) return false;
  if (work.status === "cancelled" && work.attachedShipmentId === null) return true;
  if (work.target === "outbound") {
    if (work.status === "cancelled") {
      return source.status === "processing" && source.revision === work.sourceRevision;
    }
    if (work.status === "consumed") {
      return source.status === "shipped" && source.revision === work.sourceRevision + 1;
    }
    return source.status === "processing" && source.revision === work.sourceRevision;
  }
  if (work.status === "cancelled") {
    return (
      (source.status === "awaiting" && source.revision === work.sourceRevision) ||
      (source.status === "processing" && source.revision === work.sourceRevision + 1) ||
      (trackingWinsCancellation &&
        source.status === "shipped" &&
        source.revision === work.sourceRevision + 2) ||
      (carrierCancellationCompleted &&
        source.status === "cancelled" &&
        source.revision === work.sourceRevision + 2)
    );
  }
  if (trackingWinsCancellation && hasCancellationIntent(work)) {
    return (
      (source.status === "processing" && source.revision === work.sourceRevision + 1) ||
      (source.status === "shipped" && source.revision === work.sourceRevision + 2)
    );
  }
  if (work.status === "consumed") {
    return source.status === "shipped" && source.revision === work.sourceRevision + 2;
  }
  if (
    work.status === "active" ||
    work.status === "cancel-pending" ||
    work.status === "cancel-confirmed" ||
    work.status === "manual-review"
  ) {
    return (
      (source.status === "awaiting" && source.revision === work.sourceRevision) ||
      (source.status === "processing" && source.revision === work.sourceRevision + 1)
    );
  }
  return source.status === "awaiting" && source.revision === work.sourceRevision;
}

function orderLifecycleMatches(work: NpShopStoredPackingWork, order: NpShopStoredOrder): boolean {
  return work.status === "cancelled" || work.status === "consumed"
    ? order.status === "paid" || order.status === "refunded"
    : order.status === "paid";
}

function hasCancellationIntent(work: NpShopStoredPackingWork): boolean {
  return (
    work.consumedAt === null &&
    (work.status === "cancel-pending" ||
      work.status === "cancel-confirmed" ||
      work.status === "cancelled" ||
      (work.status === "manual-review" &&
        work.cancellationId !== null &&
        work.cancelRequestedAt !== null))
  );
}

function replacementTrackingMatches(
  work: NpShopStoredPackingWork,
  tracking: NpShopStoredTracking,
  booking: NpShopStoredExchangeCarrierBooking,
  exchange: NpShopStoredExchange,
): boolean {
  const lifecycleMatches =
    (exchange.status === "processing" &&
      exchange.revision === booking.completedExchangeRevision &&
      exchange.orderRevision === booking.completedOrderRevision) ||
    (exchange.status === "shipped" &&
      booking.completedExchangeRevision !== null &&
      booking.completedOrderRevision !== null &&
      exchange.revision === booking.completedExchangeRevision + 1 &&
      exchange.orderRevision === booking.completedOrderRevision + 1);
  return (
    work.target === "replacement" &&
    work.attachedShipmentId !== null &&
    booking.status === "completed" &&
    booking.id === work.attachedShipmentId &&
    booking.orderId === work.orderId &&
    booking.exchangeId === work.exchangeId &&
    booking.bookingReference !== null &&
    booking.trackingNumber !== null &&
    booking.completedOrderRevision !== null &&
    booking.completedExchangeRevision === work.sourceRevision + 1 &&
    booking.completedOrderRevision === booking.sourceOrderRevision + 1 &&
    booking.purgeAt === work.purgeAt &&
    booking.carrier !== null &&
    booking.trackingNumber !== null &&
    exchange.id === work.exchangeId &&
    exchange.orderId === work.orderId &&
    exchange.purgeAt === work.purgeAt &&
    exchange.carrier === booking.carrier &&
    exchange.trackingNumber === booking.trackingNumber &&
    lifecycleMatches &&
    tracking.orderId === work.orderId &&
    tracking.shipmentId === booking.id &&
    tracking.providerId === booking.providerId &&
    tracking.bookingReference === booking.bookingReference &&
    tracking.trackingNumber === booking.trackingNumber &&
    tracking.purgeAt === work.purgeAt
  );
}

function projectAdminRow(
  work: NpShopStoredPackingWork,
  expectedProviderId: string | undefined,
  trackingStarted: boolean,
  createSourceEligible: boolean,
  cancellationSourceEligible: boolean,
): NpShopAdminPackingWorkRow {
  const providerMatches =
    expectedProviderId !== undefined && work.providerId === expectedProviderId;
  return {
    id: work.orderId,
    packingWorkId: work.workId,
    packingWorkRevision: work.revision,
    packingWorkTarget: work.target,
    exchangeId: work.exchangeId,
    provider: work.providerId,
    status: work.status,
    sourceRevision: work.sourceRevision,
    parcelRevision: work.parcelRevision,
    parcels: work.parcels.length,
    units: work.lines.reduce((total, line) => total + line.quantity, 0),
    weightGrams: work.parcels.reduce((total, parcel) => total + parcel.weightGrams, 0),
    shipmentId: work.attachedShipmentId ?? "—",
    providerError: work.providerErrorCode ?? "—",
    localFinalizeEligible:
      (work.status === "provider-confirmed" && createSourceEligible) ||
      (work.status === "cancel-confirmed" && cancellationSourceEligible),
    providerRetryEligible:
      providerMatches &&
      ((work.status === "pending" && createSourceEligible) ||
        (work.status === "cancel-pending" && cancellationSourceEligible)),
    providerCancelEligible:
      providerMatches &&
      cancellationSourceEligible &&
      work.consumedAt === null &&
      !(
        work.target === "outbound" &&
        work.attachedShipmentId !== null &&
        !hasCancellationIntent(work)
      ) &&
      (!trackingStarted || (work.status === "manual-review" && hasCancellationIntent(work))) &&
      ["pending", "provider-confirmed", "active", "manual-review"].includes(work.status),
    statusPollEligible:
      providerMatches &&
      work.providerWorkReference !== null &&
      ["provider-confirmed", "active", "cancel-pending", "cancel-confirmed"].includes(work.status),
    updatedAt: work.updatedAt,
  };
}

function adminSourceEligibility(
  work: NpShopStoredPackingWork,
  relatedRows: ReadonlyMap<string, StorageRow>,
  sourceRows: ReadonlyMap<string, StorageRow>,
): { create: boolean; cancellation: boolean } {
  if (workFingerprint(work) !== work.parcelFingerprint) {
    return { create: false, cancellation: false };
  }
  if (work.target === "outbound") {
    const fulfillment = parseRow(relatedRows.get(fulfillmentKey(work.orderId)), requireFulfillment);
    if (!fulfillment.value || fulfillment.invalid) {
      return { create: false, cancellation: false };
    }
    const order = parseRow(
      sourceRows.get(orderKey(fulfillment.value.ownerSegment, work.orderId)),
      requireOrder,
    );
    const cancellation = Boolean(
      order.value &&
      !order.invalid &&
      fulfillment.value.orderId === order.value.id &&
      fulfillment.value.ownerSegment === order.value.ownerSegment &&
      fulfillment.value.privateDataStatus === order.value.privateDataStatus &&
      fulfillment.value.createdAt === order.value.paymentResolvedAt &&
      fulfillment.value.purgeAt === order.value.purgeAt &&
      work.orderId === order.value.id &&
      work.exchangeId === null &&
      work.purgeAt === order.value.purgeAt &&
      (order.value.status === "paid" || order.value.status === "refunded"),
    );
    const parcel = parseRow(
      relatedRows.get(outboundParcelKey(work.orderId)),
      requireOutboundParcels,
    );
    const create = Boolean(
      cancellation &&
      order.value?.status === "paid" &&
      fulfillment.value.status === "processing" &&
      fulfillment.value.revision === work.sourceRevision &&
      parcel.value &&
      !parcel.invalid &&
      parcel.value.orderId === work.orderId &&
      parcel.value.fulfillmentRevision === work.sourceRevision &&
      parcel.value.revision === work.parcelRevision &&
      parcel.value.purgeAt === work.purgeAt &&
      parcel.value.lockedShipmentId === null &&
      !relatedRows.has(outboundBookingKey(work.orderId)) &&
      currentFingerprint(work, packingLinesFromOrder(order.value), parcel.value) ===
        work.parcelFingerprint,
    );
    return { create, cancellation };
  }
  const exchange = parseRow(relatedRows.get(replacementExchangeKey(work.orderId)), requireExchange);
  if (!exchange.value || exchange.invalid) {
    return { create: false, cancellation: false };
  }
  const order = parseRow(
    sourceRows.get(orderKey(exchange.value.ownerSegment, work.orderId)),
    requireOrder,
  );
  const cancellation = Boolean(
    order.value &&
    !order.invalid &&
    exchange.value.orderId === order.value.id &&
    exchange.value.ownerSegment === order.value.ownerSegment &&
    exchange.value.purgeAt === order.value.purgeAt &&
    work.orderId === order.value.id &&
    work.exchangeId === exchange.value.id &&
    work.purgeAt === order.value.purgeAt,
  );
  const returnRequest = parseRow(relatedRows.get(returnKey(work.orderId)), requireReturn);
  const parcel = parseRow(
    relatedRows.get(replacementParcelKey(work.orderId)),
    requireReplacementParcels,
  );
  const create = Boolean(
    cancellation &&
    order.value &&
    returnRequest.value &&
    !returnRequest.invalid &&
    returnMatchesOrder(returnRequest.value, order.value) &&
    exchangeMatchesOrder(exchange.value, order.value, returnRequest.value) &&
    exchange.value.status === "awaiting" &&
    exchange.value.revision === work.sourceRevision &&
    parcel.value &&
    !parcel.invalid &&
    parcel.value.orderId === work.orderId &&
    parcel.value.exchangeId === work.exchangeId &&
    parcel.value.exchangeRevision === work.sourceRevision &&
    parcel.value.revision === work.parcelRevision &&
    parcel.value.purgeAt === work.purgeAt &&
    parcel.value.lockedShipmentId === null &&
    !relatedRows.has(replacementBookingKey(work.orderId)) &&
    currentFingerprint(work, packingLinesFromExchange(exchange.value), parcel.value) ===
      work.parcelFingerprint,
  );
  return { create, cancellation };
}

async function readRows(siteId: string, keys: readonly string[]): Promise<Map<string, StorageRow>> {
  if (keys.length === 0) return new Map();
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
        inArray(npPluginStorage.key, [...new Set(keys)]),
      ),
    );
  return new Map(rows.map((row) => [row.key, row]));
}

export async function npListRecentShopPackingWork(expectedProviderId?: string): Promise<{
  rows: NpShopAdminPackingWorkRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, `${STORAGE_PREFIX}%`),
  );
  const [rows, [aggregate]] = await Promise.all([
    db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(where)
      .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
      .limit(npShopPackingWorkLimits.adminListSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(npPluginStorage)
      .where(where),
  ]);
  const projectedRows: NpShopAdminPackingWorkRow[] = [];
  const parsedWorks: NpShopStoredPackingWork[] = [];
  for (const row of rows) {
    try {
      parsedWorks.push(npRequireStoredShopPackingWorkAtKey(row.value, row.expiresAt, row.key));
    } catch {
      continue;
    }
  }
  const listedOrderIds = [...new Set(parsedWorks.map((work) => work.orderId))];
  const siblingRows =
    listedOrderIds.length === 0
      ? []
      : await db
          .select({
            key: npPluginStorage.key,
            value: npPluginStorage.value,
            expiresAt: npPluginStorage.expiresAt,
            orderId: sql<string>`${npPluginStorage.value}->>'orderId'`,
          })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              like(npPluginStorage.key, `${STORAGE_PREFIX}%`),
              inArray(sql<string>`${npPluginStorage.value}->>'orderId'`, listedOrderIds),
            ),
          );
  const siblingCounts = new Map<string, number>();
  const invalidSiblingOrders = new Set<string>();
  for (const row of siblingRows) {
    siblingCounts.set(row.orderId, (siblingCounts.get(row.orderId) ?? 0) + 1);
    try {
      const sibling = npRequireStoredShopPackingWorkAtKey(row.value, row.expiresAt, row.key);
      if (sibling.orderId !== row.orderId) invalidSiblingOrders.add(row.orderId);
    } catch {
      invalidSiblingOrders.add(row.orderId);
    }
  }
  for (const [orderId, count] of siblingCounts) {
    if (count > 2) invalidSiblingOrders.add(orderId);
  }
  const relatedKeys = parsedWorks.flatMap((work) =>
    work.target === "outbound"
      ? [
          fulfillmentKey(work.orderId),
          outboundParcelKey(work.orderId),
          outboundBookingKey(work.orderId),
        ]
      : [
          replacementExchangeKey(work.orderId),
          returnKey(work.orderId),
          replacementParcelKey(work.orderId),
          replacementBookingKey(work.orderId),
          replacementTrackingKey(work.orderId),
        ],
  );
  const relatedRows = await readRows(siteId, relatedKeys);
  const sourceKeys: string[] = [];
  for (const work of parsedWorks) {
    const source =
      work.target === "outbound"
        ? parseRow(relatedRows.get(fulfillmentKey(work.orderId)), requireFulfillment).value
        : parseRow(relatedRows.get(replacementExchangeKey(work.orderId)), requireExchange).value;
    if (source) sourceKeys.push(orderKey(source.ownerSegment, work.orderId));
  }
  const sourceRows = await readRows(siteId, sourceKeys);
  for (const work of parsedWorks) {
    const eligibility = invalidSiblingOrders.has(work.orderId)
      ? { create: false, cancellation: false }
      : adminSourceEligibility(work, relatedRows, sourceRows);
    projectedRows.push(
      projectAdminRow(
        work,
        expectedProviderId,
        relatedRows.has(replacementTrackingKey(work.orderId)),
        eligibility.create,
        eligibility.cancellation,
      ),
    );
  }
  return {
    rows: projectedRows,
    total: Number(aggregate?.total ?? 0),
  };
}

export async function npCountShopPackingWork(
  expectedProviderId?: string,
): Promise<NpShopPackingWorkCounts> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, `${STORAGE_PREFIX}%`),
  );
  const [aggregateRows, sampleRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        outbound: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'target' = 'outbound')::int`,
        replacement: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'target' = 'replacement')::int`,
        pending: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'pending')::int`,
        providerConfirmed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'provider-confirmed')::int`,
        active: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'active')::int`,
        cancelling: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' in ('cancel-pending', 'cancel-confirmed'))::int`,
        cancelled: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'cancelled')::int`,
        consumed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'consumed')::int`,
        manualReview: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'manual-review')::int`,
        unresolved: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PACKING_WORK_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' in ('pending', 'provider-confirmed', 'cancel-pending', 'cancel-confirmed'))::int`,
      })
      .from(npPluginStorage)
      .where(where),
    db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(where)
      .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
      .limit(npShopPackingWorkLimits.diagnosticSampleSize),
  ]);
  const aggregate = aggregateRows[0];
  const works: NpShopStoredPackingWork[] = [];
  let invalidSample = 0;
  let expiredSample = 0;
  let retainedPastPurgeSample = 0;
  const pastPurgeWorks: NpShopStoredPackingWork[] = [];
  let providerMismatchSample = 0;
  const fingerprintMismatchKeys = new Set<string>();
  const now = new Date();
  for (const row of sampleRows) {
    try {
      const work = npRequireStoredShopPackingWorkAtKey(row.value, row.expiresAt, row.key);
      works.push(work);
      if (row.expiresAt !== null && row.expiresAt <= now) {
        pastPurgeWorks.push(work);
      }
      if (
        expectedProviderId !== undefined &&
        work.status !== "cancelled" &&
        work.status !== "consumed" &&
        work.providerId !== expectedProviderId
      ) {
        providerMismatchSample += 1;
      }
      if (workFingerprint(work) !== work.parcelFingerprint) {
        fingerprintMismatchKeys.add(row.key);
      }
    } catch {
      invalidSample += 1;
    }
  }

  const pastPurgeOrderIds = [...new Set(pastPurgeWorks.map((work) => work.orderId))];
  const pastPurgeSiblingRows =
    pastPurgeOrderIds.length === 0
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
              like(npPluginStorage.key, `${STORAGE_PREFIX}%`),
              inArray(sql<string>`${npPluginStorage.value}->>'orderId'`, pastPurgeOrderIds),
            ),
          );
  const retainingSiblingKeys = new Map<string, Set<string>>();
  for (const row of pastPurgeSiblingRows) {
    try {
      const sibling = npRequireStoredShopPackingWorkAtKey(row.value, row.expiresAt, row.key);
      if (
        (sibling.status !== "cancelled" && sibling.status !== "consumed") ||
        (sibling.status === "cancelled" && sibling.attachedShipmentId !== null)
      ) {
        const keys = retainingSiblingKeys.get(sibling.orderId) ?? new Set<string>();
        keys.add(row.key);
        retainingSiblingKeys.set(sibling.orderId, keys);
      }
    } catch {
      // Invalid siblings remain structural errors; they do not make a terminal row healthy.
    }
  }

  const relatedKeys: string[] = [];
  for (const work of works) {
    if (work.target === "outbound") {
      relatedKeys.push(
        fulfillmentKey(work.orderId),
        outboundParcelKey(work.orderId),
        outboundBookingKey(work.orderId),
      );
    } else {
      relatedKeys.push(
        orderLookupKey(work.orderId),
        replacementExchangeKey(work.orderId),
        replacementParcelKey(work.orderId),
        replacementBookingKey(work.orderId),
      );
      if (work.attachedShipmentId !== null) {
        relatedKeys.push(replacementTrackingKey(work.orderId));
      }
    }
  }
  const relatedRows = await readRows(siteId, relatedKeys);
  const sourceKeys: string[] = [];
  for (const work of works) {
    if (work.target === "outbound") {
      const fulfillment = parseRow(
        relatedRows.get(fulfillmentKey(work.orderId)),
        requireFulfillment,
      );
      if (fulfillment.value) {
        sourceKeys.push(orderKey(fulfillment.value.ownerSegment, work.orderId));
      }
      continue;
    }
    const lookup = parseRow(relatedRows.get(orderLookupKey(work.orderId)), requireOrderLookup);
    if (lookup.value) {
      sourceKeys.push(orderKey(lookup.value.ownerSegment, work.orderId));
      sourceKeys.push(returnKey(work.orderId));
    }
  }
  const sourceRows = await readRows(siteId, sourceKeys);

  let orphanSourceSample = 0;
  let sourceMismatchSample = 0;
  let exchangeIdentityMismatchSample = 0;
  let parcelMismatchSample = 0;
  let attachedShipmentMismatchSample = 0;
  let trackingMismatchSample = 0;
  let trackingConflictSample = 0;
  let unresolvedAttachedCancellationSample = 0;
  const purgeTerminalKeys = new Set<string>();

  for (const work of works) {
    let lines: readonly NpShopPackingWorkLine[] | null = null;
    let currentOrder: NpShopStoredOrder | null = null;
    let currentFulfillment: NpShopStoredFulfillment | null = null;
    let outboundBookingValue: NpShopStoredCarrierBooking | null = null;
    const replacementExchange =
      work.target === "replacement"
        ? parseRow(relatedRows.get(replacementExchangeKey(work.orderId)), requireExchange)
        : null;
    const replacementReturn =
      work.target === "replacement"
        ? parseRow(sourceRows.get(returnKey(work.orderId)), requireReturn)
        : null;
    const replacementBooking =
      work.target === "replacement"
        ? parseRow(relatedRows.get(replacementBookingKey(work.orderId)), requireReplacementBooking)
        : null;
    const replacementTracking =
      work.target === "replacement" && work.attachedShipmentId !== null
        ? parseRow(
            relatedRows.get(replacementTrackingKey(work.orderId)),
            requireReplacementTracking,
          )
        : null;
    const exactReplacementTracking = Boolean(
      replacementExchange?.value &&
      replacementBooking?.value &&
      replacementTracking?.value &&
      replacementTrackingMatches(
        work,
        replacementTracking.value,
        replacementBooking.value,
        replacementExchange.value,
      ),
    );
    const trackingWinsCancellation = exactReplacementTracking && hasCancellationIntent(work);
    if (work.target === "outbound") {
      const fulfillment = parseRow(
        relatedRows.get(fulfillmentKey(work.orderId)),
        requireFulfillment,
      );
      if (fulfillment.invalid) {
        sourceMismatchSample += 1;
      } else if (!fulfillment.value) {
        orphanSourceSample += 1;
      } else {
        currentFulfillment = fulfillment.value;
        const order = parseRow(
          sourceRows.get(orderKey(fulfillment.value.ownerSegment, work.orderId)),
          requireOrder,
        );
        if (order.invalid) {
          sourceMismatchSample += 1;
        } else if (!order.value) {
          orphanSourceSample += 1;
        } else {
          currentOrder = order.value;
          lines = packingLinesFromOrder(order.value);
          if (
            order.value.id !== work.orderId ||
            order.value.ownerSegment !== fulfillment.value.ownerSegment ||
            order.value.purgeAt !== work.purgeAt ||
            fulfillment.value.purgeAt !== work.purgeAt ||
            fulfillment.value.privateDataStatus !== order.value.privateDataStatus ||
            fulfillment.value.createdAt !== order.value.paymentResolvedAt ||
            !orderLifecycleMatches(work, order.value) ||
            !sourceLifecycleMatches(work, fulfillment.value)
          ) {
            sourceMismatchSample += 1;
          }
        }
      }
    } else {
      const exchange = replacementExchange!;
      if (exchange.invalid) {
        sourceMismatchSample += 1;
      } else if (!exchange.value) {
        orphanSourceSample += 1;
      } else {
        lines = packingLinesFromExchange(exchange.value);
        const identityMismatch =
          exchange.value.id !== work.exchangeId || exchange.value.orderId !== work.orderId;
        if (identityMismatch) {
          exchangeIdentityMismatchSample += 1;
        }
        const lookup = parseRow(relatedRows.get(orderLookupKey(work.orderId)), requireOrderLookup);
        if (lookup.invalid) {
          sourceMismatchSample += 1;
        } else if (!lookup.value) {
          orphanSourceSample += 1;
        } else if (
          lookup.value.orderId !== work.orderId ||
          lookup.value.ownerSegment !== exchange.value.ownerSegment ||
          lookup.value.purgeAt !== exchange.value.purgeAt ||
          lookup.value.purgeAt !== work.purgeAt
        ) {
          sourceMismatchSample += 1;
        } else {
          const order = parseRow(
            sourceRows.get(orderKey(lookup.value.ownerSegment, work.orderId)),
            requireOrder,
          );
          if (order.invalid) {
            sourceMismatchSample += 1;
          } else if (!order.value) {
            orphanSourceSample += 1;
          } else if (work.status === "cancelled") {
            currentOrder = order.value;
            const carrierCancellationCompleted = Boolean(
              work.attachedShipmentId !== null &&
              replacementBooking?.value?.status === "cancelled" &&
              replacementBooking.value.id === work.attachedShipmentId &&
              replacementBooking.value.orderId === work.orderId &&
              replacementBooking.value.exchangeId === work.exchangeId &&
              replacementBooking.value.sourceExchangeRevision === work.sourceRevision &&
              replacementBooking.value.completedExchangeRevision === work.sourceRevision + 1 &&
              replacementBooking.value.completedOrderRevision !== null &&
              replacementBooking.value.purgeAt === work.purgeAt &&
              exchange.value.status === "cancelled" &&
              exchange.value.revision === replacementBooking.value.completedExchangeRevision + 1 &&
              exchange.value.orderRevision ===
                replacementBooking.value.completedOrderRevision + 1 &&
              order.value.revision === exchange.value.orderRevision,
            );
            if (
              identityMismatch ||
              lookup.value.orderId !== work.orderId ||
              lookup.value.ownerSegment !== order.value.ownerSegment ||
              lookup.value.purgeAt !== order.value.purgeAt ||
              exchange.value.ownerSegment !== order.value.ownerSegment ||
              exchange.value.purgeAt !== order.value.purgeAt ||
              work.purgeAt !== order.value.purgeAt ||
              !orderLifecycleMatches(work, order.value) ||
              !sourceLifecycleMatches(
                work,
                exchange.value,
                trackingWinsCancellation,
                carrierCancellationCompleted,
              )
            ) {
              sourceMismatchSample += 1;
            }
          } else {
            currentOrder = order.value;
            const returnRequest = replacementReturn!;
            if (returnRequest.invalid) {
              sourceMismatchSample += 1;
            } else if (!returnRequest.value) {
              orphanSourceSample += 1;
            } else if (
              identityMismatch ||
              lookup.value.orderId !== work.orderId ||
              lookup.value.ownerSegment !== order.value.ownerSegment ||
              lookup.value.purgeAt !== order.value.purgeAt ||
              work.purgeAt !== order.value.purgeAt ||
              !returnMatchesOrder(returnRequest.value, order.value) ||
              !exchangeMatchesOrder(exchange.value, order.value, returnRequest.value) ||
              !sourceLifecycleMatches(work, exchange.value, trackingWinsCancellation)
            ) {
              sourceMismatchSample += 1;
            }
          }
        }
      }
    }

    const parcel =
      work.target === "outbound"
        ? parseRow(relatedRows.get(outboundParcelKey(work.orderId)), requireOutboundParcels)
        : parseRow(relatedRows.get(replacementParcelKey(work.orderId)), requireReplacementParcels);
    const parcelValue = parcel.value;
    const requiresExactParcelSource =
      work.status !== "cancelled" || work.attachedShipmentId !== null;
    const parcelIdentityMismatch =
      parcel.invalid ||
      (!parcelValue && requiresExactParcelSource) ||
      (parcelValue !== null &&
        (parcelValue.orderId !== work.orderId ||
          parcelValue.revision !== work.parcelRevision ||
          parcelValue.purgeAt !== work.purgeAt ||
          (work.target === "outbound"
            ? !("fulfillmentRevision" in parcelValue) ||
              parcelValue.fulfillmentRevision !== work.sourceRevision
            : !("exchangeRevision" in parcelValue) ||
              parcelValue.exchangeRevision !== work.sourceRevision ||
              parcelValue.exchangeId !== work.exchangeId)));
    if (parcelIdentityMismatch && requiresExactParcelSource) parcelMismatchSample += 1;
    if (
      !parcelIdentityMismatch &&
      parcelValue &&
      lines &&
      requiresExactParcelSource &&
      currentFingerprint(work, lines, parcelValue) !== work.parcelFingerprint
    ) {
      fingerprintMismatchKeys.add(`${STORAGE_PREFIX}${work.target}:${work.orderId}`);
    }

    if (work.status === "cancelled" && work.attachedShipmentId === null) {
      // An unattached tombstone deliberately permits later parcel/source drift.
    } else if (work.attachedShipmentId === null) {
      if (parcelValue?.lockedShipmentId !== null && parcelValue?.lockedShipmentId !== undefined) {
        attachedShipmentMismatchSample += 1;
      }
    } else if (!parcelValue || parcelValue.lockedShipmentId !== work.attachedShipmentId) {
      attachedShipmentMismatchSample += 1;
    } else if (work.target === "outbound") {
      const booking = parseRow(
        relatedRows.get(outboundBookingKey(work.orderId)),
        requireOutboundBooking,
      );
      outboundBookingValue = booking.value;
      if (
        booking.invalid ||
        !booking.value ||
        booking.value.id !== work.attachedShipmentId ||
        booking.value.orderId !== work.orderId ||
        booking.value.fulfillmentRevision !== work.sourceRevision ||
        booking.value.purgeAt !== work.purgeAt ||
        (work.status === "consumed" && booking.value.status !== "completed")
      ) {
        attachedShipmentMismatchSample += 1;
      }
    } else {
      const booking = replacementBooking!;
      if (
        booking.invalid ||
        !booking.value ||
        booking.value.id !== work.attachedShipmentId ||
        booking.value.orderId !== work.orderId ||
        booking.value.exchangeId !== work.exchangeId ||
        booking.value.sourceExchangeRevision !== work.sourceRevision ||
        booking.value.purgeAt !== work.purgeAt ||
        (work.status === "consumed" && booking.value.status !== "completed")
      ) {
        attachedShipmentMismatchSample += 1;
      }
      const tracking = replacementTracking!;
      if (tracking.invalid || (tracking.value !== null && !exactReplacementTracking)) {
        trackingMismatchSample += 1;
      } else if (tracking.value !== null && hasCancellationIntent(work)) {
        trackingConflictSample += 1;
      }
    }

    if (work.target === "outbound" && outboundBookingValue === null) {
      const booking = parseRow(
        relatedRows.get(outboundBookingKey(work.orderId)),
        requireOutboundBooking,
      );
      outboundBookingValue = booking.invalid ? null : booking.value;
    }
    let purgeTerminal = false;
    if (currentOrder) {
      const source = {
        order: currentOrder,
        fulfillment: currentFulfillment,
        outboundParcels:
          work.target === "outbound" && parcelValue !== null && "fulfillmentRevision" in parcelValue
            ? parcelValue
            : null,
        outboundBooking: outboundBookingValue,
        returnRequest: replacementReturn?.invalid ? null : (replacementReturn?.value ?? null),
        exchange: replacementExchange?.invalid ? null : (replacementExchange?.value ?? null),
        replacementParcels:
          work.target === "replacement" && parcelValue !== null && "exchangeRevision" in parcelValue
            ? parcelValue
            : null,
        replacementBooking: replacementBooking?.invalid
          ? null
          : (replacementBooking?.value ?? null),
        replacementTracking: replacementTracking?.invalid
          ? null
          : (replacementTracking?.value ?? null),
      };
      purgeTerminal = npShopPackingWorkIsPurgeTerminal(work, source);
      if (purgeTerminal) {
        purgeTerminalKeys.add(`${STORAGE_PREFIX}${work.target}:${work.orderId}`);
      } else if (work.status === "cancelled" || work.status === "consumed") {
        const keys = retainingSiblingKeys.get(work.orderId) ?? new Set<string>();
        keys.add(`${STORAGE_PREFIX}${work.target}:${work.orderId}`);
        retainingSiblingKeys.set(work.orderId, keys);
      }
    }
    if (work.status === "cancelled" && work.attachedShipmentId !== null && !purgeTerminal) {
      unresolvedAttachedCancellationSample += 1;
    }
  }

  for (const work of pastPurgeWorks) {
    const key = `${STORAGE_PREFIX}${work.target}:${work.orderId}`;
    const retainedBySibling = [...(retainingSiblingKeys.get(work.orderId) ?? [])].some(
      (siblingKey) => siblingKey !== key && !purgeTerminalKeys.has(siblingKey),
    );
    if (purgeTerminalKeys.has(key) && !retainedBySibling) {
      expiredSample += 1;
    } else {
      retainedPastPurgeSample += 1;
    }
  }

  const total = Number(aggregate?.total ?? 0);
  return {
    total,
    outbound: Number(aggregate?.outbound ?? 0),
    replacement: Number(aggregate?.replacement ?? 0),
    pending: Number(aggregate?.pending ?? 0),
    providerConfirmed: Number(aggregate?.providerConfirmed ?? 0),
    active: Number(aggregate?.active ?? 0),
    cancelling: Number(aggregate?.cancelling ?? 0),
    cancelled: Number(aggregate?.cancelled ?? 0),
    consumed: Number(aggregate?.consumed ?? 0),
    manualReview: Number(aggregate?.manualReview ?? 0),
    unresolved: Number(aggregate?.unresolved ?? 0),
    invalidSample,
    expiredSample,
    retainedPastPurgeSample,
    unresolvedAttachedCancellationSample,
    providerMismatchSample,
    orphanSourceSample,
    sourceMismatchSample,
    exchangeIdentityMismatchSample,
    parcelMismatchSample,
    fingerprintMismatchSample: fingerprintMismatchKeys.size,
    attachedShipmentMismatchSample,
    trackingMismatchSample,
    trackingConflictSample,
    sampleSize: sampleRows.length,
    sampleBoundReached: total > sampleRows.length,
  };
}
