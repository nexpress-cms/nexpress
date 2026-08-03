import { randomUUID } from "node:crypto";

import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

import {
  NpShopCarrierProviderError,
  npRequireStoredShopCarrierBooking,
  type NpShopStoredCarrierBooking,
} from "./carrier-contract.js";
import { npShopCartOwnerStorageSegment, type NpShopCartOwner } from "./cart-service.js";
import { npRequireStoredShopOrder, type NpShopStoredOrder } from "./order-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import {
  NP_SHOP_RETURN_LOGISTICS_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_PRIVATE_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_STORAGE_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_LABEL_REQUEST_CONTRACT,
  NpShopReturnLogisticsConflictError,
  NpShopReturnLogisticsContractError,
  NpShopReturnLogisticsProviderError,
  npProjectShopReturnLogistics,
  npRequireShopReturnLogisticsCancelRequest,
  npRequireShopReturnLogisticsCancelResult,
  npRequireShopReturnLogisticsLabelRequest,
  npRequireShopReturnLogisticsLabelResult,
  npRequireShopReturnLogisticsRequest,
  npRequireShopReturnLogisticsResult,
  npRequireStoredShopReturnLogistics,
  npRequireStoredShopReturnLogisticsPrivate,
  npShopReturnLogisticsLimits,
  type NpShopReturnLogistics,
  type NpShopReturnLogisticsCancelResult,
  type NpShopReturnLogisticsCreateInput,
  type NpShopReturnLogisticsExistingInput,
  type NpShopReturnLogisticsItem,
  type NpShopReturnLogisticsLabelReadInput,
  type NpShopReturnLogisticsLabelResult,
  type NpShopReturnLogisticsResult,
  type NpShopStoredReturnLogistics,
  type NpShopStoredReturnLogisticsPrivate,
} from "./return-logistics-contract.js";
import { npRequireStoredShopReturn, type NpShopStoredReturn } from "./return-contract.js";
import type { NpShopRuntime } from "./runtime.js";

export interface NpShopAdminReturnLogisticsRow {
  [key: string]: unknown;
  id: string;
  logisticsId: string;
  returnId: string;
  provider: string;
  mode: string;
  status: string;
  carrier: string;
  trackingNumber: string;
  providerError: string;
  privateOrigin: string;
  updatedAt: string;
}

export function npShopReturnLogisticsStorageKey(orderId: string): string {
  return `return-logistics:${orderId}`;
}

export function npShopReturnLogisticsPrivateStorageKey(orderId: string): string {
  return `return-logistics-private:${orderId}`;
}

function returnStorageKey(orderId: string): string {
  return `return:${orderId}`;
}

function bookingStorageKey(orderId: string): string {
  return `carrier-booking:${orderId}`;
}

function orderStorageKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

