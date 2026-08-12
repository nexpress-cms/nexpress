import { createHash } from "node:crypto";

import { npPluginStorage } from "@nexpress/core/db";
import type { getDb } from "@nexpress/core/db";
import { and, eq, like, sql } from "drizzle-orm";

import {
  NpShopPackingWorkContractError,
  npRequireStoredShopPackingWork,
  npSerializeShopPackingWorkFingerprintSource,
  npShopPackingWorkStorageKey,
  type NpShopPackingWorkFingerprintSource,
  type NpShopPackingWorkTarget,
  type NpShopStoredPackingWork,
} from "./packing-contract.js";
import type { NpShopStoredCarrierBooking } from "./carrier-contract.js";
import type { NpShopStoredExchangeCarrierBooking } from "./exchange-carrier-contract.js";
import type { NpShopStoredExchangeParcels } from "./exchange-parcel-contract.js";
import { npShopExchangeLinesFromOrder, type NpShopStoredExchange } from "./exchange-contract.js";
import type { NpShopStoredFulfillment } from "./fulfillment-contract.js";
import type { NpShopStoredOrder } from "./order-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import type { NpShopStoredFulfillmentParcels } from "./parcel-contract.js";
import type { NpShopStoredReturn } from "./return-contract.js";
import type { NpShopStoredTracking } from "./tracking-contract.js";

type NpShopPackingWorkDb = ReturnType<typeof getDb> | NpShopTransaction;

export interface NpShopPackingWorkShipmentSource {
  target: NpShopPackingWorkTarget;
  orderId: string;
  exchangeId: string | null;
  sourceRevision: number;
  parcelRevision: number;
  purgeAt: string;
  shipmentId: string;
  lines: NpShopPackingWorkFingerprintSource["lines"];
  parcels: NpShopPackingWorkFingerprintSource["parcels"];
}

export interface NpShopPackingWorkPurgeSource {
  readonly order: NpShopStoredOrder;
  readonly fulfillment: NpShopStoredFulfillment | null;
  readonly outboundParcels: NpShopStoredFulfillmentParcels | null;
  readonly outboundBooking: NpShopStoredCarrierBooking | null;
  readonly returnRequest: NpShopStoredReturn | null;
  readonly exchange: NpShopStoredExchange | null;
  readonly replacementParcels: NpShopStoredExchangeParcels | null;
  readonly replacementBooking: NpShopStoredExchangeCarrierBooking | null;
  readonly replacementTracking: NpShopStoredTracking | null;
}

function packingWorkFingerprint(source: NpShopPackingWorkFingerprintSource): string {
  return createHash("sha256")
    .update(npSerializeShopPackingWorkFingerprintSource(source), "utf8")
    .digest("hex");
}

function packingWorkFingerprintSource(
  work: NpShopStoredPackingWork,
  lines: NpShopPackingWorkFingerprintSource["lines"],
  parcels: NpShopPackingWorkFingerprintSource["parcels"],
): NpShopPackingWorkFingerprintSource {
  return work.target === "outbound"
    ? {
        target: "outbound",
        exchangeId: null,
        sourceRevision: work.sourceRevision,
        parcelRevision: work.parcelRevision,
        lines,
        parcels,
      }
    : {
        target: "replacement",
        exchangeId: work.exchangeId,
        sourceRevision: work.sourceRevision,
        parcelRevision: work.parcelRevision,
        lines,
        parcels,
      };
}

export function npShopPackingWorkMatchesShipmentSource(
  work: NpShopStoredPackingWork,
  source: NpShopPackingWorkShipmentSource,
): boolean {
  const storedSource = packingWorkFingerprintSource(work, work.lines, work.parcels);
  const currentSource = packingWorkFingerprintSource(work, source.lines, source.parcels);
  return (
    work.target === source.target &&
    work.orderId === source.orderId &&
    work.exchangeId === source.exchangeId &&
    work.sourceRevision === source.sourceRevision &&
    work.parcelRevision === source.parcelRevision &&
    work.purgeAt === source.purgeAt &&
    work.attachedShipmentId === source.shipmentId &&
    packingWorkFingerprint(storedSource) === work.parcelFingerprint &&
    packingWorkFingerprint(currentSource) === work.parcelFingerprint
  );
}

