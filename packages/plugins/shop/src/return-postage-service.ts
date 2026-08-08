import { randomUUID } from "node:crypto";

import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, inArray, like, lte, sql } from "drizzle-orm";

import {
  npRequireStoredShopCarrierBooking,
  type NpShopStoredCarrierBooking,
} from "./carrier-contract.js";
import { npShopCartOwnerStorageSegment, type NpShopCartOwner } from "./cart-service.js";
import { npRequireStoredShopOrder, type NpShopStoredOrder } from "./order-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import {
  NP_SHOP_RETURN_POSTAGE_HEALTH_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_PRIVATE_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_QUOTE_REQUEST_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_STORAGE_CONTRACT,
  NpShopReturnPostageConflictError,
  NpShopReturnPostageContractError,
  NpShopReturnPostageUnavailableError,
  npProjectShopReturnPostage,
  npRequireShopReturnPostageHealth,
  npRequireShopReturnPostageQuoteRequest,
  npRequireShopReturnPostageQuoteResult,
  npRequireStoredShopReturnPostage,
  npRequireStoredShopReturnPostagePrivate,
  npShopReturnPostageLimits,
  type NpShopQuotedReturnLogisticsCreateInput,
  type NpShopReturnPostageHealth,
  type NpShopReturnPostageMethod,
  type NpShopReturnPostageQuote,
  type NpShopReturnPostageQuoteInput,
  type NpShopReturnPostageSelectInput,
  type NpShopStoredReturnPostage,
  type NpShopStoredReturnPostagePrivate,
} from "./return-postage-contract.js";
import {
  npRequireStoredShopReturnLogistics,
  npShopReturnLogisticsLimits,
  type NpShopStoredReturnLogistics,
} from "./return-logistics-contract.js";
import { npRequireStoredShopReturn, type NpShopStoredReturn } from "./return-contract.js";
import type { NpShopRuntime } from "./runtime.js";
import type { NpShopOrderDraftShipping } from "./types.js";

const HEALTH_KEY = "return-postage-health";

export interface NpShopAdminReturnPostageRow {
  [key: string]: unknown;
  id: string;
  quoteId: string;
  returnId: string;
  provider: string;
  status: string;
  currency: string;
  amount: string;
  privateOrigin: string;
  expiresAt: string;
}

export interface NpShopReturnPostageCounts {
  total: number;
  quoted: number;
  selected: number;
  expired: number;
  privateMismatchSample: number;
  invalidSample: number;
  providerMismatchSample: number;
}

export function npShopReturnPostageStorageKey(orderId: string): string {
  return `return-postage:${orderId}`;
}

export function npShopReturnPostagePrivateStorageKey(orderId: string): string {
  return `return-postage-private:${orderId}`;
}

function orderStorageKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

function returnStorageKey(orderId: string): string {
  return `return:${orderId}`;
}

function bookingStorageKey(orderId: string): string {
  return `carrier-booking:${orderId}`;
}