async function readRow(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  key: string,
  forUpdate = false,
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

function requireOrderAt(value: unknown, expiresAt: Date | null, key: string): NpShopStoredOrder {
  const order = npRequireStoredShopOrder(value);
  if (
    key !== orderStorageKey(order.ownerSegment, order.id) ||
    expiresAt === null ||
    expiresAt.toISOString() !== order.purgeAt
  ) {
    throw new NpShopReturnLogisticsContractError("Invalid return logistics order metadata", [
      "order key and expiry must match its canonical values.",
    ]);
  }
  return order;
}

function requireReturnAt(value: unknown, expiresAt: Date | null, key: string): NpShopStoredReturn {
  const returnRequest = npRequireStoredShopReturn(value);
  if (
    key !== returnStorageKey(returnRequest.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== returnRequest.purgeAt
  ) {
    throw new NpShopReturnLogisticsContractError("Invalid return logistics return metadata", [
      "return key and expiry must match its canonical values.",
    ]);
  }
  return returnRequest;
}

function requireBookingAt(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredCarrierBooking {
  const booking = npRequireStoredShopCarrierBooking(value);
  if (
    key !== bookingStorageKey(booking.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== booking.purgeAt
  ) {
    throw new NpShopReturnLogisticsContractError("Invalid return logistics booking metadata", [
      "booking key and expiry must match its canonical values.",
    ]);
  }
  return booking;
}

function requireLogisticsAt(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredReturnLogistics {
  const logistics = npRequireStoredShopReturnLogistics(value);
  if (
    key !== npShopReturnLogisticsStorageKey(logistics.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== logistics.purgeAt
  ) {
    throw new NpShopReturnLogisticsContractError("Invalid return logistics storage metadata", [
      "return logistics key and expiry must match its canonical values.",
    ]);
  }
  return logistics;
}

function requirePrivateAt(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredReturnLogisticsPrivate {
  const privateData = npRequireStoredShopReturnLogisticsPrivate(value);
  if (
    key !== npShopReturnLogisticsPrivateStorageKey(privateData.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== privateData.expiresAt
  ) {
    throw new NpShopReturnLogisticsContractError("Invalid private return logistics metadata", [
      "private return logistics key and expiry must match its canonical values.",
    ]);
  }
  return privateData;
}

async function readOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredOrder | null> {
  const row = await readRow(db, siteId, orderStorageKey(ownerSegment, orderId), forUpdate);
  return row ? requireOrderAt(row.value, row.expiresAt, row.key) : null;
}

async function readReturn(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredReturn | null> {
  const row = await readRow(db, siteId, returnStorageKey(orderId), forUpdate);
  return row ? requireReturnAt(row.value, row.expiresAt, row.key) : null;
}

async function readBooking(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredCarrierBooking | null> {
  const row = await readRow(db, siteId, bookingStorageKey(orderId), forUpdate);
  return row ? requireBookingAt(row.value, row.expiresAt, row.key) : null;
}

async function readLogistics(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredReturnLogistics | null> {
  const row = await readRow(db, siteId, npShopReturnLogisticsStorageKey(orderId), forUpdate);
  return row ? requireLogisticsAt(row.value, row.expiresAt, row.key) : null;
}

async function readPrivate(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredReturnLogisticsPrivate | null> {
  const row = await readRow(db, siteId, npShopReturnLogisticsPrivateStorageKey(orderId), forUpdate);
  return row ? requirePrivateAt(row.value, row.expiresAt, row.key) : null;
}

async function persistLogistics(
  tx: NpShopTransaction,
  siteId: string,
  logistics: NpShopStoredReturnLogistics,
): Promise<void> {
  npRequireStoredShopReturnLogistics(logistics);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopReturnLogisticsStorageKey(logistics.orderId),
      value: logistics,
      expiresAt: new Date(logistics.purgeAt),
      updatedAt: new Date(logistics.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: logistics,
        expiresAt: new Date(logistics.purgeAt),
        updatedAt: new Date(logistics.updatedAt),
      },
    });
}

async function persistPrivate(
  tx: NpShopTransaction,
  siteId: string,
  privateData: NpShopStoredReturnLogisticsPrivate,
): Promise<void> {
  npRequireStoredShopReturnLogisticsPrivate(privateData);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopReturnLogisticsPrivateStorageKey(privateData.orderId),
      value: privateData,
      expiresAt: new Date(privateData.expiresAt),
      updatedAt: new Date(privateData.createdAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: privateData,
        expiresAt: new Date(privateData.expiresAt),
        updatedAt: new Date(privateData.createdAt),
      },
    });
}

async function deletePrivate(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<void> {
  await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopReturnLogisticsPrivateStorageKey(orderId)),
      ),
    );
}

function nextTimestamp(...values: (string | null)[]): string {
  const floor = values.reduce(
    (maximum, value) => (value ? Math.max(maximum, new Date(value).getTime()) : maximum),
    0,
  );
  return new Date(Math.max(Date.now(), floor + 1)).toISOString();
}

function hasLivePickupWindow(readyAt: string | null, closeAt: string | null): boolean {
  if (!readyAt || !closeAt) return true;
  const now = Date.now();
  return !(
    new Date(readyAt).getTime() <
      now - npShopReturnLogisticsLimits.futureToleranceSeconds * 1_000 ||
    new Date(closeAt).getTime() <= now ||
    new Date(readyAt).getTime() > now + npShopReturnLogisticsLimits.maximumLeadSeconds * 1_000
  );
}

function requireLivePickupWindow(readyAt: string | null, closeAt: string | null): void {
  if (readyAt && closeAt && !hasLivePickupWindow(readyAt, closeAt)) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_return_conflict",
      "The return pickup window is no longer live or exceeds the maximum lead time.",
    );
  }
}

function returnItems(
  order: NpShopStoredOrder,
  returnRequest: NpShopStoredReturn,
): NpShopReturnLogisticsItem[] {
  return returnRequest.lines.map((returned) => {
    const line = order.lines.find((candidate) => candidate.key === returned.lineKey);
    if (!line || returned.quantity > line.quantity) {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_return_conflict",
        "The approved return no longer matches its immutable order lines.",
      );
    }
    return {
      lineKey: line.key,
      productId: line.productId,
      productName: line.productName,
      variantSku: line.variantSku,
      variantName: line.variantName,
      quantity: returned.quantity,
    };
  });
}

function requireEligibility(
  order: NpShopStoredOrder | null,
  returnRequest: NpShopStoredReturn | null,
  booking: NpShopStoredCarrierBooking | null,
  input: { returnId: string; expectedReturnRevision?: number },
  ownerSegment: string,
  providerId: string,
): asserts order is NpShopStoredOrder {
  if (
    !order ||
    !returnRequest ||
    returnRequest.id !== input.returnId ||
    returnRequest.orderId !== order.id ||
    returnRequest.ownerSegment !== ownerSegment ||
    returnRequest.purgeAt !== order.purgeAt
  ) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_not_found",
      "The approved owner-scoped return does not exist.",
    );
  }
  if (
    input.expectedReturnRevision !== undefined &&
    returnRequest.revision !== input.expectedReturnRevision
  ) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_revision_conflict",
      "The return changed before logistics creation started.",
    );
  }
  if (returnRequest.status !== "approved") {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_return_conflict",
      "Only an approved return can create return logistics.",
    );
  }
  if (
    !booking ||
    booking.status !== "completed" ||
    booking.providerId !== providerId ||
    !booking.bookingReference ||
    !booking.carrier ||
    !booking.trackingNumber ||
    booking.purgeAt !== order.purgeAt
  ) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_return_conflict",
      "Return logistics requires one completed outbound booking from the configured provider.",
    );
  }
  if (new Date(order.purgeAt) <= new Date()) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_return_conflict",
      "The return order is past its commercial retention window.",
    );
  }
}

