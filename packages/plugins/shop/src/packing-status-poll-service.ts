import { randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, gt, inArray, like, or, sql } from "drizzle-orm";

import {
  NP_SHOP_PACKING_STATUS_POLL_CURSOR_CONTRACT,
  NP_SHOP_PACKING_STATUS_POLL_CURSOR_KEY,
  NP_SHOP_PACKING_STATUS_POLL_REQUEST_CONTRACT,
  NP_SHOP_PACKING_STATUS_POLL_STORAGE_CONTRACT,
  NpShopPackingStatusConflictError,
  NpShopPackingStatusContractError,
  npRequireShopPackingStatusPollCursor,
  npRequireShopPackingStatusPollRequest,
  npRequireShopPackingStatusPollResult,
  npRequireShopPackingStatusProviderId,
  npRequireStoredShopPackingStatus,
  npRequireStoredShopPackingStatusPoll,
  npShopPackingStatusLimits,
  npShopPackingStatusPollBackoffSeconds,
  npShopPackingStatusPollStorageKey,
  npShopPackingStatusStorageKey,
  type NpShopPackingStatusPollCursor,
  type NpShopPackingStatusPollErrorCode,
  type NpShopPackingStatusPollRequest,
  type NpShopStoredPackingStatus,
  type NpShopStoredPackingStatusPoll,
} from "./packing-status-contract.js";
import { npApplyShopPackingStatusEvent } from "./packing-status-service.js";
import {
  npRequireStoredShopPackingWorkAtKey,
  npReadStoredShopPackingWork,
} from "./packing-work-storage.js";
import {
  npShopPackingWorkStorageKey,
  type NpShopPackingWorkPollAdapter,
  type NpShopStoredPackingWork,
} from "./packing-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";

type StorageRow = {
  readonly key: string;
  readonly value: unknown;
  readonly expiresAt: Date | null;
};

export interface NpShopPackingStatusReconcileResult {
  readonly scanned: number;
  readonly claimed: number;
  readonly succeeded: number;
  readonly advanced: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface NpShopAdminPackingStatusPollRow extends Record<string, unknown> {
  readonly id: string;
  readonly workId: string;
  readonly target: string;
  readonly provider: string;
  readonly failures: number;
  readonly lastAttemptAt: string;
  readonly lastSuccessAt: string;
  readonly nextAttemptAt: string;
  readonly error: string;
  readonly leasedUntil: string;
  readonly updatedAt: string;
}

interface Candidate {
  readonly key: string;
  readonly work: NpShopStoredPackingWork;
}

interface Claim {
  readonly work: NpShopStoredPackingWork;
  readonly request: NpShopPackingStatusPollRequest;
  readonly leaseId: string;
}

async function readExactRow(
  db: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  key: string,
  forUpdate = false,
): Promise<StorageRow | null> {
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

function requirePollRow(row: StorageRow): NpShopStoredPackingStatusPoll {
  const poll = npRequireStoredShopPackingStatusPoll(row.value);
  if (
    row.key !== npShopPackingStatusPollStorageKey(poll.target, poll.orderId) ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== poll.purgeAt
  ) {
    throw new NpShopPackingStatusContractError("Invalid packing status poll metadata", [
      "poll key and expiry must match its exact work.",
    ]);
  }
  return poll;
}

function requireStateRow(row: StorageRow): NpShopStoredPackingStatus {
  const state = npRequireStoredShopPackingStatus(row.value);
  if (
    row.key !== npShopPackingStatusStorageKey(state.target, state.orderId) ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== state.purgeAt
  ) {
    throw new NpShopPackingStatusContractError("Invalid packing status metadata", [
      "status key and expiry must match its exact work.",
    ]);
  }
  return state;
}

function pollMatchesWork(
  poll: NpShopStoredPackingStatusPoll,
  work: NpShopStoredPackingWork,
): boolean {
  return (
    poll.workId === work.workId &&
    poll.orderId === work.orderId &&
    poll.target === work.target &&
    poll.exchangeId === work.exchangeId &&
    poll.providerId === work.providerId &&
    poll.providerWorkReference === work.providerWorkReference &&
    poll.purgeAt === work.purgeAt
  );
}

function stateMatchesWork(
  state: NpShopStoredPackingStatus,
  work: NpShopStoredPackingWork,
): boolean {
  return (
    state.workId === work.workId &&
    state.orderId === work.orderId &&
    state.target === work.target &&
    state.exchangeId === work.exchangeId &&
    state.providerId === work.providerId &&
    state.providerWorkReference === work.providerWorkReference &&
    state.purgeAt === work.purgeAt
  );
}

function pollable(work: NpShopStoredPackingWork): boolean {
  return (
    work.providerWorkReference !== null &&
    ["provider-confirmed", "active", "cancel-pending", "cancel-confirmed"].includes(work.status)
  );
}

async function persistPoll(
  tx: NpShopTransaction,
  siteId: string,
  poll: NpShopStoredPackingStatusPoll,
): Promise<void> {
  npRequireStoredShopPackingStatusPoll(poll);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopPackingStatusPollStorageKey(poll.target, poll.orderId),
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

async function readCursor(siteId: string): Promise<NpShopPackingStatusPollCursor | null> {
  const row = await readExactRow(getDb(), siteId, NP_SHOP_PACKING_STATUS_POLL_CURSOR_KEY);
  if (!row) return null;
  try {
    if (row.expiresAt !== null) {
      throw new NpShopPackingStatusContractError("Invalid packing status poll cursor metadata", [
        "cursor must not expire.",
      ]);
    }
    return npRequireShopPackingStatusPollCursor(row.value);
  } catch (error) {
    if (error instanceof NpShopPackingStatusContractError) return null;
    throw error;
  }
}

async function writeCursor(
  siteId: string,
  providerId: string,
  lastWorkKey: string | null,
  now: Date,
): Promise<void> {
  const cursor = npRequireShopPackingStatusPollCursor({
    contract: NP_SHOP_PACKING_STATUS_POLL_CURSOR_CONTRACT,
    providerId,
    lastWorkKey,
    updatedAt: now.toISOString(),
  });
  await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-packing-status-poll-cursor:${siteId}`}, 0))`,
    );
    await tx
      .insert(npPluginStorage)
      .values({
        pluginId: NP_SHOP_PLUGIN_ID,
        siteId,
        key: NP_SHOP_PACKING_STATUS_POLL_CURSOR_KEY,
        value: cursor,
        expiresAt: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
        set: { value: cursor, expiresAt: null, updatedAt: now },
      });
  });
}

