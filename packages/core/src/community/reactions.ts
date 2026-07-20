import { and, count, eq } from "drizzle-orm";

import { npRequireEngagementTarget, npRequireReactionRow } from "../community-contract/contract.js";
import type { NpReactionRow, NpReactToInput } from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npComments, npReactions } from "../db/schema/community.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

import { withMemberWrite } from "./can.js";
import { type CommunityScope } from "./roles.js";
import { createNotification } from "./notifications.js";
import { applyReputation } from "./reputation.js";
import { getCommunitySettings } from "./settings.js";
import {
  npResolveDocumentEngagementTarget,
  type NpResolvedDocumentEngagementTarget,
} from "./engagement-target.js";

/**
 * Reactions service. `kind` is gated by both:
 *   1. `KIND_RE` — a syntactic check (lowercase token, ≤30 chars)
 *      that runs on every add/remove call without a DB round-trip.
 *   2. The site's reaction allow-list, persisted in
 *      `np_settings.community.reactionKinds` and edited from the
 *      admin community settings page. v1 ships with `["like"]` as
 *      the only allowed kind. Removal is NOT gated against the
 *      allow-list — if a site retires a reaction, members can still
 *      undo their old reactions of that kind.
 */

export const DEFAULT_REACTION_KINDS = ["like"] as const;
const KIND_RE = /^[a-z][a-z0-9_-]{0,29}$/;

export type { NpReactionRow, NpReactToInput };

interface NpResolvedReactionTarget extends NpResolvedDocumentEngagementTarget {
  scopes: ReadonlyArray<{ type: CommunityScope; id: string }>;
}

function validateKind(kind: string): void {
  if (!KIND_RE.test(kind)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "kind",
        message: "kind must match [a-z][a-z0-9_-]{0,29}",
      },
    ]);
  }
}

/**
 * Adds a reaction. Idempotent: if `(target_type, target_id, member_id,
 * kind)` already exists, returns the existing row instead of bumping
 * the unique-constraint into an error. The first time a member reacts
 * to a comment we also fire a notification to the comment author.
 */
export async function addReaction(input: NpReactToInput): Promise<NpReactionRow> {
  validateKind(input.kind);

  const settings = await getCommunitySettings();
  if (!settings.reactionKinds.includes(input.kind)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "kind",
        message: `Reaction kind '${input.kind}' is not allowed on this site`,
      },
    ]);
  }

  const target = await resolveReactionTarget(input.targetType, input.targetId);
  return withMemberWrite(input.memberId, target.scopes, async () => {
    return doAddReaction(input, target);
  });
}

async function resolveReactionTarget(
  targetType: string,
  targetId: string,
): Promise<NpResolvedReactionTarget> {
  const checked = npRequireEngagementTarget({ targetType, targetId });
  if (checked.targetType !== "comment") {
    const target = await npResolveDocumentEngagementTarget(
      checked.targetType,
      checked.targetId,
      "reactions",
    );
    return {
      ...target,
      scopes: [{ type: "collection", id: target.targetType }],
    };
  }

  const db = getDb();
  const [comment] = (await db
    .select({
      targetType: npComments.targetType,
      memberId: npComments.memberId,
      status: npComments.status,
      siteId: npComments.siteId,
    })
    .from(npComments)
    .where(eq(npComments.id, checked.targetId))
    .limit(1)) as Array<{
    targetType: string;
    memberId: string;
    status: string;
    siteId: string;
  }>;
  if (!comment) throw new NpNotFoundError("comment", checked.targetId);
  if (comment.status === "deleted") {
    throw new NpValidationError("Invalid input", [
      { field: "targetId", message: "Cannot react to a deleted comment" },
    ]);
  }
  const requestSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  if (comment.siteId !== requestSiteId) {
    throw new NpForbiddenError("reaction", "cross-site");
  }
  return {
    targetType: checked.targetType,
    targetId: checked.targetId,
    siteId: comment.siteId,
    recipientId: comment.memberId,
    scopes: [{ type: "collection", id: comment.targetType }],
  };
}

async function doAddReaction(
  input: NpReactToInput,
  target: NpResolvedReactionTarget,
): Promise<NpReactionRow> {
  const db = getDb();

  // Idempotent insert via ON CONFLICT. The previous select-then-insert
  // pattern lost a race when two identical clicks arrived in parallel —
  // both selects found nothing, both inserts ran, one hit the unique
  // constraint with a 23505 surface as 500. (#48)
  //
  // `onConflictDoNothing` returns nothing for the conflict, so we
  // re-select the existing row when our insert was the loser. The
  // `inserted` flag tells us which path won — the notification only
  // fires when our insert actually created a new reaction, keeping
  // the "first-time only" semantic.
  const inserted = (await db
    .insert(npReactions)
    .values({
      targetType: target.targetType,
      targetId: target.targetId,
      memberId: input.memberId,
      kind: input.kind,
      siteId: target.siteId,
    })
    .onConflictDoNothing()
    .returning()) as NpReactionRow[];

  let row: NpReactionRow;
  if (inserted.length > 0) {
    row = npRequireReactionRow(inserted[0]);
  } else {
    const [existing] = (await db
      .select()
      .from(npReactions)
      .where(
        and(
          eq(npReactions.targetType, target.targetType),
          eq(npReactions.targetId, target.targetId),
          eq(npReactions.memberId, input.memberId),
          eq(npReactions.kind, input.kind),
          eq(npReactions.siteId, target.siteId),
        ),
      )
      .limit(1)) as NpReactionRow[];
    if (!existing) throw new Error("Reaction conflict but row not found");
    return npRequireReactionRow(existing);
  }

  // Fan out a notification + apply reputation delta to the recipient.
  // Self-reactions are filtered for both — neither makes sense.
  if (target.recipientId && target.recipientId !== input.memberId) {
    await createNotification({
      memberId: target.recipientId,
      kind: "reaction.received",
      actorMemberId: input.memberId,
      payload: {
        reactorId: input.memberId,
        targetType: target.targetType,
        targetId: target.targetId,
        reactionKind: input.kind,
      },
    });
    await applyReputation(target.recipientId, {
      kind: "reaction.received",
      reactionKind: input.kind,
      recipientId: target.recipientId,
      reactorId: input.memberId,
      targetType: target.targetType,
      targetId: target.targetId,
    });
  }

  return row;
}

