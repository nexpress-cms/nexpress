import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getCollectionConfig } from "../collections/registry.js";
import { getDb } from "../collections/pipeline.js";
import { nxComments } from "../db/schema/community.js";
import { NxForbiddenError, NxNotFoundError, NxValidationError } from "../errors.js";

import { recordAuditEvent } from "./audit.js";
import { memberCan } from "./can.js";
import { renderCommentMarkdown } from "./markdown.js";
import { createNotification } from "./notifications.js";

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
      status: "visible",
    })
    .returning()) as Array<NxCommentRow>;
  if (!row) throw new Error("Comment insert returned no row");

  // Reply notification — fire-and-forget. Self-replies don't notify.
  if (parentAuthorId && parentAuthorId !== input.memberId) {
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
export async function staffHideComment(
  commentId: string,
  staffUserId: string,
  reason?: string | null,
): Promise<void> {
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
}

export async function staffRestoreComment(
  commentId: string,
  staffUserId: string,
): Promise<void> {
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
}