function matchesApprovedReturn(
  order: NpShopStoredOrder | null,
  returnRequest: NpShopStoredReturn | null,
  logistics: NpShopStoredReturnLogistics,
): boolean {
  return Boolean(
    order &&
    returnRequest &&
    order.id === logistics.orderId &&
    order.ownerSegment === logistics.ownerSegment &&
    order.purgeAt === logistics.purgeAt &&
    returnRequest.id === logistics.returnId &&
    returnRequest.orderId === order.id &&
    returnRequest.ownerSegment === logistics.ownerSegment &&
    returnRequest.purgeAt === logistics.purgeAt &&
    returnRequest.status === "approved",
  );
}

function throwProviderFailure(error: unknown, operation: string): never {
  if (error instanceof NpShopReturnLogisticsProviderError) throw error;
  if (error instanceof NpShopCarrierProviderError) {
    throw new NpShopReturnLogisticsProviderError(error.code, error.message, {
      retryable: error.retryable,
    });
  }
  if (error instanceof NpShopReturnLogisticsContractError) {
    throw new NpShopReturnLogisticsProviderError(
      "invalid-result",
      `The return logistics provider returned an invalid ${operation} result.`,
      { retryable: false },
    );
  }
  throw new NpShopReturnLogisticsProviderError(
    "provider-unavailable",
    `The return logistics provider failed during ${operation}.`,
    { retryable: true },
  );
}

async function persistProviderFailure(
  siteId: string,
  logistics: NpShopStoredReturnLogistics,
  error: unknown,
): Promise<void> {
  const providerError =
    error instanceof NpShopReturnLogisticsProviderError ||
    error instanceof NpShopCarrierProviderError
      ? error
      : null;
  const code =
    error instanceof NpShopReturnLogisticsContractError
      ? "invalid-result"
      : providerError && /^[a-z][a-z0-9-]{0,99}$/u.test(providerError.code)
        ? providerError.code
        : "provider-unavailable";
  const retryable =
    !(error instanceof NpShopReturnLogisticsContractError) && providerError?.retryable !== false;
  await getDb().transaction(async (tx) => {
    const current = await readLogistics(tx, siteId, logistics.orderId, true);
    if (!current || current.id !== logistics.id) return;
    if (current.status !== "pending" && current.status !== "cancel-pending") return;
    const updatedAt = nextTimestamp(current.updatedAt);
    await persistLogistics(tx, siteId, {
      ...current,
      status: retryable ? current.status : "manual-review",
      revision: current.revision + 1,
      providerErrorCode: code,
      updatedAt,
    });
    if (!retryable) await deletePrivate(tx, siteId, current.orderId);
  });
}