function logisticsStorageKey(orderId: string): string {
  return `return-logistics:${orderId}`;
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

function requireOrderAt(row: NonNullable<Awaited<ReturnType<typeof readRow>>>): NpShopStoredOrder {
  const value = npRequireStoredShopOrder(row.value);
  if (
    row.key !== orderStorageKey(value.ownerSegment, value.id) ||
    row.expiresAt?.toISOString() !== value.purgeAt
  ) {
    throw new NpShopReturnPostageContractError("Invalid return postage order metadata", [
      "order key and expiry must match its canonical values.",
    ]);
  }
  return value;
}

function requireReturnAt(
  row: NonNullable<Awaited<ReturnType<typeof readRow>>>,
): NpShopStoredReturn {
  const value = npRequireStoredShopReturn(row.value);
  if (
    row.key !== returnStorageKey(value.orderId) ||
    row.expiresAt?.toISOString() !== value.purgeAt
  ) {
    throw new NpShopReturnPostageContractError("Invalid return postage return metadata", [
      "return key and expiry must match its canonical values.",
    ]);
  }
  return value;
}

function requireBookingAt(
  row: NonNullable<Awaited<ReturnType<typeof readRow>>>,
): NpShopStoredCarrierBooking {
  const value = npRequireStoredShopCarrierBooking(row.value);
  if (
    row.key !== bookingStorageKey(value.orderId) ||
    row.expiresAt?.toISOString() !== value.purgeAt
  ) {
    throw new NpShopReturnPostageContractError("Invalid return postage booking metadata", [
      "booking key and expiry must match its canonical values.",
    ]);
  }
  return value;
}

function requireLogisticsAt(
  row: NonNullable<Awaited<ReturnType<typeof readRow>>>,
): NpShopStoredReturnLogistics {
  const value = npRequireStoredShopReturnLogistics(row.value);
  if (
    row.key !== logisticsStorageKey(value.orderId) ||
    row.expiresAt?.toISOString() !== value.purgeAt
  ) {
    throw new NpShopReturnPostageContractError("Invalid return postage logistics metadata", [
      "return logistics key and expiry must match its canonical values.",
    ]);
  }
  return value;
}

function requirePostageAt(
  row: NonNullable<Awaited<ReturnType<typeof readRow>>>,
): NpShopStoredReturnPostage {
  const value = npRequireStoredShopReturnPostage(row.value);
  if (
    row.key !== npShopReturnPostageStorageKey(value.orderId) ||
    row.expiresAt?.toISOString() !== value.expiresAt
  ) {
    throw new NpShopReturnPostageContractError("Invalid return postage storage metadata", [
      "postage key and expiry must match its canonical values.",
    ]);
  }
  return value;
}

function requirePrivateAt(
  row: NonNullable<Awaited<ReturnType<typeof readRow>>>,
): NpShopStoredReturnPostagePrivate {
  const value = npRequireStoredShopReturnPostagePrivate(row.value);
  if (
    row.key !== npShopReturnPostagePrivateStorageKey(value.orderId) ||
    row.expiresAt?.toISOString() !== value.expiresAt
  ) {
    throw new NpShopReturnPostageContractError("Invalid private return postage metadata", [
      "private postage key and expiry must match its canonical values.",
    ]);
  }
  return value;
}

async function persistPostage(
  tx: NpShopTransaction,
  siteId: string,
  value: NpShopStoredReturnPostage,
): Promise<void> {
  npRequireStoredShopReturnPostage(value);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopReturnPostageStorageKey(value.orderId),
      value,
      expiresAt: new Date(value.expiresAt),
      updatedAt: new Date(value.quotedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: { value, expiresAt: new Date(value.expiresAt), updatedAt: new Date(value.quotedAt) },
    });
}

async function persistPrivate(
  tx: NpShopTransaction,
  siteId: string,
  value: NpShopStoredReturnPostagePrivate,
): Promise<void> {
  npRequireStoredShopReturnPostagePrivate(value);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopReturnPostagePrivateStorageKey(value.orderId),
      value,
      expiresAt: new Date(value.expiresAt),
      updatedAt: new Date(value.createdAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: { value, expiresAt: new Date(value.expiresAt), updatedAt: new Date(value.createdAt) },
    });
}

async function deletePostageRows(
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
        inArray(npPluginStorage.key, [
          npShopReturnPostageStorageKey(orderId),
          npShopReturnPostagePrivateStorageKey(orderId),
        ]),
      ),
    );
}

async function persistHealth(siteId: string, value: NpShopReturnPostageHealth): Promise<void> {
  npRequireShopReturnPostageHealth(value);
  await getDb()
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: HEALTH_KEY,
      value,
      expiresAt: null,
      updatedAt: new Date(value.attemptedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: { value, expiresAt: null, updatedAt: new Date(value.attemptedAt) },
    });
}

function returnItems(order: NpShopStoredOrder, returned: NpShopStoredReturn) {
  return returned.lines.map((requested) => {
    const line = order.lines.find((candidate) => candidate.key === requested.lineKey);
    if (!line || requested.quantity > line.quantity) {
      throw new NpShopReturnPostageConflictError(
        "return_postage_return_conflict",
        "The approved return no longer matches its immutable order lines.",
      );
    }
    return {
      lineKey: line.key,
      productId: line.productId,
      productName: line.productName,
      variantSku: line.variantSku,
      variantName: line.variantName,
      quantity: requested.quantity,
    };
  });
}

