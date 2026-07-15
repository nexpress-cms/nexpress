import { and, desc, eq } from "drizzle-orm";

import { npRequireMuteSummary } from "../community-contract/contract.js";
import type { NpMemberMuteRow, NpMemberMuteSummary } from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npMemberMutes, npMembers } from "../db/schema/community.js";
import { NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

/**
 * Phase 16.1 — member-to-member mute. One-directional: A
 * muting B hides B from A's surfaces (comments, notification
 * fan-out). B keeps posting normally.
 *
 * Distinct from `np_bans` (staff-issued, global write block).
 * Mutes are always self-service: a member calls these helpers
 * for their own mute list, never for someone else's.
 */

export type { NpMemberMuteRow, NpMemberMuteSummary };

export interface MuteMemberInput {
  /** The muter — the current member taking the action. */
  memberId: string;
  /** The muted — whose content should disappear. */
  targetId: string;
}

export async function muteMember(input: MuteMemberInput): Promise<void> {
  if (input.memberId === input.targetId) {
    throw new NpValidationError("Invalid input", [
      { field: "targetId", message: "Cannot mute yourself." },
    ]);
  }
  const db = getDb();

  // Confirm both rows exist — otherwise the FK violation
  // surfaces as an opaque 500. NotFound is the right shape:
  // a deleted member shouldn't be muteable.
  const [muter] = (await db
    .select({ id: npMembers.id })
    .from(npMembers)
    .where(eq(npMembers.id, input.memberId))
    .limit(1)) as Array<{ id: string }>;
  if (!muter) throw new NpNotFoundError("member", input.memberId);
  const [target] = (await db
    .select({ id: npMembers.id, status: npMembers.status })
    .from(npMembers)
    .where(eq(npMembers.id, input.targetId))
    .limit(1)) as Array<{ id: string; status: string }>;
  if (!target) throw new NpNotFoundError("member", input.targetId);

  // Phase 18 — site_id is part of the PK so the same muter can
  // hold a separate "muted-on-site-A" / "muted-on-site-B" set.
  // Idempotent: muting twice on the same site doesn't error.
  // #272 — write: must NOT silently fall through to default site.
  const siteId = await requireSiteId();
  await db
    .insert(npMemberMutes)
    .values({
      memberId: input.memberId,
      targetId: input.targetId,
      siteId,
    })
    .onConflictDoNothing();
}

export async function unmuteMember(input: MuteMemberInput): Promise<boolean> {
  if (input.memberId === input.targetId) {
    throw new NpValidationError("Invalid input", [
      { field: "targetId", message: "Cannot unmute yourself." },
    ]);
  }
  const db = getDb();
  // #272 — write: must NOT silently fall through to default site.
  const siteId = await requireSiteId();
  const result = (await db
    .delete(npMemberMutes)
    .where(
      and(
        eq(npMemberMutes.memberId, input.memberId),
        eq(npMemberMutes.targetId, input.targetId),
        eq(npMemberMutes.siteId, siteId),
      ),
    )
    .returning({ memberId: npMemberMutes.memberId })) as Array<{
    memberId: string;
  }>;
  return result.length > 0;
}

/**
 * `true` when `memberId` has muted `targetId` on the current
 * site. Used by comment listing + notification fan-out to
 * filter views and skip alerts.
 */
export async function isMuted(input: MuteMemberInput): Promise<boolean> {
  if (input.memberId === input.targetId) return false;
  const db = getDb();
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const [row] = (await db
    .select({ memberId: npMemberMutes.memberId })
    .from(npMemberMutes)
    .where(
      and(
        eq(npMemberMutes.memberId, input.memberId),
        eq(npMemberMutes.targetId, input.targetId),
        eq(npMemberMutes.siteId, siteId),
      ),
    )
    .limit(1)) as Array<{ memberId: string }>;
  return !!row;
}

/**
 * Returns the set of `targetId`s the given member has muted on
 * the current site. Used to filter listComments output in one
 * DB round-trip rather than `isMuted()` per row.
 */
export async function getMutedTargetIds(memberId: string): Promise<Set<string>> {
  const db = getDb();
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const rows = (await db
    .select({ targetId: npMemberMutes.targetId })
    .from(npMemberMutes)
    .where(and(eq(npMemberMutes.memberId, memberId), eq(npMemberMutes.siteId, siteId)))) as Array<{
    targetId: string;
  }>;
  return new Set(rows.map((r) => r.targetId));
}

export interface ListMutesOptions {
  /** Default 50, max 200. */
  limit?: number;
}

/**
 * Surfaces the muter's list with the muted member's display
 * info joined in, so the settings UI doesn't have to round-
 * trip through `/api/members/[handle]` for every row.
 */
export async function listMutes(
  memberId: string,
  options: ListMutesOptions = {},
): Promise<NpMemberMuteSummary[]> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  // Phase 18 — settings list is per-site. The same muter can
  // see different lists on different tenants.
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const rows = (await db
    .select({
      targetId: npMemberMutes.targetId,
      handle: npMembers.handle,
      displayName: npMembers.displayName,
      createdAt: npMemberMutes.createdAt,
    })
    .from(npMemberMutes)
    .innerJoin(npMembers, eq(npMemberMutes.targetId, npMembers.id))
    .where(and(eq(npMemberMutes.memberId, memberId), eq(npMemberMutes.siteId, siteId)))
    .orderBy(desc(npMemberMutes.createdAt))
    .limit(limit)) as Array<{
    targetId: string;
    handle: string;
    displayName: string;
    createdAt: Date;
  }>;
  return rows.map((r) =>
    npRequireMuteSummary({
      targetId: r.targetId,
      handle: r.handle,
      displayName: r.displayName,
      createdAt: r.createdAt.toISOString(),
    }),
  );
}
