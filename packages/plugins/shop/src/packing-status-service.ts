import { createHash } from "node:crypto";

import { getDb, npPluginStorage } from "@nexpress/core/db";
import { getCurrentSiteId } from "@nexpress/core/sites";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

import {
  NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT,
  NP_SHOP_PACKING_STATUS_STORAGE_CONTRACT,
  NpShopPackingStatusConflictError,
  NpShopPackingStatusContractError,
  npRequireShopPackingStatusProviderId,
  npRequireStoredShopPackingStatus,
  npRequireStoredShopPackingStatusReceipt,
  npShopPackingStatusEventDigest,
  npShopPackingStatusLimits,
  npShopPackingStatusReceiptStorageKey,
  npShopPackingStatusStorageKey,
  type NpShopPackingEvidenceStatus,
  type NpShopPackingStatusReceiptOutcome,
  type NpShopStoredPackingStatus,
  type NpShopStoredPackingStatusReceipt,
  type NpShopVerifiedPackingStatusEvent,
} from "./packing-status-contract.js";
import {
  npReadStoredShopPackingWork,
  npRequireStoredShopPackingWorkAtKey,
} from "./packing-work-storage.js";
import { npShopPackingWorkStorageKey, type NpShopStoredPackingWork } from "./packing-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";

type NpShopPackingStatusDb = ReturnType<typeof getDb> | NpShopTransaction;

export interface NpShopPackingStatusApplyResult {
  readonly receipt: NpShopStoredPackingStatusReceipt;
  readonly state: NpShopStoredPackingStatus;
  readonly duplicate: boolean;
}

export interface NpShopAdminPackingStatusEventRow extends Record<string, unknown> {
  readonly provider: string;
  readonly target: string;
  readonly eventId: string;
  readonly workId: string;
  readonly orderId: string;
  readonly status: string;
  readonly outcome: string;
  readonly occurredAt: string;
  readonly processedAt: string;
}

async function requireSiteId(): Promise<string> {
  const siteId = await getCurrentSiteId();
  if (!siteId) throw new Error("Shop packing status requires an active site context.");
  return siteId;
}

async function readExactRow(
  db: NpShopPackingStatusDb,
  siteId: string,
  key: string,
  forUpdate = false,
): Promise<{ key: string; value: unknown; expiresAt: Date | null } | null> {
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

function requireStateRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredPackingStatus {
  const state = npRequireStoredShopPackingStatus(value);
  if (
    key !== npShopPackingStatusStorageKey(state.target, state.orderId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== state.purgeAt
  ) {
    throw new NpShopPackingStatusContractError("Invalid packing status storage metadata", [
      "packing status key and expiry must match its canonical identity.",
    ]);
  }
  return state;
}

function requireReceiptRow(
  value: unknown,
  expiresAt: Date | null,
  key: string,
): NpShopStoredPackingStatusReceipt {
  const receipt = npRequireStoredShopPackingStatusReceipt(value);
  if (
    key !== npShopPackingStatusReceiptStorageKey(receipt.providerId, receipt.event.eventId) ||
    expiresAt === null ||
    expiresAt.toISOString() !== receipt.purgeAt
  ) {
    throw new NpShopPackingStatusContractError("Invalid packing status receipt metadata", [
      "packing status receipt key and expiry must match its canonical event.",
    ]);
  }
  return receipt;
}

async function persistState(
  tx: NpShopTransaction,
  siteId: string,
  state: NpShopStoredPackingStatus,
): Promise<void> {
  npRequireStoredShopPackingStatus(state);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopPackingStatusStorageKey(state.target, state.orderId),
      value: state,
      expiresAt: new Date(state.purgeAt),
      updatedAt: new Date(state.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: state,
        expiresAt: new Date(state.purgeAt),
        updatedAt: new Date(state.updatedAt),
      },
    });
}

async function persistReceipt(
  tx: NpShopTransaction,
  siteId: string,
  receipt: NpShopStoredPackingStatusReceipt,
): Promise<void> {
  npRequireStoredShopPackingStatusReceipt(receipt);
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: npShopPackingStatusReceiptStorageKey(receipt.providerId, receipt.event.eventId),
    value: receipt,
    expiresAt: new Date(receipt.purgeAt),
    updatedAt: new Date(receipt.processedAt),
  });
}

