import { and, asc, eq, gt } from "drizzle-orm";

import {
  npRequireCommunityId,
  npRequireFollowActivityNotificationPayload,
  npRequireFollowRow,
  npRequireFollowTarget,
  npRequireFollowTargetType,
} from "../community-contract/contract.js";
import type {
  NpFollowActivityNotificationPayload,
  NpFollowInput,
  NpFollowRow,
  NpFollowTarget,
} from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npFollows, npMembers } from "../db/schema/community.js";
import { NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

import { withMemberWrite } from "./can.js";
import { createNotification } from "./notifications.js";
import { npResolveDocumentEngagementTarget } from "./engagement-target.js";

/**
 * Follow graph service. `member` is the sole reserved target; document
 * subscriptions use the canonical collection slug after that collection
 * explicitly opts into `community.follows`. Self-follow is rejected so the
 * recommended-follows / "people you follow" reads don't have to special-case it.
 */

type FollowTarget = NpFollowTarget;

export type { NpFollowInput, NpFollowRow };

export async function follow(input: NpFollowInput): Promise<NpFollowRow> {
  const followerId = npRequireCommunityId(input.followerId, "community.follow.followerId");
  const target = npRequireFollowTarget({ targetType: input.targetType, targetId: input.targetId });
  const checked = { followerId, ...target };
  if (checked.targetType === "member" && checked.targetId === checked.followerId) {
    throw new NpValidationError("Invalid input", [
      { field: "targetId", message: "Members can't follow themselves." },
    ]);
  }

  // #311 — withMemberWrite enforces the ban gate by structure: a
  // future write path that forgets the gate can't compile against
  // this helper. Site-wide bans block follows (no obvious scope
  // chain for a polymorphic follow target).
  return withMemberWrite(checked.followerId, [], async () => {
    return doFollow(checked);
  });
}

async function doFollow(input: NpFollowInput): Promise<NpFollowRow> {
  const db = getDb();
  let targetSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  let memberHandle: string | null = null;

  // Validate the target exists so a typo cannot insert a dangling follow.
  // Document targets additionally share the public/site/opt-in gate used by
  // reactions, views, and reports.
  if (input.targetType === "member") {
    const [target] = (await db
      .select({ id: npMembers.id, status: npMembers.status, handle: npMembers.handle })
      .from(npMembers)
      .where(eq(npMembers.id, input.targetId))
      .limit(1)) as Array<{ id: string; status: string; handle: string }>;
    if (!target) throw new NpNotFoundError("member", input.targetId);
    if (target.status !== "active") {
      throw new NpValidationError("Invalid input", [
        { field: "targetId", message: "Cannot follow a non-active member." },
      ]);
    }
    memberHandle = target.handle;
  } else {
    const target = await npResolveDocumentEngagementTarget(
      input.targetType,
      input.targetId,
      "follows",
    );
    if (!target.href) {
      throw new NpValidationError("Invalid input", [
        {
          field: "targetId",
          message: "A followed document must expose a public URL through seo.urlPath.",
        },
      ]);
    }
    targetSiteId = target.siteId;
  }

  // Idempotent: insert with `onConflictDoNothing` so two concurrent
  // follow toggles don't surface a unique-constraint 500 to the
  // race-loser. The schema's `np_follows_unique` enforces
  // `(follower, targetType, targetId)` uniqueness — without
  // `onConflict` the loser of a race would bubble the raw
  // pg 23505 instead of the intended idempotent success (#124,
  // mirrors the reactions write path).
  // Phase 18 — site_id is part of the unique key now, so a
  // global member can hold parallel follow rows on different
  // tenants. The site comes from the request resolver (the
  // click happened on this tenant); falls back to the default
  // site for callers without a resolved site (scripts, jobs).
  const siteId = targetSiteId;
  const [inserted] = (await db
    .insert(npFollows)
    .values({
      followerId: input.followerId,
      targetType: input.targetType,
      targetId: input.targetId,
      siteId,
    })
    .onConflictDoNothing()
    .returning()) as NpFollowRow[];

  if (inserted) {
    const checkedInserted = npRequireFollowRow(inserted);
    // Fresh insert — notify the followed member.
    if (input.targetType === "member") {
      await createNotification({
        memberId: input.targetId,
        kind: "follow.received",
        actorMemberId: input.followerId,
        payload: {
          followerId: input.followerId,
          ...(memberHandle ? { href: `/u/${encodeURIComponent(memberHandle)}` } : {}),
        },
      });
    }
    return checkedInserted;
  }

  // Conflict path: the row already existed (or a concurrent caller
  // just inserted it). Re-select and return without re-firing the
  // notification — the original insertion already did that.
  const [existing] = (await db
    .select()
    .from(npFollows)
    .where(
      and(
        eq(npFollows.followerId, input.followerId),
        eq(npFollows.targetType, input.targetType),
        eq(npFollows.targetId, input.targetId),
        eq(npFollows.siteId, siteId),
      ),
    )
    .limit(1)) as NpFollowRow[];
  if (!existing) {
    // Unreachable in practice — the conflict means a row exists.
    // If we genuinely don't see it, something is racing us with a
    // delete; surface a generic error rather than fabricate a row.
    throw new Error("Follow insert hit conflict but re-select returned no row");
  }
  return npRequireFollowRow(existing);
}

export async function unfollow(input: NpFollowInput): Promise<void> {
  const checked = {
    followerId: npRequireCommunityId(input.followerId, "community.follow.followerId"),
    ...npRequireFollowTarget({ targetType: input.targetType, targetId: input.targetId }),
  };
  const db = getDb();
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  await db
    .delete(npFollows)
    .where(
      and(
        eq(npFollows.followerId, checked.followerId),
        eq(npFollows.targetType, checked.targetType),
        eq(npFollows.targetId, checked.targetId),
        eq(npFollows.siteId, siteId),
      ),
    );
}

export async function isFollowing(input: NpFollowInput): Promise<boolean> {
  const checked = {
    followerId: npRequireCommunityId(input.followerId, "community.follow.followerId"),
    ...npRequireFollowTarget({ targetType: input.targetType, targetId: input.targetId }),
  };
  const db = getDb();
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const [row] = (await db
    .select({ id: npFollows.id })
    .from(npFollows)
    .where(
      and(
        eq(npFollows.followerId, checked.followerId),
        eq(npFollows.targetType, checked.targetType),
        eq(npFollows.targetId, checked.targetId),
        eq(npFollows.siteId, siteId),
      ),
    )
    .limit(1)) as Array<{ id: string }>;
  return Boolean(row);
}

/**
 * "Who am I following?" — paged. Used by the site UI to populate a
 * member's profile or settings page.
 */
export async function listFollowing(
  followerId: string,
  options: { targetType?: FollowTarget; limit?: number; offset?: number } = {},
): Promise<NpFollowRow[]> {
  const db = getDb();
  const checkedFollowerId = npRequireCommunityId(followerId, "community.follow.followerId");
  const checkedTargetType =
    options.targetType === undefined ? undefined : npRequireFollowTargetType(options.targetType);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  // Phase 18 — scope to current site. A member who follows on
  // tenant A and tenant B should see two separate "Following"
  // lists, one per site. Falls back to the default site when
  // the resolver isn't wired (scripts).
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const where = checkedTargetType
    ? and(
        eq(npFollows.followerId, checkedFollowerId),
        eq(npFollows.targetType, checkedTargetType),
        eq(npFollows.siteId, siteId),
      )
    : and(eq(npFollows.followerId, checkedFollowerId), eq(npFollows.siteId, siteId));
  const rows = (await db
    .select()
    .from(npFollows)
    .where(where)
    .limit(limit)
    .offset(offset)) as NpFollowRow[];
  return rows.map(npRequireFollowRow);
}

export interface NpNotifyFollowersInput extends NpFollowActivityNotificationPayload {
  actorMemberId?: string | null;
  excludeMemberIds?: readonly string[];
}

/**
 * Deliver one exact activity notification to every member subscribed to a
 * public document. Reads use a UUID cursor and fixed pages so a popular target
 * never becomes one unbounded result set. Recipient preferences and member
 * mutes remain centralized in `createNotification`.
 */
export async function notifyFollowers(input: NpNotifyFollowersInput): Promise<number> {
  const payload = npRequireFollowActivityNotificationPayload({
    activity: input.activity,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    targetType: input.targetType,
    targetId: input.targetId,
    href: input.href,
    commentId: input.commentId,
  });
  const actorMemberId =
    input.actorMemberId == null
      ? null
      : npRequireCommunityId(input.actorMemberId, "community.followActivity.actorMemberId");
  const excluded = new Set(
    (input.excludeMemberIds ?? []).map((id, index) =>
      npRequireCommunityId(id, `community.followActivity.excludeMemberIds.${index.toString()}`),
    ),
  );
  if (actorMemberId) excluded.add(actorMemberId);

  // This also pins the subject to the current site and refuses notifications
  // for a disabled/private/deleted subscription target.
  const subject = await npResolveDocumentEngagementTarget(
    payload.subjectType,
    payload.subjectId,
    "follows",
  );
  const db = getDb();
  let cursor: string | null = null;
  let notified = 0;
  const pageSize = 200;

  while (true) {
    const where = cursor
      ? and(
          eq(npFollows.targetType, payload.subjectType),
          eq(npFollows.targetId, payload.subjectId),
          eq(npFollows.siteId, subject.siteId),
          gt(npFollows.id, cursor),
        )
      : and(
          eq(npFollows.targetType, payload.subjectType),
          eq(npFollows.targetId, payload.subjectId),
          eq(npFollows.siteId, subject.siteId),
        );
    const rows = (await db
      .select({ id: npFollows.id, followerId: npFollows.followerId })
      .from(npFollows)
      .where(where)
      .orderBy(asc(npFollows.id))
      .limit(pageSize)) as Array<{ id: string; followerId: string }>;

    for (const row of rows) {
      cursor = row.id;
      if (excluded.has(row.followerId)) continue;
      const inserted = await createNotification({
        memberId: row.followerId,
        kind: "follow.activity",
        actorMemberId,
        payload,
      });
      if (inserted) notified += 1;
    }
    if (rows.length < pageSize) break;
  }
  return notified;
}
