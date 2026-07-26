import { and, desc, eq, gt, inArray, lt, sql, type SQL } from "drizzle-orm";

import {
  npRequireCommunityId,
  npRequireCommunityRealtimeEventRow,
  npRequireEngagementTarget,
  npToCommunityRealtimeEventWire,
} from "../community-contract/contract.js";
import type {
  NpCommunityRealtimeChannel,
  NpCommunityRealtimeEventWire,
} from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npCommunityRealtimeEvents } from "../db/schema/community.js";
import { requireSiteId } from "../sites/context.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";

import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";

export const NP_COMMUNITY_REALTIME_RETENTION_MS = 6 * 60 * 60 * 1_000;
export const NP_COMMUNITY_REALTIME_PRUNE_BATCH_SIZE = 1_000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1_000;
export const NP_COMMUNITY_REALTIME_BATCH_SIZE = 100;

let nextCleanupAt = 0;
const DOCUMENT_CHANNELS = new Set<string>(["comments", "reactions"]);

export type NpCommunityRealtimeServerSubscription =
  | {
      scope: "document";
      siteId: string;
      targetType: string;
      targetId: string;
    }
  | {
      scope: "inbox";
      siteId: string;
      memberId: string;
    };

export interface NpCommunityRealtimeCursor {
  id: string | null;
  sequence: number;
}

export interface NpCommunityRealtimeOutboxStats {
  totalRows: number;
  expiredRows: number;
  oldestCreatedAt: Date | null;
  cutoff: Date;
}

export interface NpCommunityRealtimePruneOptions {
  now?: Date;
  batchSize?: number;
}

export interface NpCommunityRealtimePruneResult {
  deletedRows: number;
  hasMore: boolean;
  cutoff: Date;
}