function requireEligibility(
  order: NpShopStoredOrder | null,
  returned: NpShopStoredReturn | null,
  booking: NpShopStoredCarrierBooking | null,
  logistics: NpShopStoredReturnLogistics | null,
  input: { returnId: string; expectedReturnRevision: number },
  ownerSegment: string,
  providerId: string,
): asserts order is NpShopStoredOrder {
  if (
    !order ||
    !returned ||
    !booking ||
    returned.id !== input.returnId ||
    returned.orderId !== order.id ||
    returned.ownerSegment !== ownerSegment ||
    returned.purgeAt !== order.purgeAt ||
    booking.orderId !== order.id ||
    booking.purgeAt !== order.purgeAt
  ) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_not_found",
      "The approved owner-scoped return and outbound booking do not exist.",
    );
  }
  if (logistics) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_return_conflict",
      "Return postage can be quoted only before return logistics exists.",
    );
  }
  if (returned.revision !== input.expectedReturnRevision) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_revision_conflict",
      "The return changed before postage quoting completed.",
    );
  }
  if (returned.status !== "approved") {
    throw new NpShopReturnPostageConflictError(
      "return_postage_return_conflict",
      "Only an approved return can request postage methods.",
    );
  }
  if (
    booking.status !== "completed" ||
    booking.providerId !== providerId ||
    !booking.bookingReference
  ) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_return_conflict",
      "Return postage requires the completed outbound booking from the configured provider.",
    );
  }
}

async function readEligibility(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  forUpdate: boolean,
) {
  const orderRow = await readRow(db, siteId, orderStorageKey(ownerSegment, orderId), forUpdate);
  const returnRow = await readRow(db, siteId, returnStorageKey(orderId), forUpdate);
  const bookingRow = await readRow(db, siteId, bookingStorageKey(orderId), forUpdate);
  const logisticsRow = await readRow(db, siteId, logisticsStorageKey(orderId), forUpdate);
  return {
    order: orderRow ? requireOrderAt(orderRow) : null,
    returned: returnRow ? requireReturnAt(returnRow) : null,
    booking: bookingRow ? requireBookingAt(bookingRow) : null,
    logistics: logisticsRow ? requireLogisticsAt(logisticsRow) : null,
  };
}

function requireLivePickupWindow(input: NpShopReturnPostageQuoteInput): void {
  if (!input.readyAt || !input.closeAt) return;
  const now = Date.now();
  if (
    new Date(input.readyAt).getTime() <
      now - npShopReturnLogisticsLimits.futureToleranceSeconds * 1_000 ||
    new Date(input.closeAt).getTime() <= now ||
    new Date(input.readyAt).getTime() > now + npShopReturnLogisticsLimits.maximumLeadSeconds * 1_000
  ) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_return_conflict",
      "The return pickup window is no longer live or exceeds the maximum lead time.",
    );
  }
}

