import { randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

import {
  npRequireStoredShopFulfillment,
  type NpShopStoredFulfillment,
} from "./fulfillment-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import { npStageShopOrderNotification } from "./order-notification-service.js";
import {
  NpShopOrderContractError,
  npRequireStoredShopOrder,
  type NpShopStoredOrder,
} from "./order-contract.js";
import { NpShopPaymentProviderError } from "./payment-attempt-contract.js";
import { npShopPaymentLimits } from "./payment-contract.js";
import { npReadStoredShopPaymentAdjustment } from "./payment-adjustment-service.js";
import {
  npReadStoredShopPaymentDisputesForOrder,
  npShopPaymentDisputesMatchOrder,
  npShopPaymentDisputesRequireReview,
} from "./payment-dispute-service.js";
import {
  NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT,
  NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_SETTLEMENT_CONTRACT,
  NpShopPartialRefundConflictError,
  npProjectShopPartialRefund,
  npRequireShopPaymentPartialRefundResult,
  npRequireStoredShopPartialRefund,
  npShopPartialRefundLimits,
  type NpShopPartialRefund,
  type NpShopPartialRefundActionInput,
  type NpShopPaymentPartialRefundResult,
  type NpShopReturnPostageSettlement,
  type NpShopReturnSettlementRefundActionInput,
  type NpShopStoredPartialRefund,
} from "./partial-refund-contract.js";
import { npRequireStoredShopRefund, type NpShopStoredRefund } from "./refund-contract.js";
import { npRequireStoredShopReturn, type NpShopStoredReturn } from "./return-contract.js";
import {
  npReadStoredShopReturnLogisticsForSettlement,
  npShopReturnLogisticsStorageKey,
} from "./return-logistics-service.js";
import {
  npRequireStoredShopReturnLogistics,
  type NpShopReturnLogistics,
  type NpShopStoredReturnLogistics,
} from "./return-logistics-contract.js";
import type { NpShopRuntime } from "./runtime.js";

interface NpShopOrderLookup {
  contract: "np.shop-order-lookup.v1";
  orderId: string;
  ownerSegment: string;
  purgeAt: string;
}

export interface NpShopAdminPartialRefundRow {
  [key: string]: unknown;
  id: string;
  refundId: string;
  returnId: string;
  orderRevision: number;
  returnRevision: number;
  provider: string;
  status: string;
  actionKind: string;
  itemAmount: string;
  shippingAmount: string;
  taxAmount: string;
  responsibility: string;
  returnPostage: string;
  postageDeduction: string;
  total: string;
  providerError: string;
  updatedAt: string;
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
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

function orderLookupStorageKey(orderId: string): string {
  return `order-lookup:${orderId}`;
}

function orderStorageKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

function returnStorageKey(orderId: string): string {
  return `return:${orderId}`;
}

function fulfillmentStorageKey(orderId: string): string {
  return `fulfillment:${orderId}`;
}

function fullRefundStorageKey(orderId: string): string {
  return `refund:${orderId}`;
}

function exchangeStorageKey(orderId: string): string {
  return `exchange:${orderId}`;
}

export function npShopPartialRefundStorageKey(orderId: string): string {
  return `partial-refund:${orderId}`;
}

function requireLookup(value: unknown, expiresAt: Date | null, key: string): NpShopOrderLookup {
  if (!isRecord(value) || Object.keys(value).length !== 4) {
    throw new NpShopOrderContractError("Invalid Shop order lookup", [
      "Order lookup must be one exact plain object.",
    ]);
  }
  const lookup = value;
  if (
    lookup.contract !== "np.shop-order-lookup.v1" ||
    typeof lookup.orderId !== "string" ||
    !canonicalUuidPattern.test(lookup.orderId) ||
    !isOwnerSegment(lookup.ownerSegment) ||
    !isCanonicalIso(lookup.purgeAt) ||
    key !== orderLookupStorageKey(lookup.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== lookup.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop order lookup", [
      "Order lookup identity, owner, key, and expiry must be canonical.",
    ]);
  }
  return value as unknown as NpShopOrderLookup;
}

function requireOrder(value: unknown, expiresAt: Date | null, key: string): NpShopStoredOrder {
  const order = npRequireStoredShopOrder(value);
  if (
    key !== orderStorageKey(order.ownerSegment, order.id) ||
    expiresAt === null ||
    expiresAt.toISOString() !== order.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop order storage metadata", [
      "Order key and expiry must match its canonical value.",
    ]);
  }
  return order;
}

function requireReturn(value: unknown, expiresAt: Date | null, key: string): NpShopStoredReturn {
  const returnRequest = npRequireStoredShopReturn(value);
  if (
    key !== returnStorageKey(returnRequest.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== returnRequest.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop return storage metadata", [
      "Return key and expiry must match its canonical value.",
    ]);
  }
  return returnRequest;
}

function requireFulfillment(
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
    throw new NpShopOrderContractError("Invalid Shop fulfillment storage metadata", [
      "Fulfillment key and expiry must match its canonical value.",
    ]);
  }
  return fulfillment;
}

