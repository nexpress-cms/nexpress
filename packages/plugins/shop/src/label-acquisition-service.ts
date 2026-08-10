import { randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, like, sql } from "drizzle-orm";

import {
  NpShopCarrierConflictError,
  NpShopCarrierProviderError,
  NpShopCarrierUnavailableError,
  npRequireStoredShopCarrierBooking,
  type NpShopStoredCarrierBooking,
} from "./carrier-contract.js";
import {
  npRequireStoredShopExchangeCarrierBooking,
  type NpShopStoredExchangeCarrierBooking,
} from "./exchange-carrier-contract.js";
import { npRequireStoredShopExchange, type NpShopStoredExchange } from "./exchange-contract.js";
import {
  NP_SHOP_CARRIER_LABEL_ACQUISITION_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_LABEL_ACQUISITION_STORAGE_CONTRACT,
  NpShopCarrierLabelAcquisitionConflictError,
  NpShopCarrierLabelAcquisitionContractError,
  npRequireShopCarrierLabelAcquisitionRequest,
  npRequireShopCarrierLabelAcquisitionResult,
  npRequireStoredShopCarrierLabelAcquisition,
  npShopCarrierLabelAcquisitionLimits,
  type NpShopCarrierLabelAcquisitionActionInput,
  type NpShopCarrierLabelAcquisitionResult,
  type NpShopCarrierLabelAcquisitionTarget,
  type NpShopStoredCarrierLabelAcquisition,
} from "./label-acquisition-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import type { NpShopRuntime } from "./runtime.js";
import {
  npRequireStoredShopTracking,
  npShopExchangeTrackingStorageKey,
  npShopTrackingStorageKey,
} from "./tracking-contract.js";

export interface NpShopCarrierLabelSource {
  target: NpShopCarrierLabelAcquisitionTarget;
  shipmentId: string;
  orderId: string;
  providerId: string;
  bookingReference: string;
  carrier: string;
  trackingNumber: string;
  exchangeId: string | null;
  sourceRevision: number;
  purgeAt: string;
}

export interface NpShopAdminCarrierLabelAcquisitionRow {
  [key: string]: unknown;
  id: string;
  acquisitionId: string;
  expectedRevision: number;
  shipmentId: string;
  target: NpShopCarrierLabelAcquisitionTarget;
  exchangeId: string | null;
  provider: string;
  status: string;
  operation: string;
  generation: number;
  labelReference: string;
  providerError: string;
  updatedAt: string;
}

export function npShopCarrierLabelAcquisitionStorageKey(shipmentId: string): string {
  return `carrier-label-acquisition:${shipmentId}`;
}

function carrierBookingStorageKey(orderId: string): string {
  return `carrier-booking:${orderId}`;
}

function exchangeBookingStorageKey(orderId: string): string {
  return `exchange-carrier-booking:${orderId}`;
}

function exchangeStorageKey(orderId: string): string {
  return `exchange:${orderId}`;
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
    throw new NpShopCarrierLabelAcquisitionContractError("Invalid label carrier booking metadata", [
      "carrier booking key and expiry must match its canonical values.",
    ]);
  }
  return booking;
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
    throw new NpShopCarrierLabelAcquisitionContractError(
      "Invalid replacement label booking metadata",
      ["replacement booking key and expiry must match its canonical values."],
    );
  }
  return booking;
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
    throw new NpShopCarrierLabelAcquisitionContractError(
      "Invalid replacement label exchange metadata",
      ["exchange key and expiry must match its canonical values."],
    );
  }
  return exchange;
}

