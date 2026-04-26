import { and, count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxComments, nxReactions } from "../db/schema/community.js";
import { NxNotFoundError, NxValidationError } from "../errors.js";

import { assertNotBanned } from "./can.js";
import { createNotification } from "./notifications.js";
import { applyReputation } from "./reputation.js";
import { getCommunitySettings } from "./settings.js";

/**
 * Reactions service. `kind` is gated by both:
 *   1. `KIND_RE` — a syntactic check (lowercase token, ≤30 chars)
 *      that runs on every add/remove call without a DB round-trip.
 *   2. The site's reaction allow-list, persisted in
 *      `nx_settings.community.reactionKinds` and edited from the
 *      admin community settings page. v1 ships with `["like"]` as
 *      the only allowed kind. Removal is NOT gated against the
 *      allow-list — if a site retires a reaction, members can still
 *      undo their old reactions of that kind.
 */

export const DEFAULT_REACTION_KINDS = ["like"] as const;
const KIND_RE = /^[a-z][a-z0-9_-]{0,29}$/;

export interface NxReactionRow {
  id: string;
  targetType: string;
  targetId: string;
  memberId: string;
  kind: string;
  createdAt: Date;
}

export interface NxReactToInput {
  targetType: string;
  targetId: string;
  memberId: string;
  kind: string;
}

function validateKind(kind: string): void {
  if (!KIND_RE.test(kind)) {
    throw new NxValidationError("Invalid input", [
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
export async function addReaction(input: NxReactToInput): Promise<NxReactionRow> {
  validateKind(input.kind);

  const settings = await getCommunitySettings();
  if (!settings.reactionKinds.includes(input.kind)) {
    throw new NxValidationError("Invalid input", [
      {
        field: "kind",
        message: `Reaction kind '${input.kind}' is not allowed on this site`,
      },
    ]);
  }

  // Banned members can't react. We don't know the target's collection
  // from a polymorphic reaction, so site-wide bans are the only scope
  // that applies here — collection-scoped bans on reactions need
  // future plumbing to thread the collection slug into this call. (#53)
  await assertNotBanned(input.memberId);

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;

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
    .insert(nxReactions)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      memberId: input.memberId,
      kind: input.kind,
    })
    .onConflictDoNothing()
    .returning()) as NxReactionRow[];

  let row: NxReactionRow;
  if (inserted.length > 0) {
    row = inserted[0]!;
  } else {
    const [existing] = (await db
      .select()
      .from(nxReactions)
      .where(
        and(
          eq(nxReactions.targetType, input.targetType),
          eq(nxReactions.targetId, input.targetId),
          eq(nxReactions.memberId, input.memberId),
          eq(nxReactions.kind, input.kind),
        ),
      )
      .limit(1)) as NxReactionRow[];
    if (!existing) throw new Error("Reaction conflict but row not found");
    return existing;
  }

  // Fan out a notification + apply reputation delta to the recipient.
  // Self-reactions are filtered for both — neither makes sense.
  if (input.targetType === "comment") {
    const [comment] = (await db
      .select({ memberId: nxComments.memberId })
      .from(nxComments)
      .where(eq(nxComments.id, input.targetId))
      .limit(1)) as Array<{ memberId: string }>;
    if (comment && comment.memberId !== input.memberId) {
      await createNotification({
        memberId: comment.memberId,
        kind: "reaction.received",
        payload: {
          reactorId: input.memberId,
          targetType: input.targetType,
          targetId: input.targetId,
          reactionKind: input.kind,
        },
      });
      await applyReputation(comment.memberId, {
        kind: "reaction.received",
        reactionKind: input.kind,
        recipientId: comment.memberId,
        reactorId: input.memberId,
        targetType: input.targetType,
        targetId: input.targetId,
      });
    }
  }

  return row;
}

export async function removeReaction(input: NxReactToInput): Promise<void> {
  validateKind(input.kind);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  // Look up the reaction's recipient BEFORE deleting so the
  // reputation event has the right context. We only emit
  // `reaction.removed` when there was actually something to remove
  // (i.e. the row existed and the reactor isn't the recipient).
  let recipientId: string | null = null;
  if (input.targetType === "comment") {
    const [comment] = (await db
      .select({ memberId: nxComments.memberId })
      .from(nxComments)
      .where(eq(nxComments.id, input.targetId))
      .limit(1)) as Array<{ memberId: string }>;
    if (comment && comment.memberId !== input.memberId) {
      recipientId = comment.memberId;
    }
  }

  // Use `.returning()` so we know whether the delete actually
  // removed a row — repeated/no-op DELETEs (e.g. a client re-trying
  // an unreact) must NOT emit a phantom `reaction.removed` event,
  // otherwise a member could drain a recipient's reputation by
  // hammering the endpoint without ever having reacted.
  const deleted = (await db
    .delete(nxReactions)
    .where(
      and(
        eq(nxReactions.targetType, input.targetType),
        eq(nxReactions.targetId, input.targetId),
        eq(nxReactions.memberId, input.memberId),
        eq(nxReactions.kind, input.kind),
      ),
    )
    .returning({ id: nxReactions.id })) as Array<{ id: string }>;

  if (recipientId && deleted.length > 0) {
    await applyReputation(recipientId, {
      kind: "reaction.removed",
      reactionKind: input.kind,
      recipientId,
      reactorId: input.memberId,
      targetType: input.targetType,
      targetId: input.targetId,
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const rows = (await db
    .select({ kind: nxReactions.kind, total: count() })
    .from(nxReactions)
    .where(and(eq(nxReactions.targetType, targetType), eq(nxReactions.targetId, targetId)))
    .groupBy(nxReactions.kind)) as Array<{ kind: string; total: number | string }>;
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const rows = (await db
    .select({ kind: nxReactions.kind })
    .from(nxReactions)
    .where(
      and(
        eq(nxReactions.targetType, targetType),
        eq(nxReactions.targetId, targetId),
        eq(nxReactions.memberId, memberId),
      ),
    )) as Array<{ kind: string }>;
  return rows.map((r) => r.kind);
}

/**
 * Internal helper — assert that the target exists for the given kind.
 * Today only `comment` is supported. The polymorphic shape leaves
 * room for `thread` / `reply` once a thread schema lands; the forum
 * plugin shipped without one (it reuses `nx_comments` under the
 * `discussions` collection), so widening this surface is on hold
 * until a separate threads design.
 */
export async function assertReactableExists(
  targetType: string,
  targetId: string,
): Promise<void> {
  if (targetType !== "comment") {
    throw new NxValidationError("Invalid input", [
      {
        field: "targetType",
        message: `Reactions on '${targetType}' aren't supported yet — only 'comment' is wired today.`,
      },
    ]);
  }
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [comment] = (await db
    .select({ id: nxComments.id, status: nxComments.status })
    .from(nxComments)
    .where(eq(nxComments.id, targetId))
    .limit(1)) as Array<{ id: string; status: string }>;
  if (!comment) throw new NxNotFoundError("comment", targetId);
  if (comment.status === "deleted") {
    throw new NxValidationError("Invalid input", [
      { field: "targetId", message: "Cannot react to a deleted comment" },
    ]);
  }
}