function requirePartialRefund(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredPartialRefund {
  const refund = npRequireStoredShopPartialRefund(value);
  if (
    key !== npShopPartialRefundStorageKey(refund.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== refund.purgeAt
  ) {
    throw new NpShopOrderContractError("Invalid Shop partial refund storage metadata", [
      "Partial refund key and expiry must match its canonical value.",
    ]);
  }
  return refund;
}

function requireReturnLogistics(
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
    throw new NpShopOrderContractError("Invalid Shop return logistics storage metadata", [
      "Return logistics key and expiry must match its canonical value.",
    ]);
  }
  return logistics;
}

async function readLookupForUpdate(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<NpShopOrderLookup | null> {
  const [row] = await tx
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
        eq(npPluginStorage.key, orderLookupStorageKey(orderId)),
      ),
    )
    .limit(1)
    .for("update");
  return row ? requireLookup(row.value, row.expiresAt, row.key) : null;
}

async function readOrderForUpdate(
  tx: NpShopTransaction,
  siteId: string,
  lookup: NpShopOrderLookup,
): Promise<NpShopStoredOrder | null> {
  const [row] = await tx
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
        eq(npPluginStorage.key, orderStorageKey(lookup.ownerSegment, lookup.orderId)),
      ),
    )
    .limit(1)
    .for("update");
  return row ? requireOrder(row.value, row.expiresAt, row.key) : null;
}

async function readReturnForUpdate(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<NpShopStoredReturn | null> {
  const [row] = await tx
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
        eq(npPluginStorage.key, returnStorageKey(orderId)),
      ),
    )
    .limit(1)
    .for("update");
  return row ? requireReturn(row.value, row.expiresAt, row.key) : null;
}

async function readPartialRefund(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredPartialRefund | null> {
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
        eq(npPluginStorage.key, npShopPartialRefundStorageKey(orderId)),
      ),
    )
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  return row ? requirePartialRefund(row.value, row.expiresAt, row.key) : null;
}

/** Internal reconciliation read for authenticated provider adjustment events. */
export async function npReadStoredShopPartialRefundForAdjustment(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
  forUpdate = false,
): Promise<NpShopStoredPartialRefund | null> {
  return readPartialRefund(db, siteId, orderId, forUpdate);
}

async function readFullRefund(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<NpShopStoredRefund | null> {
  const [row] = await tx
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, fullRefundStorageKey(orderId)),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) return null;
  const refund = npRequireStoredShopRefund(row.value);
  if (row.expiresAt === null || row.expiresAt.toISOString() !== refund.purgeAt) {
    throw new NpShopOrderContractError("Invalid Shop full refund storage metadata", [
      "Full refund expiry must match its canonical value.",
    ]);
  }
  return refund;
}

async function requireShippedFulfillment(
  tx: NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
): Promise<void> {
  const [row] = await tx
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, fulfillmentStorageKey(order.id)),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) {
    throw new NpShopPartialRefundConflictError(
      "partial_refund_return_not_received",
      "A return-linked partial refund requires one shipped fulfillment.",
    );
  }
  const fulfillment = requireFulfillment(row.value, row.expiresAt, fulfillmentStorageKey(order.id));
  if (
    fulfillment.status !== "shipped" ||
    fulfillment.orderId !== order.id ||
    fulfillment.ownerSegment !== order.ownerSegment ||
    fulfillment.purgeAt !== order.purgeAt
  ) {
    throw new NpShopPartialRefundConflictError(
      "partial_refund_return_not_received",
      "The received return no longer matches one exact shipped fulfillment.",
    );
  }
}

async function persistPartialRefund(
  tx: NpShopTransaction,
  siteId: string,
  refund: NpShopStoredPartialRefund,
): Promise<void> {
  npRequireStoredShopPartialRefund(refund);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopPartialRefundStorageKey(refund.orderId),
      value: refund,
      expiresAt: new Date(refund.purgeAt),
      updatedAt: new Date(refund.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: refund,
        expiresAt: new Date(refund.purgeAt),
        updatedAt: new Date(refund.updatedAt),
      },
    });
}

async function persistOrder(
  tx: NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
): Promise<void> {
  npRequireStoredShopOrder(order);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: orderStorageKey(order.ownerSegment, order.id),
      value: order,
      expiresAt: new Date(order.purgeAt),
      updatedAt: new Date(order.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: order,
        expiresAt: new Date(order.purgeAt),
        updatedAt: new Date(order.updatedAt),
      },
    });
}