export function npRequireStoredShopCarrierLabelAcquisitionAtKey(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredCarrierLabelAcquisition {
  const acquisition = npRequireStoredShopCarrierLabelAcquisition(value);
  if (
    key !== npShopCarrierLabelAcquisitionStorageKey(acquisition.shipmentId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== acquisition.purgeAt
  ) {
    throw new NpShopCarrierLabelAcquisitionContractError("Invalid label acquisition metadata", [
      "label acquisition key and expiry must match its canonical values.",
    ]);
  }
  return acquisition;
}

async function readBooking(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate: boolean,
): Promise<NpShopStoredCarrierBooking | null> {
  const row = await readStorageRow(db, siteId, carrierBookingStorageKey(orderId), forUpdate);
  return row ? requireBookingAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function readExchangeBooking(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate: boolean,
): Promise<NpShopStoredExchangeCarrierBooking | null> {
  const row = await readStorageRow(db, siteId, exchangeBookingStorageKey(orderId), forUpdate);
  return row ? requireExchangeBookingAtStorage(row.value, row.expiresAt, row.key) : null;
}

async function readExchange(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate: boolean,
): Promise<NpShopStoredExchange | null> {
  const row = await readStorageRow(db, siteId, exchangeStorageKey(orderId), forUpdate);
  return row ? requireExchangeAtStorage(row.value, row.expiresAt, row.key) : null;
}

export async function npReadStoredShopCarrierLabelAcquisition(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  shipmentId: string,
  forUpdate = false,
): Promise<NpShopStoredCarrierLabelAcquisition | null> {
  const row = await readStorageRow(
    db,
    siteId,
    npShopCarrierLabelAcquisitionStorageKey(shipmentId),
    forUpdate,
  );
  return row
    ? npRequireStoredShopCarrierLabelAcquisitionAtKey(row.value, row.expiresAt, row.key)
    : null;
}

function replacementMatches(
  booking: NpShopStoredExchangeCarrierBooking,
  exchange: NpShopStoredExchange,
): boolean {
  if (booking.completedExchangeRevision === null) return false;
  const revisionMatches =
    exchange.status === "processing"
      ? exchange.revision === booking.completedExchangeRevision
      : exchange.status === "shipped"
        ? exchange.revision === booking.completedExchangeRevision + 1
        : false;
  return (
    booking.status === "completed" &&
    exchange.id === booking.exchangeId &&
    revisionMatches &&
    exchange.carrier === booking.carrier &&
    exchange.trackingNumber === booking.trackingNumber
  );
}

function acquisitionMatchesRetainedReplacement(
  acquisition: NpShopStoredCarrierLabelAcquisition,
  booking: NpShopStoredExchangeCarrierBooking,
  exchange: NpShopStoredExchange,
): boolean {
  if (
    booking.completedExchangeRevision === null ||
    acquisition.target !== "replacement" ||
    acquisition.exchangeId !== booking.exchangeId ||
    acquisition.shipmentId !== booking.id ||
    acquisition.orderId !== booking.orderId ||
    acquisition.providerId !== booking.providerId ||
    acquisition.sourceRevision !== booking.completedExchangeRevision ||
    acquisition.bookingReference !== booking.bookingReference ||
    acquisition.carrier !== booking.carrier ||
    acquisition.trackingNumber !== booking.trackingNumber ||
    acquisition.purgeAt !== booking.purgeAt ||
    exchange.id !== booking.exchangeId
  ) {
    return false;
  }
  if (booking.status === "cancelled") {
    return (
      exchange.status === "cancelled" && exchange.revision === booking.completedExchangeRevision + 1
    );
  }
  if (
    booking.status === "completed" ||
    booking.status === "cancel-pending" ||
    booking.status === "cancel-confirmed"
  ) {
    return (
      exchange.carrier === booking.carrier &&
      exchange.trackingNumber === booking.trackingNumber &&
      ((exchange.status === "processing" &&
        exchange.revision === booking.completedExchangeRevision) ||
        (booking.status === "completed" &&
          exchange.status === "shipped" &&
          exchange.revision === booking.completedExchangeRevision + 1))
    );
  }
  return false;
}

function acquisitionMatchesRetainedOutbound(
  acquisition: NpShopStoredCarrierLabelAcquisition,
  booking: NpShopStoredCarrierBooking,
): boolean {
  return (
    acquisition.target === "outbound" &&
    acquisition.exchangeId === null &&
    booking.status === "completed" &&
    acquisition.shipmentId === booking.id &&
    acquisition.orderId === booking.orderId &&
    acquisition.providerId === booking.providerId &&
    acquisition.sourceRevision === booking.fulfillmentRevision &&
    acquisition.bookingReference === booking.bookingReference &&
    acquisition.carrier === booking.carrier &&
    acquisition.trackingNumber === booking.trackingNumber &&
    acquisition.purgeAt === booking.purgeAt
  );
}

export async function npReadShopCarrierLabelSource(
  tx: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  input: { orderId: string; shipmentId: string },
  providerId: string,
  forUpdate = false,
): Promise<NpShopCarrierLabelSource> {
  const sources: NpShopCarrierLabelSource[] = [];
  // Cross-domain transitions lock the exchange before either booking.
  const exchange = await readExchange(tx, siteId, input.orderId, forUpdate);
  const outbound = await readBooking(tx, siteId, input.orderId, forUpdate);
  let candidateCount = outbound?.id === input.shipmentId ? 1 : 0;
  if (
    outbound?.id === input.shipmentId &&
    outbound.status === "completed" &&
    outbound.providerId === providerId &&
    outbound.bookingReference &&
    outbound.carrier &&
    outbound.trackingNumber
  ) {
    sources.push({
      target: "outbound",
      shipmentId: outbound.id,
      orderId: outbound.orderId,
      providerId: outbound.providerId,
      bookingReference: outbound.bookingReference,
      carrier: outbound.carrier,
      trackingNumber: outbound.trackingNumber,
      exchangeId: null,
      sourceRevision: outbound.fulfillmentRevision,
      purgeAt: outbound.purgeAt,
    });
  }
  const replacement = await readExchangeBooking(tx, siteId, input.orderId, forUpdate);
  if (replacement?.id === input.shipmentId) candidateCount += 1;
  if (
    replacement?.id === input.shipmentId &&
    replacement.providerId === providerId &&
    replacement.bookingReference &&
    replacement.carrier &&
    replacement.trackingNumber &&
    replacement.completedExchangeRevision !== null &&
    exchange &&
    replacementMatches(replacement, exchange)
  ) {
    sources.push({
      target: "replacement",
      shipmentId: replacement.id,
      orderId: replacement.orderId,
      providerId: replacement.providerId,
      bookingReference: replacement.bookingReference,
      carrier: replacement.carrier,
      trackingNumber: replacement.trackingNumber,
      exchangeId: replacement.exchangeId,
      sourceRevision: replacement.completedExchangeRevision,
      purgeAt: replacement.purgeAt,
    });
  }
  if (candidateCount !== 1 || sources.length !== 1) {
    throw new NpShopCarrierConflictError(
      "carrier_label_not_available",
      "One exact completed outbound or replacement booking is required for label acquisition.",
    );
  }
  return sources[0];
}

async function requireNoTracking(
  tx: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  source: NpShopCarrierLabelSource,
  forUpdate: boolean,
): Promise<void> {
  const key =
    source.target === "replacement"
      ? npShopExchangeTrackingStorageKey(source.orderId)
      : npShopTrackingStorageKey(source.orderId);
  const row = await readStorageRow(tx, siteId, key, forUpdate);
  if (!row) return;
  const tracking = npRequireStoredShopTracking(row.value);
  if (
    row.key !== key ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== tracking.purgeAt ||
    tracking.orderId !== source.orderId ||
    tracking.shipmentId !== source.shipmentId
  ) {
    throw new NpShopCarrierLabelAcquisitionContractError(
      "Invalid label acquisition tracking metadata",
      ["tracking key, shipment, and expiry must match their canonical values."],
    );
  }
  throw new NpShopCarrierLabelAcquisitionConflictError(
    "label_acquisition_tracking_started",
    "A verified tracking state blocks label purchase and regeneration.",
  );
}

export function npShopCarrierLabelAcquisitionMatchesSource(
  acquisition: NpShopStoredCarrierLabelAcquisition,
  source: NpShopCarrierLabelSource,
): boolean {
  return (
    acquisition.shipmentId === source.shipmentId &&
    acquisition.orderId === source.orderId &&
    acquisition.target === source.target &&
    acquisition.exchangeId === source.exchangeId &&
    acquisition.providerId === source.providerId &&
    acquisition.sourceRevision === source.sourceRevision &&
    acquisition.bookingReference === source.bookingReference &&
    acquisition.carrier === source.carrier &&
    acquisition.trackingNumber === source.trackingNumber &&
    acquisition.purgeAt === source.purgeAt
  );
}

async function persistAcquisition(
  tx: NpShopTransaction,
  siteId: string,
  acquisition: NpShopStoredCarrierLabelAcquisition,
): Promise<void> {
  npRequireStoredShopCarrierLabelAcquisition(acquisition);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopCarrierLabelAcquisitionStorageKey(acquisition.shipmentId),
      value: acquisition,
      expiresAt: new Date(acquisition.purgeAt),
      updatedAt: new Date(acquisition.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: acquisition,
        expiresAt: new Date(acquisition.purgeAt),
        updatedAt: new Date(acquisition.updatedAt),
      },
    });
}

async function recordAudit(
  tx: NpShopTransaction,
  siteId: string,
  userId: string,
  action: string,
  acquisition: NpShopStoredCarrierLabelAcquisition,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(npAuditEvents).values({
    actorKind: "staff",
    actorUserId: userId,
    actorMemberId: null,
    action,
    targetType: "shop-order",
    targetId: acquisition.orderId,
    payload: {
      acquisitionId: acquisition.id,
      shipmentId: acquisition.shipmentId,
      target: acquisition.target,
      exchangeId: acquisition.exchangeId,
      generation: acquisition.generation,
      operation: acquisition.operation,
      ...payload,
    },
    siteId,
  });
}

function nextTimestamp(...values: Array<string | null>): string {
  return new Date(
    Math.max(Date.now(), ...values.flatMap((value) => (value ? [new Date(value).getTime()] : []))),
  ).toISOString();
}

function closedProviderCode(error: NpShopCarrierProviderError): string {
  const code = error.code.trim();
  return /^[a-z][a-z0-9-]{0,99}$/u.test(code) ? code : "provider-error";
}

async function markManualReview(
  siteId: string,
  shipmentId: string,
  acquisitionId: string,
  providerErrorCode: string,
  expectedStatuses: readonly NpShopStoredCarrierLabelAcquisition["status"][],
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const current = await npReadStoredShopCarrierLabelAcquisition(tx, siteId, shipmentId, true);
    if (!current || current.id !== acquisitionId || !expectedStatuses.includes(current.status)) {
      return;
    }
    await persistAcquisition(tx, siteId, {
      ...current,
      status: "manual-review",
      revision: current.revision + 1,
      providerErrorCode,
      updatedAt: nextTimestamp(current.updatedAt, current.confirmedAt),
    });
  });
}