async function executeCreate(
  runtime: NpShopRuntime,
  siteId: string,
  logistics: NpShopStoredReturnLogistics,
  order: NpShopStoredOrder,
  returnRequest: NpShopStoredReturn,
  privateData: NpShopStoredReturnLogisticsPrivate | null,
): Promise<{ logistics: NpShopReturnLogistics; duplicate: boolean }> {
  const adapter = runtime.carrierReturnLogisticsAdapter!;
  let result: NpShopReturnLogisticsResult;
  if (logistics.status === "provider-confirmed") {
    result = npRequireShopReturnLogisticsResult({
      contract: "np.shop-return-logistics-result.v1",
      logisticsId: logistics.id,
      returnId: logistics.returnId,
      orderId: logistics.orderId,
      returnReference: logistics.returnReference,
      carrier: logistics.carrier,
      trackingNumber: logistics.trackingNumber,
      readyAt: logistics.readyAt,
      closeAt: logistics.closeAt,
      confirmedAt: logistics.confirmedAt,
    });
  } else {
    requireLivePickupWindow(logistics.readyAt, logistics.closeAt);
    if (!privateData || new Date(privateData.expiresAt) <= new Date()) {
      await getDb().transaction(async (tx) => {
        const current = await readLogistics(tx, siteId, logistics.orderId, true);
        if (!current || current.id !== logistics.id || current.status !== "pending") return;
        await persistLogistics(tx, siteId, {
          ...current,
          status: "manual-review",
          revision: current.revision + 1,
          providerErrorCode: "private-expired",
          updatedAt: nextTimestamp(current.updatedAt),
        });
        await deletePrivate(tx, siteId, current.orderId);
      });
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_private_expired",
        "The return origin expired before provider confirmation.",
      );
    }
    const request = npRequireShopReturnLogisticsRequest({
      contract: NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT,
      logisticsId: logistics.id,
      returnId: logistics.returnId,
      orderId: logistics.orderId,
      originalShipmentId: logistics.originalShipmentId,
      originalBookingReference: logistics.originalBookingReference,
      mode: logistics.mode,
      returnLocationReference: runtime.carrierReturnLocationReference,
      items: returnItems(order, returnRequest),
      origin: privateData.origin,
      readyAt: logistics.readyAt,
      closeAt: logistics.closeAt,
      requestedAt: logistics.requestedAt,
    });
    try {
      result = npRequireShopReturnLogisticsResult(await adapter.createReturnShipment(request));
    } catch (error) {
      await persistProviderFailure(siteId, logistics, error);
      throwProviderFailure(error, "creation");
    }
    if (
      result.logisticsId !== logistics.id ||
      result.returnId !== logistics.returnId ||
      result.orderId !== logistics.orderId ||
      result.readyAt !== logistics.readyAt ||
      result.closeAt !== logistics.closeAt ||
      (logistics.mode === "pickup" && !hasLivePickupWindow(result.readyAt, result.closeAt)) ||
      new Date(result.confirmedAt) < new Date(logistics.requestedAt) ||
      new Date(result.confirmedAt).getTime() >
        Date.now() + npShopReturnLogisticsLimits.futureToleranceSeconds * 1_000
    ) {
      await getDb().transaction(async (tx) => {
        const current = await readLogistics(tx, siteId, logistics.orderId, true);
        if (!current || current.id !== logistics.id || current.status !== "pending") return;
        await persistLogistics(tx, siteId, {
          ...current,
          status: "manual-review",
          revision: current.revision + 1,
          providerErrorCode: "invalid-result",
          updatedAt: nextTimestamp(current.updatedAt),
        });
        await deletePrivate(tx, siteId, current.orderId);
      });
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_result_mismatch",
        "The provider result does not match the durable return logistics intent.",
      );
    }
    try {
      logistics = await getDb().transaction(async (tx) => {
        const currentOrder = await readOrder(
          tx,
          siteId,
          logistics.ownerSegment,
          logistics.orderId,
          true,
        );
        const currentReturn = await readReturn(tx, siteId, logistics.orderId, true);
        const current = await readLogistics(tx, siteId, logistics.orderId, true);
        if (
          current?.id === logistics.id &&
          (current.status === "provider-confirmed" || current.status === "active")
        ) {
          const matchesStoredResult =
            current.returnReference === result.returnReference &&
            current.carrier === result.carrier &&
            current.trackingNumber === result.trackingNumber &&
            current.readyAt === result.readyAt &&
            current.closeAt === result.closeAt &&
            current.confirmedAt === result.confirmedAt;
          if (matchesStoredResult) return current;
          const manualReview = {
            ...current,
            status: "manual-review",
            revision: current.revision + 1,
            providerErrorCode: "idempotency-conflict",
            updatedAt: nextTimestamp(current.updatedAt),
          } satisfies NpShopStoredReturnLogistics;
          await persistLogistics(tx, siteId, manualReview);
          return manualReview;
        }
        if (!current || current.id !== logistics.id || current.status !== "pending") {
          throw new NpShopReturnLogisticsConflictError(
            "return_logistics_manual_review",
            "Return logistics changed before provider confirmation was stored.",
          );
        }
        const next = {
          ...current,
          status: matchesApprovedReturn(currentOrder, currentReturn, current)
            ? "provider-confirmed"
            : "manual-review",
          revision: current.revision + 1,
          returnReference: result.returnReference,
          carrier: result.carrier,
          trackingNumber: result.trackingNumber,
          readyAt: result.readyAt,
          closeAt: result.closeAt,
          providerErrorCode: matchesApprovedReturn(currentOrder, currentReturn, current)
            ? null
            : "return-changed",
          confirmedAt: result.confirmedAt,
          updatedAt: nextTimestamp(current.updatedAt, result.confirmedAt),
        } satisfies NpShopStoredReturnLogistics;
        await persistLogistics(tx, siteId, next);
        await deletePrivate(tx, siteId, next.orderId);
        return next;
      });
    } catch {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_manual_review",
        "The provider created return logistics but local confirmation requires reconciliation.",
      );
    }
    if (logistics.status === "manual-review") {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_manual_review",
        "The provider created return logistics after the physical return changed; operator reconciliation is required.",
      );
    }
  }
  try {
    const activated = await getDb().transaction(async (tx) => {
      const currentOrder = await readOrder(
        tx,
        siteId,
        logistics.ownerSegment,
        logistics.orderId,
        true,
      );
      const currentReturn = await readReturn(tx, siteId, logistics.orderId, true);
      const current = await readLogistics(tx, siteId, logistics.orderId, true);
      if (current?.id === logistics.id && current.status === "active") {
        return { logistics: npProjectShopReturnLogistics(current), duplicate: true };
      }
      if (!current || current.id !== logistics.id || current.status !== "provider-confirmed") {
        throw new NpShopReturnLogisticsConflictError(
          "return_logistics_state_conflict",
          "Return logistics changed before local activation.",
        );
      }
      if (!matchesApprovedReturn(currentOrder, currentReturn, current)) {
        const manualReview = {
          ...current,
          status: "manual-review",
          revision: current.revision + 1,
          providerErrorCode: "return-changed",
          updatedAt: nextTimestamp(current.updatedAt),
        } satisfies NpShopStoredReturnLogistics;
        await persistLogistics(tx, siteId, manualReview);
        return { logistics: npProjectShopReturnLogistics(manualReview), duplicate: false };
      }
      const next = {
        ...current,
        status: "active",
        revision: current.revision + 1,
        updatedAt: nextTimestamp(current.updatedAt),
      } satisfies NpShopStoredReturnLogistics;
      await persistLogistics(tx, siteId, next);
      return { logistics: npProjectShopReturnLogistics(next), duplicate: false };
    });
    if (activated.logistics.status === "manual-review") {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_manual_review",
        "The physical return changed before local return-logistics activation.",
      );
    }
    return activated;
  } catch {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_manual_review",
      "The provider created return logistics but local activation requires reconciliation.",
    );
  }
}

