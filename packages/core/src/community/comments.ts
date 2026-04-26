import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getCollectionConfig } from "../collections/registry.js";
import { getDb, getDocumentById } from "../collections/pipeline.js";
import { nxComments } from "../db/schema/community.js";
import { NxForbiddenError, NxNotFoundError, NxValidationError } from "../errors.js";

import { getLogger } from "../observability/logger.js";

import { recordAuditEvent } from "./audit.js";
import { assertNotBanned, memberCan } from "./can.js";
import { renderCommentMarkdown } from "./markdown.js";
import { createNotification } from "./notifications.js";
import { applyReputation } from "./reputation.js";
import { getSpamAdapter } from "./spam-adapter.js";

/**
 * Service layer for `nx_comments`. Routes call into here so the
 * permission gate (`memberCan`) and the markdown render are
 * consistent across HTTP, the admin UI, and any future plugin
 * surface.
 *
 * Comments are gated by collection config: `community.comments === true`
 * on the target collection or every write returns 400.
 */

const MAX_BODY_LENGTH = 5000;

export type CommentStatus = "visible" | "pending" | "hidden" | "deleted";

export interface NxCommentRow {
  id: string;
  targetType: string;
  targetId: string;
  parentId: string | null;
  memberId: string;
  bodyMd: string;
  bodyHtml: string;
  status: CommentStatus;
  hiddenReason: string | null;
  editedAt: Date | null;
  createdAt: Date;
}

export interface NxCommentCreateInput {
  targetType: string;
  targetId: string;
  parentId?: string | null;
  memberId: string;
  bodyMd: string;
}

function assertCollectionAcceptsComments(slug: string): void {
  const config = getCollectionConfig(slug);
  if (!config.community?.comments) {
    throw new NxValidationError("Comments disabled", [
      {
        field: "collection",
        message: `Collection "${slug}" does not accept comments. Set community.comments=true on the collection config.`,
      },
    ]);
  }
}

function validateBody(bodyMd: string): void {
  const trimmed = bodyMd.trim();
  if (trimmed.length === 0) {
    throw new NxValidationError("Invalid input", [
      { field: "bodyMd", message: "Comment body required" },
    ]);
  }
  if (trimmed.length > MAX_BODY_LENGTH) {
    throw new NxValidationError("Invalid input", [
      { field: "bodyMd", message: `Comment body must be ≤ ${MAX_BODY_LENGTH} characters` },
    ]);
  }
}

function commentScopes(row: { targetType: string }): Array<{ type: "collection"; id: string }> {
  // The only scope a comment carries today is its target collection. When
  // 9.4 ships threads, we'll add `category` / `thread` here so the
  // permission resolver can match category-mod / thread-author grants.
  return [{ type: "collection", id: row.targetType }];
}