function matchesOrderAndReturn(
  refund: NpShopStoredPartialRefund,
  order: NpShopStoredOrder,
  returnRequest: NpShopStoredReturn,
): boolean {
  const requestedAtEnd = new Date(refund.requestedAt).getTime() + 999;
  return (
    refund.orderId === order.id &&
    refund.returnId === returnRequest.id &&
    refund.providerId === order.paymentProvider &&
    refund.paymentReference === order.paymentReference &&
    refund.currency === order.currency &&
    refund.purgeAt === order.purgeAt &&
    returnRequest.orderId === order.id &&
    returnRequest.ownerSegment === order.ownerSegment &&
    returnRequest.status === "received" &&
    refund.returnRevision === returnRequest.revision &&
    order.status === "paid" &&
    order.paymentResolvedAt !== null &&
    requestedAtEnd >= new Date(order.paymentResolvedAt).getTime() &&
    (refund.status === "refunded"
      ? refund.orderRevision === order.revision
      : refund.orderRevision <= order.revision)
  );
}

function samePostageMethod(
  settlement: NpShopReturnPostageSettlement,
  logistics: NpShopStoredReturnLogistics | NpShopReturnLogistics,
): boolean {
  const method = logistics.postageMethod;
  if (!method) return false;
  const settlementEstimate = settlement.method.estimatedTransit;
  const logisticsEstimate = method.estimatedTransit;
  return (
    settlement.method.contract === method.contract &&
    settlement.method.providerId === method.providerId &&
    settlement.method.quoteId === method.quoteId &&
    settlement.method.methodId === method.methodId &&
    settlement.method.label === method.label &&
    settlement.method.currency === method.currency &&
    settlement.method.amountMinor === method.amountMinor &&
    settlement.method.quotedAt === method.quotedAt &&
    settlement.method.quoteExpiresAt === method.quoteExpiresAt &&
    ((settlementEstimate === null && logisticsEstimate === null) ||
      (settlementEstimate !== null &&
        logisticsEstimate !== null &&
        settlementEstimate.minimumDays === logisticsEstimate.minimumDays &&
        settlementEstimate.maximumDays === logisticsEstimate.maximumDays))
  );
}

function settlementMatchesLogistics(
  refund: NpShopStoredPartialRefund,
  order: NpShopStoredOrder,
  returnRequest: NpShopStoredReturn,
  logistics: NpShopStoredReturnLogistics | NpShopReturnLogistics | null,
): boolean {
  if (!refund.postageSettlement) return true;
  return (
    logistics !== null &&
    (!("orderId" in logistics) ||
      (logistics.orderId === order.id && logistics.returnId === returnRequest.id)) &&
    logistics.status === "active" &&
    samePostageMethod(refund.postageSettlement, logistics)
  );
}

export function npDeriveShopPartialRefundAllocation(
  order: Pick<
    NpShopStoredOrder,
    "shippingMinor" | "taxMinor" | "lines" | "promotions" | "totalMinor"
  >,
  returnRequest: Pick<NpShopStoredReturn, "lines">,
  input: Pick<NpShopPartialRefundActionInput, "shippingMinor" | "taxMinor">,
): NpShopStoredPartialRefund["allocation"] {
  if (input.shippingMinor > order.shippingMinor || input.taxMinor > order.taxMinor) {
    throw new NpShopPartialRefundConflictError(
      "partial_refund_amount_invalid",
      "Shipping and tax refunds cannot exceed their immutable order components.",
    );
  }
  let itemAmountMinor = 0;
  const lines = returnRequest.lines.map((returnedLine) => {
    const orderLine = order.lines.find((line) => line.key === returnedLine.lineKey);
    if (!orderLine || returnedLine.quantity > orderLine.quantity) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_amount_invalid",
        "The received return lines no longer match the immutable order snapshot.",
      );
    }
    const grossAmountMinor = orderLine.unitPriceMinor * returnedLine.quantity;
    const lineDiscountMinor = order.promotions.applied.reduce(
      (total, promotion) =>
        total +
        (promotion.lineDiscounts.find((line) => line.lineKey === returnedLine.lineKey)
          ?.discountMinor ?? 0),
      0,
    );
    const returnedDiscountMinor =
      returnedLine.quantity === orderLine.quantity
        ? lineDiscountMinor
        : Math.floor((lineDiscountMinor * returnedLine.quantity) / orderLine.quantity);
    const amountMinor = grossAmountMinor - returnedDiscountMinor;
    if (
      !Number.isSafeInteger(amountMinor) ||
      !Number.isSafeInteger(itemAmountMinor + amountMinor)
    ) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_amount_invalid",
        "The returned item allocation exceeds the safe integer range.",
      );
    }
    itemAmountMinor += amountMinor;
    return { lineKey: returnedLine.lineKey, quantity: returnedLine.quantity, amountMinor };
  });
  return { lines, itemAmountMinor, shippingMinor: input.shippingMinor, taxMinor: input.taxMinor };
}

async function recordAudit(
  tx: NpShopTransaction,
  siteId: string,
  userId: string,
  action: string,
  orderId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(npAuditEvents).values({
    actorKind: "staff",
    actorUserId: userId,
    actorMemberId: null,
    action,
    targetType: "shop-order",
    targetId: orderId,
    payload,
    siteId,
  });
}

export async function npReadShopPartialRefundForOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  order: NpShopStoredOrder,
  returnRequest: NpShopStoredReturn | null,
  returnLogistics: NpShopReturnLogistics | null,
): Promise<NpShopPartialRefund | null> {
  const refund = await readPartialRefund(db, siteId, order.id);
  if (!refund) return null;
  if (
    !returnRequest ||
    !matchesOrderAndReturn(refund, order, returnRequest) ||
    !settlementMatchesLogistics(refund, order, returnRequest, returnLogistics)
  ) {
    throw new NpShopOrderContractError("Shop partial refund does not match its order", [
      "Partial refund identity, received return, payment, allocation, optional postage settlement, retention, and revision must match.",
    ]);
  }
  return npProjectShopPartialRefund(refund);
}

export async function npHasShopPartialRefund(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<boolean> {
  return (await readPartialRefund(tx, siteId, orderId, true)) !== null;
}

async function refundShopReturn(
  runtime: NpShopRuntime,
  input: NpShopPartialRefundActionInput | NpShopReturnSettlementRefundActionInput,
  staffUserId: string,
): Promise<{ refund: NpShopPartialRefund; duplicate: boolean }> {
  const siteId = await requireSiteId();
  const settlesPostage = "responsibility" in input;
  const prepared = await getDb().transaction(async (tx) => {
    const lookup = await readLookupForUpdate(tx, siteId, input.orderId);
    if (!lookup) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_not_found",
        "The Shop order does not exist in this site.",
      );
    }
    const order = await readOrderForUpdate(tx, siteId, lookup);
    const returnRequest = await readReturnForUpdate(tx, siteId, input.orderId);
    if (!order || !returnRequest || returnRequest.id !== input.returnId) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_not_found",
        "The exact Shop order and return do not exist.",
      );
    }
    const existing = await readPartialRefund(tx, siteId, input.orderId, true);
    if (existing && Boolean(existing.postageSettlement) !== settlesPostage) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_already_exists",
        existing.postageSettlement
          ? "This return already owns a postage-settlement refund; resume it through the matching action."
          : "This return already owns a standard partial refund; resume it through the matching action.",
      );
    }
    const logistics =
      settlesPostage || existing?.postageSettlement
        ? await npReadStoredShopReturnLogisticsForSettlement(tx, siteId, input.orderId, true)
        : null;
    if (
      existing?.postageSettlement &&
      settlesPostage &&
      existing.postageSettlement.responsibility !== input.responsibility
    ) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_revision_conflict",
        "The re-entered return-postage responsibility does not match the durable settlement.",
      );
    }
    if (existing && !settlementMatchesLogistics(existing, order, returnRequest, logistics)) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_amount_invalid",
        "The durable postage settlement no longer matches one active quote-backed return shipment.",
      );
    }
    if (existing?.status === "refunded") {
      return { order, returnRequest, logistics, refund: existing, complete: true as const };
    }
    const paymentAdjustment = await npReadStoredShopPaymentAdjustment(
      tx,
      siteId,
      input.orderId,
      true,
    );
    if (paymentAdjustment?.status === "manual-review") {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_manual_review",
        "A provider-initiated payment adjustment requires reconciliation before a partial refund can start or resume.",
      );
    }
    const paymentDisputes = await npReadStoredShopPaymentDisputesForOrder(
      tx,
      siteId,
      input.orderId,
      true,
    );
    if (!npShopPaymentDisputesMatchOrder(paymentDisputes, order)) {
      throw new NpShopOrderContractError("Shop payment dispute does not match its order", [
        "Dispute provider, payment, amount, and retention must match the commercial order.",
      ]);
    }
    if (npShopPaymentDisputesRequireReview(paymentDisputes)) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_manual_review",
        "A payment dispute requires provider reconciliation before a partial refund can start or resume.",
      );
    }
    if (existing?.status === "manual-review") {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_manual_review",
        "The provider rejected this stable partial refund attempt; manual review is required.",
      );
    }
    if (existing) {
      if (
        existing.status === "pending" &&
        (existing.postageSettlement
          ? !runtime.paymentReturnSettlementAdapter ||
            existing.providerId !== runtime.paymentReturnSettlementAdapter.id
          : !runtime.paymentPartialRefundAdapter ||
            existing.providerId !== runtime.paymentPartialRefundAdapter.id)
      ) {
        throw new NpShopPartialRefundConflictError(
          "partial_refund_provider_mismatch",
          "The pending partial refund requires its original payment provider.",
        );
      }
      return { order, returnRequest, logistics, refund: existing, complete: false as const };
    }
    if (await readFullRefund(tx, siteId, input.orderId)) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_full_refund_conflict",
        "A durable full-refund attempt already owns this payment.",
      );
    }
    const [exchange] = await tx
      .select({ key: npPluginStorage.key })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          eq(npPluginStorage.key, exchangeStorageKey(input.orderId)),
        ),
      )
      .limit(1)
      .for("update");
    if (exchange) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_already_exists",
        "A same-item exchange already owns this received return.",
      );
    }
    const adapter = settlesPostage
      ? runtime.paymentReturnSettlementAdapter
      : runtime.paymentPartialRefundAdapter;
    if (!adapter) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_not_supported",
        settlesPostage
          ? "The configured Shop payment provider does not support quote-backed return-postage settlement refunds."
          : "The configured Shop payment provider does not support partial refunds.",
      );
    }
    if (order.revision !== input.orderRevision || returnRequest.revision !== input.returnRevision) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_revision_conflict",
        "The order or return changed before the partial refund was requested.",
      );
    }
    if (order.status !== "paid" || !order.paymentProvider || !order.paymentReference) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_order_not_paid",
        "Only one currently paid Shop order can be partially refunded.",
      );
    }
    if (returnRequest.status !== "received") {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_return_not_received",
        "The physical return must be received before its payment can be partially refunded.",
      );
    }
    if (new Date(order.purgeAt) <= new Date()) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_order_expired",
        "The order is past its commercial retention window.",
      );
    }
    if (order.paymentProvider !== adapter.id) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_provider_mismatch",
        "The paid order belongs to a different configured payment provider.",
      );
    }
    await requireShippedFulfillment(tx, siteId, order);
    const allocation = npDeriveShopPartialRefundAllocation(order, returnRequest, input);
    const requestedAt = new Date();
    requestedAt.setMilliseconds(0);
    const now = requestedAt.toISOString();
    let postageSettlement: NpShopReturnPostageSettlement | undefined;
    if (settlesPostage) {
      if (
        !logistics ||
        logistics.status !== "active" ||
        logistics.orderId !== order.id ||
        logistics.returnId !== returnRequest.id ||
        logistics.ownerSegment !== order.ownerSegment ||
        logistics.purgeAt !== order.purgeAt ||
        !logistics.postageMethod ||
        logistics.postageMethod.currency !== order.currency
      ) {
        throw new NpShopPartialRefundConflictError(
          "partial_refund_amount_invalid",
          "A postage settlement requires one active quote-backed return shipment in the order currency.",
        );
      }
      postageSettlement = {
        contract: NP_SHOP_RETURN_POSTAGE_SETTLEMENT_CONTRACT,
        responsibility: input.responsibility,
        method: logistics.postageMethod,
        deductionMinor:
          input.responsibility === "customer" ? logistics.postageMethod.amountMinor : 0,
        designatedAt: now,
      };
    }
    const grossAmountMinor =
      allocation.itemAmountMinor + allocation.shippingMinor + allocation.taxMinor;
    const amountMinor = grossAmountMinor - (postageSettlement?.deductionMinor ?? 0);
    if (
      !Number.isSafeInteger(grossAmountMinor) ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor < 1 ||
      amountMinor >= order.totalMinor
    ) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_amount_invalid",
        postageSettlement?.responsibility === "customer" && amountMinor < 1
          ? "The exact quoted return postage consumes the complete refundable allocation; collect or resolve that amount outside Shop instead of creating a zero or negative provider refund."
          : "A return-linked refund must be positive and smaller than the complete order total; use the full-refund action for the entire payment.",
      );
    }
    const refund: NpShopStoredPartialRefund = {
      contract: NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT,
      id: randomUUID(),
      orderId: order.id,
      returnId: returnRequest.id,
      providerId: adapter.id,
      status: "pending",
      orderRevision: order.revision,
      returnRevision: returnRequest.revision,
      paymentReference: order.paymentReference,
      refundReference: null,
      currency: order.currency,
      amountMinor,
      allocation,
      ...(postageSettlement ? { postageSettlement } : {}),
      reason: input.reason,
      providerErrorCode: null,
      requestedAt: now,
      updatedAt: now,
      refundedAt: null,
      purgeAt: order.purgeAt,
    };
    await persistPartialRefund(tx, siteId, refund);
    await recordAudit(
      tx,
      siteId,
      staffUserId,
      postageSettlement ? "shop.return-settlement-refund.request" : "shop.partial-refund.request",
      order.id,
      {
        refundId: refund.id,
        returnId: refund.returnId,
        orderRevision: refund.orderRevision,
        returnRevision: refund.returnRevision,
        providerId: refund.providerId,
        amountMinor: refund.amountMinor,
        ...(postageSettlement
          ? {
              responsibility: postageSettlement.responsibility,
              returnPostageMinor: postageSettlement.method.amountMinor,
              deductionMinor: postageSettlement.deductionMinor,
            }
          : {}),
      },
    );
    return { order, returnRequest, logistics, refund, complete: false as const };
  });
  if (prepared.complete) {
    return { refund: npProjectShopPartialRefund(prepared.refund), duplicate: true };
  }

  let providerResult: NpShopPaymentPartialRefundResult;
  if (prepared.refund.status === "provider-confirmed") {
    providerResult = {
      contract: NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT,
      refundId: prepared.refund.id,
      orderId: prepared.refund.orderId,
      returnId: prepared.refund.returnId,
      paymentReference: prepared.refund.paymentReference,
      refundReference: prepared.refund.refundReference!,
      currency: prepared.refund.currency,
      amountMinor: prepared.refund.amountMinor,
      refundedAt: prepared.refund.refundedAt!,
    };
  } else {
    const adapter = prepared.refund.postageSettlement
      ? runtime.paymentReturnSettlementAdapter
      : runtime.paymentPartialRefundAdapter;
    if (!adapter || adapter.id !== prepared.refund.providerId) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_provider_mismatch",
        "The pending partial refund requires its original payment provider.",
      );
    }
    try {
      const providerInput = {
        refundId: prepared.refund.id,
        orderId: prepared.refund.orderId,
        returnId: prepared.refund.returnId,
        paymentReference: prepared.refund.paymentReference,
        currency: prepared.refund.currency,
        amountMinor: prepared.refund.amountMinor,
        allocation: prepared.refund.allocation,
        reason: prepared.refund.reason,
        requestedAt: prepared.refund.requestedAt,
      };
      providerResult = npRequireShopPaymentPartialRefundResult(
        prepared.refund.postageSettlement
          ? await runtime.paymentReturnSettlementAdapter!.refundReturnSettlement({
              ...providerInput,
              postageSettlement: prepared.refund.postageSettlement,
            })
          : await runtime.paymentPartialRefundAdapter!.refundPaymentPartially(providerInput),
      );
    } catch (error) {
      if (error instanceof NpShopPaymentProviderError && !error.retryable) {
        await getDb().transaction(async (tx) => {
          const current = await readPartialRefund(tx, siteId, input.orderId, true);
          if (!current || current.id !== prepared.refund.id || current.status !== "pending") return;
          const code = error.code
            .trim()
            .slice(0, npShopPartialRefundLimits.providerErrorCodeLength);
          await persistPartialRefund(tx, siteId, {
            ...current,
            status: "manual-review",
            providerErrorCode: code || "provider-error",
            updatedAt: new Date().toISOString(),
          });
        });
      }
      throw error;
    }
  }
  if (
    providerResult.refundId !== prepared.refund.id ||
    providerResult.orderId !== prepared.refund.orderId ||
    providerResult.returnId !== prepared.refund.returnId ||
    providerResult.paymentReference !== prepared.refund.paymentReference ||
    providerResult.currency !== prepared.refund.currency ||
    providerResult.amountMinor !== prepared.refund.amountMinor ||
    new Date(providerResult.refundedAt) < new Date(prepared.refund.requestedAt) ||
    new Date(providerResult.refundedAt).getTime() >
      Date.now() + npShopPaymentLimits.futureToleranceSeconds * 1_000
  ) {
    await getDb().transaction(async (tx) => {
      const current = await readPartialRefund(tx, siteId, input.orderId, true);
      if (!current || current.id !== prepared.refund.id || current.status !== "pending") return;
      await persistPartialRefund(tx, siteId, {
        ...current,
        status: "manual-review",
        providerErrorCode: "provider-result-mismatch",
        updatedAt: new Date().toISOString(),
      });
    });
    throw new NpShopPartialRefundConflictError(
      "partial_refund_provider_mismatch",
      "The provider result does not match the durable partial refund intent.",
    );
  }

  const confirmed = await getDb().transaction(async (tx) => {
    const current = await readPartialRefund(tx, siteId, input.orderId, true);
    if (!current || current.id !== prepared.refund.id) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_not_found",
        "The durable partial refund disappeared after provider confirmation.",
      );
    }
    if (current.status === "refunded") return { refund: current, complete: true as const };
    if (current.status === "provider-confirmed") {
      if (
        current.refundReference !== providerResult.refundReference ||
        current.refundedAt !== providerResult.refundedAt
      ) {
        throw new NpShopPartialRefundConflictError(
          "partial_refund_provider_mismatch",
          "The provider returned conflicting results for one partial refund idempotency key.",
        );
      }
      return { refund: current, complete: false as const };
    }
    if (current.status !== "pending") {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_manual_review",
        "The partial refund entered manual review before confirmation was stored.",
      );
    }
    const next: NpShopStoredPartialRefund = {
      ...current,
      status: "provider-confirmed",
      refundReference: providerResult.refundReference,
      refundedAt: providerResult.refundedAt,
      updatedAt: new Date(
        Math.max(Date.now(), new Date(providerResult.refundedAt).getTime()),
      ).toISOString(),
    };
    await persistPartialRefund(tx, siteId, next);
    return { refund: next, complete: false as const };
  });
  if (confirmed.complete) {
    return { refund: npProjectShopPartialRefund(confirmed.refund), duplicate: true };
  }

  return getDb().transaction(async (tx) => {
    const lookup = await readLookupForUpdate(tx, siteId, input.orderId);
    if (!lookup) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_not_found",
        "The refunded order lookup is missing; manual reconciliation is required.",
      );
    }
    const order = await readOrderForUpdate(tx, siteId, lookup);
    const returnRequest = await readReturnForUpdate(tx, siteId, input.orderId);
    const current = await readPartialRefund(tx, siteId, input.orderId, true);
    const logistics = current?.postageSettlement
      ? await npReadStoredShopReturnLogisticsForSettlement(tx, siteId, input.orderId, true)
      : null;
    if (!order || !returnRequest || !current || current.id !== prepared.refund.id) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_not_found",
        "The durable partial refund, order, or return is missing; manual reconciliation is required.",
      );
    }
    if (current.status === "refunded") {
      return { refund: npProjectShopPartialRefund(current), duplicate: true };
    }
    if (
      current.status !== "provider-confirmed" ||
      order.revision !== prepared.refund.orderRevision ||
      !matchesOrderAndReturn(current, order, returnRequest) ||
      !settlementMatchesLogistics(current, order, returnRequest, logistics)
    ) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_revision_conflict",
        "The provider refunded the payment but local order state changed; manual reconciliation is required.",
      );
    }
    const finalDisputes = await npReadStoredShopPaymentDisputesForOrder(tx, siteId, order.id, true);
    if (
      !npShopPaymentDisputesMatchOrder(finalDisputes, order) ||
      npShopPaymentDisputesRequireReview(finalDisputes)
    ) {
      throw new NpShopPartialRefundConflictError(
        "partial_refund_manual_review",
        "The provider refund is confirmed, but payment dispute evidence must be reconciled before local completion.",
      );
    }
    const now = new Date(
      Math.max(Date.now(), new Date(current.refundedAt ?? 0).getTime()),
    ).toISOString();
    const updatedOrder: NpShopStoredOrder = {
      ...order,
      revision: order.revision + 1,
      updatedAt: now,
    };
    await persistOrder(tx, siteId, updatedOrder);
    const completed: NpShopStoredPartialRefund = {
      ...current,
      status: "refunded",
      orderRevision: updatedOrder.revision,
      updatedAt: now,
    };
    await persistPartialRefund(tx, siteId, completed);
    await npStageShopOrderNotification(tx, siteId, {
      orderId: updatedOrder.id,
      ownerSegment: updatedOrder.ownerSegment,
      kind: completed.postageSettlement
        ? "return-settlement-refund.completed"
        : "partial-refund.completed",
      orderRevision: updatedOrder.revision,
      occurredAt: now,
      purgeAt: updatedOrder.purgeAt,
      email: null,
    });
    await recordAudit(
      tx,
      siteId,
      staffUserId,
      completed.postageSettlement
        ? "shop.return-settlement-refund.complete"
        : "shop.partial-refund.complete",
      order.id,
      {
        refundId: completed.id,
        returnId: completed.returnId,
        orderRevision: completed.orderRevision,
        amountMinor: completed.amountMinor,
        ...(completed.postageSettlement
          ? {
              responsibility: completed.postageSettlement.responsibility,
              returnPostageMinor: completed.postageSettlement.method.amountMinor,
              deductionMinor: completed.postageSettlement.deductionMinor,
            }
          : {}),
      },
    );
    return { refund: npProjectShopPartialRefund(completed), duplicate: false };
  });
}

