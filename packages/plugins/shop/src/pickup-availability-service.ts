import { createHash, randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, inArray, like, lte, sql } from "drizzle-orm";

import {
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_HEALTH_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT,
  NpShopCarrierPickupAvailabilityConflictError,
  NpShopCarrierPickupAvailabilityContractError,
  NpShopCarrierPickupAvailabilityUnavailableError,
  npRequireShopCarrierPickupAvailabilityHealth,
  npRequireShopCarrierPickupAvailabilityRequest,
  npRequireShopCarrierPickupAvailabilityResult,
  npRequireStoredShopCarrierPickupAvailability,
  npShopCarrierPickupAvailabilityLimits,
  type NpShopCarrierPickupAvailabilityHealth,
  type NpShopCarrierPickupAvailabilityQueryInput,
  type NpShopCarrierPickupAvailabilitySelectionInput,
  type NpShopStoredCarrierPickupAvailability,
} from "./pickup-availability-contract.js";
import {
  npInspectShopCarrierPickupAvailabilityContext,
  npLockShopCarrierPickupAvailabilityContext,
  npReadShopCarrierPickupSummary,
  npResolveShopCarrierPickupAvailabilityContext,
  npScheduleShopCarrierPickup,
} from "./pickup-service.js";
import type { NpShopCarrierPickupPackage } from "./pickup-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import type { NpShopRuntime } from "./runtime.js";

const STORAGE_PREFIX = "carrier-pickup-availability:";
const HEALTH_KEY = "carrier-pickup-availability-health";

export interface NpShopAdminCarrierPickupAvailabilityRow {
  [key: string]: unknown;
  id: string;
  shipmentId: string;
  pickupTarget: "outbound" | "replacement";
  exchangeId: string | null;
  pickupRevision: number;
  availabilityId: string;
  availabilityRevision: number;
  windowId: string;
  provider: string;
  window: string;
  packages: number;
  weightGrams: number;
  expiresAt: string;
}

export interface NpShopCarrierPickupAvailabilityCounts {
  total: number;
  windows: number;
  expired: number;
  invalidSample: number;
  providerMismatchSample: number;
  stateMismatchSample: number;
}

export function npShopCarrierPickupAvailabilityStorageKey(
  shipmentId: string,
  availabilityId: string,
): string {
  return `${STORAGE_PREFIX}${shipmentId}:${availabilityId}`;
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

function bookingFingerprint(booking: {
  bookingReference: string | null;
  carrier: string | null;
  trackingNumber: string | null;
}): string {
  if (!booking.bookingReference || !booking.carrier || !booking.trackingNumber) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_state_conflict",
      "The completed carrier booking is missing exact provider references.",
    );
  }
  return createHash("sha256")
    .update(JSON.stringify([booking.bookingReference, booking.carrier, booking.trackingNumber]))
    .digest("hex");
}

async function readAvailability(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  shipmentId: string,
  availabilityId: string,
  forUpdate = false,
): Promise<NpShopStoredCarrierPickupAvailability | null> {
  const key = npShopCarrierPickupAvailabilityStorageKey(shipmentId, availabilityId);
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
  const value = npRequireStoredShopCarrierPickupAvailability(row.value);
  if (row.key !== key || row.expiresAt?.toISOString() !== value.expiresAt) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid carrier pickup availability storage metadata",
      ["availability key and expiry must match its canonical values."],
    );
  }
  return value;
}

async function persistAvailability(
  tx: NpShopTransaction,
  siteId: string,
  availability: NpShopStoredCarrierPickupAvailability,
): Promise<void> {
  npRequireStoredShopCarrierPickupAvailability(availability);
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: npShopCarrierPickupAvailabilityStorageKey(availability.shipmentId, availability.id),
    value: availability,
    expiresAt: new Date(availability.expiresAt),
    updatedAt: new Date(availability.requestedAt),
  });
}

async function readHealth(siteId: string): Promise<NpShopCarrierPickupAvailabilityHealth | null> {
  const [row] = await getDb()
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, HEALTH_KEY),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt !== null) {
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid carrier pickup availability health metadata",
      ["availability health must not expire."],
    );
  }
  return npRequireShopCarrierPickupAvailabilityHealth(row.value);
}