export async function createComment(input: NxCommentCreateInput): Promise<NxCommentRow> {
  validateBody(input.bodyMd);
  assertCollectionAcceptsComments(input.targetType);

  // Reject banned members before any IO. Site-wide bans block every
  // comment; collection-scoped bans block writes to that collection.
  // (#53 — without this, banned members kept commenting because
  // `createComment` never went through `memberCan`.)
  await assertNotBanned(input.memberId, [
    { type: "collection", id: input.targetType },
  ]);

  // Target document must actually exist. Without this guard, members
  // could insert orphan comment rows under random UUIDs for any
  // comment-enabled collection (#49). We use the public read path
  // (`undefined` user = anonymous) so the comment-creation surface
  // matches what's publicly visible — comments under a draft would
  // be filtered out of the rendered site anyway.
  const targetDoc = await getDocumentById(input.targetType, input.targetId);
  if (!targetDoc) {
    throw new NxNotFoundError(input.targetType, input.targetId);
  }

  // Forum-style "locked" guard: collections that opted into a `locked`
  // checkbox on their schema (e.g. `defineDiscussionsCollection`) flip
  // it to true to prevent new comments. The flag lives at the document
  // level, not the collection level — different threads in the same
  // collection can be locked independently. (#47)
  if (targetDoc.locked === true) {
    throw new NxValidationError("Invalid input", [
      { field: "targetId", message: "This thread is locked and does not accept new comments." },
    ]);
  }

  // Parent thread sanity: if `parentId` is set, the parent must exist
  // and target the same collection + document. Cross-doc replies are
  // disallowed so a reply can't smuggle itself into a different thread.
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  let parentAuthorId: string | null = null;
  if (input.parentId) {
    const [parent] = (await db
      .select({
        id: nxComments.id,
        targetType: nxComments.targetType,
        targetId: nxComments.targetId,
        memberId: nxComments.memberId,
      })
      .from(nxComments)
      .where(eq(nxComments.id, input.parentId))
      .limit(1)) as Array<{
      id: string;
      targetType: string;
      targetId: string;
      memberId: string;
    }>;
    if (!parent) {
      throw new NxNotFoundError("comment", input.parentId);
    }
    if (parent.targetType !== input.targetType || parent.targetId !== input.targetId) {
      throw new NxValidationError("Invalid input", [
        { field: "parentId", message: "Parent comment belongs to a different document" },
      ]);
    }
    parentAuthorId = parent.memberId;
  }

  // Run the registered spam adapter (default: pass-through). Sites
  // that install Akismet / OpenAI moderation / a custom classifier
  // via `setSpamAdapter()` get their verdict here:
  //   - `"pass"`   → status = "visible" (existing behavior)
  //   - `"flag"`   → status = "pending"; mods see the row, public list
  //                  does not; the audit log captures the verdict
  //   - `"reject"` → throw NxValidationError, no row written
  //
  // Fail-open: if the adapter throws (network blip, timeout, 5xx
  // from the upstream service), log via the observability hook and
  // treat the verdict as `pass`. Sites that prefer fail-closed wrap
  // their own adapter in a try/catch and return `reject` on errors.
  let verdict;
  try {
    verdict = await getSpamAdapter().check(input.bodyMd, {
      memberId: input.memberId,
      targetType: input.targetType,
      targetId: input.targetId,
      parentId: input.parentId ?? null,
    });
  } catch (err) {
    getLogger().warn("spam adapter threw — treating as pass", {
      error: err instanceof Error ? err.message : String(err),
      targetType: input.targetType,
      targetId: input.targetId,
    });
    verdict = { kind: "pass" as const };
  }
  if (verdict.kind === "reject") {
    throw new NxValidationError("Invalid input", [
      {
        field: "bodyMd",
        message: verdict.reason ?? "Comment was rejected by the site's spam filter",
      },
    ]);
  }
  const initialStatus: CommentStatus = verdict.kind === "flag" ? "pending" : "visible";

  const html = renderCommentMarkdown(input.bodyMd);
  const [row] = (await db
    .insert(nxComments)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      parentId: input.parentId ?? null,
      memberId: input.memberId,
      bodyMd: input.bodyMd,
      bodyHtml: html,
      status: initialStatus,
    })
    .returning()) as Array<NxCommentRow>;
  if (!row) throw new Error("Comment insert returned no row");

  if (verdict.kind === "flag") {
    // Surface flagged content in the audit log so mods can triage.
    // Recorded as a member-actor event so it threads with other
    // member-originated audit entries on the comment.
    await recordAuditEvent({
      actor: { kind: "member", memberId: input.memberId },
      action: "comment.flag",
      targetType: "comment",
      targetId: row.id,
      payload: {
        reason: verdict.reason ?? null,
        adapter: verdict.metadata ?? null,
      },
    });
  }

  // Reputation: only credit visible comments. Flagged content waits
  // for a mod restore — at that point the moderation surface can
  // decide whether to retroactively credit (not done in v1).
  if (initialStatus === "visible") {
    await applyReputation(input.memberId, {
      kind: "comment.created",
      commentId: row.id,
      memberId: input.memberId,
      targetType: input.targetType,
      targetId: input.targetId,
    });
  }

  // Reply notification — fire-and-forget. Self-replies don't notify.
  // Pending (spam-flagged) comments don't notify either: surfacing a
  // notification for content the public list won't render is just
  // confusing. If a mod later restores the row to visible, that's
  // when it makes sense to notify; the moderation surface owns that
  // decision.
  if (
    initialStatus === "visible" &&
    parentAuthorId &&
    parentAuthorId !== input.memberId
  ) {
    await createNotification({
      memberId: parentAuthorId,
      kind: "comment.reply",
      payload: {
        commentId: row.id,
        replyAuthorId: input.memberId,
        targetType: input.targetType,
        targetId: input.targetId,
      },
    });
  }

  return row;
}

export interface NxCommentListOptions {
  /** Default 50, max 200. */
  limit?: number;
  /** Default 0. */
  offset?: number;
  /** Newest first by default; flip for chronological reads. */
  order?: "newest" | "oldest";
  /** Override visibility — staff/mods may want to see hidden rows. */
  includeHidden?: boolean;
}

export interface NxCommentListResult {
  comments: NxCommentRow[];
  totalDocs: number;
}

