import { createHash, randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, gt, inArray, like, sql } from "drizzle-orm";

import type { NpShopCarrierReturnTrackingPollAdapter } from "./carrier-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import { npRequireStoredShopReturn, type NpShopStoredReturn } from "./return-contract.js";
import {
  npRequireStoredShopReturnLogistics,
  type NpShopStoredReturnLogistics,
} from "./return-logistics-contract.js";
import {
  NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_CURSOR_KEY,
  NP_SHOP_RETURN_TRACKING_POLL_REQUEST_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_STORAGE_CONTRACT,
  NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT,
  NP_SHOP_RETURN_TRACKING_STORAGE_CONTRACT,
  NpShopReturnTrackingConflictError,
  NpShopReturnTrackingContractError,
  npProjectShopReturnTracking,
  npRequireShopReturnTrackingPollCursor,
  npRequireShopReturnTrackingPollRequest,
  npRequireShopReturnTrackingPollResult,
  npRequireShopReturnTrackingProviderId,
  npRequireStoredShopReturnTracking,
  npRequireStoredShopReturnTrackingPoll,
  npRequireStoredShopReturnTrackingReceipt,
  npShopReturnTrackingEventDigest,
  npShopReturnTrackingLimits,
  npShopReturnTrackingPollBackoffSeconds,
  npShopReturnTrackingPollStorageKey,
  npShopReturnTrackingReceiptStorageKey,
  npShopReturnTrackingStorageKey,
  type NpShopReturnTracking,
  type NpShopReturnTrackingPollCursor,
  type NpShopReturnTrackingPollErrorCode,
  type NpShopReturnTrackingPollRequest,
  type NpShopStoredReturnTracking,
  type NpShopStoredReturnTrackingPoll,
  type NpShopStoredReturnTrackingReceipt,
  type NpShopVerifiedReturnTrackingEvent,
} from "./return-tracking-contract.js";
import type { NpShopTrackingReceiptOutcome, NpShopTrackingStatus } from "./tracking-contract.js";

export interface NpShopReturnTrackingApplyResult {
  receipt: NpShopStoredReturnTrackingReceipt;
  tracking: NpShopReturnTracking;
  duplicate: boolean;
}

export interface NpShopAdminReturnTrackingEventRow {
  [key: string]: unknown;
  provider: string;
  eventId: string;
  logisticsId: string;
  returnId: string;
  orderId: string;
  status: string;
  outcome: string;
  occurredAt: string;
  processedAt: string;
}

export interface NpShopAdminReturnTrackingPollRow {
  [key: string]: unknown;
  id: string;
  returnId: string;
  logisticsId: string;
  provider: string;
  failures: number;
  lastAttemptAt: string;
  lastSuccessAt: string;
  nextAttemptAt: string;
  lastError: string;
  lease: string;
}

export interface NpShopReturnTrackingReconcileResult {
  scanned: number;
  claimed: number;
  succeeded: number;
  advanced: number;
  unchanged: number;
  failed: number;
  skipped: number;
}

function logisticsKey(orderId: string): string {
  return `return-logistics:${orderId}`;
}
function returnKey(orderId: string): string {
  return `return:${orderId}`;
}