async function persistHealth(
  siteId: string,
  providerId: string,
  status: "ok" | "error",
  errorCode: "provider-error" | "invalid-result" | null,
  attemptedAt: string,
): Promise<void> {
  let previous: NpShopCarrierPickupAvailabilityHealth | null = null;
  try {
    previous = await readHealth(siteId);
  } catch {
    // A fresh exact health row replaces malformed diagnostic state.
  }
  const value = npRequireShopCarrierPickupAvailabilityHealth({
    contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_HEALTH_CONTRACT,
    providerId,
    status,
    errorCode,
    attemptedAt,
    succeededAt: status === "ok" ? attemptedAt : (previous?.succeededAt ?? null),
  });
  await getDb()
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: HEALTH_KEY,
      value,
      expiresAt: null,
      updatedAt: new Date(attemptedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: { value, expiresAt: null, updatedAt: new Date(attemptedAt) },
    });
}

function semanticResultIssues(
  result: ReturnType<typeof npRequireShopCarrierPickupAvailabilityResult>,
  availabilityId: string,
  requestedAt: string,
  maximumExpiresAt: string,
  purgeAt: string,
): string[] {
  const issues: string[] = [];
  const evaluatedAt = new Date().toISOString();
  if (result.availabilityId !== availabilityId) {
    issues.push("availabilityId does not match the request.");
  }
  if (
    result.expiresAt <= requestedAt ||
    result.expiresAt <= evaluatedAt ||
    result.expiresAt > maximumExpiresAt
  ) {
    issues.push("expiresAt is outside the requested lifetime.");
  }
  if (result.expiresAt > purgeAt) issues.push("expiresAt follows commercial retention.");
  const maximumWindowAt = new Date(
    new Date(requestedAt).getTime() +
      npShopCarrierPickupAvailabilityLimits.maximumLeadSeconds * 1_000,
  ).toISOString();
  for (const [index, window] of result.windows.entries()) {
    if (window.readyAt <= result.expiresAt) {
      issues.push(`window[${index.toString()}] does not begin after the availability expires.`);
    }
    if (window.readyAt > maximumWindowAt || window.closeAt > maximumWindowAt) {
      issues.push(`window[${index.toString()}] exceeds the 14-day horizon.`);
    }
    if (window.closeAt > purgeAt) {
      issues.push(`window[${index.toString()}] follows commercial retention.`);
    }
  }
  return issues;
}

