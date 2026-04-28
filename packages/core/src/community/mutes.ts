import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxMemberMutes, nxMembers } from "../db/schema/community.js";
import { NxNotFoundError, NxValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";

/**
 * Phase 16.1 — member-to-member mute. One-directional: A
 * muting B hides B from A's surfaces (comments, notification
 * fan-out). B keeps posting normally.
 *
 * Distinct from `nx_bans` (staff-issued, global write block).
 * Mutes are always self-service: a member calls these helpers
 * for their own mute list, never for someone else's.
 */

export interface NxMemberMuteRow {
  memberId: string;
  targetId: string;
  createdAt: Date;
}

export interface MuteMemberInput {
  /** The muter — the current member taking the action. */
  memberId: string;
  /** The muted — whose content should disappear. */
  targetId: string;
}

export async function muteMember(input: MuteMemberInput): Promise<void> {
  if (input.memberId === input.targetId) {
    throw new NxValidationError("Invalid input", [
      { field: "targetId", message: "Cannot mute yourself." },
    ]);
  }
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;

  // Confirm both rows exist — otherwise the FK violation
  // surfaces as an opaque 500. NotFound is the right shape:
  // a deleted member shouldn't be muteable.
  const [muter] = (await db
    .select({ id: nxMembers.id })
    .from(nxMembers)
    .where(eq(nxMembers.id, input.memberId))
    .limit(1)) as Array<{ id: string }>;
  if (!muter) throw new NxNotFoundError("member", input.memberId);
  const [target] = (await db
    .select({ id: nxMembers.id, status: nxMembers.status })
    .from(nxMembers)
    .where(eq(nxMembers.id, input.targetId))
    .limit(1)) as Array<{ id: string; status: string }>;
  if (!target) throw new NxNotFoundError("member", input.targetId);

  // Phase 18 — site_id is part of the PK so the same muter can
  // hold a separate "muted-on-site-A" / "muted-on-site-B" set.
  // Idempotent: muting twice on the same site doesn't error.
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  await db
    .insert(nxMemberMutes)
    .values({
      memberId: input.memberId,
      targetId: input.targetId,
      siteId,
    })
    .onConflictDoNothing();
}

export async function unmuteMember(input: MuteMemberInput): Promise<boolean> {
  if (input.memberId === input.targetId) {
    throw new NxValidationError("Invalid input", [
      { field: "targetId", message: "Cannot unmute yourself." },
    ]);
  }
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const result = (await db
    .delete(nxMemberMutes)
    .where(
      and(
        eq(nxMemberMutes.memberId, input.memberId),
        eq(nxMemberMutes.targetId, input.targetId),
        eq(nxMemberMutes.siteId, siteId),
      ),
    )
    .returning({ memberId: nxMemberMutes.memberId })) as Array<{
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const [row] = (await db
    .select({ memberId: nxMemberMutes.memberId })
    .from(nxMemberMutes)
    .where(
      and(
        eq(nxMemberMutes.memberId, input.memberId),
        eq(nxMemberMutes.targetId, input.targetId),
        eq(nxMemberMutes.siteId, siteId),
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const rows = (await db
    .select({ targetId: nxMemberMutes.targetId })
    .from(nxMemberMutes)
    .where(and(eq(nxMemberMutes.memberId, memberId), eq(nxMemberMutes.siteId, siteId)))) as Array<{
    targetId: string;
  }>;
  return new Set(rows.map((r) => r.targetId));
}

export interface NxMemberMuteSummary {
  targetId: string;
  handle: string;
  displayName: string;
  createdAt: string;
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
): Promise<NxMemberMuteSummary[]> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  // Phase 18 — settings list is per-site. The same muter can
  // see different lists on different tenants.
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const rows = (await db
    .select({
      targetId: nxMemberMutes.targetId,
      handle: nxMembers.handle,
      displayName: nxMembers.displayName,
      createdAt: nxMemberMutes.createdAt,
    })
    .from(nxMemberMutes)
    .innerJoin(nxMembers, eq(nxMemberMutes.targetId, nxMembers.id))
    .where(and(eq(nxMemberMutes.memberId, memberId), eq(nxMemberMutes.siteId, siteId)))
    .orderBy(desc(nxMemberMutes.createdAt))
    .limit(limit)) as Array<{
    targetId: string;
    handle: string;
    displayName: string;
    createdAt: Date;
  }>;
  return rows.map((r) => ({
    targetId: r.targetId,
    handle: r.handle,
    displayName: r.displayName,
    createdAt: r.createdAt.toISOString(),
  }));
}