async function readRow(
  db: NpShopTransaction | ReturnType<typeof getDb>,
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

function requireLogisticsRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredReturnLogistics {
  const logistics = npRequireStoredShopReturnLogistics(value);
  if (
    key !== logisticsKey(logistics.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== logistics.purgeAt
  ) {
    throw new NpShopReturnTrackingContractError("Invalid return logistics storage metadata", [
      "return logistics key and expiry must match its value.",
    ]);
  }
  return logistics;
}

function requireReturnRow(value: unknown, expiresAt: Date | null, key: string): NpShopStoredReturn {
  const returned = npRequireStoredShopReturn(value);
  if (
    key !== returnKey(returned.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== returned.purgeAt
  ) {
    throw new NpShopReturnTrackingContractError("Invalid physical return storage metadata", [
      "physical return key and expiry must match its value.",
    ]);
  }
  return returned;
}

function requireTrackingRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredReturnTracking {
  const tracking = npRequireStoredShopReturnTracking(value);
  if (
    key !== npShopReturnTrackingStorageKey(tracking.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== tracking.purgeAt
  ) {
    throw new NpShopReturnTrackingContractError("Invalid return tracking storage metadata", [
      "return tracking key and expiry must match its value.",
    ]);
  }
  return tracking;
}

function requireReceiptRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredReturnTrackingReceipt {
  const receipt = npRequireStoredShopReturnTrackingReceipt(value);
  if (
    key !== npShopReturnTrackingReceiptStorageKey(receipt.providerId, receipt.event.eventId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== receipt.purgeAt
  ) {
    throw new NpShopReturnTrackingContractError("Invalid return tracking receipt metadata", [
      "return tracking receipt key and expiry must match its value.",
    ]);
  }
  return receipt;
}

function requirePollRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredReturnTrackingPoll {
  const poll = npRequireStoredShopReturnTrackingPoll(value);
  if (
    key !== npShopReturnTrackingPollStorageKey(poll.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== poll.purgeAt
  ) {
    throw new NpShopReturnTrackingContractError("Invalid return tracking poll metadata", [
      "return tracking poll key and expiry must match its value.",
    ]);
  }
  return poll;
}

function requireCursorRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopReturnTrackingPollCursor {
  const cursor = npRequireShopReturnTrackingPollCursor(value);
  if (key !== NP_SHOP_RETURN_TRACKING_POLL_CURSOR_KEY || expiresAt !== null) {
    throw new NpShopReturnTrackingContractError("Invalid return tracking poll cursor metadata", [
      "return tracking poll cursor must use its fixed non-expiring key.",
    ]);
  }
  return cursor;
}

async function persistTracking(
  tx: NpShopTransaction,
  siteId: string,
  tracking: NpShopStoredReturnTracking,
) {
  npRequireStoredShopReturnTracking(tracking);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopReturnTrackingStorageKey(tracking.orderId),
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
  receipt: NpShopStoredReturnTrackingReceipt,
) {
  npRequireStoredShopReturnTrackingReceipt(receipt);
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: npShopReturnTrackingReceiptStorageKey(receipt.providerId, receipt.event.eventId),
    value: receipt,
    expiresAt: new Date(receipt.purgeAt),
    updatedAt: new Date(receipt.processedAt),
  });
}

async function persistPoll(
  tx: NpShopTransaction,
  siteId: string,
  poll: NpShopStoredReturnTrackingPoll,
) {
  npRequireStoredShopReturnTrackingPoll(poll);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopReturnTrackingPollStorageKey(poll.orderId),
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
  cursor: NpShopReturnTrackingPollCursor,
) {
  npRequireShopReturnTrackingPollCursor(cursor);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: NP_SHOP_RETURN_TRACKING_POLL_CURSOR_KEY,
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

function precedence(status: NpShopTrackingStatus): number {
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

function logisticsMatchesEvent(
  logistics: NpShopStoredReturnLogistics,
  event: NpShopVerifiedReturnTrackingEvent,
  providerId: string,
) {
  return (
    logistics.status === "active" &&
    logistics.id === event.logisticsId &&
    logistics.returnId === event.returnId &&
    logistics.orderId === event.orderId &&
    logistics.providerId === providerId &&
    logistics.returnReference === event.returnReference &&
    logistics.trackingNumber === event.trackingNumber
  );
}

export async function npApplyShopReturnTrackingEvent(
  providerIdInput: string,
  event: NpShopVerifiedReturnTrackingEvent,
  receivedAt: Date,
): Promise<NpShopReturnTrackingApplyResult> {
  const providerId = npRequireShopReturnTrackingProviderId(providerIdInput);
  const siteId = await requireSiteId();
  const digest = npShopReturnTrackingEventDigest(event);
  const receiptKey = npShopReturnTrackingReceiptStorageKey(providerId, event.eventId);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-return-tracking:${siteId}:${providerId}:${createHash("sha256").update(event.eventId).digest("hex")}`}, 0))`,
    );
    const existingReceiptRow = await readRow(tx, siteId, receiptKey, true);
    if (existingReceiptRow) {
      const receipt = requireReceiptRow(
        existingReceiptRow.value,
        existingReceiptRow.expiresAt,
        existingReceiptRow.key,
      );
      if (receipt.eventDigest !== digest) {
        throw new NpShopReturnTrackingConflictError(
          "return_tracking_event_conflict",
          "The carrier event id was already used for different return-tracking data.",
        );
      }
      const stateRow = await readRow(
        tx,
        siteId,
        npShopReturnTrackingStorageKey(event.orderId),
        true,
      );
      if (!stateRow) {
        throw new NpShopReturnTrackingConflictError(
          "return_tracking_logistics_not_found",
          "The duplicate event no longer has its durable return-tracking state.",
        );
      }
      return {
        receipt,
        tracking: npProjectShopReturnTracking(
          requireTrackingRow(stateRow.value, stateRow.expiresAt, stateRow.key),
        ),
        duplicate: true,
      };
    }

    const logisticsRow = await readRow(tx, siteId, logisticsKey(event.orderId), true);
    if (!logisticsRow) {
      throw new NpShopReturnTrackingConflictError(
        "return_tracking_logistics_not_found",
        "The event has no durable return logistics.",
      );
    }
    const logistics = requireLogisticsRow(
      logisticsRow.value,
      logisticsRow.expiresAt,
      logisticsRow.key,
    );
    if (new Date(logistics.purgeAt) <= receivedAt) {
      throw new NpShopReturnTrackingConflictError(
        "return_tracking_expired",
        "The return shipment is past its commercial retention window.",
      );
    }
    if (logistics.providerId !== providerId) {
      throw new NpShopReturnTrackingConflictError(
        "return_tracking_provider_mismatch",
        "The event belongs to a different carrier provider.",
      );
    }
    if (!logisticsMatchesEvent(logistics, event, providerId)) {
      throw new NpShopReturnTrackingConflictError(
        "return_tracking_logistics_mismatch",
        "The event does not exactly match active return logistics.",
      );
    }
    const returnedRow = await readRow(tx, siteId, returnKey(event.orderId), true);
    if (!returnedRow) {
      throw new NpShopReturnTrackingConflictError(
        "return_tracking_return_mismatch",
        "The event has no retained physical return.",
      );
    }
    const returned = requireReturnRow(returnedRow.value, returnedRow.expiresAt, returnedRow.key);
    if (
      returned.id !== event.returnId ||
      returned.ownerSegment !== logistics.ownerSegment ||
      returned.purgeAt !== logistics.purgeAt ||
      (returned.status !== "approved" && returned.status !== "received")
    ) {
      throw new NpShopReturnTrackingConflictError(
        "return_tracking_return_mismatch",
        "The event does not match an approved or received physical return.",
      );
    }

    const stateKey = npShopReturnTrackingStorageKey(event.orderId);
    const stateRow = await readRow(tx, siteId, stateKey, true);
    const existing = stateRow
      ? requireTrackingRow(stateRow.value, stateRow.expiresAt, stateRow.key)
      : null;
    if (
      existing &&
      (existing.logisticsId !== logistics.id ||
        existing.returnId !== logistics.returnId ||
        existing.providerId !== providerId ||
        existing.returnReference !== logistics.returnReference ||
        existing.trackingNumber !== logistics.trackingNumber ||
        existing.purgeAt !== logistics.purgeAt)
    ) {
      throw new NpShopReturnTrackingConflictError(
        "return_tracking_logistics_mismatch",
        "The durable return-tracking state belongs to different logistics.",
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
      precedence(event.status) <= precedence(existing.status)
    ) {
      outcome = event.status === existing.status ? "ignored-stale" : "ignored-regression";
    } else if (existing && !canAdvance(existing.status, event.status)) {
      outcome = "ignored-regression";
    }

    const processedAt = receivedAt.toISOString();
    const tracking: NpShopStoredReturnTracking =
      outcome === "advanced"
        ? {
            contract: NP_SHOP_RETURN_TRACKING_STORAGE_CONTRACT,
            orderId: event.orderId,
            returnId: event.returnId,
            logisticsId: event.logisticsId,
            providerId,
            returnReference: event.returnReference,
            trackingNumber: event.trackingNumber,
            status: event.status,
            latestEventId: event.eventId,
            occurredAt: event.occurredAt,
            deliveredAt: event.status === "delivered" ? event.occurredAt : null,
            updatedAt: processedAt,
            purgeAt: logistics.purgeAt,
          }
        : (existing ??
          (() => {
            throw new NpShopReturnTrackingContractError("Invalid initial return-tracking event", [
              "the first canonical event must create durable state.",
            ]);
          })());
    if (outcome === "advanced") await persistTracking(tx, siteId, tracking);
    const receipt: NpShopStoredReturnTrackingReceipt = {
      contract: NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT,
      providerId,
      event,
      eventDigest: digest,
      outcome,
      trackingStatus: tracking.status,
      processedAt,
      purgeAt: logistics.purgeAt,
    };
    await persistReceipt(tx, siteId, receipt);
    return {
      receipt,
      tracking: npProjectShopReturnTracking(tracking),
      duplicate: false,
    };
  });
}

interface Candidate {
  logistics: NpShopStoredReturnLogistics;
}
interface Claim {
  logistics: NpShopStoredReturnLogistics;
  request: NpShopReturnTrackingPollRequest;
  leaseId: string;
}

async function readCursor(siteId: string) {
  const row = await readRow(getDb(), siteId, NP_SHOP_RETURN_TRACKING_POLL_CURSOR_KEY, false);
  return row ? requireCursorRow(row.value, row.expiresAt, row.key) : null;
}

async function writeCursor(
  siteId: string,
  providerId: string,
  lastLogisticsKey: string | null,
  now: Date,
) {
  await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-return-tracking-poll-cursor:${siteId}`}, 0))`,
    );
    await persistCursor(tx, siteId, {
      contract: NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT,
      providerId,
      lastLogisticsKey,
      updatedAt: now.toISOString(),
    });
  });
}

async function readCandidatePage(
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
        like(npPluginStorage.key, "return-logistics:%"),
        sql`${npPluginStorage.value}->>'status' = 'active'`,
        sql`${npPluginStorage.value}->>'providerId' = ${providerId}`,
        gt(npPluginStorage.expiresAt, now),
        afterKey ? gt(npPluginStorage.key, afterKey) : undefined,
      ),
    )
    .orderBy(asc(npPluginStorage.key))
    .limit(limit);
}