export async function npListShopCarrierPickupWindows(
  runtime: NpShopRuntime,
  input: NpShopCarrierPickupAvailabilityQueryInput,
  staffUserId: string,
): Promise<NpShopStoredCarrierPickupAvailability> {
  const adapter = runtime.carrierPickupAvailabilityAdapter;
  if (!adapter) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_not_supported",
      "The carrier does not expose pickup availability.",
    );
  }
  const siteId = await requireSiteId();
  const context = await npResolveShopCarrierPickupAvailabilityContext(runtime, input);
  if (
    !context.booking.bookingReference ||
    !context.booking.carrier ||
    !context.booking.trackingNumber
  ) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_state_conflict",
      "The completed carrier booking is missing exact provider references.",
    );
  }
  const availabilityId = randomUUID();
  const sourceBookingFingerprint = bookingFingerprint(context.booking);
  const requestedAtDate = new Date();
  requestedAtDate.setMilliseconds(0);
  const requestedAt = requestedAtDate.toISOString();
  const maximumExpiresAt = new Date(
    requestedAtDate.getTime() +
      npShopCarrierPickupAvailabilityLimits.maximumLifetimeSeconds * 1_000,
  ).toISOString();
  const request = npRequireShopCarrierPickupAvailabilityRequest({
    contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_REQUEST_CONTRACT,
    availabilityId,
    shipmentId: input.shipmentId,
    orderId: input.orderId,
    bookingReference: context.booking.bookingReference,
    carrier: context.booking.carrier,
    trackingNumber: context.booking.trackingNumber,
    locationReference: context.locationReference,
    parcelRevision: context.parcelRevision,
    packages: context.packages,
    requestedAt,
    maximumExpiresAt,
  });
  let result: ReturnType<typeof npRequireShopCarrierPickupAvailabilityResult>;
  try {
    result = npRequireShopCarrierPickupAvailabilityResult(await adapter.listPickupWindows(request));
  } catch (error) {
    const invalid = error instanceof NpShopCarrierPickupAvailabilityContractError;
    await persistHealth(
      siteId,
      adapter.id,
      "error",
      invalid ? "invalid-result" : "provider-error",
      requestedAt,
    );
    throw new NpShopCarrierPickupAvailabilityUnavailableError();
  }
  const semanticIssues = semanticResultIssues(
    result,
    availabilityId,
    requestedAt,
    maximumExpiresAt,
    context.booking.purgeAt,
  );
  if (semanticIssues.length) {
    await persistHealth(siteId, adapter.id, "error", "invalid-result", requestedAt);
    throw new NpShopCarrierPickupAvailabilityContractError(
      "Invalid Shop carrier pickup availability result",
      semanticIssues,
    );
  }
  const availability = await getDb().transaction(async (tx) => {
    const current = await npLockShopCarrierPickupAvailabilityContext(runtime, input, siteId, tx);
    if (
      current.booking.id !== context.booking.id ||
      current.booking.bookingReference !== context.booking.bookingReference ||
      current.booking.carrier !== context.booking.carrier ||
      current.booking.trackingNumber !== context.booking.trackingNumber ||
      bookingFingerprint(current.booking) !== sourceBookingFingerprint ||
      current.booking.purgeAt !== context.booking.purgeAt ||
      current.locationReference !== context.locationReference ||
      current.parcelRevision !== context.parcelRevision ||
      !samePackages(current.packages, context.packages)
    ) {
      throw new NpShopCarrierPickupAvailabilityConflictError(
        "pickup_availability_state_conflict",
        "The carrier booking or parcel snapshot changed while availability was loading.",
      );
    }
    const stored = npRequireStoredShopCarrierPickupAvailability({
      contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT,
      id: availabilityId,
      orderId: input.orderId,
      shipmentId: input.shipmentId,
      target: input.target,
      exchangeId: input.exchangeId,
      providerId: adapter.id,
      bookingFingerprint: sourceBookingFingerprint,
      revision: 1,
      locationReference: context.locationReference,
      parcelRevision: context.parcelRevision,
      packages: context.packages,
      windows: result.windows,
      requestedAt,
      expiresAt: result.expiresAt,
      purgeAt: context.booking.purgeAt,
    });
    await persistAvailability(tx, siteId, stored);
    await tx.insert(npAuditEvents).values({
      actorKind: "staff",
      actorUserId: staffUserId,
      actorMemberId: null,
      action: "shop.carrier.pickup.availability.list",
      targetType: "shop-order",
      targetId: stored.orderId,
      payload: {
        availabilityId: stored.id,
        shipmentId: stored.shipmentId,
        pickupTarget: stored.target,
        exchangeId: stored.exchangeId,
        providerId: stored.providerId,
        parcelRevision: stored.parcelRevision,
        windows: stored.windows.length,
        expiresAt: stored.expiresAt,
      },
      siteId,
    });
    return stored;
  });
  await persistHealth(siteId, adapter.id, "ok", null, requestedAt);
  return availability;
}

