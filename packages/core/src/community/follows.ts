import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { npFollows, npMembers } from "../db/schema/community.js";
import { NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";

import { withMemberWrite } from "./can.js";
import { createNotification } from "./notifications.js";

/**
 * Follow graph service. v1 supports `member` follows; `thread` and
 * `tag` lands when those subjects exist. Self-follow is rejected so
 * the recommended-follows / "people you follow" reads don't have to
 * special-case it.
 */

const SUPPORTED_TARGETS = ["member", "thread", "tag"] as const;
type FollowTarget = (typeof SUPPORTED_TARGETS)[number];

export interface NpFollowRow {
  id: string;
  followerId: string;
  targetType: string;
  targetId: string;
  createdAt: Date;
}

export interface NpFollowInput {
  followerId: string;
  targetType: FollowTarget;
  targetId: string;
}

function assertSupportedTarget(targetType: string): asserts targetType is FollowTarget {
  if (!SUPPORTED_TARGETS.includes(targetType as FollowTarget)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "targetType",
        message: `targetType must be one of: ${SUPPORTED_TARGETS.join(", ")}`,
      },
    ]);
  }
}

export async function follow(input: NpFollowInput): Promise<NpFollowRow> {
  assertSupportedTarget(input.targetType);
  if (input.targetType === "member" && input.targetId === input.followerId) {
    throw new NpValidationError("Invalid input", [
      { field: "targetId", message: "Members can't follow themselves." },
    ]);
  }

  // #311 — withMemberWrite enforces the ban gate by structure: a
  // future write path that forgets the gate can't compile against
  // this helper. Site-wide bans block follows (no obvious scope
  // chain for a polymorphic follow target).
  return withMemberWrite(input.followerId, [], async () => {
    return doFollow(input);
  });
}

async function doFollow(input: NpFollowInput): Promise<NpFollowRow> {

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;

  // Validate the target exists so a typo doesn't quietly insert a
  // dangling follow row. `thread` / `tag` targets had no validation
  // path because those subjects don't exist yet — that meant members
  // could spam the follow graph with arbitrary strings (#75). Until
  // those surfaces ship, refuse follows for them.
  if (input.targetType === "member") {
    const [target] = (await db
      .select({ id: npMembers.id, status: npMembers.status })
      .from(npMembers)
      .where(eq(npMembers.id, input.targetId))
      .limit(1)) as Array<{ id: string; status: string }>;
    if (!target) throw new NpNotFoundError("member", input.targetId);
    if (target.status !== "active") {
      throw new NpValidationError("Invalid input", [
        { field: "targetId", message: "Cannot follow a non-active member." },
      ]);
    }
  } else {
    throw new NpValidationError("Invalid input", [
      {
        field: "targetType",
        message: `Following ${input.targetType} targets is not supported yet`,
      },
    ]);
  }

  // Idempotent: insert with `onConflictDoNothing` so two concurrent
  // follow toggles don't surface a unique-constraint 500 to the
  // race-loser. The schema's `nx_follows_unique` enforces
  // `(follower, targetType, targetId)` uniqueness — without
  // `onConflict` the loser of a race would bubble the raw
  // pg 23505 instead of the intended idempotent success (#124,
  // mirrors the reactions write path).
  // Phase 18 — site_id is part of the unique key now, so a
  // global member can hold parallel follow rows on different
  // tenants. The site comes from the request resolver (the
  // click happened on this tenant); falls back to the default
  // site for callers without a resolved site (scripts, jobs).
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
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
    // Fresh insert — notify the followed member.
    if (input.targetType === "member") {
      await createNotification({
        memberId: input.targetId,
        kind: "follow.received",
        actorMemberId: input.followerId,
        payload: { followerId: input.followerId },
      });
    }
    return inserted;
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
  return existing;
}

export async function unfollow(input: NpFollowInput): Promise<void> {
  assertSupportedTarget(input.targetType);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  await db
    .delete(npFollows)
    .where(
      and(
        eq(npFollows.followerId, input.followerId),
        eq(npFollows.targetType, input.targetType),
        eq(npFollows.targetId, input.targetId),
        eq(npFollows.siteId, siteId),
      ),
    );
}

export async function isFollowing(input: NpFollowInput): Promise<boolean> {
  assertSupportedTarget(input.targetType);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const [row] = (await db
    .select({ id: npFollows.id })
    .from(npFollows)
    .where(
      and(
        eq(npFollows.followerId, input.followerId),
        eq(npFollows.targetType, input.targetType),
        eq(npFollows.targetId, input.targetId),
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  // Phase 18 — scope to current site. A member who follows on
  // tenant A and tenant B should see two separate "Following"
  // lists, one per site. Falls back to the default site when
  // the resolver isn't wired (scripts).
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const where = options.targetType
    ? and(
        eq(npFollows.followerId, followerId),
        eq(npFollows.targetType, options.targetType),
        eq(npFollows.siteId, siteId),
      )
    : and(eq(npFollows.followerId, followerId), eq(npFollows.siteId, siteId));
  const rows = (await db
    .select()
    .from(npFollows)
    .where(where)
    .limit(limit)
    .offset(offset)) as NpFollowRow[];
  return rows;
}