export async function npCreateShopReturnLogistics(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopReturnLogisticsCreateInput,
): Promise<{ logistics: NpShopReturnLogistics; duplicate: boolean }> {
  const adapter = runtime.carrierReturnLogisticsAdapter;
  if (!adapter || !runtime.carrierReturnLocationReference) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_not_supported",
      "Return logistics is not configured for this site.",
    );
  }
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const prepared = await getDb().transaction(async (tx) => {
    const order = await readOrder(tx, siteId, ownerSegment, input.orderId, true);
    const returnRequest = await readReturn(tx, siteId, input.orderId, true);
    const booking = await readBooking(tx, siteId, input.orderId, true);
    const current = await readLogistics(tx, siteId, input.orderId, true);
    requireEligibility(order, returnRequest, booking, input, ownerSegment, adapter.id);
    if (!returnRequest || !booking) {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_not_found",
        "The approved return or its outbound booking does not exist.",
      );
    }
    if (current) {
      if (current.returnId !== input.returnId || current.ownerSegment !== ownerSegment) {
        throw new NpShopReturnLogisticsConflictError(
          "return_logistics_already_exists",
          "This order already owns different return logistics.",
        );
      }
      if (current.status === "active") {
        return {
          duplicate: true as const,
          logistics: current,
          order,
          returnRequest,
          booking,
          privateData: null,
        };
      }
      throw new NpShopReturnLogisticsConflictError(
        current.status === "manual-review"
          ? "return_logistics_manual_review"
          : "return_logistics_state_conflict",
        current.status === "pending" || current.status === "provider-confirmed"
          ? "Existing return logistics must be resumed with its current revision."
          : "Existing return logistics cannot be recreated.",
      );
    }
    requireLivePickupWindow(input.readyAt, input.closeAt);
    const now = new Date();
    const requestedAt = now.toISOString();
    const privateExpiresAt = new Date(
      Math.min(
        now.getTime() + npShopReturnLogisticsLimits.privateTtlSeconds * 1_000,
        new Date(order.purgeAt).getTime(),
      ),
    ).toISOString();
    const id = randomUUID();
    const logistics = {
      contract: NP_SHOP_RETURN_LOGISTICS_STORAGE_CONTRACT,
      id,
      returnId: returnRequest.id,
      orderId: order.id,
      ownerSegment,
      providerId: adapter.id,
      status: "pending",
      revision: 1,
      mode: input.mode,
      originalShipmentId: booking.id,
      originalBookingReference: booking.bookingReference!,
      returnReference: null,
      carrier: null,
      trackingNumber: null,
      readyAt: input.readyAt,
      closeAt: input.closeAt,
      providerErrorCode: null,
      cancellationId: null,
      requestedAt,
      confirmedAt: null,
      cancelRequestedAt: null,
      cancelledAt: null,
      updatedAt: requestedAt,
      purgeAt: order.purgeAt,
    } satisfies NpShopStoredReturnLogistics;
    const privateData = {
      contract: NP_SHOP_RETURN_LOGISTICS_PRIVATE_CONTRACT,
      logisticsId: id,
      returnId: returnRequest.id,
      orderId: order.id,
      ownerSegment,
      origin: input.origin,
      createdAt: requestedAt,
      expiresAt: privateExpiresAt,
    } satisfies NpShopStoredReturnLogisticsPrivate;
    await persistLogistics(tx, siteId, logistics);
    await persistPrivate(tx, siteId, privateData);
    return { duplicate: false as const, logistics, order, returnRequest, booking, privateData };
  });
  if (prepared.duplicate) {
    return { logistics: npProjectShopReturnLogistics(prepared.logistics), duplicate: true };
  }
  return executeCreate(
    runtime,
    siteId,
    prepared.logistics,
    prepared.order,
    prepared.returnRequest,
    prepared.privateData,
  );
}

export async function npResumeShopReturnLogistics(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopReturnLogisticsExistingInput,
): Promise<{ logistics: NpShopReturnLogistics; duplicate: boolean }> {
  const adapter = runtime.carrierReturnLogisticsAdapter;
  if (!adapter || !runtime.carrierReturnLocationReference) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_not_supported",
      "Return logistics requires its original carrier adapter.",
    );
  }
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const prepared = await getDb().transaction(async (tx) => {
    const order = await readOrder(tx, siteId, ownerSegment, input.orderId, true);
    const returnRequest = await readReturn(tx, siteId, input.orderId, true);
    const booking = await readBooking(tx, siteId, input.orderId, true);
    const logistics = await readLogistics(tx, siteId, input.orderId, true);
    if (
      !order ||
      !returnRequest ||
      !booking ||
      !logistics ||
      logistics.id !== input.logisticsId ||
      logistics.returnId !== input.returnId ||
      logistics.ownerSegment !== ownerSegment ||
      logistics.providerId !== adapter.id
    ) {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_not_found",
        "The resumable owner-scoped return logistics does not exist.",
      );
    }
    if (logistics.status === "active") {
      return { duplicate: true as const, logistics, order, returnRequest, privateData: null };
    }
    if (logistics.revision !== input.expectedRevision) {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_revision_conflict",
        "Return logistics changed before resume started.",
      );
    }
    requireEligibility(
      order,
      returnRequest,
      booking,
      { returnId: input.returnId },
      ownerSegment,
      adapter.id,
    );
    if (logistics.status !== "pending" && logistics.status !== "provider-confirmed") {
      throw new NpShopReturnLogisticsConflictError(
        logistics.status === "manual-review"
          ? "return_logistics_manual_review"
          : "return_logistics_state_conflict",
        "Only pending or provider-confirmed return logistics can be resumed.",
      );
    }
    const privateData =
      logistics.status === "pending" ? await readPrivate(tx, siteId, input.orderId, true) : null;
    return { duplicate: false as const, logistics, order, returnRequest, privateData };
  });
  if (prepared.duplicate) {
    return { logistics: npProjectShopReturnLogistics(prepared.logistics), duplicate: true };
  }
  return executeCreate(
    runtime,
    siteId,
    prepared.logistics,
    prepared.order,
    prepared.returnRequest,
    prepared.privateData,
  );
}