async function filterDue(
  siteId: string,
  rows: Awaited<ReturnType<typeof readCandidatePage>>,
  now: Date,
) {
  if (rows.length === 0) return [];
  const logisticsRows = rows.map((row) => requireLogisticsRow(row.value, row.expiresAt, row.key));
  const keys = logisticsRows.flatMap((logistics) => [
    returnKey(logistics.orderId),
    npShopReturnTrackingStorageKey(logistics.orderId),
    npShopReturnTrackingPollStorageKey(logistics.orderId),
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
        inArray(npPluginStorage.key, keys),
      ),
    );
  const support = new Map(supportRows.map((row) => [row.key, row]));
  const due: Candidate[] = [];
  for (const logistics of logisticsRows) {
    const returnedRow = support.get(returnKey(logistics.orderId));
    const returned = returnedRow
      ? requireReturnRow(returnedRow.value, returnedRow.expiresAt, returnedRow.key)
      : null;
    if (
      !returned ||
      returned.id !== logistics.returnId ||
      returned.ownerSegment !== logistics.ownerSegment ||
      returned.purgeAt !== logistics.purgeAt ||
      (returned.status !== "approved" && returned.status !== "received")
    )
      continue;
    const trackingRow = support.get(npShopReturnTrackingStorageKey(logistics.orderId));
    const tracking = trackingRow
      ? requireTrackingRow(trackingRow.value, trackingRow.expiresAt, trackingRow.key)
      : null;
    if (tracking?.status === "delivered") continue;
    if (
      tracking &&
      (tracking.logisticsId !== logistics.id ||
        tracking.returnId !== logistics.returnId ||
        tracking.providerId !== logistics.providerId ||
        tracking.returnReference !== logistics.returnReference ||
        tracking.trackingNumber !== logistics.trackingNumber ||
        tracking.purgeAt !== logistics.purgeAt)
    )
      throw new NpShopReturnTrackingContractError("Invalid return-tracking state", [
        "return-tracking state must match active logistics.",
      ]);
    const pollRow = support.get(npShopReturnTrackingPollStorageKey(logistics.orderId));
    const poll = pollRow ? requirePollRow(pollRow.value, pollRow.expiresAt, pollRow.key) : null;
    if (
      poll &&
      (poll.logisticsId !== logistics.id ||
        poll.returnId !== logistics.returnId ||
        poll.providerId !== logistics.providerId ||
        poll.purgeAt !== logistics.purgeAt)
    )
      throw new NpShopReturnTrackingContractError("Invalid return-tracking poll state", [
        "return-tracking poll must match active logistics.",
      ]);
    if (
      poll &&
      ((poll.leaseExpiresAt !== null && new Date(poll.leaseExpiresAt) > now) ||
        new Date(poll.nextAttemptAt) > now)
    )
      continue;
    due.push({ logistics });
  }
  return due;
}

