import { npAuthContractLimits } from "@nexpress/core/auth-contract";

import type { WpComment, WpImportRecord } from "../parse/types.js";
import type { ResumeDeps } from "./resume.js";

/**
 * Phase 21.7 — wire WP comments into NexPress's `np_comments` plus
 * per-author imported members.
 *
 * The applier owns sequencing — it inserts each post first, then
 * walks the post's comments and asks the caller's hooks to:
 *
 *   1. Resolve a comment author to a NexPress member id, creating
 *      one with `status='imported'` if needed.
 *   2. Insert the comment row directly (no spam/profanity check,
 *      no notification fan-out — it's archived content).
 *
 * Comments that aren't approved in the WXR (`<wp:comment_approved>`
 * != "1") are dropped. Reply parents are resolved within the same
 * post: WP comment ids form a per-post tree, so we walk the comment
 * list in id-ascending order and consult an in-memory map.
 */

export interface ImportedMemberInput {
  handle: string;
  email: string | null;
  displayName: string;
}

export interface CommentInsertInput {
  targetType: string;
  targetId: string;
  parentId: string | null;
  memberId: string;
  bodyMd: string;
  bodyHtml: string;
  createdAt: Date;
}

export interface CommentDeps {
  ensureImportedMember: (input: ImportedMemberInput) => Promise<{ id: string }>;
  insertComment: (input: CommentInsertInput) => Promise<{ id: string }>;
  /**
   * Render a comment body to safe HTML. The shim plugs in the
   * framework's `renderCommentMarkdown`; tests pass a passthrough.
   */
  renderBody: (source: string) => string;
}

export interface CommentImportPlan {
  applied: number;
  skippedUnapproved: number;
  skippedNoMember: number;
  /** Phase 21.14 — comments the resume marker said were already imported. */
  skippedByResume: number;
  errors: Array<{ wpCommentId: number; reason: string }>;
}

/**
 * Walk a record's comments and import them. Mutates `plan` in place.
 * Returns when the record's comments have all been processed.
 */
export async function importPostComments(args: {
  record: WpImportRecord;
  postId: string;
  collection: string;
  deps: CommentDeps;
  plan: CommentImportPlan;
  log?: (line: string) => void;
  /** Phase 21.14 — when supplied, dedupes by `wpCommentId`. */
  resume?: ResumeDeps;
}): Promise<void> {
  const { record, postId, collection, deps, plan, resume } = args;
  const log = args.log ?? noop;
  if (record.comments.length === 0) return;

  // Sort by WP id so a parent always lands before its replies.
  // WP guarantees sequential allocation per site; this matters for
  // the parent-resolution map below.
  const ordered = [...record.comments].sort((a, b) => a.wpId - b.wpId);
  const wpToNexpressId = new Map<number, string>();
  // Phase 21.14 — seed the parent-resolution map with anything
  // from the resume marker so a partial-failure mid-thread can
  // still resolve replies under the previously-inserted parent.
  if (resume) {
    for (const c of ordered) {
      const prior = resume.state.comments[c.wpId];
      if (prior) wpToNexpressId.set(c.wpId, prior);
    }
  }

  for (const wpComment of ordered) {
    if (resume?.state.comments[wpComment.wpId]) {
      plan.skippedByResume++;
      continue;
    }
    if (!wpComment.approved) {
      plan.skippedUnapproved++;
      continue;
    }
    try {
      const member = await ensureMemberFor(wpComment, deps);
      if (!member) {
        plan.skippedNoMember++;
        continue;
      }
      const parentId =
        wpComment.parentWpId !== null ? (wpToNexpressId.get(wpComment.parentWpId) ?? null) : null;

      const createdAt = parseWpDate(wpComment.date);
      const inserted = await deps.insertComment({
        targetType: collection,
        targetId: postId,
        parentId,
        memberId: member.id,
        bodyMd: wpComment.content,
        bodyHtml: deps.renderBody(wpComment.content),
        createdAt,
      });
      wpToNexpressId.set(wpComment.wpId, inserted.id);
      plan.applied++;
      log(`comment write ${collection}/${record.slug} #${wpComment.wpId}`);
      if (resume) {
        resume.state.comments[wpComment.wpId] = inserted.id;
        await resume.persist();
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      plan.errors.push({ wpCommentId: wpComment.wpId, reason });
      log(`comment error ${collection}/${record.slug} #${wpComment.wpId}: ${reason}`);
    }
  }
}

/**
 * Build the imported-member input for a WP comment. The applier
 * requires a stable `handle` so re-imports of the same author
 * de-dupe; we derive it from the email when present (most stable),
 * else from the slugified author name. The `-wpimp` suffix avoids
 * collisions with live members who may already own the slugified
 * handle (a regular registration can't claim a handle that ends in
 * `-wpimp` — short of a live user picking that exact suffix on
 * purpose).
 */
async function ensureMemberFor(
  comment: WpComment,
  deps: CommentDeps,
): Promise<{ id: string } | null> {
  const fallbackName = comment.authorName?.trim() || "guest";
  const slugSource = comment.authorEmail ?? fallbackName;
  const handle = `${slugify(slugSource)}-wpimp`;
  if (!handle || handle === "-wpimp") return null;
  return deps.ensureImportedMember({
    handle,
    email: comment.authorEmail,
    displayName: fallbackName,
  });
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, npAuthContractLimits.handleLength - "-wpimp".length);
}

function parseWpDate(raw: string): Date {
  if (!raw) return new Date();
  // <wp:comment_date_gmt> is "YYYY-MM-DD HH:mm:ss" without a TZ
  // marker. Force UTC; mismatched timezones in archived comments
  // are an acceptable rounding error.
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function emptyCommentPlan(): CommentImportPlan {
  return { applied: 0, skippedUnapproved: 0, skippedNoMember: 0, skippedByResume: 0, errors: [] };
}

function noop(): void {
  /* default log sink */
}
