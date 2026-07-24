import { and, desc, eq, gt, lt, type SQL } from "drizzle-orm";

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

const RETENTION_MS = 6 * 60 * 60 * 1_000;
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
    await getDb()
      .delete(npCommunityRealtimeEvents)
      .where(lt(npCommunityRealtimeEvents.createdAt, new Date(now.getTime() - RETENTION_MS)));
  } catch (error) {
    recordRealtimeFailure(error);
  }
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