export async function removeReaction(input: NpReactToInput): Promise<void> {
  validateKind(input.kind);
  const checked = npRequireEngagementTarget({
    targetType: input.targetType,
    targetId: input.targetId,
  });
  const db = getDb();
  // Look up the reaction's recipient BEFORE deleting so the
  // reputation event has the right context. We only emit
  // `reaction.removed` when there was actually something to remove
  // (i.e. the row existed and the reactor isn't the recipient).
  //
  // Issue #362 — also pin the request's tenant against the target's
  // and include `siteId` in the delete predicate. `addReaction`
  // already rejects cross-site adds; without the same gate here, a
  // member on site A could name a site B comment UUID and remove
  // their site B reaction (and apply the reputation reversal in the
  // wrong site context). The siteId in the predicate is
  // defence-in-depth: even if the pre-check passes against a stale
  // resolver value, the row only deletes when both ids agree.
  const requestSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  let recipientId: string | null = null;
  if (checked.targetType === "comment") {
    const [comment] = (await db
      .select({ memberId: npComments.memberId, siteId: npComments.siteId })
      .from(npComments)
      .where(eq(npComments.id, checked.targetId))
      .limit(1)) as Array<{ memberId: string; siteId: string }>;
    if (comment && comment.siteId !== requestSiteId) {
      throw new NpForbiddenError("reaction", "cross-site");
    }
    if (comment && comment.memberId !== input.memberId) {
      recipientId = comment.memberId;
    }
  } else {
    try {
      const target = await npResolveDocumentEngagementTarget(
        checked.targetType,
        checked.targetId,
        "reactions",
        { requirePublic: false },
      );
      if (target.recipientId !== input.memberId) recipientId = target.recipientId;
    } catch (error) {
      if (error instanceof NpForbiddenError) throw error;
      if (!(error instanceof NpNotFoundError) && !(error instanceof NpValidationError)) {
        throw error;
      }
      // A retired collection capability or already-deleted target must not
      // trap a member's existing reaction. The site-scoped delete below still
      // prevents cross-tenant removal; only recipient reputation is skipped.
    }
  }

  // Use `.returning()` so we know whether the delete actually
  // removed a row — repeated/no-op DELETEs (e.g. a client re-trying
  // an unreact) must NOT emit a phantom `reaction.removed` event,
  // otherwise a member could drain a recipient's reputation by
  // hammering the endpoint without ever having reacted.
  const deleted = (await db
    .delete(npReactions)
    .where(
      and(
        eq(npReactions.targetType, checked.targetType),
        eq(npReactions.targetId, checked.targetId),
        eq(npReactions.memberId, input.memberId),
        eq(npReactions.kind, input.kind),
        eq(npReactions.siteId, requestSiteId),
      ),
    )
    .returning({ id: npReactions.id })) as Array<{ id: string }>;

  if (recipientId && deleted.length > 0) {
    await applyReputation(recipientId, {
      kind: "reaction.removed",
      reactionKind: input.kind,
      recipientId,
      reactorId: input.memberId,
      targetType: checked.targetType,
      targetId: checked.targetId,
    });
  }
}

/**
 * Per-target counts grouped by kind. Returns `{ like: 12 }`-style
 * objects; missing kinds are absent (caller defaults to 0).
 */
export async function countReactions(
  targetType: string,
  targetId: string,
): Promise<Record<string, number>> {
  const target = npRequireEngagementTarget({ targetType, targetId });
  await assertReactableExists(target.targetType, target.targetId);
  const db = getDb();
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const rows = (await db
    .select({ kind: npReactions.kind, total: count() })
    .from(npReactions)
    .where(
      and(
        eq(npReactions.siteId, siteId),
        eq(npReactions.targetType, target.targetType),
        eq(npReactions.targetId, target.targetId),
      ),
    )
    .groupBy(npReactions.kind)) as Array<{ kind: string; total: number | string }>;
  const out: Record<string, number> = {};
  for (const row of rows) out[row.kind] = Number(row.total);
  return out;
}

/**
 * Returns the kinds the given member has reacted with on a target.
 * Used by the site UI to render the like button as toggled-on.
 */
export async function listMemberReactions(
  targetType: string,
  targetId: string,
  memberId: string,
): Promise<string[]> {
  const target = npRequireEngagementTarget({ targetType, targetId });
  await assertReactableExists(target.targetType, target.targetId);
  const db = getDb();
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const rows = (await db
    .select({ kind: npReactions.kind })
    .from(npReactions)
    .where(
      and(
        eq(npReactions.targetType, target.targetType),
        eq(npReactions.targetId, target.targetId),
        eq(npReactions.memberId, memberId),
        eq(npReactions.siteId, siteId),
      ),
    )) as Array<{ kind: string }>;
  return rows.map((r) => r.kind);
}

/**
 * Internal helper — assert that a comment or reaction-enabled public
 * collection document exists in the current site.
 */
export async function assertReactableExists(targetType: string, targetId: string): Promise<void> {
  await resolveReactionTarget(targetType, targetId);
}