export function npShopPackingWorkMatchesIdentity(
  work: NpShopStoredPackingWork,
  source: Pick<NpShopPackingWorkShipmentSource, "target" | "orderId" | "exchangeId" | "purgeAt">,
): boolean {
  return (
    work.target === source.target &&
    work.orderId === source.orderId &&
    work.exchangeId === source.exchangeId &&
    work.purgeAt === source.purgeAt &&
    packingWorkFingerprint(packingWorkFingerprintSource(work, work.lines, work.parcels)) ===
      work.parcelFingerprint
  );
}

export function npShopPackingWorkMatchesUnattachedTombstone(
  work: NpShopStoredPackingWork,
  source: Pick<NpShopPackingWorkShipmentSource, "target" | "orderId" | "exchangeId" | "purgeAt">,
): boolean {
  return (
    work.status === "cancelled" &&
    work.attachedShipmentId === null &&
    npShopPackingWorkMatchesIdentity(work, source)
  );
}

function fulfillmentMatchesOrder(
  fulfillment: NpShopStoredFulfillment,
  order: NpShopStoredOrder,
): boolean {
  return (
    fulfillment.orderId === order.id &&
    fulfillment.ownerSegment === order.ownerSegment &&
    (order.status === "paid" || order.status === "refunded") &&
    fulfillment.privateDataStatus === order.privateDataStatus &&
    fulfillment.createdAt === order.paymentResolvedAt &&
    fulfillment.purgeAt === order.purgeAt
  );
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

function outboundSnapshotMatches(
  work: NpShopStoredPackingWork,
  order: NpShopStoredOrder,
  parcels: NpShopStoredFulfillmentParcels,
): boolean {
  return (
    work.target === "outbound" &&
    parcels.orderId === order.id &&
    parcels.fulfillmentRevision === work.sourceRevision &&
    parcels.revision === work.parcelRevision &&
    parcels.purgeAt === work.purgeAt &&
    parcels.lockedShipmentId === work.attachedShipmentId &&
    packingWorkFingerprint(
      packingWorkFingerprintSource(
        work,
        order.lines.map((line) => ({
          lineKey: line.key,
          productId: line.productId,
          productSlug: line.productSlug,
          variantSku: line.variantSku,
          quantity: line.quantity,
        })),
        parcels.parcels,
      ),
    ) === work.parcelFingerprint
  );
}

function replacementSnapshotMatches(
  work: NpShopStoredPackingWork,
  exchange: NpShopStoredExchange,
  parcels: NpShopStoredExchangeParcels,
): boolean {
  return (
    work.target === "replacement" &&
    parcels.orderId === exchange.orderId &&
    parcels.exchangeId === exchange.id &&
    parcels.exchangeRevision === work.sourceRevision &&
    parcels.revision === work.parcelRevision &&
    parcels.purgeAt === work.purgeAt &&
    parcels.lockedShipmentId === work.attachedShipmentId &&
    packingWorkFingerprint(
      packingWorkFingerprintSource(
        work,
        exchange.lines.map((line) => ({
          lineKey: line.lineKey,
          productId: line.productId,
          productSlug: line.productSlug,
          variantSku: line.variantSku,
          quantity: line.quantity,
        })),
        parcels.parcels,
      ),
    ) === work.parcelFingerprint
  );
}

function replacementBookingMatchesCompletedSource(
  booking: NpShopStoredExchangeCarrierBooking,
  order: NpShopStoredOrder,
  exchange: NpShopStoredExchange,
  work: NpShopStoredPackingWork,
): boolean {
  return (
    booking.id === work.attachedShipmentId &&
    booking.orderId === order.id &&
    booking.exchangeId === exchange.id &&
    booking.sourceExchangeRevision === work.sourceRevision &&
    booking.completedOrderRevision !== null &&
    booking.completedExchangeRevision === booking.sourceExchangeRevision + 1 &&
    booking.completedOrderRevision === booking.sourceOrderRevision + 1 &&
    booking.purgeAt === work.purgeAt &&
    exchange.orderId === order.id &&
    exchange.orderRevision === order.revision &&
    exchange.purgeAt === order.purgeAt
  );
}

function replacementTrackingMatches(
  tracking: NpShopStoredTracking,
  booking: NpShopStoredExchangeCarrierBooking,
  exchange: NpShopStoredExchange,
): boolean {
  return (
    booking.status === "completed" &&
    booking.bookingReference !== null &&
    booking.carrier !== null &&
    booking.trackingNumber !== null &&
    booking.completedOrderRevision !== null &&
    booking.completedExchangeRevision !== null &&
    exchange.status === "shipped" &&
    exchange.orderRevision === booking.completedOrderRevision + 1 &&
    exchange.revision === booking.completedExchangeRevision + 1 &&
    exchange.carrier === booking.carrier &&
    exchange.trackingNumber === booking.trackingNumber &&
    tracking.orderId === booking.orderId &&
    tracking.shipmentId === booking.id &&
    tracking.providerId === booking.providerId &&
    tracking.bookingReference === booking.bookingReference &&
    tracking.trackingNumber === booking.trackingNumber &&
    tracking.purgeAt === booking.purgeAt
  );
}

/**
 * Returns true only when deleting the order cannot discard an unresolved
 * packing or carrier effect. This predicate intentionally treats every
 * attached outbound cancellation and every incomplete replacement carrier
 * compensation as non-terminal, even though the packing provider itself has
 * acknowledged cancellation.
 */
export function npShopPackingWorkIsPurgeTerminal(
  work: NpShopStoredPackingWork,
  source: NpShopPackingWorkPurgeSource,
): boolean {
  const identity = {
    target: work.target,
    orderId: source.order.id,
    exchangeId: work.target === "replacement" ? (source.exchange?.id ?? null) : null,
    purgeAt: source.order.purgeAt,
  } as const;
  if (!npShopPackingWorkMatchesIdentity(work, identity)) return false;
  if (work.status === "cancelled" && work.attachedShipmentId === null) return true;
  if (work.status !== "cancelled" && work.status !== "consumed") return false;

  if (work.target === "outbound") {
    if (work.status === "cancelled") return false;
    const { fulfillment, outboundParcels, outboundBooking } = source;
    if (
      !fulfillment ||
      !outboundParcels ||
      !fulfillmentMatchesOrder(fulfillment, source.order) ||
      fulfillment.status !== "shipped" ||
      fulfillment.revision !== work.sourceRevision + 1 ||
      !outboundSnapshotMatches(work, source.order, outboundParcels)
    ) {
      return false;
    }
    if (work.attachedShipmentId === null) return outboundBooking === null;
    return (
      outboundBooking?.status === "completed" &&
      outboundBooking.id === work.attachedShipmentId &&
      outboundBooking.orderId === source.order.id &&
      outboundBooking.fulfillmentRevision === work.sourceRevision &&
      outboundBooking.purgeAt === work.purgeAt &&
      fulfillment.carrier === outboundBooking.carrier &&
      fulfillment.trackingNumber === outboundBooking.trackingNumber
    );
  }

  const { returnRequest, exchange, replacementParcels, replacementBooking } = source;
  if (
    !returnRequest ||
    !exchange ||
    !replacementParcels ||
    !returnMatchesOrder(returnRequest, source.order) ||
    !exchangeMatchesOrder(exchange, source.order, returnRequest) ||
    !replacementSnapshotMatches(work, exchange, replacementParcels)
  ) {
    return false;
  }
  if (work.status === "consumed") {
    if (exchange.status !== "shipped" || exchange.revision !== work.sourceRevision + 2) {
      return false;
    }
    if (work.attachedShipmentId === null) return replacementBooking === null;
    return Boolean(
      replacementBooking &&
      replacementBooking.status === "completed" &&
      replacementBookingMatchesCompletedSource(replacementBooking, source.order, exchange, work) &&
      exchange.carrier === replacementBooking.carrier &&
      exchange.trackingNumber === replacementBooking.trackingNumber,
    );
  }

  if (
    work.attachedShipmentId === null ||
    !replacementBooking ||
    !replacementBookingMatchesCompletedSource(replacementBooking, source.order, exchange, work)
  ) {
    return false;
  }
  if (replacementBooking.status === "cancelled") {
    return (
      source.replacementTracking === null &&
      replacementBooking.completedOrderRevision !== null &&
      replacementBooking.completedExchangeRevision !== null &&
      exchange.status === "cancelled" &&
      (exchange.inventoryOutcome === "restocked" || exchange.inventoryOutcome === "not-required") &&
      exchange.orderRevision === replacementBooking.completedOrderRevision + 1 &&
      exchange.revision === replacementBooking.completedExchangeRevision + 1 &&
      exchange.carrier === null &&
      exchange.trackingNumber === null
    );
  }
  return Boolean(
    source.replacementTracking &&
    replacementTrackingMatches(source.replacementTracking, replacementBooking, exchange),
  );
}

function requireStoredPackingWorkAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredPackingWork {
  const work = npRequireStoredShopPackingWork(value);
  if (
    key !== npShopPackingWorkStorageKey(work.target, work.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== work.purgeAt
  ) {
    throw new NpShopPackingWorkContractError("Invalid stored Shop packing work metadata", [
      "Packing-work storage key and expiry must match the canonical target, order, and purge time.",
    ]);
  }
  return work;
}

export async function npReadStoredShopPackingWork(
  db: NpShopPackingWorkDb,
  siteId: string,
  target: NpShopPackingWorkTarget,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredPackingWork | null> {
  const key = npShopPackingWorkStorageKey(target, orderId);
  let conflictingQuery = db
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
        like(npPluginStorage.key, "packing-work:%"),
        sql`${npPluginStorage.value}->>'orderId' = ${orderId}`,
      ),
    )
    .orderBy(npPluginStorage.key)
    .limit(3);
  if (forUpdate) conflictingQuery = conflictingQuery.for("update") as typeof conflictingQuery;
  const relatedRows = await conflictingQuery;
  let invalidRelatedRow = relatedRows.length > 2;
  for (const row of relatedRows) {
    try {
      requireStoredPackingWorkAtKey(row.value, row.expiresAt, row.key);
    } catch {
      invalidRelatedRow = true;
      break;
    }
  }
  if (invalidRelatedRow) {
    throw new NpShopPackingWorkContractError("Invalid stored Shop packing work metadata", [
      "Packing-work rows that identify an order must use one of its canonical target keys.",
    ]);
  }
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
  return row ? requireStoredPackingWorkAtKey(row.value, row.expiresAt, row.key) : null;
}

export async function npPersistStoredShopPackingWork(
  tx: NpShopTransaction,
  siteId: string,
  work: NpShopStoredPackingWork,
): Promise<void> {
  npRequireStoredShopPackingWork(work);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopPackingWorkStorageKey(work.target, work.orderId),
      value: work,
      expiresAt: new Date(work.purgeAt),
      updatedAt: new Date(work.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: work,
        expiresAt: new Date(work.purgeAt),
        updatedAt: new Date(work.updatedAt),
      },
    });
}

export function npShopPackingWorkAllowsShipmentEffect(
  work: NpShopStoredPackingWork | null,
  shipmentId: string,
): boolean {
  if (!work) return true;
  if (work.status === "active" || work.status === "consumed") {
    return work.attachedShipmentId === shipmentId;
  }
  return work.status === "cancelled" && work.attachedShipmentId === null;
}

export function npShopPackingWorkAllowsShipmentEffectForSource(
  work: NpShopStoredPackingWork | null,
  source: NpShopPackingWorkShipmentSource,
): boolean {
  if (!work) return true;
  if (work.status === "cancelled" && work.attachedShipmentId === null) {
    return npShopPackingWorkMatchesUnattachedTombstone(work, source);
  }
  return (
    npShopPackingWorkAllowsShipmentEffect(work, source.shipmentId) &&
    npShopPackingWorkMatchesShipmentSource(work, source)
  );
}

export function npRequireStoredShopPackingWorkAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredPackingWork {
  return requireStoredPackingWorkAtKey(value, expiresAt, key);
}