export async function npPartiallyRefundShopReturn(
  runtime: NpShopRuntime,
  input: NpShopPartialRefundActionInput,
  staffUserId: string,
): Promise<{ refund: NpShopPartialRefund; duplicate: boolean }> {
  return refundShopReturn(runtime, input, staffUserId);
}

export async function npSettleShopReturnPostageRefund(
  runtime: NpShopRuntime,
  input: NpShopReturnSettlementRefundActionInput,
  staffUserId: string,
): Promise<{ refund: NpShopPartialRefund; duplicate: boolean }> {
  return refundShopReturn(runtime, input, staffUserId);
}

export async function npCountShopPartialRefunds(): Promise<{
  total: number;
  pending: number;
  providerConfirmed: number;
  refunded: number;
  manualReview: number;
  merchantResponsibility: number;
  customerResponsibility: number;
  invalidSample: number;
  orphanSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'pending')::int`,
      providerConfirmed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'provider-confirmed')::int`,
      refunded: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'refunded')::int`,
      manualReview: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'contract' = ${NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT} and ${npPluginStorage.value}->>'status' = 'manual-review')::int`,
      merchantResponsibility: sql<number>`count(*) filter (where ${npPluginStorage.value}->'postageSettlement'->>'responsibility' = 'merchant')::int`,
      customerResponsibility: sql<number>`count(*) filter (where ${npPluginStorage.value}->'postageSettlement'->>'responsibility' = 'customer')::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "partial-refund:%"),
      ),
    );
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
        like(npPluginStorage.key, "partial-refund:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPartialRefundLimits.diagnosticSampleSize);
  let invalidSample = 0;
  let orphanSample = 0;
  const valid: NpShopStoredPartialRefund[] = [];
  for (const row of rows) {
    try {
      valid.push(requirePartialRefund(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  const lookupRows =
    valid.length === 0
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
              inArray(
                npPluginStorage.key,
                valid.map((refund) => orderLookupStorageKey(refund.orderId)),
              ),
            ),
          );
  const lookupRowsByKey = new Map(lookupRows.map((row) => [row.key, row]));
  const resolved: Array<{ refund: NpShopStoredPartialRefund; lookup: NpShopOrderLookup }> = [];
  for (const refund of valid) {
    const lookupRow = lookupRowsByKey.get(orderLookupStorageKey(refund.orderId));
    if (!lookupRow) {
      orphanSample += 1;
      continue;
    }
    try {
      resolved.push({
        refund,
        lookup: requireLookup(lookupRow.value, lookupRow.expiresAt, lookupRow.key),
      });
    } catch {
      invalidSample += 1;
    }
  }
  const relatedKeys = resolved.flatMap(({ refund, lookup }) => [
    orderStorageKey(lookup.ownerSegment, refund.orderId),
    returnStorageKey(refund.orderId),
    fulfillmentStorageKey(refund.orderId),
    ...(refund.postageSettlement ? [npShopReturnLogisticsStorageKey(refund.orderId)] : []),
  ]);
  const relatedRows =
    relatedKeys.length === 0
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
              inArray(npPluginStorage.key, relatedKeys),
            ),
          );
  const relatedRowsByKey = new Map(relatedRows.map((row) => [row.key, row]));
  for (const { refund, lookup } of resolved) {
    const orderKey = orderStorageKey(lookup.ownerSegment, refund.orderId);
    const returnKey = returnStorageKey(refund.orderId);
    const fulfillmentKey = fulfillmentStorageKey(refund.orderId);
    const logisticsKey = npShopReturnLogisticsStorageKey(refund.orderId);
    const orderRow = relatedRowsByKey.get(orderKey);
    const returnRow = relatedRowsByKey.get(returnKey);
    const fulfillmentRow = relatedRowsByKey.get(fulfillmentKey);
    const logisticsRow = refund.postageSettlement ? relatedRowsByKey.get(logisticsKey) : null;
    if (!orderRow || !returnRow || !fulfillmentRow || (refund.postageSettlement && !logisticsRow)) {
      orphanSample += 1;
      continue;
    }
    try {
      const order = requireOrder(orderRow.value, orderRow.expiresAt, orderRow.key);
      const returnRequest = requireReturn(returnRow.value, returnRow.expiresAt, returnRow.key);
      const fulfillment = requireFulfillment(
        fulfillmentRow.value,
        fulfillmentRow.expiresAt,
        fulfillmentRow.key,
      );
      const logistics = logisticsRow
        ? requireReturnLogistics(logisticsRow.value, logisticsRow.expiresAt, logisticsRow.key)
        : null;
      if (
        !matchesOrderAndReturn(refund, order, returnRequest) ||
        !settlementMatchesLogistics(refund, order, returnRequest, logistics) ||
        fulfillment.status !== "shipped" ||
        fulfillment.orderId !== order.id ||
        fulfillment.ownerSegment !== order.ownerSegment ||
        fulfillment.purgeAt !== order.purgeAt
      ) {
        invalidSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  return { ...counts, invalidSample, orphanSample };
}

export async function npListRecentShopPartialRefunds(): Promise<{
  rows: NpShopAdminPartialRefundRow[];
  total: number;
}> {
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
        like(npPluginStorage.key, "partial-refund:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPartialRefundLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "partial-refund:%"),
      ),
    );
  return {
    rows: rows.map((row) => {
      const refund = requirePartialRefund(row.value, row.expiresAt, row.key);
      return {
        id: refund.orderId,
        refundId: refund.id,
        returnId: refund.returnId,
        orderRevision: refund.orderRevision,
        returnRevision: refund.returnRevision,
        provider: refund.providerId,
        status: refund.status,
        actionKind:
          refund.status === "pending" || refund.status === "provider-confirmed"
            ? refund.postageSettlement
              ? "return-postage-settlement"
              : "partial-refund"
            : "none",
        itemAmount: `${refund.currency} ${refund.allocation.itemAmountMinor.toString()}`,
        shippingAmount: `${refund.currency} ${refund.allocation.shippingMinor.toString()}`,
        taxAmount: `${refund.currency} ${refund.allocation.taxMinor.toString()}`,
        responsibility: refund.postageSettlement?.responsibility ?? "—",
        returnPostage: refund.postageSettlement
          ? `${refund.currency} ${refund.postageSettlement.method.amountMinor.toString()}`
          : "—",
        postageDeduction: refund.postageSettlement
          ? `${refund.currency} ${refund.postageSettlement.deductionMinor.toString()}`
          : "—",
        total: `${refund.currency} ${refund.amountMinor.toString()}`,
        providerError: refund.providerErrorCode ?? "—",
        updatedAt: refund.updatedAt,
      };
    }),
    total,
  };
}