async function readCandidatePage(
  siteId: string,
  providerId: string,
  afterKey: string | null,
  limit: number,
): Promise<StorageRow[]> {
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
        like(npPluginStorage.key, "packing-work:%"),
        sql`${npPluginStorage.value}->>'providerId' = ${providerId}`,
        sql`${npPluginStorage.value}->>'providerWorkReference' is not null`,
        or(
          sql`${npPluginStorage.value}->>'status' = 'provider-confirmed'`,
          sql`${npPluginStorage.value}->>'status' = 'active'`,
          sql`${npPluginStorage.value}->>'status' = 'cancel-pending'`,
          sql`${npPluginStorage.value}->>'status' = 'cancel-confirmed'`,
        ),
        afterKey ? gt(npPluginStorage.key, afterKey) : undefined,
      ),
    )
    .orderBy(asc(npPluginStorage.key))
    .limit(limit);
}

async function dueCandidates(siteId: string, rows: StorageRow[], now: Date): Promise<Candidate[]> {
  const candidates = rows.flatMap((row) => {
    try {
      return [
        {
          key: row.key,
          work: npRequireStoredShopPackingWorkAtKey(row.value, row.expiresAt, row.key),
        },
      ];
    } catch {
      return [];
    }
  });
  const keys = candidates.flatMap(({ work }) => [
    npShopPackingStatusPollStorageKey(work.target, work.orderId),
    npShopPackingStatusStorageKey(work.target, work.orderId),
  ]);
  const supportRows =
    keys.length === 0
      ? []
      : await getDb()
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
  return candidates.filter(({ work }) => {
    try {
      if (!pollable(work)) return false;
      const stateRow = support.get(npShopPackingStatusStorageKey(work.target, work.orderId));
      if (stateRow) {
        const state = requireStateRow(stateRow);
        if (!stateMatchesWork(state, work) || state.status === "packed") return false;
      }
      const pollRow = support.get(npShopPackingStatusPollStorageKey(work.target, work.orderId));
      if (!pollRow) return true;
      const poll = requirePollRow(pollRow);
      if (!pollMatchesWork(poll, work)) return false;
      return (
        (poll.leaseExpiresAt === null || new Date(poll.leaseExpiresAt) <= now) &&
        new Date(poll.nextAttemptAt) <= now
      );
    } catch {
      return false;
    }
  });
}