function requireInputMatchesSource(
  input: NpShopCarrierLabelAcquisitionActionInput,
  source: NpShopCarrierLabelSource,
): void {
  if (input.target !== source.target || input.exchangeId !== source.exchangeId) {
    throw new NpShopCarrierLabelAcquisitionConflictError(
      "label_acquisition_booking_not_found",
      "The label acquisition target does not match its booking.",
    );
  }
}

export async function npAcquireShopCarrierShippingLabel(
  runtime: NpShopRuntime,
  input: NpShopCarrierLabelAcquisitionActionInput,
  staffUserId: string,
): Promise<{ acquisition: NpShopStoredCarrierLabelAcquisition; duplicate: boolean }> {
  const adapter = runtime.carrierLabelAcquisitionAdapter;
  if (!adapter) {
    throw new NpShopCarrierLabelAcquisitionConflictError(
      "label_acquisition_not_supported",
      "The configured carrier does not expose label purchase and regeneration.",
    );
  }
  const siteId = await requireSiteId();
  const prepared = await getDb().transaction(async (tx) => {
    const source = await npReadShopCarrierLabelSource(tx, siteId, input, adapter.id, true);
    requireInputMatchesSource(input, source);
    await requireNoTracking(tx, siteId, source, true);
    const existing = await npReadStoredShopCarrierLabelAcquisition(
      tx,
      siteId,
      source.shipmentId,
      true,
    );
    if (existing && !npShopCarrierLabelAcquisitionMatchesSource(existing, source)) {
      throw new NpShopCarrierLabelAcquisitionConflictError(
        "label_acquisition_state_conflict",
        "The durable label acquisition belongs to a different booking revision.",
      );
    }
    if ((existing?.revision ?? 0) !== input.expectedRevision) {
      throw new NpShopCarrierLabelAcquisitionConflictError(
        "label_acquisition_revision_conflict",
        "The label acquisition changed before this action started.",
      );
    }
    if (existing?.status === "manual-review") {
      throw new NpShopCarrierLabelAcquisitionConflictError(
        "label_acquisition_manual_review",
        "The current label acquisition requires manual reconciliation.",
      );
    }
    if (existing?.status === "pending" || existing?.status === "provider-confirmed") {
      return { acquisition: existing };
    }
    const requestedAt = nextTimestamp(existing?.updatedAt ?? null);
    const acquisition: NpShopStoredCarrierLabelAcquisition = {
      contract: NP_SHOP_CARRIER_LABEL_ACQUISITION_STORAGE_CONTRACT,
      id: randomUUID(),
      shipmentId: source.shipmentId,
      orderId: source.orderId,
      target: source.target,
      exchangeId: source.exchangeId,
      providerId: source.providerId,
      status: "pending",
      revision: (existing?.revision ?? 0) + 1,
      sourceRevision: source.sourceRevision,
      generation: (existing?.generation ?? 0) + 1,
      operation: existing ? "regenerate" : "purchase",
      bookingReference: source.bookingReference,
      carrier: source.carrier,
      trackingNumber: source.trackingNumber,
      replacesLabelReference: existing?.labelReference ?? null,
      labelReference: null,
      providerErrorCode: null,
      requestedAt,
      confirmedAt: null,
      updatedAt: requestedAt,
      purgeAt: source.purgeAt,
    };
    await persistAcquisition(tx, siteId, acquisition);
    await recordAudit(tx, siteId, staffUserId, "shop.carrier.label.acquire.prepare", acquisition, {
      providerId: acquisition.providerId,
      sourceRevision: acquisition.sourceRevision,
    });
    return { acquisition };
  });
  let acquisition = prepared.acquisition;
  if (acquisition.status === "pending") {
    const request = npRequireShopCarrierLabelAcquisitionRequest({
      contract: NP_SHOP_CARRIER_LABEL_ACQUISITION_REQUEST_CONTRACT,
      acquisitionId: acquisition.id,
      shipmentId: acquisition.shipmentId,
      orderId: acquisition.orderId,
      generation: acquisition.generation,
      operation: acquisition.operation,
      bookingReference: acquisition.bookingReference,
      carrier: acquisition.carrier,
      trackingNumber: acquisition.trackingNumber,
      replacesLabelReference: acquisition.replacesLabelReference,
      requestedAt: acquisition.requestedAt,
    });
    let result: NpShopCarrierLabelAcquisitionResult;
    try {
      result = npRequireShopCarrierLabelAcquisitionResult(
        await adapter.acquireShippingLabel(request),
      );
    } catch (error) {
      if (error instanceof NpShopCarrierProviderError) {
        if (!error.retryable) {
          await markManualReview(
            siteId,
            acquisition.shipmentId,
            acquisition.id,
            closedProviderCode(error),
            ["pending", "provider-confirmed", "completed"],
          );
          throw new NpShopCarrierLabelAcquisitionConflictError(
            "label_acquisition_manual_review",
            "The carrier rejected this stable label acquisition; manual review is required.",
          );
        }
        throw new NpShopCarrierUnavailableError(
          "The carrier label service is temporarily unavailable; retry the same acquisition.",
        );
      }
      if (error instanceof NpShopCarrierLabelAcquisitionContractError) {
        await markManualReview(siteId, acquisition.shipmentId, acquisition.id, "invalid-result", [
          "pending",
          "provider-confirmed",
          "completed",
        ]);
        throw new NpShopCarrierLabelAcquisitionConflictError(
          "label_acquisition_result_mismatch",
          "The carrier returned an invalid label acquisition result; manual review is required.",
        );
      }
      throw new NpShopCarrierUnavailableError(
        "The carrier label service is temporarily unavailable; retry the same acquisition.",
      );
    }
    const acquiredAt = new Date(result.acquiredAt).getTime();
    if (
      result.acquisitionId !== request.acquisitionId ||
      result.shipmentId !== request.shipmentId ||
      result.orderId !== request.orderId ||
      result.generation !== request.generation ||
      result.operation !== request.operation ||
      acquiredAt < new Date(request.requestedAt).getTime() ||
      acquiredAt > Date.now() + npShopCarrierLabelAcquisitionLimits.futureToleranceSeconds * 1_000
    ) {
      await markManualReview(siteId, acquisition.shipmentId, acquisition.id, "invalid-result", [
        "pending",
        "provider-confirmed",
        "completed",
      ]);
      throw new NpShopCarrierLabelAcquisitionConflictError(
        "label_acquisition_result_mismatch",
        "The carrier label acquisition result does not match the durable request.",
      );
    }
    try {
      acquisition = await getDb().transaction(async (tx) => {
        const source = await npReadShopCarrierLabelSource(tx, siteId, input, adapter.id, true);
        requireInputMatchesSource(input, source);
        await requireNoTracking(tx, siteId, source, true);
        const current = await npReadStoredShopCarrierLabelAcquisition(
          tx,
          siteId,
          acquisition.shipmentId,
          true,
        );
        if (
          !current ||
          current.id !== acquisition.id ||
          !npShopCarrierLabelAcquisitionMatchesSource(current, source)
        ) {
          throw new NpShopCarrierLabelAcquisitionConflictError(
            "label_acquisition_state_conflict",
            "The label acquisition changed before provider confirmation was stored.",
          );
        }
        if (current.status === "provider-confirmed" || current.status === "completed") {
          if (
            current.labelReference === result.labelReference &&
            current.confirmedAt === result.acquiredAt
          ) {
            return current;
          }
          throw new NpShopCarrierLabelAcquisitionConflictError(
            "label_acquisition_result_mismatch",
            "The carrier returned conflicting results for one label acquisition id.",
          );
        }
        if (current.status !== "pending") {
          throw new NpShopCarrierLabelAcquisitionConflictError(
            "label_acquisition_state_conflict",
            "The label acquisition cannot accept provider confirmation in its current state.",
          );
        }
        const confirmed: NpShopStoredCarrierLabelAcquisition = {
          ...current,
          status: "provider-confirmed",
          revision: current.revision + 1,
          labelReference: result.labelReference,
          confirmedAt: result.acquiredAt,
          updatedAt: nextTimestamp(current.updatedAt, result.acquiredAt),
        };
        await persistAcquisition(tx, siteId, confirmed);
        await recordAudit(
          tx,
          siteId,
          staffUserId,
          "shop.carrier.label.acquire.confirm",
          confirmed,
          {
            providerId: confirmed.providerId,
          },
        );
        return confirmed;
      });
    } catch (error) {
      await markManualReview(
        siteId,
        acquisition.shipmentId,
        acquisition.id,
        "local-state-conflict",
        ["pending", "provider-confirmed", "completed"],
      );
      throw new NpShopCarrierLabelAcquisitionConflictError(
        "label_acquisition_manual_review",
        `The carrier acquired a label but confirmation requires manual reconciliation: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
  if (acquisition.status === "completed") {
    return { acquisition, duplicate: true };
  }
  try {
    return await getDb().transaction(async (tx) => {
      const source = await npReadShopCarrierLabelSource(tx, siteId, input, adapter.id, true);
      requireInputMatchesSource(input, source);
      await requireNoTracking(tx, siteId, source, true);
      const current = await npReadStoredShopCarrierLabelAcquisition(
        tx,
        siteId,
        acquisition.shipmentId,
        true,
      );
      if (current?.id === acquisition.id && current.status === "completed") {
        return { acquisition: current, duplicate: true };
      }
      if (
        !current ||
        current.id !== acquisition.id ||
        current.status !== "provider-confirmed" ||
        !npShopCarrierLabelAcquisitionMatchesSource(current, source)
      ) {
        throw new NpShopCarrierLabelAcquisitionConflictError(
          "label_acquisition_state_conflict",
          "The provider-confirmed label acquisition cannot be completed locally.",
        );
      }
      const completed: NpShopStoredCarrierLabelAcquisition = {
        ...current,
        status: "completed",
        revision: current.revision + 1,
        updatedAt: nextTimestamp(current.updatedAt, current.confirmedAt),
      };
      await persistAcquisition(tx, siteId, completed);
      await recordAudit(tx, siteId, staffUserId, "shop.carrier.label.acquire.complete", completed, {
        providerId: completed.providerId,
      });
      return { acquisition: completed, duplicate: false };
    });
  } catch (error) {
    await markManualReview(siteId, acquisition.shipmentId, acquisition.id, "local-state-conflict", [
      "provider-confirmed",
    ]);
    throw new NpShopCarrierLabelAcquisitionConflictError(
      "label_acquisition_manual_review",
      `The carrier acquired a label but local completion requires manual reconciliation: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export async function npListRecentShopCarrierLabelAcquisitions(): Promise<{
  rows: NpShopAdminCarrierLabelAcquisitionRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "carrier-label-acquisition:%"),
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
    .limit(npShopCarrierLabelAcquisitionLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(where);
  return {
    rows: rows.map((row) => {
      const acquisition = npRequireStoredShopCarrierLabelAcquisitionAtKey(
        row.value,
        row.expiresAt,
        row.key,
      );
      return {
        id: acquisition.orderId,
        acquisitionId: acquisition.id,
        expectedRevision: acquisition.revision,
        shipmentId: acquisition.shipmentId,
        target: acquisition.target,
        exchangeId: acquisition.exchangeId,
        provider: acquisition.providerId,
        status: acquisition.status,
        operation: acquisition.operation,
        generation: acquisition.generation,
        labelReference: acquisition.labelReference ?? "—",
        providerError: acquisition.providerErrorCode ?? "—",
        updatedAt: acquisition.updatedAt,
      };
    }),
    total: Number(total),
  };
}

export async function npCountShopCarrierLabelAcquisitions(expectedProviderId?: string): Promise<{
  total: number;
  outbound: number;
  replacement: number;
  pending: number;
  providerConfirmed: number;
  completed: number;
  manualReview: number;
  invalidSample: number;
  orphanSample: number;
  bookingMismatchSample: number;
  providerMismatchSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "carrier-label-acquisition:%"),
  );
  const [aggregate] = await db
    .select({
      total: sql<number>`count(*)::int`,
      outbound: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'target' = 'outbound')::int`,
      replacement: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'target' = 'replacement')::int`,
      pending: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'pending')::int`,
      providerConfirmed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'provider-confirmed')::int`,
      completed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'completed')::int`,
      manualReview: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'manual-review')::int`,
    })
    .from(npPluginStorage)
    .where(where);
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(where)
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopCarrierLabelAcquisitionLimits.diagnosticSampleSize);
  const counts = {
    total: Number(aggregate?.total ?? 0),
    outbound: Number(aggregate?.outbound ?? 0),
    replacement: Number(aggregate?.replacement ?? 0),
    pending: Number(aggregate?.pending ?? 0),
    providerConfirmed: Number(aggregate?.providerConfirmed ?? 0),
    completed: Number(aggregate?.completed ?? 0),
    manualReview: Number(aggregate?.manualReview ?? 0),
    invalidSample: 0,
    orphanSample: 0,
    bookingMismatchSample: 0,
    providerMismatchSample: 0,
  };
  for (const row of rows) {
    try {
      const acquisition = npRequireStoredShopCarrierLabelAcquisitionAtKey(
        row.value,
        row.expiresAt,
        row.key,
      );
      if (expectedProviderId && acquisition.providerId !== expectedProviderId) {
        counts.providerMismatchSample += 1;
      }
      const [outbound, replacement, exchange] = await Promise.all([
        readBooking(db, siteId, acquisition.orderId, false),
        readExchangeBooking(db, siteId, acquisition.orderId, false),
        readExchange(db, siteId, acquisition.orderId, false),
      ]);
      const relevantBooking = acquisition.target === "outbound" ? outbound : replacement;
      if (!relevantBooking) {
        counts.orphanSample += 1;
      } else if (
        acquisition.target === "outbound"
          ? !acquisitionMatchesRetainedOutbound(
              acquisition,
              relevantBooking as NpShopStoredCarrierBooking,
            )
          : !exchange ||
            !acquisitionMatchesRetainedReplacement(
              acquisition,
              relevantBooking as NpShopStoredExchangeCarrierBooking,
              exchange,
            )
      ) {
        counts.bookingMismatchSample += 1;
      }
    } catch {
      counts.invalidSample += 1;
    }
  }
  return counts;
}