export async function listComments(
  targetType: string,
  targetId: string,
  options: NxCommentListOptions = {},
): Promise<NxCommentListResult> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const order = options.order === "oldest" ? asc : desc;

  const where = options.includeHidden
    ? and(eq(nxComments.targetType, targetType), eq(nxComments.targetId, targetId))
    : sql`${eq(nxComments.targetType, targetType)} and ${eq(nxComments.targetId, targetId)} and ${eq(nxComments.status, "visible")}`;

  const rows = (await db
    .select()
    .from(nxComments)
    .where(where)
    .orderBy(order(nxComments.createdAt))
    .limit(limit)
    .offset(offset)) as NxCommentRow[];

  const [totalRow] = (await db
    .select({ total: count() })
    .from(nxComments)
    .where(where)) as Array<{ total: number | string }>;

  return { comments: rows, totalDocs: Number(totalRow?.total ?? 0) };
}

export interface NxCommentUpdateInput {
  commentId: string;
  memberId: string;
  bodyMd: string;
}

export async function updateComment(input: NxCommentUpdateInput): Promise<NxCommentRow> {
  validateBody(input.bodyMd);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [existing] = (await db
    .select()
    .from(nxComments)
    .where(eq(nxComments.id, input.commentId))
    .limit(1)) as NxCommentRow[];
  if (!existing) throw new NxNotFoundError("comment", input.commentId);

  // Reject edits to soft-deleted comments. `deleteComment` clears
  // `bodyMd`/`bodyHtml` to honor erasure expectations; allowing the
  // owner to edit-back content would defeat that and let moderation
  // views surface text the user expected to disappear. (#50)
  if (existing.status === "deleted") {
    throw new NxValidationError("Invalid state", [
      { field: "comment", message: "Cannot edit a deleted comment" },
    ]);
  }

  // Owner edits via `edit-own`; mods via `edit-any-comment`.
  const ownerCan = await memberCan(input.memberId, "edit-own", {
    type: "comment",
    id: existing.id,
    ownerId: existing.memberId,
    scopes: commentScopes(existing),
  });
  const modCan = ownerCan
    ? false
    : await memberCan(input.memberId, "edit-any-comment", {
        type: "comment",
        id: existing.id,
        ownerId: existing.memberId,
        scopes: commentScopes(existing),
      });
  if (!ownerCan && !modCan) {
    throw new NxForbiddenError("comment", "update");
  }

  const html = renderCommentMarkdown(input.bodyMd);
  const [updated] = (await db
    .update(nxComments)
    .set({ bodyMd: input.bodyMd, bodyHtml: html, editedAt: new Date() })
    .where(eq(nxComments.id, input.commentId))
    .returning()) as NxCommentRow[];
  if (!updated) throw new Error("Comment update returned no row");
  return updated;
}

export interface NxCommentDeleteInput {
  commentId: string;
  memberId: string;
}

export async function deleteComment(input: NxCommentDeleteInput): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [existing] = (await db
    .select()
    .from(nxComments)
    .where(eq(nxComments.id, input.commentId))
    .limit(1)) as NxCommentRow[];
  if (!existing) throw new NxNotFoundError("comment", input.commentId);

  const ownerCan = await memberCan(input.memberId, "delete-own", {
    type: "comment",
    id: existing.id,
    ownerId: existing.memberId,
    scopes: commentScopes(existing),
  });
  const modCan = ownerCan
    ? false
    : await memberCan(input.memberId, "delete-any-comment", {
        type: "comment",
        id: existing.id,
        ownerId: existing.memberId,
        scopes: commentScopes(existing),
      });
  if (!ownerCan && !modCan) {
    throw new NxForbiddenError("comment", "delete");
  }

  // Soft-delete: keep the row so reply chains stay intact and audit
  // can resolve "who said what" later. Body fields are blanked so the
  // text is actually gone from the read path.
  await db
    .update(nxComments)
    .set({ status: "deleted", bodyMd: "", bodyHtml: "", editedAt: new Date() })
    .where(eq(nxComments.id, input.commentId));
}

export interface NxCommentHideInput {
  commentId: string;
  memberId: string;
  reason?: string | null;
}

export async function hideComment(input: NxCommentHideInput): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [existing] = (await db
    .select()
    .from(nxComments)
    .where(eq(nxComments.id, input.commentId))
    .limit(1)) as NxCommentRow[];
  if (!existing) throw new NxNotFoundError("comment", input.commentId);

  const ok = await memberCan(input.memberId, "hide-comment", {
    type: "comment",
    id: existing.id,
    ownerId: existing.memberId,
    scopes: commentScopes(existing),
  });
  if (!ok) throw new NxForbiddenError("comment", "hide");

  await db
    .update(nxComments)
    .set({
      status: "hidden",
      hiddenByMemberId: input.memberId,
      hiddenReason: input.reason ?? null,
    })
    .where(eq(nxComments.id, input.commentId));

  await recordAuditEvent({
    actor: { kind: "member", memberId: input.memberId },
    action: "comment.hide",
    targetType: "comment",
    targetId: existing.id,
    payload: { reason: input.reason ?? null, collection: existing.targetType },
  });
}