export async function npCancelShopReturnLogistics(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopReturnLogisticsExistingInput,
): Promise<{ logistics: NpShopReturnLogistics; duplicate: boolean }> {
  const adapter = runtime.carrierReturnLogisticsAdapter;
  if (!adapter) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_not_supported",
      "Return logistics requires its original carrier adapter.",
    );
  }
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const prepared = await getDb().transaction(async (tx) => {
    const order = await readOrder(tx, siteId, ownerSegment, input.orderId, true);
    const returnRequest = await readReturn(tx, siteId, input.orderId, true);
    const current = await readLogistics(tx, siteId, input.orderId, true);
    if (
      !current ||
      !order ||
      !returnRequest ||
      current.id !== input.logisticsId ||
      current.returnId !== input.returnId ||
      current.ownerSegment !== ownerSegment ||
      returnRequest.id !== input.returnId
    ) {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_not_found",
        "The owner-scoped return logistics does not exist.",
      );
    }
    if (current.status === "cancelled") return { duplicate: true as const, logistics: current };
    if (returnRequest.status !== "approved") {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_return_conflict",
        "Return logistics can be cancelled only while the physical return remains approved.",
      );
    }
    if (current.revision !== input.expectedRevision) {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_revision_conflict",
        "Return logistics changed before cancellation started.",
      );
    }
    if (current.providerId !== adapter.id) {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_state_conflict",
        "Return logistics requires its original provider.",
      );
    }
    if (
      current.status !== "active" &&
      current.status !== "cancel-pending" &&
      current.status !== "cancel-confirmed"
    ) {
      throw new NpShopReturnLogisticsConflictError(
        current.status === "manual-review"
          ? "return_logistics_manual_review"
          : "return_logistics_state_conflict",
        "Only active or cancelling return logistics can be cancelled.",
      );
    }
    if (current.status !== "active") return { duplicate: false as const, logistics: current };
    const requestedAt = nextTimestamp(current.updatedAt);
    const next = {
      ...current,
      status: "cancel-pending",
      revision: current.revision + 1,
      cancellationId: randomUUID(),
      cancelRequestedAt: requestedAt,
      providerErrorCode: null,
      updatedAt: requestedAt,
    } satisfies NpShopStoredReturnLogistics;
    await persistLogistics(tx, siteId, next);
    return { duplicate: false as const, logistics: next };
  });
  if (prepared.duplicate) {
    return { logistics: npProjectShopReturnLogistics(prepared.logistics), duplicate: true };
  }
  let logistics = prepared.logistics;
  let result: NpShopReturnLogisticsCancelResult;
  if (logistics.status === "cancel-confirmed") {
    result = npRequireShopReturnLogisticsCancelResult({
      contract: "np.shop-return-logistics-cancel-result.v1",
      cancellationId: logistics.cancellationId,
      logisticsId: logistics.id,
      returnId: logistics.returnId,
      orderId: logistics.orderId,
      cancelledAt: logistics.cancelledAt,
    });
  } else {
    const request = npRequireShopReturnLogisticsCancelRequest({
      contract: NP_SHOP_RETURN_LOGISTICS_CANCEL_REQUEST_CONTRACT,
      cancellationId: logistics.cancellationId,
      logisticsId: logistics.id,
      returnId: logistics.returnId,
      orderId: logistics.orderId,
      returnReference: logistics.returnReference,
      requestedAt: logistics.cancelRequestedAt,
    });
    try {
      result = npRequireShopReturnLogisticsCancelResult(
        await adapter.cancelReturnShipment(request),
      );
    } catch (error) {
      await persistProviderFailure(siteId, logistics, error);
      throwProviderFailure(error, "cancellation");
    }
    if (
      result.cancellationId !== logistics.cancellationId ||
      result.logisticsId !== logistics.id ||
      result.returnId !== logistics.returnId ||
      result.orderId !== logistics.orderId ||
      new Date(result.cancelledAt) < new Date(logistics.cancelRequestedAt ?? 0) ||
      new Date(result.cancelledAt).getTime() >
        Date.now() + npShopReturnLogisticsLimits.futureToleranceSeconds * 1_000
    ) {
      await getDb().transaction(async (tx) => {
        const current = await readLogistics(tx, siteId, logistics.orderId, true);
        if (!current || current.id !== logistics.id || current.status !== "cancel-pending") return;
        await persistLogistics(tx, siteId, {
          ...current,
          status: "manual-review",
          revision: current.revision + 1,
          providerErrorCode: "invalid-result",
          updatedAt: nextTimestamp(current.updatedAt),
        });
      });
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_result_mismatch",
        "The provider cancellation result does not match the durable intent.",
      );
    }
  }
  logistics = await getDb().transaction(async (tx) => {
    const current = await readLogistics(tx, siteId, logistics.orderId, true);
    if (!current || current.id !== logistics.id) {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_manual_review",
        "Return logistics disappeared after provider cancellation.",
      );
    }
    if (current.status === "cancel-confirmed" || current.status === "cancelled") {
      const matchesStoredResult = current.cancelledAt === result.cancelledAt;
      if (matchesStoredResult) return current;
      const manualReview = {
        ...current,
        status: "manual-review",
        revision: current.revision + 1,
        providerErrorCode: "idempotency-conflict",
        updatedAt: nextTimestamp(current.updatedAt),
      } satisfies NpShopStoredReturnLogistics;
      await persistLogistics(tx, siteId, manualReview);
      return manualReview;
    }
    if (current.status !== "cancel-pending") {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_manual_review",
        "Return logistics changed before cancellation confirmation was stored.",
      );
    }
    const next = {
      ...current,
      status: "cancel-confirmed",
      revision: current.revision + 1,
      providerErrorCode: null,
      cancelledAt: result.cancelledAt,
      updatedAt: nextTimestamp(current.updatedAt, result.cancelledAt),
    } satisfies NpShopStoredReturnLogistics;
    await persistLogistics(tx, siteId, next);
    return next;
  });
  if (logistics.status === "manual-review") {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_manual_review",
      "The provider returned conflicting cancellation results for one idempotency key.",
    );
  }
  if (logistics.status === "cancelled") {
    return { logistics: npProjectShopReturnLogistics(logistics), duplicate: true };
  }
  return getDb().transaction(async (tx) => {
    const current = await readLogistics(tx, siteId, logistics.orderId, true);
    if (!current || current.id !== logistics.id || current.status !== "cancel-confirmed") {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_manual_review",
        "Return logistics changed before local cancellation completed.",
      );
    }
    const next = {
      ...current,
      status: "cancelled",
      revision: current.revision + 1,
      updatedAt: nextTimestamp(current.updatedAt),
    } satisfies NpShopStoredReturnLogistics;
    await persistLogistics(tx, siteId, next);
    return { logistics: npProjectShopReturnLogistics(next), duplicate: false };
  });
}