export async function npScheduleShopCarrierPickupWindow(
  runtime: NpShopRuntime,
  input: NpShopCarrierPickupAvailabilitySelectionInput,
  staffUserId: string,
): ReturnType<typeof npScheduleShopCarrierPickup> {
  const adapter = runtime.carrierPickupAvailabilityAdapter;
  if (!adapter) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_not_supported",
      "The carrier does not expose pickup availability.",
    );
  }
  const siteId = await requireSiteId();
  const availability = await readAvailability(
    getDb(),
    siteId,
    input.shipmentId,
    input.availabilityId,
  );
  if (
    !availability ||
    availability.orderId !== input.orderId ||
    availability.target !== input.target ||
    availability.exchangeId !== input.exchangeId ||
    availability.providerId !== adapter.id
  ) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_not_found",
      "The selected pickup availability snapshot was not found.",
    );
  }
  if (availability.revision !== input.expectedAvailabilityRevision) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_revision_conflict",
      "The pickup availability snapshot changed before selection.",
    );
  }
  if (availability.expiresAt <= new Date().toISOString()) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_expired",
      "The selected pickup availability snapshot expired.",
    );
  }
  const window = availability.windows.find((candidate) => candidate.id === input.windowId);
  if (!window) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_window_not_found",
      "The selected provider window does not exist in this snapshot.",
    );
  }
  const context = await npResolveShopCarrierPickupAvailabilityContext(runtime, {
    orderId: input.orderId,
    shipmentId: input.shipmentId,
    target: input.target,
    exchangeId: input.exchangeId,
    expectedPickupRevision: input.expectedPickupRevision,
  });
  if (
    context.booking.purgeAt !== availability.purgeAt ||
    bookingFingerprint(context.booking) !== availability.bookingFingerprint ||
    context.locationReference !== availability.locationReference ||
    context.parcelRevision !== availability.parcelRevision ||
    !samePackages(context.packages, availability.packages)
  ) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_state_conflict",
      "The selected window no longer matches the carrier booking and parcel snapshot.",
    );
  }
  let result: Awaited<ReturnType<typeof npScheduleShopCarrierPickup>>;
  try {
    result = await npScheduleShopCarrierPickup(
      runtime,
      {
        orderId: input.orderId,
        shipmentId: input.shipmentId,
        target: input.target,
        exchangeId: input.exchangeId,
        expectedRevision: input.expectedPickupRevision,
        readyAt: window.readyAt,
        closeAt: window.closeAt,
      },
      staffUserId,
    );
  } catch (error) {
    const pickup = await npReadShopCarrierPickupSummary(input.shipmentId);
    if (pickup && pickup.readyAt === window.readyAt && pickup.closeAt === window.closeAt) {
      await consumeAvailability(
        siteId,
        input,
        window.readyAt,
        window.closeAt,
        pickup.pickupId,
        staffUserId,
      );
    }
    throw error;
  }
  if (result.pickup.readyAt !== window.readyAt || result.pickup.closeAt !== window.closeAt) {
    throw new NpShopCarrierPickupAvailabilityConflictError(
      "pickup_availability_state_conflict",
      "Another pickup window was scheduled before this exact selection completed.",
    );
  }
  await consumeAvailability(
    siteId,
    input,
    window.readyAt,
    window.closeAt,
    result.pickup.id,
    staffUserId,
  );
  return result;
}

async function consumeAvailability(
  siteId: string,
  input: NpShopCarrierPickupAvailabilitySelectionInput,
  readyAt: string,
  closeAt: string,
  pickupId: string,
  staffUserId: string,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const current = await readAvailability(
      tx,
      siteId,
      input.shipmentId,
      input.availabilityId,
      true,
    );
    if (current) {
      await tx
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(
              npPluginStorage.key,
              npShopCarrierPickupAvailabilityStorageKey(input.shipmentId, input.availabilityId),
            ),
          ),
        );
    }
    await tx.insert(npAuditEvents).values({
      actorKind: "staff",
      actorUserId: staffUserId,
      actorMemberId: null,
      action: "shop.carrier.pickup.availability.select",
      targetType: "shop-order",
      targetId: input.orderId,
      payload: {
        availabilityId: input.availabilityId,
        windowId: input.windowId,
        pickupId,
        shipmentId: input.shipmentId,
        pickupTarget: input.target,
        exchangeId: input.exchangeId,
        readyAt,
        closeAt,
      },
      siteId,
    });
  });
}