function requireValidDate(value: unknown, path: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${path} must be a valid Date.`);
  }
  return new Date(value);
}

function requirePersistedDate(value: unknown, path: string): Date {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new Error(`${path} must be a valid persisted timestamp.`);
  }
  const normalized = new Date(value);
  if (!Number.isFinite(normalized.getTime())) {
    throw new Error(`${path} must be a valid persisted timestamp.`);
  }
  return normalized;
}

function requireNonNegativeSafeInteger(value: unknown, path: string): number {
  const normalized =
    typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || (normalized as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  return normalized as number;
}

function requirePruneOptions(
  value: NpCommunityRealtimePruneOptions,
): Required<NpCommunityRealtimePruneOptions> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("community.realtime.prune options must be a plain object.");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("community.realtime.prune options must be a plain object.");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key !== "now" && key !== "batchSize") {
      throw new Error(`Unsupported community realtime prune option "${String(key)}".`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(`community.realtime.prune.${String(key)} must be a data property.`);
    }
  }
  const now = value.now === undefined ? new Date() : requireValidDate(value.now, "prune.now");
  const batchSize = value.batchSize ?? NP_COMMUNITY_REALTIME_PRUNE_BATCH_SIZE;
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > NP_COMMUNITY_REALTIME_PRUNE_BATCH_SIZE
  ) {
    throw new Error(
      `prune.batchSize must be an integer between 1 and ${NP_COMMUNITY_REALTIME_PRUNE_BATCH_SIZE.toString()}.`,
    );
  }
  return { now, batchSize };
}

function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - NP_COMMUNITY_REALTIME_RETENTION_MS);
}

function requireSubscription(
  value: NpCommunityRealtimeServerSubscription,
): NpCommunityRealtimeServerSubscription {
  if (!npIsCanonicalSiteId(value.siteId)) {
    throw new Error("Community realtime subscription requires a canonical site id.");
  }
  if (value.scope === "inbox") {
    return {
      scope: "inbox",
      siteId: value.siteId,
      memberId: npRequireCommunityId(value.memberId, "community.realtime.memberId"),
    };
  }
  if (value.scope !== "document") {
    throw new Error("Community realtime subscription scope must be document or inbox.");
  }
  return {
    scope: "document",
    siteId: value.siteId,
    ...npRequireEngagementTarget({
      targetType: value.targetType,
      targetId: value.targetId,
    }),
  };
}

function requireCursor(value: NpCommunityRealtimeCursor): NpCommunityRealtimeCursor {
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) {
    throw new Error("Community realtime cursor requires a non-negative safe sequence.");
  }
  return {
    id: value.id === null ? null : npRequireCommunityId(value.id, "community.realtime.cursor.id"),
    sequence: value.sequence,
  };
}

function subscriptionWhere(value: NpCommunityRealtimeServerSubscription): SQL {
  const subscription = requireSubscription(value);
  return subscription.scope === "document"
    ? and(
        eq(npCommunityRealtimeEvents.siteId, subscription.siteId),
        eq(npCommunityRealtimeEvents.targetType, subscription.targetType),
        eq(npCommunityRealtimeEvents.targetId, subscription.targetId),
      )!
    : and(
        eq(npCommunityRealtimeEvents.siteId, subscription.siteId),
        eq(npCommunityRealtimeEvents.memberId, subscription.memberId),
        eq(npCommunityRealtimeEvents.channel, "notifications"),
      )!;
}

function recordRealtimeFailure(error: unknown): void {
  npRecordCommunityRuntimeDiagnostic(
    "realtime",
    error instanceof Error ? error.message : String(error),
  );
}

async function cleanExpiredEvents(now: Date): Promise<void> {
  if (now.getTime() < nextCleanupAt) return;
  nextCleanupAt = now.getTime() + CLEANUP_INTERVAL_MS;
  try {
    await npPruneCommunityRealtimeEvents({ now });
  } catch (error) {
    recordRealtimeFailure(error);
  }
}

/** Read the exact retention backlog used by live health and operator diagnostics. */
export async function npGetCommunityRealtimeOutboxStats(
  now: Date = new Date(),
): Promise<NpCommunityRealtimeOutboxStats> {
  const checkedNow = requireValidDate(now, "community.realtime.stats.now");
  const cutoff = retentionCutoff(checkedNow);
  const [row] = (await getDb()
    .select({
      totalRows: sql<string>`count(*)::text`,
      expiredRows: sql<string>`count(*) filter (
        where ${npCommunityRealtimeEvents.createdAt} < ${cutoff}
      )::text`,
      oldestCreatedAt: sql<Date | null>`min(${npCommunityRealtimeEvents.createdAt})`,
    })
    .from(npCommunityRealtimeEvents)) as Array<{
    totalRows: unknown;
    expiredRows: unknown;
    oldestCreatedAt: unknown;
  }>;
  if (!row) throw new Error("Community realtime outbox statistics returned no row.");
  const totalRows = requireNonNegativeSafeInteger(
    row.totalRows,
    "community.realtime.stats.totalRows",
  );
  const expiredRows = requireNonNegativeSafeInteger(
    row.expiredRows,
    "community.realtime.stats.expiredRows",
  );
  if (expiredRows > totalRows) {
    throw new Error("community.realtime.stats.expiredRows cannot exceed totalRows.");
  }
  const oldestCreatedAt =
    row.oldestCreatedAt === null
      ? null
      : requirePersistedDate(row.oldestCreatedAt, "community.realtime.stats.oldestCreatedAt");
  if ((totalRows === 0) !== (oldestCreatedAt === null)) {
    throw new Error(
      "community.realtime.stats.oldestCreatedAt must be null exactly when the outbox is empty.",
    );
  }
  return { totalRows, expiredRows, oldestCreatedAt, cutoff };
}

/**
 * Delete one fixed-size oldest-first retention batch. Concurrent callers may
 * race on the same candidates, but every delete remains idempotent and no
 * invocation can remove more than the validated batch bound.
 */
export async function npPruneCommunityRealtimeEvents(
  options: NpCommunityRealtimePruneOptions = {},
): Promise<NpCommunityRealtimePruneResult> {
  const { now, batchSize } = requirePruneOptions(options);
  const cutoff = retentionCutoff(now);
  const candidates = (await getDb()
    .select({ id: npCommunityRealtimeEvents.id })
    .from(npCommunityRealtimeEvents)
    .where(lt(npCommunityRealtimeEvents.createdAt, cutoff))
    .orderBy(npCommunityRealtimeEvents.createdAt, npCommunityRealtimeEvents.sequence)
    .limit(batchSize + 1)) as Array<{ id: unknown }>;
  const ids = candidates
    .slice(0, batchSize)
    .map((row) => npRequireCommunityId(row.id, "community.realtime.prune.candidate.id"));
  if (ids.length === 0) return { deletedRows: 0, hasMore: false, cutoff };

  const deleted = (await getDb()
    .delete(npCommunityRealtimeEvents)
    .where(inArray(npCommunityRealtimeEvents.id, ids))
    .returning({ id: npCommunityRealtimeEvents.id })) as Array<{ id: unknown }>;
  deleted.forEach((row) => npRequireCommunityId(row.id, "community.realtime.prune.deleted.id"));
  return {
    deletedRows: deleted.length,
    hasMore: candidates.length > batchSize,
    cutoff,
  };
}

async function insertEvent(input: {
  channel: NpCommunityRealtimeChannel;
  targetType: string | null;
  targetId: string | null;
  memberId: string | null;
  siteId: string;
}): Promise<void> {
  if (!npIsCanonicalSiteId(input.siteId)) {
    throw new Error("Community realtime event requires a canonical site id.");
  }
  if (input.channel === "notifications") {
    if (input.targetType !== null || input.targetId !== null || input.memberId === null) {
      throw new Error("Community realtime inbox events require only a member id.");
    }
    npRequireCommunityId(input.memberId, "community.realtime.memberId");
  } else {
    if (!DOCUMENT_CHANNELS.has(input.channel)) {
      throw new Error("Community realtime document event channel is unsupported.");
    }
    if (input.targetType === null || input.targetId === null || input.memberId !== null) {
      throw new Error("Community realtime document events require only a document target.");
    }
    npRequireEngagementTarget({
      targetType: input.targetType,
      targetId: input.targetId,
    });
  }
  const [row] = await getDb().insert(npCommunityRealtimeEvents).values(input).returning();
  if (!row) throw new Error("Community realtime event insert returned no row.");
  const checked = npRequireCommunityRealtimeEventRow(row);
  await cleanExpiredEvents(checked.createdAt);
}

/**
 * Best-effort document invalidation. Durable community writes remain
 * successful when the outbox is unavailable; clients then converge through
 * the hook's bounded polling fallback and operators see a runtime diagnostic.
 */
export async function npEmitCommunityDocumentChanged(
  channel: Exclude<NpCommunityRealtimeChannel, "notifications">,
  targetType: string,
  targetId: string,
): Promise<void> {
  try {
    const target = npRequireEngagementTarget({ targetType, targetId });
    await insertEvent({
      channel,
      ...target,
      memberId: null,
      siteId: await requireSiteId(),
    });
  } catch (error) {
    recordRealtimeFailure(error);
  }
}

/** Best-effort private inbox invalidation for one member on the current site. */
export async function npEmitCommunityInboxChanged(memberId: string): Promise<void> {
  try {
    await insertEvent({
      channel: "notifications",
      targetType: null,
      targetId: null,
      memberId: npRequireCommunityId(memberId, "community.realtime.memberId"),
      siteId: await requireSiteId(),
    });
  } catch (error) {
    recordRealtimeFailure(error);
  }
}

/**
 * Resolve an EventSource resume id inside the already-authorized scope. An
 * absent, malformed, expired, or foreign id starts at the current authorized
 * scope watermark; the browser performs one state refresh when the stream
 * opens, so this never loses observable state or exposes whether another
 * scope's id exists.
 */
export async function npResolveCommunityRealtimeCursor(
  subscription: NpCommunityRealtimeServerSubscription,
  lastEventId: string | null,
): Promise<NpCommunityRealtimeCursor> {
  const checkedSubscription = requireSubscription(subscription);
  const current = async (): Promise<NpCommunityRealtimeCursor> => {
    const [latest] = await getDb()
      .select({
        sequence: npCommunityRealtimeEvents.sequence,
      })
      .from(npCommunityRealtimeEvents)
      .where(subscriptionWhere(checkedSubscription))
      .orderBy(desc(npCommunityRealtimeEvents.sequence))
      .limit(1);
    return { id: null, sequence: latest?.sequence ?? 0 };
  };
  if (
    !lastEventId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(lastEventId)
  ) {
    return current();
  }
  const [row] = await getDb()
    .select()
    .from(npCommunityRealtimeEvents)
    .where(
      and(subscriptionWhere(checkedSubscription), eq(npCommunityRealtimeEvents.id, lastEventId)),
    )
    .limit(1);
  if (!row) return current();
  const event = npRequireCommunityRealtimeEventRow(row);
  return { id: event.id, sequence: event.sequence };
}

export async function npListCommunityRealtimeEvents(
  subscription: NpCommunityRealtimeServerSubscription,
  cursor: NpCommunityRealtimeCursor,
): Promise<{
  events: NpCommunityRealtimeEventWire[];
  cursor: NpCommunityRealtimeCursor;
}> {
  try {
    const checkedSubscription = requireSubscription(subscription);
    const checkedCursor = requireCursor(cursor);
    const rows = await getDb()
      .select()
      .from(npCommunityRealtimeEvents)
      .where(
        and(
          subscriptionWhere(checkedSubscription),
          gt(npCommunityRealtimeEvents.sequence, checkedCursor.sequence),
        ),
      )
      .orderBy(npCommunityRealtimeEvents.sequence)
      .limit(NP_COMMUNITY_REALTIME_BATCH_SIZE);
    const checked = rows.map(npRequireCommunityRealtimeEventRow);
    const last = checked.at(-1);
    return {
      events: checked.map(npToCommunityRealtimeEventWire),
      cursor: last ? { id: last.id, sequence: last.sequence } : checkedCursor,
    };
  } catch (error) {
    recordRealtimeFailure(error);
    throw error;
  }
}