function precedence(status: NpShopPackingEvidenceStatus): number {
  switch (status) {
    case "accepted":
      return 1;
    case "picking":
      return 2;
    case "failed":
      return 3;
    case "packed":
      return 4;
  }
}

function stateMatchesEvent(
  state: NpShopStoredPackingStatus,
  providerId: string,
  event: NpShopVerifiedPackingStatusEvent,
): boolean {
  return (
    state.providerId === providerId &&
    state.workId === event.workId &&
    state.orderId === event.orderId &&
    state.target === event.target &&
    state.exchangeId === event.exchangeId &&
    state.providerWorkReference === event.providerWorkReference
  );
}

export async function npApplyShopPackingStatusEvent(
  providerIdInput: string,
  event: NpShopVerifiedPackingStatusEvent,
  receivedAt: Date,
): Promise<NpShopPackingStatusApplyResult> {
  const providerId = npRequireShopPackingStatusProviderId(providerIdInput);
  const siteId = await requireSiteId();
  const eventDigest = npShopPackingStatusEventDigest(event);
  const receiptKey = npShopPackingStatusReceiptStorageKey(providerId, event.eventId);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-packing-status-event:${siteId}:${providerId}:${createHash("sha256").update(event.eventId).digest("hex")}`}, 0))`,
    );
    const receiptRow = await readExactRow(tx, siteId, receiptKey, true);
    if (receiptRow) {
      const receipt = requireReceiptRow(receiptRow.value, receiptRow.expiresAt, receiptRow.key);
      if (receipt.eventDigest !== eventDigest) {
        throw new NpShopPackingStatusConflictError(
          "packing_status_event_conflict",
          "The packing status event id was already used for different data.",
        );
      }
      const stateRow = await readExactRow(
        tx,
        siteId,
        npShopPackingStatusStorageKey(event.target, event.orderId),
        true,
      );
      if (!stateRow) {
        throw new NpShopPackingStatusConflictError(
          "packing_status_work_not_found",
          "The duplicate packing status event no longer has durable state.",
        );
      }
      const state = requireStateRow(stateRow.value, stateRow.expiresAt, stateRow.key);
      if (!stateMatchesEvent(state, providerId, event)) {
        throw new NpShopPackingStatusConflictError(
          "packing_status_work_mismatch",
          "The duplicate packing status event no longer matches its work.",
        );
      }
      return { receipt, state, duplicate: true };
    }

    const work = await npReadStoredShopPackingWork(tx, siteId, event.target, event.orderId, true);
    if (!work) {
      throw new NpShopPackingStatusConflictError(
        "packing_status_work_not_found",
        "The packing status event has no durable work intent.",
      );
    }
    if (work.providerId !== providerId) {
      throw new NpShopPackingStatusConflictError(
        "packing_status_provider_mismatch",
        "The packing status event belongs to a different provider.",
      );
    }
    if (
      work.workId !== event.workId ||
      work.exchangeId !== event.exchangeId ||
      work.providerWorkReference === null ||
      work.providerWorkReference !== event.providerWorkReference
    ) {
      throw new NpShopPackingStatusConflictError(
        "packing_status_work_mismatch",
        "The packing status event does not match the exact durable work.",
      );
    }

    const stateKey = npShopPackingStatusStorageKey(event.target, event.orderId);
    const stateRow = await readExactRow(tx, siteId, stateKey, true);
    const existing = stateRow
      ? requireStateRow(stateRow.value, stateRow.expiresAt, stateRow.key)
      : null;
    if (existing && !stateMatchesEvent(existing, providerId, event)) {
      throw new NpShopPackingStatusConflictError(
        "packing_status_work_mismatch",
        "The durable packing status belongs to a different work.",
      );
    }

    let outcome: NpShopPackingStatusReceiptOutcome = "advanced";
    const eventTime = new Date(event.occurredAt).getTime();
    const existingTime = existing ? new Date(existing.occurredAt).getTime() : null;
    if (existing?.status === "packed") {
      outcome = "ignored-terminal";
    } else if (existing && existingTime !== null && eventTime < existingTime) {
      outcome = "ignored-stale";
    } else if (
      existing &&
      existingTime === eventTime &&
      precedence(event.status) <= precedence(existing.status)
    ) {
      outcome = event.status === existing.status ? "ignored-stale" : "ignored-regression";
    } else if (existing && precedence(event.status) < precedence(existing.status)) {
      outcome = "ignored-regression";
    }

    const processedAt = receivedAt.toISOString();
    const state: NpShopStoredPackingStatus =
      outcome === "advanced"
        ? event.target === "outbound"
          ? {
              contract: NP_SHOP_PACKING_STATUS_STORAGE_CONTRACT,
              providerId,
              workId: event.workId,
              orderId: event.orderId,
              target: "outbound",
              exchangeId: null,
              providerWorkReference: event.providerWorkReference,
              status: event.status,
              latestEventId: event.eventId,
              occurredAt: event.occurredAt,
              packedAt: event.status === "packed" ? event.occurredAt : null,
              failedAt: event.status === "failed" ? event.occurredAt : null,
              updatedAt: processedAt,
              purgeAt: work.purgeAt,
            }
          : {
              contract: NP_SHOP_PACKING_STATUS_STORAGE_CONTRACT,
              providerId,
              workId: event.workId,
              orderId: event.orderId,
              target: "replacement",
              exchangeId: event.exchangeId,
              providerWorkReference: event.providerWorkReference,
              status: event.status,
              latestEventId: event.eventId,
              occurredAt: event.occurredAt,
              packedAt: event.status === "packed" ? event.occurredAt : null,
              failedAt: event.status === "failed" ? event.occurredAt : null,
              updatedAt: processedAt,
              purgeAt: work.purgeAt,
            }
        : (existing ??
          (() => {
            throw new NpShopPackingStatusContractError("Invalid initial packing status event", [
              "the first canonical event must create durable state.",
            ]);
          })());
    if (outcome === "advanced") await persistState(tx, siteId, state);

    const receipt: NpShopStoredPackingStatusReceipt = {
      contract: NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT,
      providerId,
      event,
      eventDigest,
      outcome,
      packingStatus: state.status,
      processedAt,
      purgeAt: work.purgeAt,
    };
    await persistReceipt(tx, siteId, receipt);
    return { receipt, state, duplicate: false };
  });
}