export interface NxCommentRestoreInput {
  commentId: string;
  memberId: string;
}

export async function restoreComment(input: NxCommentRestoreInput): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [existing] = (await db
    .select()
    .from(nxComments)
    .where(eq(nxComments.id, input.commentId))
    .limit(1)) as NxCommentRow[];
  if (!existing) throw new NxNotFoundError("comment", input.commentId);
  if (existing.status !== "hidden") {
    throw new NxValidationError("Invalid state", [
      { field: "status", message: `Comment is "${existing.status}", not "hidden"` },
    ]);
  }

  const ok = await memberCan(input.memberId, "restore-comment", {
    type: "comment",
    id: existing.id,
    ownerId: existing.memberId,
    scopes: commentScopes(existing),
  });
  if (!ok) throw new NxForbiddenError("comment", "restore");

  await db
    .update(nxComments)
    .set({
      status: "visible",
      hiddenByUserId: null,
      hiddenByMemberId: null,
      hiddenReason: null,
    })
    .where(eq(nxComments.id, input.commentId));

  await recordAuditEvent({
    actor: { kind: "member", memberId: input.memberId },
    action: "comment.restore",
    targetType: "comment",
    targetId: existing.id,
    payload: { collection: existing.targetType },
  });
}

/**
 * Staff-side helpers: bypass the member permission resolver entirely.
 * The API layer routes here when the principal is a staff user with
 * sufficient role (admin/editor/moderator). No `memberId` required;
 * the action is always allowed.
 */
async function loadCommentForStaffOp(commentId: string): Promise<NxCommentRow> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [existing] = (await db
    .select()
    .from(nxComments)
    .where(eq(nxComments.id, commentId))
    .limit(1)) as NxCommentRow[];
  if (!existing) throw new NxNotFoundError("comment", commentId);
  return existing;
}

export async function staffHideComment(
  commentId: string,
  staffUserId: string,
  reason?: string | null,
): Promise<void> {
  const existing = await loadCommentForStaffOp(commentId);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  await db
    .update(nxComments)
    .set({
      status: "hidden",
      hiddenByUserId: staffUserId,
      hiddenByMemberId: null,
      hiddenReason: reason ?? null,
    })
    .where(eq(nxComments.id, commentId));
  await recordAuditEvent({
    actor: { kind: "staff", userId: staffUserId },
    action: "comment.hide",
    targetType: "comment",
    targetId: commentId,
    payload: { reason: reason ?? null, byStaff: true },
  });
  // Hiding the comment usually penalizes the author. Adapters return
  // 0 if they don't want to (e.g. the hide is purely admin cleanup
  // that shouldn't affect reputation).
  await applyReputation(existing.memberId, {
    kind: "comment.hidden",
    commentId,
    memberId: existing.memberId,
    byStaff: true,
    reason: reason ?? null,
  });
}

export async function staffRestoreComment(
  commentId: string,
  staffUserId: string,
): Promise<void> {
  const existing = await loadCommentForStaffOp(commentId);
  // A "deleted" comment had its body wiped — flipping it back to visible
  // would surface a ghost row (author + timestamp intact, body empty).
  // Only `hidden` is reversible; member-side `restoreComment` enforces
  // the same invariant.
  if (existing.status !== "hidden") {
    throw new NxValidationError("Invalid state", [
      {
        field: "status",
        message: `Comment is "${existing.status}", not "hidden"`,
      },
    ]);
  }
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  await db
    .update(nxComments)
    .set({
      status: "visible",
      hiddenByUserId: null,
      hiddenByMemberId: null,
      hiddenReason: null,
    })
    .where(eq(nxComments.id, commentId));
  await recordAuditEvent({
    actor: { kind: "staff", userId: staffUserId },
    action: "comment.restore",
    targetType: "comment",
    targetId: commentId,
    payload: { byStaff: true },
  });
}

export async function staffDeleteComment(
  commentId: string,
  staffUserId: string,
): Promise<void> {
  const existing = await loadCommentForStaffOp(commentId);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  await db
    .update(nxComments)
    .set({ status: "deleted", bodyMd: "", bodyHtml: "" })
    .where(eq(nxComments.id, commentId));
  await recordAuditEvent({
    actor: { kind: "staff", userId: staffUserId },
    action: "comment.delete",
    targetType: "comment",
    targetId: commentId,
    payload: { byStaff: true },
  });
  await applyReputation(existing.memberId, {
    kind: "comment.deleted",
    commentId,
    memberId: existing.memberId,
    byStaff: true,
  });
}