export async function npQuoteShopReturnPostage(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopReturnPostageQuoteInput,
): Promise<NpShopReturnPostageQuote> {
  const adapter = runtime.carrierReturnPostageAdapter;
  const returnLocationReference = runtime.carrierReturnLocationReference;
  if (!adapter || !returnLocationReference) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_not_supported",
      "Return-postage quoting is not configured for this site.",
    );
  }
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  requireLivePickupWindow(input);
  const snapshot = await readEligibility(getDb(), siteId, ownerSegment, input.orderId, false);
  requireEligibility(
    snapshot.order,
    snapshot.returned,
    snapshot.booking,
    snapshot.logistics,
    input,
    ownerSegment,
    adapter.id,
  );
  if (!snapshot.returned || !snapshot.booking) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_not_found",
      "The approved return does not exist.",
    );
  }
  const quoteId = randomUUID();
  const requestedAt = new Date();
  const maximumExpiresAt = new Date(
    Math.min(
      requestedAt.getTime() + npShopReturnPostageLimits.maximumQuoteLifetimeSeconds * 1_000,
      new Date(snapshot.order.purgeAt).getTime(),
    ),
  );
  const request = npRequireShopReturnPostageQuoteRequest({
    contract: NP_SHOP_RETURN_POSTAGE_QUOTE_REQUEST_CONTRACT,
    quoteId,
    returnId: snapshot.returned.id,
    orderId: snapshot.order.id,
    originalShipmentId: snapshot.booking.id,
    originalBookingReference: snapshot.booking.bookingReference,
    returnLocationReference,
    currency: snapshot.order.currency,
    mode: input.mode,
    items: returnItems(snapshot.order, snapshot.returned),
    origin: input.origin,
    readyAt: input.readyAt,
    closeAt: input.closeAt,
    requestedAt: requestedAt.toISOString(),
    maximumExpiresAt: maximumExpiresAt.toISOString(),
  });
  let result: unknown;
  try {
    result = await adapter.quoteReturnShipping(request);
  } catch {
    await persistHealth(siteId, {
      contract: NP_SHOP_RETURN_POSTAGE_HEALTH_CONTRACT,
      providerId: adapter.id,
      status: "error",
      errorCode: "provider-error",
      attemptedAt: request.requestedAt,
      succeededAt: null,
    });
    throw new NpShopReturnPostageUnavailableError();
  }
  let quoteResult;
  try {
    quoteResult = npRequireShopReturnPostageQuoteResult(result, {
      quoteId,
      requestedAt: request.requestedAt,
      maximumExpiresAt: request.maximumExpiresAt,
    });
  } catch {
    await persistHealth(siteId, {
      contract: NP_SHOP_RETURN_POSTAGE_HEALTH_CONTRACT,
      providerId: adapter.id,
      status: "error",
      errorCode: "invalid-result",
      attemptedAt: request.requestedAt,
      succeededAt: null,
    });
    throw new NpShopReturnPostageUnavailableError();
  }
  await persistHealth(siteId, {
    contract: NP_SHOP_RETURN_POSTAGE_HEALTH_CONTRACT,
    providerId: adapter.id,
    status: "ok",
    errorCode: null,
    attemptedAt: request.requestedAt,
    succeededAt: request.requestedAt,
  });
  return getDb().transaction(async (tx) => {
    const current = await readEligibility(tx, siteId, ownerSegment, input.orderId, true);
    requireEligibility(
      current.order,
      current.returned,
      current.booking,
      current.logistics,
      input,
      ownerSegment,
      adapter.id,
    );
    if (!current.returned || !current.booking) {
      throw new NpShopReturnPostageConflictError(
        "return_postage_not_found",
        "The return disappeared.",
      );
    }
    const existingPostageRow = await readRow(
      tx,
      siteId,
      npShopReturnPostageStorageKey(input.orderId),
      true,
    );
    if (existingPostageRow) {
      const existingPostage = requirePostageAt(existingPostageRow);
      if (existingPostage.id !== quoteId && existingPostage.quotedAt >= request.requestedAt) {
        throw new NpShopReturnPostageConflictError(
          "return_postage_revision_conflict",
          "A newer return-postage quote completed first.",
        );
      }
    }
    const expiresAt = quoteResult.expiresAt;
    if (new Date(expiresAt) <= new Date()) {
      throw new NpShopReturnPostageConflictError(
        "return_postage_expired",
        "The return-postage quote expired before it could be stored.",
      );
    }
    const stored = {
      contract: NP_SHOP_RETURN_POSTAGE_STORAGE_CONTRACT,
      id: quoteId,
      returnId: current.returned.id,
      orderId: current.order.id,
      ownerSegment,
      providerId: adapter.id,
      status: "quoted",
      revision: 1,
      returnRevision: current.returned.revision,
      originalShipmentId: current.booking.id,
      originalBookingReference: current.booking.bookingReference!,
      currency: current.order.currency,
      mode: input.mode,
      methods: quoteResult.methods,
      selectedMethod: null,
      readyAt: input.readyAt,
      closeAt: input.closeAt,
      quotedAt: request.requestedAt,
      expiresAt,
      purgeAt: current.order.purgeAt,
    } satisfies NpShopStoredReturnPostage;
    const privateData = {
      contract: NP_SHOP_RETURN_POSTAGE_PRIVATE_CONTRACT,
      quoteId,
      returnId: current.returned.id,
      orderId: current.order.id,
      ownerSegment,
      origin: input.origin,
      createdAt: request.requestedAt,
      expiresAt,
    } satisfies NpShopStoredReturnPostagePrivate;
    await persistPostage(tx, siteId, stored);
    await persistPrivate(tx, siteId, privateData);
    return npProjectShopReturnPostage(stored);
  });
}