export async function npListRecentShopCarrierPickupAvailability(): Promise<{
  rows: NpShopAdminCarrierPickupAvailabilityRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
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
        like(npPluginStorage.key, `${STORAGE_PREFIX}%`),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopCarrierPickupAvailabilityLimits.adminListSize);
  const projected = rows.flatMap((row) => {
    const availability = npRequireStoredShopCarrierPickupAvailability(row.value);
    if (
      row.key !==
        npShopCarrierPickupAvailabilityStorageKey(availability.shipmentId, availability.id) ||
      row.expiresAt?.toISOString() !== availability.expiresAt
    ) {
      throw new NpShopCarrierPickupAvailabilityContractError(
        "Invalid carrier pickup availability storage metadata",
        ["availability key and expiry must match its canonical values."],
      );
    }
    return availability.windows.map((window) => ({
      id: availability.orderId,
      shipmentId: availability.shipmentId,
      pickupTarget: availability.target,
      exchangeId: availability.exchangeId,
      pickupRevision: 0,
      availabilityId: availability.id,
      availabilityRevision: availability.revision,
      windowId: window.id,
      provider: availability.providerId,
      window: `${window.readyAt} – ${window.closeAt}`,
      packages: availability.packages.length,
      weightGrams: availability.packages.reduce((sum, item) => sum + item.weightGrams, 0),
      expiresAt: availability.expiresAt,
    }));
  });
  return {
    rows: projected.slice(0, npShopCarrierPickupAvailabilityLimits.adminListSize),
    total: projected.length,
  };
}

export async function npCountShopCarrierPickupAvailability(
  runtime: NpShopRuntime,
): Promise<NpShopCarrierPickupAvailabilityCounts> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, `${STORAGE_PREFIX}%`),
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
    .limit(npShopCarrierPickupAvailabilityLimits.diagnosticSampleSize);
  const counts: NpShopCarrierPickupAvailabilityCounts = {
    total: Number(total),
    windows: 0,
    expired: 0,
    invalidSample: 0,
    providerMismatchSample: 0,
    stateMismatchSample: 0,
  };
  const now = new Date().toISOString();
  for (const row of rows) {
    try {
      const availability = npRequireStoredShopCarrierPickupAvailability(row.value);
      if (
        row.key !==
          npShopCarrierPickupAvailabilityStorageKey(availability.shipmentId, availability.id) ||
        row.expiresAt?.toISOString() !== availability.expiresAt
      ) {
        throw new Error("metadata mismatch");
      }
      counts.windows += availability.windows.length;
      if (availability.expiresAt <= now) counts.expired += 1;
      if (
        runtime.carrierPickupAvailabilityAdapter &&
        availability.providerId !== runtime.carrierPickupAvailabilityAdapter.id
      ) {
        counts.providerMismatchSample += 1;
      }
      if (availability.expiresAt > now && runtime.carrierPickupAdapter) {
        try {
          const context = await npInspectShopCarrierPickupAvailabilityContext(runtime, {
            orderId: availability.orderId,
            shipmentId: availability.shipmentId,
            target: availability.target,
            exchangeId: availability.exchangeId,
            expectedPickupRevision: 0,
          });
          if (
            context.booking.purgeAt !== availability.purgeAt ||
            bookingFingerprint(context.booking) !== availability.bookingFingerprint ||
            context.locationReference !== availability.locationReference ||
            context.parcelRevision !== availability.parcelRevision ||
            !samePackages(context.packages, availability.packages)
          ) {
            counts.stateMismatchSample += 1;
          }
        } catch {
          counts.stateMismatchSample += 1;
        }
      }
    } catch {
      counts.invalidSample += 1;
    }
  }
  return counts;
}

export async function npReadShopCarrierPickupAvailabilityHealth(): Promise<NpShopCarrierPickupAvailabilityHealth | null> {
  return readHealth(await requireSiteId());
}

export async function npCleanupExpiredShopCarrierPickupAvailability(
  now = new Date(),
): Promise<number> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `${STORAGE_PREFIX}%`),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopCarrierPickupAvailabilityLimits.cleanupBatchSize);
  if (!rows.length) return 0;
  const keys = rows.map((row) => row.key);
  const deleted = await db
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        inArray(npPluginStorage.key, keys),
      ),
    )
    .returning({ key: npPluginStorage.key });
  return deleted.length;
}
