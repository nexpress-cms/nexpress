import { and, count, desc, eq, isNull, inArray } from "drizzle-orm";

import {
  npRequireCommunityId,
  npRequireNotificationKind,
  npRequireNotificationPayload,
  npRequireNotificationRow,
} from "../community-contract/contract.js";
import type {
  CreateNotificationInput,
  ListNotificationsOptions,
  MarkReadInput,
  NpNotificationListResult,
  NpNotificationRow,
} from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npNotifications } from "../db/schema/community.js";
import { NpForbiddenError, NpValidationError } from "../errors.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { npEmitCommunityInboxChanged } from "./realtime.js";

/**
 * Per-member notification inbox. Every event that generates a
 * notification writes a row immediately. The member page renders the
 * in-app inbox, and the digest sweep can batch unread rows into
 * scheduled email summaries for members who opt in.
 *
 * `kind` is a free-form string. The current vocabulary:
 *  - `comment.reply`        — your comment got a reply
 *  - `comment.received`     — your document got a comment
 *  - `comment.mention`      — you were mentioned in a comment
 *  - `document.mention`     — you were mentioned in a document
 *  - `reaction.received`    — someone reacted to your content
 *  - `follow.received`      — someone followed you
 *  - `follow.activity`      — a subscribed document has new activity
 * Plugins can write their own kinds; the recipient UI fans them out
 * to whichever rendering it knows.
 */

export type {
  CreateNotificationInput,
  ListNotificationsOptions,
  MarkReadInput,
  NpNotificationListResult,
  NpNotificationRow,
};

export async function createNotification(
  input: CreateNotificationInput,
): Promise<NpNotificationRow | null> {
  const memberId = npRequireCommunityId(input.memberId, "community.notification.memberId");
  const actorMemberId =
    input.actorMemberId == null
      ? null
      : npRequireCommunityId(input.actorMemberId, "community.notification.actorMemberId");
  const kind = npRequireNotificationKind(input.kind, "community.notification.kind");
  const payload = npRequireNotificationPayload(kind, input.payload ?? {});

  // Mute check — defer the import to avoid a notifications →
  // mutes circular at module load. Mutes module imports
  // nothing back from here, but TypeScript sometimes flags
  // the cycle anyway depending on resolver order.
  if (actorMemberId && actorMemberId !== memberId) {
    const { isMuted } = await import("./mutes.js");
    const muted = await isMuted({
      memberId,
      targetId: actorMemberId,
    });
    if (muted) return null;
  }

  // Phase 16.3 — recipient-controlled kind toggle. Malformed stored
  // preferences drop this side effect and emit a diagnostic; transient
  // read failures fail open. Deferred import for the same reason as mutes.
  {
    const { isNotificationKindEnabled } = await import("./notification-prefs.js");
    const enabled = await isNotificationKindEnabled(memberId, kind);
    if (!enabled) return null;
  }

  const db = getDb();
  // Phase 18 — site comes from the request resolver. The
  // notification belongs to the tenant where the actor's
  // action happened (a reaction on tenant A → notification
  // shows up in the recipient's tenant-A inbox).
  // #272 — write: must NOT silently fall through; an actor on
  // tenant A would otherwise create a notification on the
  // default tenant.
  const siteId = await requireSiteId();
  const [row] = (await db
    .insert(npNotifications)
    .values({
      memberId,
      kind,
      payload,
      siteId,
    })
    .returning()) as NpNotificationRow[];
  if (!row) throw new Error("Notification insert returned no row");
  const checked = npRequireNotificationRow(row);
  await npEmitCommunityInboxChanged(memberId);
  return checked;
}

export async function listNotifications(
  memberId: string,
  options: ListNotificationsOptions = {},
): Promise<NpNotificationListResult> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  // Phase 18 — inbox is per-site. A member who's active on
  // multiple tenants sees a separate notification list on each.
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const baseWhere = and(eq(npNotifications.memberId, memberId), eq(npNotifications.siteId, siteId));
  const where = options.unreadOnly ? and(baseWhere, isNull(npNotifications.readAt)) : baseWhere;

  const rows = (await db
    .select()
    .from(npNotifications)
    .where(where)
    .orderBy(desc(npNotifications.createdAt))
    .limit(limit)
    .offset(offset)) as NpNotificationRow[];

  const [totalRow] = (await db
    .select({ total: count() })
    .from(npNotifications)
    .where(where)) as Array<{ total: number | string }>;

  const [unreadRow] = (await db
    .select({ total: count() })
    .from(npNotifications)
    .where(and(baseWhere, isNull(npNotifications.readAt)))) as Array<{
    total: number | string;
  }>;

  return {
    notifications: rows.map(npRequireNotificationRow),
    totalDocs: Number(totalRow?.total ?? 0),
    unread: Number(unreadRow?.total ?? 0),
  };
}

export async function unreadNotificationCount(memberId: string): Promise<number> {
  const db = getDb();
  // Phase 18 — count only notifications on the current site.
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const [row] = (await db
    .select({ total: count() })
    .from(npNotifications)
    .where(
      and(
        eq(npNotifications.memberId, memberId),
        eq(npNotifications.siteId, siteId),
        isNull(npNotifications.readAt),
      ),
    )) as Array<{ total: number | string }>;
  return Number(row?.total ?? 0);
}

export async function markNotificationsRead(input: MarkReadInput): Promise<number> {
  if (input.notificationIds.length === 0) return 0;
  if (input.notificationIds.length > 200) {
    throw new NpValidationError("Invalid input", [
      { field: "notificationIds", message: "Up to 200 ids per request" },
    ]);
  }
  const db = getDb();
  // Issue #219 — scope the update to the current site so a member
  // active on multiple tenants can't mark IDs read across tenants
  // by passing a site-A request that names site-B notification ids.
  // The caller's existing `memberId` predicate covered ownership
  // but not tenant; without this, unread counts on the other site
  // would silently drop. Using `returning({ id })` also gives us
  // an exact count instead of a follow-up SELECT — replaces the
  // pre-existing best-effort COUNT round trip.
  // #272 — write: must NOT silently fall through.
  const siteId = await requireSiteId();
  const updated = (await db
    .update(npNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(npNotifications.memberId, input.memberId),
        eq(npNotifications.siteId, siteId),
        inArray(npNotifications.id, input.notificationIds),
        isNull(npNotifications.readAt),
      ),
    )
    .returning({ id: npNotifications.id })) as Array<{ id: string }>;
  if (updated.length > 0) {
    await npEmitCommunityInboxChanged(input.memberId);
  }
  return updated.length;
}

export async function markAllNotificationsRead(memberId: string): Promise<number> {
  const db = getDb();
  // Phase 18 — "mark all read" only marks the current site's
  // inbox so a member doesn't accidentally clear another
  // tenant's unread count when toggling on this one.
  // #272 — write: must NOT silently fall through.
  const siteId = await requireSiteId();
  const before = await unreadNotificationCount(memberId);
  await db
    .update(npNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(npNotifications.memberId, memberId),
        eq(npNotifications.siteId, siteId),
        isNull(npNotifications.readAt),
      ),
    );
  if (before > 0) {
    await npEmitCommunityInboxChanged(memberId);
  }
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
  const db = getDb();
  const [row] = (await db
    .select({ memberId: npNotifications.memberId })
    .from(npNotifications)
    .where(eq(npNotifications.id, notificationId))
    .limit(1)) as Array<{ memberId: string }>;
  if (!row || row.memberId !== memberId) {
    throw new NpForbiddenError("notification", "read");
  }
}
