import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxFollows, nxMembers } from "../db/schema/community.js";
import { NxNotFoundError, NxValidationError } from "../errors.js";

import { createNotification } from "./notifications.js";

/**
 * Follow graph service. v1 supports `member` follows; `thread` and
 * `tag` lands when those subjects exist. Self-follow is rejected so
 * the recommended-follows / "people you follow" reads don't have to
 * special-case it.
 */

const SUPPORTED_TARGETS = ["member", "thread", "tag"] as const;
type FollowTarget = (typeof SUPPORTED_TARGETS)[number];

export interface NxFollowRow {
  id: string;
  followerId: string;
  targetType: string;
  targetId: string;
  createdAt: Date;
}

export interface NxFollowInput {
  followerId: string;
  targetType: FollowTarget;
  targetId: string;
}

function assertSupportedTarget(targetType: string): asserts targetType is FollowTarget {
  if (!SUPPORTED_TARGETS.includes(targetType as FollowTarget)) {
    throw new NxValidationError("Invalid input", [
      {
        field: "targetType",
        message: `targetType must be one of: ${SUPPORTED_TARGETS.join(", ")}`,
      },
    ]);
  }
}

export async function follow(input: NxFollowInput): Promise<NxFollowRow> {
  assertSupportedTarget(input.targetType);
  if (input.targetType === "member" && input.targetId === input.followerId) {
    throw new NxValidationError("Invalid input", [
      { field: "targetId", message: "Members can't follow themselves." },
    ]);
  }

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;

  // Validate the target exists so a typo doesn't quietly insert a
  // dangling follow row. Only `member` has a checkable target in 9.3
  // (thread / tag come later).
  if (input.targetType === "member") {
    const [target] = (await db
      .select({ id: nxMembers.id, status: nxMembers.status })
      .from(nxMembers)
      .where(eq(nxMembers.id, input.targetId))
      .limit(1)) as Array<{ id: string; status: string }>;
    if (!target) throw new NxNotFoundError("member", input.targetId);
    if (target.status !== "active") {
      throw new NxValidationError("Invalid input", [
        { field: "targetId", message: "Cannot follow a non-active member." },
      ]);
    }
  }

  // Idempotent: if the follow already exists, return it.
  const [existing] = (await db
    .select()
    .from(nxFollows)
    .where(
      and(
        eq(nxFollows.followerId, input.followerId),
        eq(nxFollows.targetType, input.targetType),
        eq(nxFollows.targetId, input.targetId),
      ),
    )
    .limit(1)) as NxFollowRow[];
  if (existing) return existing;

  const [row] = (await db
    .insert(nxFollows)
    .values({
      followerId: input.followerId,
      targetType: input.targetType,
      targetId: input.targetId,
    })
    .returning()) as NxFollowRow[];
  if (!row) throw new Error("Follow insert returned no row");

  // Notify the followed member.
  if (input.targetType === "member") {
    await createNotification({
      memberId: input.targetId,
      kind: "follow.received",
      payload: { followerId: input.followerId },
    });
  }

  return row;
}

export async function unfollow(input: NxFollowInput): Promise<void> {
  assertSupportedTarget(input.targetType);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  await db
    .delete(nxFollows)
    .where(
      and(
        eq(nxFollows.followerId, input.followerId),
        eq(nxFollows.targetType, input.targetType),
        eq(nxFollows.targetId, input.targetId),
      ),
    );
}

export async function isFollowing(input: NxFollowInput): Promise<boolean> {
  assertSupportedTarget(input.targetType);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select({ id: nxFollows.id })
    .from(nxFollows)
    .where(
      and(
        eq(nxFollows.followerId, input.followerId),
        eq(nxFollows.targetType, input.targetType),
        eq(nxFollows.targetId, input.targetId),
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
): Promise<NxFollowRow[]> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.targetType
    ? and(eq(nxFollows.followerId, followerId), eq(nxFollows.targetType, options.targetType))
    : eq(nxFollows.followerId, followerId);
  const rows = (await db
    .select()
    .from(nxFollows)
    .where(where)
    .limit(limit)
    .offset(offset)) as NxFollowRow[];
  return rows;
}