export async function npSelectShopReturnPostage(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopReturnPostageSelectInput,
): Promise<NpShopReturnPostageQuote> {
  const adapter = runtime.carrierReturnPostageAdapter;
  if (!adapter) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_not_supported",
      "Return-postage quoting is not configured.",
    );
  }
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  return getDb().transaction(async (tx) => {
    const current = await readEligibility(tx, siteId, ownerSegment, input.orderId, true);
    const postageRow = await readRow(
      tx,
      siteId,
      npShopReturnPostageStorageKey(input.orderId),
      true,
    );
    const privateRow = await readRow(
      tx,
      siteId,
      npShopReturnPostagePrivateStorageKey(input.orderId),
      true,
    );
    const postage = postageRow ? requirePostageAt(postageRow) : null;
    const privateData = privateRow ? requirePrivateAt(privateRow) : null;
    if (
      !postage ||
      !privateData ||
      !current.returned ||
      postage.id !== input.quoteId ||
      postage.returnId !== input.returnId ||
      postage.ownerSegment !== ownerSegment ||
      postage.providerId !== adapter.id ||
      privateData.quoteId !== postage.id ||
      privateData.ownerSegment !== ownerSegment
    ) {
      throw new NpShopReturnPostageConflictError(
        "return_postage_not_found",
        "The owner-scoped return-postage quote does not exist.",
      );
    }
    requireEligibility(
      current.order,
      current.returned,
      current.booking,
      current.logistics,
      { returnId: input.returnId, expectedReturnRevision: postage.returnRevision },
      ownerSegment,
      adapter.id,
    );
    if (postage.revision !== input.expectedRevision) {
      throw new NpShopReturnPostageConflictError(
        "return_postage_revision_conflict",
        "The return-postage quote changed before selection.",
      );
    }
    if (new Date(postage.expiresAt) <= new Date()) {
      await deletePostageRows(tx, siteId, input.orderId);
      throw new NpShopReturnPostageConflictError(
        "return_postage_expired",
        "The return-postage quote expired before selection.",
      );
    }
    const method = postage.methods.find((candidate) => candidate.id === input.methodId);
    if (!method) {
      throw new NpShopReturnPostageConflictError(
        "return_postage_method_not_found",
        "The selected return-postage method was not quoted.",
      );
    }
    const selectedMethod = {
      contract: NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT,
      providerId: postage.providerId,
      quoteId: postage.id,
      methodId: method.id,
      label: method.label,
      currency: postage.currency,
      amountMinor: method.amountMinor,
      estimatedTransit: method.estimatedTransit,
      quotedAt: postage.quotedAt,
      quoteExpiresAt: postage.expiresAt,
    } satisfies NpShopReturnPostageMethod;
    const updated = {
      ...postage,
      status: "selected",
      revision: postage.revision + 1,
      selectedMethod,
    } satisfies NpShopStoredReturnPostage;
    await persistPostage(tx, siteId, updated);
    return npProjectShopReturnPostage(updated);
  });
}

export async function npConsumeSelectedShopReturnPostage(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  order: NpShopStoredOrder,
  returned: NpShopStoredReturn,
  booking: NpShopStoredCarrierBooking,
  providerId: string,
  input: NpShopQuotedReturnLogisticsCreateInput,
): Promise<{
  method: NpShopReturnPostageMethod;
  origin: NpShopOrderDraftShipping;
  mode: NpShopStoredReturnPostage["mode"];
  readyAt: string | null;
  closeAt: string | null;
}> {
  const postageRow = await readRow(tx, siteId, npShopReturnPostageStorageKey(order.id), true);
  const privateRow = await readRow(
    tx,
    siteId,
    npShopReturnPostagePrivateStorageKey(order.id),
    true,
  );
  const postage = postageRow ? requirePostageAt(postageRow) : null;
  const privateData = privateRow ? requirePrivateAt(privateRow) : null;
  if (
    !postage ||
    !privateData ||
    postage.id !== input.postageQuoteId ||
    postage.returnId !== input.returnId ||
    postage.orderId !== input.orderId ||
    postage.ownerSegment !== ownerSegment ||
    postage.providerId !== providerId ||
    postage.returnRevision !== returned.revision ||
    postage.originalShipmentId !== booking.id ||
    postage.originalBookingReference !== booking.bookingReference ||
    postage.purgeAt !== order.purgeAt ||
    privateData.quoteId !== postage.id ||
    privateData.returnId !== returned.id ||
    privateData.ownerSegment !== ownerSegment ||
    privateData.expiresAt !== postage.expiresAt
  ) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_return_conflict",
      "The selected return-postage quote no longer matches the approved return.",
    );
  }
  if (postage.revision !== input.expectedPostageRevision) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_revision_conflict",
      "The return-postage selection changed before logistics creation.",
    );
  }
  if (postage.status !== "selected" || !postage.selectedMethod) {
    throw new NpShopReturnPostageConflictError(
      "return_postage_method_not_found",
      "Select one quoted return-postage method before creating logistics.",
    );
  }
  if (new Date(postage.expiresAt) <= new Date()) {
    await deletePostageRows(tx, siteId, order.id);
    throw new NpShopReturnPostageConflictError(
      "return_postage_expired",
      "The selected return-postage quote expired before logistics creation.",
    );
  }
  await deletePostageRows(tx, siteId, order.id);
  return {
    method: postage.selectedMethod,
    origin: privateData.origin,
    mode: postage.mode,
    readyAt: postage.readyAt,
    closeAt: postage.closeAt,
  };
}

