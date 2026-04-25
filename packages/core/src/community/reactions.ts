import { and, count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxComments, nxReactions } from "../db/schema/community.js";
import { NxNotFoundError, NxValidationError } from "../errors.js";

import { createNotification } from "./notifications.js";

/**
 * Reactions service. `kind` is currently free-form per call; sites can
 * restrict the allowed values via a check in the API layer. v1 ships
 * with `'like'` as the default vocabulary — a config knob to control
 * the allow-list lands in 9.6 alongside the rest of the community
 * settings page.
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;

  // Check existing first — avoids the duplicate-insert error path AND
  // keeps the "should I send a notification?" decision deterministic
  // (only on the first insert per member-target-kind).
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
  if (existing) return existing;

  const [row] = (await db
    .insert(nxReactions)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      memberId: input.memberId,
      kind: input.kind,
    })
    .returning()) as NxReactionRow[];
  if (!row) throw new Error("Reaction insert returned no row");

  // Fan out a notification to the comment author (skip self-reactions).
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
    }
  }

  return row;
}

export async function removeReaction(input: NxReactToInput): Promise<void> {
  validateKind(input.kind);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  await db
    .delete(nxReactions)
    .where(
      and(
        eq(nxReactions.targetType, input.targetType),
        eq(nxReactions.targetId, input.targetId),
        eq(nxReactions.memberId, input.memberId),
        eq(nxReactions.kind, input.kind),
      ),
    );
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
 * Today only `comment` is supported; extending to thread/reply is a
 * 9.4 concern. Callers can short-circuit before hitting the unique
 * constraint with this lookup.
 */
export async function assertReactableExists(
  targetType: string,
  targetId: string,
): Promise<void> {
  if (targetType !== "comment") {
    throw new NxValidationError("Invalid input", [
      {
        field: "targetType",
        message: `Reactions on '${targetType}' aren't supported yet (9.4 ships threads + replies).`,
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