async function selectCandidates(
  siteId: string,
  providerId: string,
  now: Date,
): Promise<{ readonly candidates: Candidate[]; readonly scanned: number }> {
  const cursor = await readCursor(siteId);
  const startedAfter = cursor?.providerId === providerId ? cursor.lastWorkKey : null;
  let afterKey = startedAfter;
  let lastWorkKey = afterKey;
  let wrapped = false;
  let scanned = 0;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  while (
    scanned < npShopPackingStatusLimits.pollMaximumScanSize &&
    candidates.length < npShopPackingStatusLimits.pollBatchSize
  ) {
    const pageLimit = Math.min(
      npShopPackingStatusLimits.pollScanSize,
      npShopPackingStatusLimits.pollMaximumScanSize - scanned,
    );
    const rows = await readCandidatePage(siteId, providerId, afterKey, pageLimit);
    if (rows.length === 0) {
      if (wrapped || afterKey === null) {
        lastWorkKey = null;
        break;
      }
      afterKey = null;
      wrapped = true;
      continue;
    }
    const unseen = rows.filter((row) => !seen.has(row.key));
    unseen.forEach((row) => seen.add(row.key));
    scanned += unseen.length;
    const pageLastWorkKey = rows.at(-1)?.key ?? lastWorkKey;
    afterKey = pageLastWorkKey;
    const due = await dueCandidates(siteId, unseen, now);
    const selected = due.slice(0, npShopPackingStatusLimits.pollBatchSize - candidates.length);
    candidates.push(...selected);
    if (candidates.length === npShopPackingStatusLimits.pollBatchSize) {
      lastWorkKey = selected.at(-1)?.key ?? pageLastWorkKey;
      break;
    }
    lastWorkKey = pageLastWorkKey;
    if (rows.length < pageLimit && !wrapped) {
      if (startedAfter === null) {
        lastWorkKey = null;
        break;
      }
      afterKey = null;
      wrapped = true;
    } else if (unseen.length === 0) {
      break;
    }
  }
  await writeCursor(siteId, providerId, lastWorkKey, now);
  return { candidates, scanned };
}

async function claim(
  siteId: string,
  adapter: NpShopPackingWorkPollAdapter,
  candidate: Candidate,
  options: { readonly force: boolean; readonly staffUserId?: string; readonly workId?: string },
): Promise<Claim | null> {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const work = await npReadStoredShopPackingWork(
      tx,
      siteId,
      candidate.work.target,
      candidate.work.orderId,
      true,
    );
    if (
      !work ||
      !pollable(work) ||
      work.providerId !== adapter.id ||
      (options.workId !== undefined && work.workId !== options.workId)
    ) {
      return null;
    }
    const stateRow = await readExactRow(
      tx,
      siteId,
      npShopPackingStatusStorageKey(work.target, work.orderId),
      true,
    );
    const state = stateRow ? requireStateRow(stateRow) : null;
    if (state && (!stateMatchesWork(state, work) || state.status === "packed")) return null;
    const pollKey = npShopPackingStatusPollStorageKey(work.target, work.orderId);
    const pollRow = await readExactRow(tx, siteId, pollKey, true);
    const existing = pollRow ? requirePollRow(pollRow) : null;
    if (existing && !pollMatchesWork(existing, work)) return null;
    if (existing?.leaseExpiresAt && new Date(existing.leaseExpiresAt) > now) return null;
    if (!options.force && existing && new Date(existing.nextAttemptAt) > now) return null;
    const leaseId = randomUUID();
    const requestedAt = now.toISOString();
    const leaseExpiresAt = new Date(
      now.getTime() + npShopPackingStatusLimits.pollLeaseSeconds * 1_000,
    ).toISOString();
    const pollBase = {
      contract: NP_SHOP_PACKING_STATUS_POLL_STORAGE_CONTRACT,
      workId: work.workId,
      orderId: work.orderId,
      providerId: work.providerId,
      providerWorkReference: work.providerWorkReference!,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      lastAttemptAt: requestedAt,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      nextAttemptAt: leaseExpiresAt,
      lastErrorCode: existing?.lastErrorCode ?? null,
      leaseId,
      leaseExpiresAt,
      updatedAt: requestedAt,
      purgeAt: work.purgeAt,
    };
    const poll: NpShopStoredPackingStatusPoll =
      work.target === "outbound"
        ? { ...pollBase, target: "outbound", exchangeId: null }
        : { ...pollBase, target: "replacement", exchangeId: work.exchangeId };
    await persistPoll(tx, siteId, poll);
    if (options.staffUserId) {
      await tx.insert(npAuditEvents).values({
        actorKind: "staff",
        actorUserId: options.staffUserId,
        actorMemberId: null,
        action: "shop.packing.status.poll",
        targetType: "shop-packing-work",
        targetId: work.workId,
        payload: { orderId: work.orderId, target: work.target, providerId: work.providerId },
        siteId,
      });
    }
    return {
      work,
      leaseId,
      request: npRequireShopPackingStatusPollRequest({
        contract: NP_SHOP_PACKING_STATUS_POLL_REQUEST_CONTRACT,
        workId: work.workId,
        orderId: work.orderId,
        target: work.target,
        exchangeId: work.exchangeId,
        providerWorkReference: work.providerWorkReference,
        current: state
          ? { eventId: state.latestEventId, status: state.status, occurredAt: state.occurredAt }
          : null,
        requestedAt,
      }),
    };
  });
}