export async function npReadShopReturnLogisticsLabel(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopReturnLogisticsLabelReadInput,
): Promise<NpShopReturnLogisticsLabelResult> {
  const adapter = runtime.carrierReturnLabelAdapter;
  if (!adapter) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_not_supported",
      "Return label retrieval is not configured.",
    );
  }
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const db = getDb();
  const logistics = await readLogistics(db, siteId, input.orderId);
  const order = await readOrder(db, siteId, ownerSegment, input.orderId);
  const returnRequest = await readReturn(db, siteId, input.orderId);
  if (
    !logistics ||
    !order ||
    !returnRequest ||
    logistics.id !== input.logisticsId ||
    logistics.returnId !== input.returnId ||
    logistics.ownerSegment !== ownerSegment ||
    logistics.status !== "active" ||
    logistics.providerId !== adapter.id
  ) {
    throw new NpShopReturnLogisticsConflictError(
      "return_logistics_not_found",
      "One active owner-scoped return shipment is required for label retrieval.",
    );
  }
  const request = npRequireShopReturnLogisticsLabelRequest({
    contract: NP_SHOP_RETURN_LOGISTICS_LABEL_REQUEST_CONTRACT,
    logisticsId: logistics.id,
    returnId: logistics.returnId,
    orderId: logistics.orderId,
    returnReference: logistics.returnReference,
    carrier: logistics.carrier,
    trackingNumber: logistics.trackingNumber,
    requestedAt: new Date().toISOString(),
  });
  try {
    const result = npRequireShopReturnLogisticsLabelResult(await adapter.readReturnLabel(request));
    if (
      result.logisticsId !== logistics.id ||
      result.returnId !== logistics.returnId ||
      result.orderId !== logistics.orderId ||
      new Date(result.retrievedAt) < new Date(request.requestedAt) ||
      new Date(result.retrievedAt).getTime() >
        Date.now() + npShopReturnLogisticsLimits.futureToleranceSeconds * 1_000
    ) {
      throw new NpShopReturnLogisticsConflictError(
        "return_logistics_result_mismatch",
        "The provider return label does not match the owner-scoped shipment.",
      );
    }
    return result;
  } catch (error) {
    if (error instanceof NpShopReturnLogisticsConflictError) {
      throw error;
    }
    throwProviderFailure(error, "label retrieval");
  }
}

export async function npReadShopReturnLogisticsForOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<NpShopReturnLogistics | null> {
  const logistics = await readLogistics(db, siteId, orderId);
  return logistics ? npProjectShopReturnLogistics(logistics) : null;
}

export async function npListRecentShopReturnLogistics(): Promise<{
  rows: NpShopAdminReturnLogisticsRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "return-logistics:%"),
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
    .limit(npShopReturnLogisticsLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(where);
  const expectedPrivateKeys = rows.flatMap((row) => {
    try {
      const logistics = requireLogisticsAt(row.value, row.expiresAt, row.key);
      return [npShopReturnLogisticsPrivateStorageKey(logistics.orderId)];
    } catch {
      return [];
    }
  });
  const privateKeys = new Set(
    expectedPrivateKeys.length === 0
      ? []
      : (
          await db
            .select({ key: npPluginStorage.key })
            .from(npPluginStorage)
            .where(
              and(
                eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
                eq(npPluginStorage.siteId, siteId),
                inArray(npPluginStorage.key, expectedPrivateKeys),
              ),
            )
        ).map((row) => row.key),
  );
  return {
    rows: rows.map((row) => {
      const logistics = requireLogisticsAt(row.value, row.expiresAt, row.key);
      return {
        id: logistics.orderId,
        logisticsId: logistics.id,
        returnId: logistics.returnId,
        provider: logistics.providerId,
        mode: logistics.mode,
        status: logistics.status,
        carrier: logistics.carrier ?? "—",
        trackingNumber: logistics.trackingNumber ?? "—",
        providerError: logistics.providerErrorCode ?? "—",
        privateOrigin: privateKeys.has(npShopReturnLogisticsPrivateStorageKey(logistics.orderId))
          ? "retained (max 24h)"
          : "deleted",
        updatedAt: logistics.updatedAt,
      };
    }),
    total: Number(total),
  };
}