export async function npReadShopReturnPostageHealth(): Promise<NpShopReturnPostageHealth | null> {
  const siteId = await requireSiteId();
  const row = await readRow(getDb(), siteId, HEALTH_KEY);
  if (!row) return null;
  if (row.expiresAt !== null) {
    throw new NpShopReturnPostageContractError("Invalid return postage health metadata", [
      "return postage health must not expire.",
    ]);
  }
  return npRequireShopReturnPostageHealth(row.value);
}

export async function npCountShopReturnPostage(
  providerId: string | undefined,
): Promise<NpShopReturnPostageCounts> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "return-postage:%"),
  );
  const [{ total, quoted, selected, expired }] = await db
    .select({
      total: sql<number>`count(*)::int`,
      quoted: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'quoted')::int`,
      selected: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'selected')::int`,
      expired: sql<number>`count(*) filter (where ${npPluginStorage.expiresAt} <= now())::int`,
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
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopReturnPostageLimits.diagnosticSampleSize);
  const privateKeys = rows.map((row) =>
    row.key.replace("return-postage:", "return-postage-private:"),
  );
  const privateRows =
    privateKeys.length === 0
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
              inArray(npPluginStorage.key, privateKeys),
            ),
          );
  const privateByOrder = new Map<string, NpShopStoredReturnPostagePrivate>();
  let invalidSample = 0;
  for (const row of privateRows) {
    try {
      const value = requirePrivateAt(row);
      privateByOrder.set(value.orderId, value);
    } catch {
      invalidSample += 1;
    }
  }
  const counts: NpShopReturnPostageCounts = {
    total: Number(total),
    quoted: Number(quoted),
    selected: Number(selected),
    expired: Number(expired),
    privateMismatchSample: 0,
    invalidSample,
    providerMismatchSample: 0,
  };
  for (const row of rows) {
    try {
      const value = requirePostageAt(row);
      if (providerId && value.providerId !== providerId) counts.providerMismatchSample += 1;
      const privateData = privateByOrder.get(value.orderId);
      if (
        !privateData ||
        privateData.quoteId !== value.id ||
        privateData.returnId !== value.returnId ||
        privateData.ownerSegment !== value.ownerSegment ||
        privateData.expiresAt !== value.expiresAt
      ) {
        counts.privateMismatchSample += 1;
      }
    } catch {
      counts.invalidSample += 1;
    }
  }
  return counts;
}

export async function npListRecentShopReturnPostage(): Promise<{
  rows: NpShopAdminReturnPostageRow[];
  truncated: boolean;
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
        like(npPluginStorage.key, "return-postage:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopReturnPostageLimits.adminListSize + 1);
  const projected = rows.slice(0, npShopReturnPostageLimits.adminListSize).map((row) => {
    const value = requirePostageAt(row);
    return {
      id: value.id,
      quoteId: value.id,
      returnId: value.returnId,
      provider: value.providerId,
      status: value.status,
      currency: value.currency,
      amount: value.selectedMethod?.amountMinor.toString() ?? "—",
      privateOrigin: "withheld",
      expiresAt: value.expiresAt,
    } satisfies NpShopAdminReturnPostageRow;
  });
  return { rows: projected, truncated: rows.length > npShopReturnPostageLimits.adminListSize };
}

export async function npCleanupExpiredShopReturnPostage(): Promise<number> {
  const siteId = await requireSiteId();
  const now = new Date();
  const expired = await getDb()
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "return-postage:%"),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt))
    .limit(npShopReturnPostageLimits.cleanupBatchSize);
  let removed = 0;
  for (const row of expired) {
    const orderId = row.key.slice("return-postage:".length);
    const didRemove = await getDb().transaction(async (tx) => {
      const valueRow = await readRow(tx, siteId, row.key, true);
      if (!valueRow || (valueRow.expiresAt && valueRow.expiresAt > now)) return false;
      await deletePostageRows(tx, siteId, orderId);
      return true;
    });
    if (didRemove) removed += 1;
  }
  return removed;
}