async function finish(
  siteId: string,
  claimValue: Claim,
  result:
    | { readonly ok: true; readonly packed: boolean }
    | { readonly ok: false; readonly errorCode: NpShopPackingStatusPollErrorCode },
  finishedAt: Date,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const key = npShopPackingStatusPollStorageKey(claimValue.work.target, claimValue.work.orderId);
    const row = await readExactRow(tx, siteId, key, true);
    if (!row) return;
    const current = requirePollRow(row);
    if (current.leaseId !== claimValue.leaseId) return;
    if (result.ok) {
      await persistPoll(tx, siteId, {
        ...current,
        consecutiveFailures: 0,
        lastSuccessAt: finishedAt.toISOString(),
        nextAttemptAt: result.packed
          ? finishedAt.toISOString()
          : new Date(
              finishedAt.getTime() + npShopPackingStatusLimits.pollIntervalSeconds * 1_000,
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
      npShopPackingStatusLimits.pollMaximumConsecutiveFailures,
    );
    await persistPoll(tx, siteId, {
      ...current,
      consecutiveFailures,
      nextAttemptAt: new Date(
        finishedAt.getTime() + npShopPackingStatusPollBackoffSeconds(consecutiveFailures) * 1_000,
      ).toISOString(),
      lastErrorCode: result.errorCode,
      leaseId: null,
      leaseExpiresAt: null,
      updatedAt: finishedAt.toISOString(),
    });
  });
}

async function run(
  siteId: string,
  adapter: NpShopPackingWorkPollAdapter,
  candidate: Candidate,
  options: { readonly force: boolean; readonly staffUserId?: string; readonly workId?: string },
): Promise<"advanced" | "unchanged" | "failed" | "skipped"> {
  const claimed = await claim(siteId, adapter, candidate, options);
  if (!claimed) return "skipped";
  let raw: unknown;
  try {
    raw = await adapter.readPackingStatus(claimed.request);
  } catch {
    await finish(siteId, claimed, { ok: false, errorCode: "provider-error" }, new Date());
    return "failed";
  }
  const receivedAt = new Date();
  let result;
  try {
    result = npRequireShopPackingStatusPollResult(raw, {
      request: claimed.request,
      receivedAt,
    });
  } catch {
    await finish(siteId, claimed, { ok: false, errorCode: "invalid-result" }, receivedAt);
    return "failed";
  }
  if (!result.event) {
    await finish(siteId, claimed, { ok: true, packed: false }, receivedAt);
    return "unchanged";
  }
  try {
    const applied = await npApplyShopPackingStatusEvent(adapter.id, result.event, receivedAt);
    await finish(
      siteId,
      claimed,
      { ok: true, packed: applied.state.status === "packed" },
      receivedAt,
    );
    return !applied.duplicate && applied.receipt.outcome === "advanced" ? "advanced" : "unchanged";
  } catch {
    await finish(siteId, claimed, { ok: false, errorCode: "state-conflict" }, receivedAt);
    return "failed";
  }
}

export async function npReconcileShopPackingStatus(
  adapter: NpShopPackingWorkPollAdapter,
  options: {
    readonly orderId?: string;
    readonly target?: "outbound" | "replacement";
    readonly exchangeId?: string | null;
    readonly workId?: string;
    readonly force?: boolean;
    readonly staffUserId?: string;
  } = {},
): Promise<NpShopPackingStatusReconcileResult> {
  const providerId = npRequireShopPackingStatusProviderId(adapter.id);
  if (typeof adapter.readPackingStatus !== "function") {
    throw new NpShopPackingStatusContractError("Invalid packing status poll adapter", [
      "readPackingStatus must be a function.",
    ]);
  }
  const siteId = await requireSiteId();
  let candidates: Candidate[];
  let scanned: number;
  if (options.orderId && options.target) {
    const work = await npReadStoredShopPackingWork(
      getDb(),
      siteId,
      options.target,
      options.orderId,
    );
    if (
      !work ||
      !pollable(work) ||
      work.providerId !== providerId ||
      work.exchangeId !== (options.exchangeId ?? null) ||
      (options.workId !== undefined && work.workId !== options.workId)
    ) {
      throw new NpShopPackingStatusConflictError(
        "packing_status_work_not_found",
        "The packing status poll must identify one exact durable work.",
      );
    }
    candidates = [{ key: npShopPackingWorkStorageKey(work.target, work.orderId), work }];
    scanned = 1;
  } else {
    ({ candidates, scanned } = await selectCandidates(siteId, providerId, new Date()));
  }
  const summary = {
    scanned,
    claimed: 0,
    succeeded: 0,
    advanced: 0,
    unchanged: 0,
    failed: 0,
    skipped: 0,
  };
  for (const candidate of candidates) {
    const outcome = await run(siteId, adapter, candidate, {
      force: options.force ?? false,
      staffUserId: options.staffUserId,
      workId: options.workId,
    });
    if (outcome === "skipped") summary.skipped += 1;
    else if (outcome === "failed") {
      summary.claimed += 1;
      summary.failed += 1;
    } else {
      summary.claimed += 1;
      summary.succeeded += 1;
      summary[outcome] += 1;
    }
  }
  return summary;
}

export async function npListRecentShopPackingStatusPolls(): Promise<{
  readonly rows: NpShopAdminPackingStatusPollRow[];
  readonly total: number;
}> {
  const siteId = await requireSiteId();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "packing-status-poll:%"),
  );
  const [rows, [{ total }]] = await Promise.all([
    getDb()
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(where)
      .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
      .limit(npShopPackingStatusLimits.adminListSize),
    getDb()
      .select({ total: sql<number>`count(*)::int` })
      .from(npPluginStorage)
      .where(where),
  ]);
  return {
    rows: rows.flatMap((row) => {
      try {
        const poll = requirePollRow(row);
        return [
          {
            id: poll.orderId,
            workId: poll.workId,
            target: poll.target,
            provider: poll.providerId,
            failures: poll.consecutiveFailures,
            lastAttemptAt: poll.lastAttemptAt,
            lastSuccessAt: poll.lastSuccessAt ?? "—",
            nextAttemptAt: poll.nextAttemptAt,
            error: poll.lastErrorCode ?? "—",
            leasedUntil: poll.leaseExpiresAt ?? "—",
            updatedAt: poll.updatedAt,
          },
        ];
      } catch {
        return [];
      }
    }),
    total,
  };
}