async function selectCandidates(siteId: string, providerId: string, now: Date) {
  const cursor = await readCursor(siteId);
  let afterKey = cursor?.providerId === providerId ? cursor.lastLogisticsKey : null;
  const startedAfter = afterKey;
  let wrapped = false;
  let scanned = 0;
  let lastKey = afterKey;
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  while (
    scanned < npShopReturnTrackingLimits.reconcileMaximumScanSize &&
    candidates.length < npShopReturnTrackingLimits.reconcileBatchSize
  ) {
    const pageLimit = Math.min(
      npShopReturnTrackingLimits.reconcileScanSize,
      npShopReturnTrackingLimits.reconcileMaximumScanSize - scanned,
    );
    const rows = await readCandidatePage(siteId, providerId, afterKey, pageLimit, now);
    if (rows.length === 0) {
      if (wrapped || afterKey === null) {
        lastKey = null;
        break;
      }
      afterKey = null;
      wrapped = true;
      continue;
    }
    const unseen = rows.filter((row) => !seen.has(row.key));
    unseen.forEach((row) => seen.add(row.key));
    scanned += unseen.length;
    lastKey = rows.at(-1)?.key ?? lastKey;
    afterKey = lastKey;
    const due = await filterDue(siteId, unseen, now);
    candidates.push(
      ...due.slice(0, npShopReturnTrackingLimits.reconcileBatchSize - candidates.length),
    );
    if (rows.length < pageLimit && !wrapped) {
      if (startedAfter === null) {
        lastKey = null;
        break;
      }
      afterKey = null;
      wrapped = true;
    } else if (unseen.length === 0) break;
  }
  await writeCursor(siteId, providerId, lastKey, now);
  return { candidates, scanned };
}