export async function npCountShopReturnLogistics(expectedProviderId?: string): Promise<{
  total: number;
  active: number;
  pending: number;
  cancelling: number;
  cancelled: number;
  manualReview: number;
  invalidSample: number;
  orphanSample: number;
  providerMismatchSample: number;
  privateMismatchSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "return-logistics:%"),
  );
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
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
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopReturnLogisticsLimits.diagnosticSampleSize);
  const counts = {
    total: Number(total),
    active: 0,
    pending: 0,
    cancelling: 0,
    cancelled: 0,
    manualReview: 0,
    invalidSample: 0,
    orphanSample: 0,
    providerMismatchSample: 0,
    privateMismatchSample: 0,
  };
  const sampled: NpShopStoredReturnLogistics[] = [];
  for (const row of rows) {
    try {
      const logistics = requireLogisticsAt(row.value, row.expiresAt, row.key);
      sampled.push(logistics);
      if (logistics.status === "active") counts.active += 1;
      else if (logistics.status === "pending" || logistics.status === "provider-confirmed")
        counts.pending += 1;
      else if (logistics.status === "cancel-pending" || logistics.status === "cancel-confirmed")
        counts.cancelling += 1;
      else if (logistics.status === "cancelled") counts.cancelled += 1;
      else counts.manualReview += 1;
      if (expectedProviderId && logistics.providerId !== expectedProviderId)
        counts.providerMismatchSample += 1;
    } catch {
      counts.invalidSample += 1;
    }
  }
  const supportKeys = sampled.flatMap((logistics) => [
    returnStorageKey(logistics.orderId),
    bookingStorageKey(logistics.orderId),
    npShopReturnLogisticsPrivateStorageKey(logistics.orderId),
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
  const supportByKey = new Map(supportRows.map((row) => [row.key, row]));
  for (const logistics of sampled) {
    try {
      const returnRow = supportByKey.get(returnStorageKey(logistics.orderId));
      const bookingRow = supportByKey.get(bookingStorageKey(logistics.orderId));
      const privateRow = supportByKey.get(
        npShopReturnLogisticsPrivateStorageKey(logistics.orderId),
      );
      const returnRequest = returnRow
        ? requireReturnAt(returnRow.value, returnRow.expiresAt, returnRow.key)
        : null;
      const booking = bookingRow
        ? requireBookingAt(bookingRow.value, bookingRow.expiresAt, bookingRow.key)
        : null;
      const privateData = privateRow
        ? requirePrivateAt(privateRow.value, privateRow.expiresAt, privateRow.key)
        : null;
      if (
        !returnRequest ||
        returnRequest.id !== logistics.returnId ||
        returnRequest.ownerSegment !== logistics.ownerSegment ||
        returnRequest.purgeAt !== logistics.purgeAt ||
        !booking ||
        booking.id !== logistics.originalShipmentId ||
        booking.providerId !== logistics.providerId ||
        booking.bookingReference !== logistics.originalBookingReference ||
        booking.purgeAt !== logistics.purgeAt
      ) {
        counts.orphanSample += 1;
      }
      if ((logistics.status === "pending") !== Boolean(privateData))
        counts.privateMismatchSample += 1;
      if (
        privateData &&
        (privateData.logisticsId !== logistics.id ||
          privateData.returnId !== logistics.returnId ||
          privateData.ownerSegment !== logistics.ownerSegment)
      )
        counts.privateMismatchSample += 1;
    } catch {
      counts.invalidSample += 1;
    }
  }
  return counts;
}

export async function npCleanupExpiredShopReturnLogisticsPrivate(
  now = new Date(),
): Promise<number> {
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
        like(npPluginStorage.key, "return-logistics-private:%"),
        sql`${npPluginStorage.expiresAt} <= ${now}`,
      ),
    )
    .orderBy(npPluginStorage.expiresAt, npPluginStorage.key)
    .limit(npShopReturnLogisticsLimits.cleanupBatchSize);
  if (rows.length === 0) return 0;
  return db.transaction(async (tx) => {
    let deleted = 0;
    for (const row of rows) {
      let orderId: string | null = null;
      let logisticsId: string | null = null;
      try {
        const privateData = requirePrivateAt(row.value, row.expiresAt, row.key);
        orderId = privateData.orderId;
        logisticsId = privateData.logisticsId;
      } catch {
        // Expired private bytes are deleted even when malformed; diagnostics
        // must not extend their retention.
      }
      if (orderId && logisticsId) {
        const logistics = await readLogistics(tx, siteId, orderId, true);
        if (logistics?.id === logisticsId && logistics.status === "pending") {
          await persistLogistics(tx, siteId, {
            ...logistics,
            status: "manual-review",
            revision: logistics.revision + 1,
            providerErrorCode: "private-expired",
            updatedAt: nextTimestamp(logistics.updatedAt, row.expiresAt?.toISOString() ?? null),
          });
        }
      }
      const result = await tx
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, row.key),
            sql`${npPluginStorage.expiresAt} <= ${now}`,
          ),
        )
        .returning({ key: npPluginStorage.key });
      deleted += result.length;
    }
    return deleted;
  });
}