export async function npCountShopPackingStatusPolls(expectedProviderId?: string): Promise<{
  readonly total: number;
  readonly failing: number;
  readonly leased: number;
  readonly due: number;
  readonly invalidSample: number;
  readonly providerMismatchSample: number;
  readonly workMismatchSample: number;
  readonly sampleSize: number;
  readonly sampleBoundReached: boolean;
}> {
  const siteId = await requireSiteId();
  const now = new Date();
  const nowIso = now.toISOString();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "packing-status-poll:%"),
  );
  const [[counts], rows] = await Promise.all([
    getDb()
      .select({
        total: sql<number>`count(*)::int`,
        failing: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'consecutiveFailures' ~ '^[1-9][0-9]*$')::int`,
        leased: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'leaseExpiresAt' > ${nowIso})::int`,
        due: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'nextAttemptAt' <= ${nowIso})::int`,
      })
      .from(npPluginStorage)
      .where(where),
    getDb()
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(where)
      .orderBy(desc(npPluginStorage.updatedAt))
      .limit(npShopPackingStatusLimits.diagnosticSampleSize),
  ]);
  let invalidSample = 0;
  let providerMismatchSample = 0;
  let workMismatchSample = 0;
  const polls: NpShopStoredPackingStatusPoll[] = [];
  for (const row of rows) {
    try {
      polls.push(requirePollRow(row));
    } catch {
      invalidSample += 1;
    }
  }
  const workRows =
    polls.length === 0
      ? []
      : await getDb()
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
                polls.map((poll) => npShopPackingWorkStorageKey(poll.target, poll.orderId)),
              ),
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
  for (const poll of polls) {
    const work = works.get(npShopPackingWorkStorageKey(poll.target, poll.orderId));
    if (!work || !pollMatchesWork(poll, work)) workMismatchSample += 1;
    if (expectedProviderId && poll.providerId !== expectedProviderId) providerMismatchSample += 1;
  }
  return {
    ...counts,
    invalidSample,
    providerMismatchSample,
    workMismatchSample,
    sampleSize: rows.length,
    sampleBoundReached: counts.total > rows.length,
  };
}