async function claimPoll(
  siteId: string,
  adapter: NpShopCarrierReturnTrackingPollAdapter,
  candidate: Candidate,
  options: {
    force: boolean;
    staffUserId?: string;
    expectedReturnId?: string;
    expectedLogisticsId?: string;
  },
): Promise<Claim | null> {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const logisticsRow = await readRow(tx, siteId, logisticsKey(candidate.logistics.orderId), true);
    if (!logisticsRow) return null;
    const logistics = requireLogisticsRow(
      logisticsRow.value,
      logisticsRow.expiresAt,
      logisticsRow.key,
    );
    if (
      logistics.status !== "active" ||
      logistics.providerId !== adapter.id ||
      logistics.returnReference === null ||
      logistics.trackingNumber === null ||
      new Date(logistics.purgeAt) <= now ||
      (options.expectedReturnId !== undefined && logistics.returnId !== options.expectedReturnId) ||
      (options.expectedLogisticsId !== undefined && logistics.id !== options.expectedLogisticsId)
    )
      return null;
    const returnedRow = await readRow(tx, siteId, returnKey(logistics.orderId), true);
    if (!returnedRow) return null;
    const returned = requireReturnRow(returnedRow.value, returnedRow.expiresAt, returnedRow.key);
    if (
      returned.id !== logistics.returnId ||
      returned.ownerSegment !== logistics.ownerSegment ||
      returned.purgeAt !== logistics.purgeAt ||
      (returned.status !== "approved" && returned.status !== "received")
    )
      return null;
    const trackingRow = await readRow(
      tx,
      siteId,
      npShopReturnTrackingStorageKey(logistics.orderId),
      true,
    );
    const tracking = trackingRow
      ? requireTrackingRow(trackingRow.value, trackingRow.expiresAt, trackingRow.key)
      : null;
    if (tracking?.status === "delivered") return null;
    if (
      tracking &&
      (tracking.logisticsId !== logistics.id ||
        tracking.returnId !== logistics.returnId ||
        tracking.providerId !== logistics.providerId ||
        tracking.returnReference !== logistics.returnReference ||
        tracking.trackingNumber !== logistics.trackingNumber ||
        tracking.purgeAt !== logistics.purgeAt)
    )
      return null;
    const pollKey = npShopReturnTrackingPollStorageKey(logistics.orderId);
    const pollRow = await readRow(tx, siteId, pollKey, true);
    const existing = pollRow ? requirePollRow(pollRow.value, pollRow.expiresAt, pollRow.key) : null;
    if (
      existing &&
      (existing.returnId !== logistics.returnId ||
        existing.logisticsId !== logistics.id ||
        existing.providerId !== logistics.providerId ||
        existing.purgeAt !== logistics.purgeAt)
    )
      return null;
    if (existing?.leaseExpiresAt && new Date(existing.leaseExpiresAt) > now) return null;
    if (!options.force && existing && new Date(existing.nextAttemptAt) > now) return null;
    const leaseId = randomUUID();
    const requestedAt = now.toISOString();
    const leaseExpiresAt = new Date(
      now.getTime() + npShopReturnTrackingLimits.pollLeaseSeconds * 1_000,
    ).toISOString();
    await persistPoll(tx, siteId, {
      contract: NP_SHOP_RETURN_TRACKING_POLL_STORAGE_CONTRACT,
      orderId: logistics.orderId,
      returnId: logistics.returnId,
      logisticsId: logistics.id,
      providerId: logistics.providerId,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      lastAttemptAt: requestedAt,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      nextAttemptAt: leaseExpiresAt,
      lastErrorCode: existing?.lastErrorCode ?? null,
      leaseId,
      leaseExpiresAt,
      updatedAt: requestedAt,
      purgeAt: logistics.purgeAt,
    });
    if (options.staffUserId) {
      await tx.insert(npAuditEvents).values({
        actorKind: "staff",
        actorUserId: options.staffUserId,
        actorMemberId: null,
        action: "shop.carrier.return-tracking.poll",
        targetType: "shop-return",
        targetId: logistics.returnId,
        payload: {
          orderId: logistics.orderId,
          logisticsId: logistics.id,
          providerId: logistics.providerId,
        },
        siteId,
      });
    }
    return {
      logistics,
      leaseId,
      request: npRequireShopReturnTrackingPollRequest({
        contract: NP_SHOP_RETURN_TRACKING_POLL_REQUEST_CONTRACT,
        logisticsId: logistics.id,
        returnId: logistics.returnId,
        orderId: logistics.orderId,
        returnReference: logistics.returnReference,
        trackingNumber: logistics.trackingNumber,
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

async function finishPoll(
  siteId: string,
  claim: Claim,
  result:
    { ok: true; delivered: boolean } | { ok: false; errorCode: NpShopReturnTrackingPollErrorCode },
  finishedAt: Date,
) {
  await getDb().transaction(async (tx) => {
    const row = await readRow(
      tx,
      siteId,
      npShopReturnTrackingPollStorageKey(claim.logistics.orderId),
      true,
    );
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
              finishedAt.getTime() + npShopReturnTrackingLimits.pollIntervalSeconds * 1_000,
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
      npShopReturnTrackingLimits.maximumConsecutiveFailures,
    );
    await persistPoll(tx, siteId, {
      ...current,
      consecutiveFailures,
      nextAttemptAt: new Date(
        finishedAt.getTime() + npShopReturnTrackingPollBackoffSeconds(consecutiveFailures) * 1_000,
      ).toISOString(),
      lastErrorCode: result.errorCode,
      leaseId: null,
      leaseExpiresAt: null,
      updatedAt: finishedAt.toISOString(),
    });
  });
}

async function runPoll(
  siteId: string,
  adapter: NpShopCarrierReturnTrackingPollAdapter,
  candidate: Candidate,
  options: {
    force: boolean;
    staffUserId?: string;
    expectedReturnId?: string;
    expectedLogisticsId?: string;
  },
) {
  const claim = await claimPoll(siteId, adapter, candidate, options);
  if (!claim) return "skipped" as const;
  let raw: unknown;
  try {
    raw = await adapter.readReturnTracking(claim.request);
  } catch {
    await finishPoll(siteId, claim, { ok: false, errorCode: "provider-error" }, new Date());
    return "failed" as const;
  }
  const receivedAt = new Date();
  let result;
  try {
    result = npRequireShopReturnTrackingPollResult(raw, { request: claim.request, receivedAt });
  } catch {
    await finishPoll(siteId, claim, { ok: false, errorCode: "invalid-result" }, receivedAt);
    return "failed" as const;
  }
  if (result.event === null) {
    await finishPoll(siteId, claim, { ok: true, delivered: false }, receivedAt);
    return "unchanged" as const;
  }
  try {
    const applied = await npApplyShopReturnTrackingEvent(adapter.id, result.event, receivedAt);
    await finishPoll(
      siteId,
      claim,
      { ok: true, delivered: applied.tracking.status === "delivered" },
      receivedAt,
    );
    return !applied.duplicate && applied.receipt.outcome === "advanced"
      ? ("advanced" as const)
      : ("unchanged" as const);
  } catch {
    await finishPoll(siteId, claim, { ok: false, errorCode: "state-conflict" }, receivedAt);
    return "failed" as const;
  }
}

export async function npReconcileShopReturnTracking(
  adapter: NpShopCarrierReturnTrackingPollAdapter,
  options: {
    orderId?: string;
    expectedReturnId?: string;
    expectedLogisticsId?: string;
    force?: boolean;
    staffUserId?: string;
  } = {},
): Promise<NpShopReturnTrackingReconcileResult> {
  const providerId = npRequireShopReturnTrackingProviderId(adapter.id);
  if (typeof adapter.readReturnTracking !== "function")
    throw new NpShopReturnTrackingContractError("Invalid return-tracking poll adapter", [
      "adapter.readReturnTracking must be a function.",
    ]);
  const siteId = await requireSiteId();
  let candidates: Candidate[];
  let scanned: number;
  if (options.orderId) {
    const row = await readRow(getDb(), siteId, logisticsKey(options.orderId), false);
    if (!row)
      throw new NpShopReturnTrackingConflictError(
        "return_tracking_logistics_not_found",
        "The poll has no durable return logistics.",
      );
    candidates = [{ logistics: requireLogisticsRow(row.value, row.expiresAt, row.key) }];
    scanned = 1;
  } else {
    ({ candidates, scanned } = await selectCandidates(siteId, providerId, new Date()));
  }
  const summary: NpShopReturnTrackingReconcileResult = {
    scanned,
    claimed: 0,
    succeeded: 0,
    advanced: 0,
    unchanged: 0,
    failed: 0,
    skipped: 0,
  };
  for (const candidate of candidates) {
    const outcome = await runPoll(siteId, adapter, candidate, {
      force: options.force ?? false,
      staffUserId: options.staffUserId,
      expectedReturnId: options.expectedReturnId,
      expectedLogisticsId: options.expectedLogisticsId,
    });
    if (outcome === "skipped") summary.skipped += 1;
    else {
      summary.claimed += 1;
      if (outcome === "failed") summary.failed += 1;
      else {
        summary.succeeded += 1;
        summary[outcome] += 1;
      }
    }
  }
  return summary;
}

export async function npReadShopReturnTrackingForOrder(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<NpShopReturnTracking | null> {
  const row = await readRow(db, siteId, npShopReturnTrackingStorageKey(orderId), false);
  return row
    ? npProjectShopReturnTracking(requireTrackingRow(row.value, row.expiresAt, row.key))
    : null;
}

export async function npListRecentShopReturnTrackingEvents(): Promise<{
  rows: NpShopAdminReturnTrackingEventRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "return-tracking-event:%"),
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
    .limit(npShopReturnTrackingLimits.adminListSize);
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
        logisticsId: receipt.event.logisticsId,
        returnId: receipt.event.returnId,
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

export async function npListShopReturnTrackingPolls(): Promise<{
  rows: NpShopAdminReturnTrackingPollRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "return-tracking-poll:%"),
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
    .limit(npShopReturnTrackingLimits.adminListSize);
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
        returnId: poll.returnId,
        logisticsId: poll.logisticsId,
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

export async function npCountShopReturnTrackingEvents(expectedProviderId?: string): Promise<{
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
    like(npPluginStorage.key, "return-tracking-event:%"),
  );
  const stateWhere = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "return-tracking:%"),
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
      .limit(npShopReturnTrackingLimits.diagnosticSampleSize),
    db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(eventWhere)
      .orderBy(desc(npPluginStorage.updatedAt))
      .limit(npShopReturnTrackingLimits.diagnosticSampleSize),
  ]);
  let invalidSample = 0;
  let orphanSample = 0;
  let providerMismatchSample = 0;
  let stateMismatchSample = 0;
  const states: NpShopStoredReturnTracking[] = [];
  for (const row of stateRows) {
    try {
      const state = requireTrackingRow(row.value, row.expiresAt, row.key);
      states.push(state);
      if (
        expectedProviderId &&
        state.status !== "delivered" &&
        state.providerId !== expectedProviderId
      )
        providerMismatchSample += 1;
    } catch {
      invalidSample += 1;
    }
  }
  const receipts: NpShopStoredReturnTrackingReceipt[] = [];
  for (const row of eventRows) {
    try {
      receipts.push(requireReceiptRow(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  const keys = [
    ...states.map((state) => logisticsKey(state.orderId)),
    ...receipts.map((receipt) => npShopReturnTrackingStorageKey(receipt.event.orderId)),
  ];
  const supportRows =
    keys.length === 0
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
              inArray(npPluginStorage.key, [...new Set(keys)]),
            ),
          );
  const support = new Map(supportRows.map((row) => [row.key, row]));
  for (const receipt of receipts) {
    if (!support.has(npShopReturnTrackingStorageKey(receipt.event.orderId))) orphanSample += 1;
  }
  for (const state of states) {
    const row = support.get(logisticsKey(state.orderId));
    if (!row) {
      orphanSample += 1;
      continue;
    }
    try {
      const logistics = requireLogisticsRow(row.value, row.expiresAt, row.key);
      if (
        logistics.id !== state.logisticsId ||
        logistics.returnId !== state.returnId ||
        logistics.providerId !== state.providerId ||
        logistics.returnReference !== state.returnReference ||
        logistics.trackingNumber !== state.trackingNumber ||
        logistics.purgeAt !== state.purgeAt
      )
        stateMismatchSample += 1;
    } catch {
      invalidSample += 1;
    }
  }
  return {
    ...eventCounts,
    ...stateCounts,
    invalidSample,
    orphanSample,
    providerMismatchSample,
    stateMismatchSample,
  };
}

export async function npCountShopReturnTrackingPolls(expectedProviderId?: string): Promise<{
  total: number;
  due: number;
  failed: number;
  leased: number;
  expiredLeases: number;
  invalidSample: number;
  orphanSample: number;
  providerMismatchSample: number;
  stateMismatchSample: number;
  unpolledLogisticsSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const nowIso = new Date().toISOString();
  const pollWhere = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "return-tracking-poll:%"),
  );
  const [[counts], pollRows, logisticsRows] = await Promise.all([
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
      .limit(npShopReturnTrackingLimits.diagnosticSampleSize),
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
          like(npPluginStorage.key, "return-logistics:%"),
          sql`${npPluginStorage.value}->>'status' = 'active'`,
          expectedProviderId
            ? sql`${npPluginStorage.value}->>'providerId' = ${expectedProviderId}`
            : undefined,
        ),
      )
      .orderBy(desc(npPluginStorage.updatedAt))
      .limit(npShopReturnTrackingLimits.diagnosticSampleSize),
  ]);
  let invalidSample = 0;
  let orphanSample = 0;
  let providerMismatchSample = 0;
  let stateMismatchSample = 0;
  const polls: NpShopStoredReturnTrackingPoll[] = [];
  const logistics: NpShopStoredReturnLogistics[] = [];
  for (const row of pollRows) {
    try {
      polls.push(requirePollRow(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  for (const row of logisticsRows) {
    try {
      logistics.push(requireLogisticsRow(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  const keys = polls.flatMap((poll) => [
    logisticsKey(poll.orderId),
    npShopReturnTrackingStorageKey(poll.orderId),
  ]);
  keys.push(...logistics.map((item) => npShopReturnTrackingStorageKey(item.orderId)));
  const supportRows =
    keys.length === 0
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
              inArray(npPluginStorage.key, keys),
            ),
          );
  const support = new Map(supportRows.map((row) => [row.key, row]));
  for (const poll of polls) {
    if (expectedProviderId && poll.providerId !== expectedProviderId) providerMismatchSample += 1;
    const row = support.get(logisticsKey(poll.orderId));
    if (!row) orphanSample += 1;
    else {
      try {
        const item = requireLogisticsRow(row.value, row.expiresAt, row.key);
        if (
          item.id !== poll.logisticsId ||
          item.returnId !== poll.returnId ||
          item.providerId !== poll.providerId ||
          item.purgeAt !== poll.purgeAt
        )
          stateMismatchSample += 1;
      } catch {
        invalidSample += 1;
      }
    }
  }
  const pollKeys = new Set(polls.map((poll) => npShopReturnTrackingPollStorageKey(poll.orderId)));
  const trackingKeys = new Set(
    supportRows.filter((row) => row.key.startsWith("return-tracking:")).map((row) => row.key),
  );
  let unpolledLogisticsSample = 0;
  for (const item of logistics) {
    if (
      !pollKeys.has(npShopReturnTrackingPollStorageKey(item.orderId)) &&
      !trackingKeys.has(npShopReturnTrackingStorageKey(item.orderId))
    )
      unpolledLogisticsSample += 1;
  }
  return {
    ...counts,
    invalidSample,
    orphanSample,
    providerMismatchSample,
    stateMismatchSample,
    unpolledLogisticsSample,
  };
}
