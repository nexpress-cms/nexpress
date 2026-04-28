import { and, count, desc, eq, isNull, sql, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxNotifications } from "../db/schema/community.js";
import { NxForbiddenError, NxValidationError } from "../errors.js";

/**
 * Per-member notification inbox. v1 is synchronous: every event that
 * generates a notification writes a row immediately. The inbox is
 * in-app only — email fan-out and per-member frequency preferences
 * are out of scope for the shipped roadmap.
 *
 * `kind` is a free-form string. The current vocabulary:
 *  - `comment.reply`        — your comment got a reply
 *  - `reaction.received`    — someone reacted to your content
 *  - `follow.received`      — someone followed you
 * Plugins can write their own kinds; the recipient UI fans them out
 * to whichever rendering it knows.
 */

export interface NxNotificationRow {
  id: string;
  memberId: string;
  kind: string;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  /** The recipient — whose inbox this lands in. */
  memberId: string;
  kind: string;
  payload?: Record<string, unknown>;
  /**
   * Phase 16.1 — the member whose action triggered the
   * notification (e.g. the comment author, the reactor, the
   * follower). When set, the recipient's mute list is
   * consulted: if the recipient has muted the actor, the
   * notification is silently dropped. Returns `null` from
   * the call site.
   *
   * Optional because some kinds are actor-less (system
   * notices, scheduled reminders).
   */
  actorMemberId?: string | null;
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<NxNotificationRow | null> {
  // Mute check — defer the import to avoid a notifications →
  // mutes circular at module load. Mutes module imports
  // nothing back from here, but TypeScript sometimes flags
  // the cycle anyway depending on resolver order.
  if (input.actorMemberId && input.actorMemberId !== input.memberId) {
    const { isMuted } = await import("./mutes.js");
    const muted = await isMuted({
      memberId: input.memberId,
      targetId: input.actorMemberId,
    });
    if (muted) return null;
  }

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .insert(nxNotifications)
    .values({
      memberId: input.memberId,
      kind: input.kind,
      payload: input.payload ?? {},
    })
    .returning()) as NxNotificationRow[];
  if (!row) throw new Error("Notification insert returned no row");
  return row;
}

export interface ListNotificationsOptions {
  /** Default 50, max 200. */
  limit?: number;
  /** Default 0. */
  offset?: number;
  /** When true, returns only unread. */
  unreadOnly?: boolean;
}

export interface NxNotificationListResult {
  notifications: NxNotificationRow[];
  totalDocs: number;
  unread: number;
}

export async function listNotifications(
  memberId: string,
  options: ListNotificationsOptions = {},
): Promise<NxNotificationListResult> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const where = options.unreadOnly
    ? and(eq(nxNotifications.memberId, memberId), isNull(nxNotifications.readAt))
    : eq(nxNotifications.memberId, memberId);

  const rows = (await db
    .select()
    .from(nxNotifications)
    .where(where)
    .orderBy(desc(nxNotifications.createdAt))
    .limit(limit)
    .offset(offset)) as NxNotificationRow[];

  const [totalRow] = (await db
    .select({ total: count() })
    .from(nxNotifications)
    .where(where)) as Array<{ total: number | string }>;

  const [unreadRow] = (await db
    .select({ total: count() })
    .from(nxNotifications)
    .where(and(eq(nxNotifications.memberId, memberId), isNull(nxNotifications.readAt)))) as Array<{
    total: number | string;
  }>;

  return {
    notifications: rows,
    totalDocs: Number(totalRow?.total ?? 0),
    unread: Number(unreadRow?.total ?? 0),
  };
}

export async function unreadNotificationCount(memberId: string): Promise<number> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select({ total: count() })
    .from(nxNotifications)
    .where(and(eq(nxNotifications.memberId, memberId), isNull(nxNotifications.readAt)))) as Array<{
    total: number | string;
  }>;
  return Number(row?.total ?? 0);
}

export interface MarkReadInput {
  memberId: string;
  notificationIds: string[];
}

export async function markNotificationsRead(input: MarkReadInput): Promise<number> {
  if (input.notificationIds.length === 0) return 0;
  if (input.notificationIds.length > 200) {
    throw new NxValidationError("Invalid input", [
      { field: "notificationIds", message: "Up to 200 ids per request" },
    ]);
  }
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  // Scope the update to the member's own ids — a leaked notification
  // id can't be marked read by another member.
  const result = await db
    .update(nxNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(nxNotifications.memberId, input.memberId),
        inArray(nxNotifications.id, input.notificationIds),
        isNull(nxNotifications.readAt),
      ),
    );
  // drizzle's `update().where()` doesn't return a rowCount in our
  // adapter type. Use a follow-up SELECT-COUNT-not-null variant when
  // we need exact numbers; for the API response a "best-effort"
  // count is fine.
  void result;
  // Caller sees how many rows the predicate matched via a tiny extra
  // round-trip:
  const [confirm] = (await db
    .select({ total: count() })
    .from(nxNotifications)
    .where(
      and(
        eq(nxNotifications.memberId, input.memberId),
        inArray(nxNotifications.id, input.notificationIds),
        sql`${nxNotifications.readAt} is not null`,
      ),
    )) as Array<{ total: number | string }>;
  return Number(confirm?.total ?? 0);
}

export async function markAllNotificationsRead(memberId: string): Promise<number> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const before = await unreadNotificationCount(memberId);
  await db
    .update(nxNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(nxNotifications.memberId, memberId), isNull(nxNotifications.readAt)));
  return before;
}

/**
 * Internal sanity check used by the API: throws when one principal
 * tries to read another member's notification. Centralised here
 * because every per-id route gets the same rule.
 */
export async function assertOwnsNotification(
  memberId: string,
  notificationId: string,
): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select({ memberId: nxNotifications.memberId })
    .from(nxNotifications)
    .where(eq(nxNotifications.id, notificationId))
    .limit(1)) as Array<{ memberId: string }>;
  if (!row || row.memberId !== memberId) {
    throw new NxForbiddenError("notification", "read");
  }
}