export async function npListRecentShopPackingStatusEvents(): Promise<{
  readonly rows: NpShopAdminPackingStatusEventRow[];
  readonly total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "packing-status-event:%"),
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(where)
      .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
      .limit(npShopPackingStatusLimits.adminListSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(npPluginStorage)
      .where(where),
  ]);
  const receipts = rows.flatMap((row) => {
    try {
      return [requireReceiptRow(row.value, row.expiresAt, row.key)];
    } catch {
      return [];
    }
  });
  return {
    rows: receipts.map((receipt) => ({
      provider: receipt.providerId,
      target: receipt.event.target,
      eventId: receipt.event.eventId,
      workId: receipt.event.workId,
      orderId: receipt.event.orderId,
      status: receipt.event.status,
      outcome: receipt.outcome,
      occurredAt: receipt.event.occurredAt,
      processedAt: receipt.processedAt,
    })),
    total,
  };
}

export async function npCountShopPackingStatus(expectedProviderId?: string): Promise<{
  readonly total: number;
  readonly states: number;
  readonly accepted: number;
  readonly picking: number;
  readonly failed: number;
  readonly packed: number;
  readonly invalidSample: number;
  readonly orphanSample: number;
  readonly providerMismatchSample: number;
  readonly workMismatchSample: number;
  readonly cancellationConflictSample: number;
  readonly sampleSize: number;
  readonly sampleBoundReached: boolean;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const stateWhere = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "packing-status:%"),
  );
  const eventWhere = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "packing-status-event:%"),
  );
  const [[stateCounts], [eventCounts], stateRows, receiptRows] = await Promise.all([
    db
      .select({
        states: sql<number>`count(*)::int`,
        accepted: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'accepted')::int`,
        picking: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'picking')::int`,
        failed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'failed')::int`,
        packed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'packed')::int`,
      })
      .from(npPluginStorage)
      .where(stateWhere),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(npPluginStorage)
      .where(eventWhere),
    db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(stateWhere)
      .orderBy(desc(npPluginStorage.updatedAt))
      .limit(npShopPackingStatusLimits.diagnosticSampleSize),
    db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(eventWhere)
      .orderBy(desc(npPluginStorage.updatedAt))
      .limit(npShopPackingStatusLimits.diagnosticSampleSize),
  ]);
  let invalidSample = 0;
  let orphanSample = 0;
  let providerMismatchSample = 0;
  let workMismatchSample = 0;
  let cancellationConflictSample = 0;
  const states: NpShopStoredPackingStatus[] = [];
  for (const row of stateRows) {
    try {
      states.push(requireStateRow(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  const workKeys = [
    ...new Set(states.map((state) => npShopPackingWorkStorageKey(state.target, state.orderId))),
  ];
  const workRows =
    workKeys.length === 0
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
              inArray(npPluginStorage.key, workKeys),
            ),
          );
  const works = new Map<string, NpShopStoredPackingWork>();
  for (const row of workRows) {
    try {
      works.set(row.key, npRequireStoredShopPackingWorkAtKey(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  for (const state of states) {
    const work = works.get(npShopPackingWorkStorageKey(state.target, state.orderId));
    if (!work) {
      orphanSample += 1;
      continue;
    }
    if (
      work.workId !== state.workId ||
      work.exchangeId !== state.exchangeId ||
      work.providerId !== state.providerId ||
      work.providerWorkReference !== state.providerWorkReference ||
      work.purgeAt !== state.purgeAt
    ) {
      workMismatchSample += 1;
    }
    if (expectedProviderId && state.providerId !== expectedProviderId) {
      providerMismatchSample += 1;
    }
    if (
      (work.status === "cancel-pending" ||
        work.status === "cancel-confirmed" ||
        work.status === "cancelled") &&
      (state.status === "picking" || state.status === "packed")
    ) {
      cancellationConflictSample += 1;
    }
  }
  const receipts: NpShopStoredPackingStatusReceipt[] = [];
  for (const row of receiptRows) {
    try {
      receipts.push(requireReceiptRow(row.value, row.expiresAt, row.key));
    } catch {
      invalidSample += 1;
    }
  }
  const stateByKey = new Map(
    states.map((state) => [npShopPackingStatusStorageKey(state.target, state.orderId), state]),
  );
  const missingStateKeys = [
    ...new Set(
      receipts
        .map((receipt) =>
          npShopPackingStatusStorageKey(receipt.event.target, receipt.event.orderId),
        )
        .filter((key) => !stateByKey.has(key)),
    ),
  ];
  if (missingStateKeys.length > 0) {
    const relatedStateRows = await db
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
          inArray(npPluginStorage.key, missingStateKeys),
        ),
      );
    for (const row of relatedStateRows) {
      try {
        stateByKey.set(row.key, requireStateRow(row.value, row.expiresAt, row.key));
      } catch {
        invalidSample += 1;
      }
    }
  }
  for (const receipt of receipts) {
    const state = stateByKey.get(
      npShopPackingStatusStorageKey(receipt.event.target, receipt.event.orderId),
    );
    if (
      !state ||
      !stateMatchesEvent(state, receipt.providerId, receipt.event) ||
      state.purgeAt !== receipt.purgeAt
    ) {
      orphanSample += 1;
    }
    if (expectedProviderId && receipt.providerId !== expectedProviderId) {
      providerMismatchSample += 1;
    }
  }
  return {
    total: eventCounts.total,
    ...stateCounts,
    invalidSample,
    orphanSample,
    providerMismatchSample,
    workMismatchSample,
    cancellationConflictSample,
    sampleSize: Math.max(stateRows.length, receiptRows.length),
    sampleBoundReached:
      stateCounts.states > stateRows.length || eventCounts.total > receiptRows.length,
  };
}
