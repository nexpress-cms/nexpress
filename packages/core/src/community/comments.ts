import { and, asc, count, desc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";

import { getCollectionConfig } from "../collections/registry.js";
import { getDocumentById } from "../collections/pipeline.js";
import {
  npRequireCommentRow,
  npRequireReactionSummaryWire,
} from "../community-contract/contract.js";
import type {
  CommentStatus,
  NpCommentCreateInput,
  NpCommentDeleteInput,
  NpCommentHideInput,
  NpCommentListOptions,
  NpCommentListItem,
  NpCommentListResult,
  NpCommentRestoreInput,
  NpCommentRow,
  NpCommentSort,
  NpCommentUpdateInput,
  NpCommunityJsonObject,
  NpReactionSummaryWire,
} from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npComments, npMembers, npReactions } from "../db/schema/community.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";

import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";

import { recordAuditEvent } from "./audit.js";
import { memberCan, withMemberWrite } from "./can.js";
import { renderCommentMarkdown } from "./markdown.js";
import { runProfanityCheck, runSpamCheck } from "./moderation.js";
import {
  extractMentionHandles,
  fanOutMentionNotifications,
  resolveMentionedMembers,
} from "./mentions.js";
import { getMutedTargetIds } from "./mutes.js";
import { createNotification } from "./notifications.js";
import { notifyFollowers } from "./follows.js";
import { npResolveDocumentPublicHref } from "./engagement-target.js";
import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";
import { getProfanityAdapter } from "./profanity-adapter.js";
import { applyReputation } from "./reputation.js";
import { getSpamAdapter } from "./spam-adapter.js";
import { getMemberProfiles } from "./profiles.js";

/**
 * Service layer for `np_comments`. Routes call into here so the
 * permission gate (`memberCan`) and the markdown render are
 * consistent across HTTP, the admin UI, and any future plugin
 * surface.
 *
 * Comments are gated by collection config: `community.comments === true`
 * on the target collection or every write returns 400.
 */

const MAX_BODY_LENGTH = 5000;

export type {
  CommentStatus,
  NpCommentCreateInput,
  NpCommentDeleteInput,
  NpCommentHideInput,
  NpCommentListOptions,
  NpCommentListItem,
  NpCommentListResult,
  NpCommentRestoreInput,
  NpCommentRow,
  NpCommentSort,
  NpCommentUpdateInput,
};

function assertCollectionAcceptsComments(slug: string): void {
  const config = getCollectionConfig(slug);
  if (!config.community?.comments) {
    throw new NpValidationError("Comments disabled", [
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
    throw new NpValidationError("Invalid input", [
      { field: "bodyMd", message: "Comment body required" },
    ]);
  }
  if (trimmed.length > MAX_BODY_LENGTH) {
    throw new NpValidationError("Invalid input", [
      { field: "bodyMd", message: `Comment body must be ≤ ${MAX_BODY_LENGTH} characters` },
    ]);
  }
}

function commentScopes(row: { targetType: string }): Array<{ type: "collection"; id: string }> {
  // The only scope a comment carries today is its target collection.
  // If a thread schema is ever added, this is where `category` /
  // `thread` would join the chain so category-mod / thread-author
  // grants resolve.
  return [{ type: "collection", id: row.targetType }];
}

export async function createComment(input: NpCommentCreateInput): Promise<NpCommentRow> {
  validateBody(input.bodyMd);
  assertCollectionAcceptsComments(input.targetType);

  // #311 — withMemberWrite enforces the ban gate by structure.
  // Site-wide bans block every comment; collection-scoped bans
  // block writes to that collection (#53 — without the gate,
  // banned members kept commenting because createComment never
  // went through memberCan).
  return withMemberWrite(input.memberId, [{ type: "collection", id: input.targetType }], async () =>
    doCreateComment(input),
  );
}

async function doCreateComment(input: NpCommentCreateInput): Promise<NpCommentRow> {
  // Target document must actually exist. Without this guard, members
  // could insert orphan comment rows under random UUIDs for any
  // comment-enabled collection (#49). We use the public read path
  // (`undefined` user = anonymous) so the comment-creation surface
  // matches what's publicly visible — comments under a draft would
  // be filtered out of the rendered site anyway.
  const targetDoc = await getDocumentById(input.targetType, input.targetId);
  if (!targetDoc) {
    throw new NpNotFoundError(input.targetType, input.targetId);
  }

  // Issue #215 — reject cross-tenant writes. A member on site A
  // shouldn't be able to comment on site B's content just by
  // passing B's document UUID. Compare the target doc's
  // canonical `siteId` to the request resolver's site; bail
  // early before the locked / parent / spam / profanity passes
  // run so we don't log adapter calls on rejected requests.
  const requestSiteId = await getCurrentSiteId();
  if (requestSiteId && typeof targetDoc.siteId === "string" && targetDoc.siteId !== requestSiteId) {
    throw new NpForbiddenError("comment", "cross-site");
  }

  // Forum-style "locked" guard: collections that opted into a `locked`
  // checkbox on their schema (e.g. the bundled forum post collection) flip
  // it to true to prevent new comments. The flag lives at the document
  // level, not the collection level — different threads in the same
  // collection can be locked independently. (#47)
  if (targetDoc.locked === true) {
    throw new NpValidationError("Invalid input", [
      { field: "targetId", message: "This thread is locked and does not accept new comments." },
    ]);
  }

  // Parent thread sanity: if `parentId` is set, the parent must exist,
  // target the same collection + document, and BE VISIBLE. Cross-doc
  // replies are disallowed so a reply can't smuggle itself into a
  // different thread; replies under non-visible parents are
  // disallowed because:
  //   - hidden    — a mod took the parent down; new replies under
  //     it would resurrect the thread on the public list
  //   - deleted   — the body was erased; threading children below
  //     a tombstone leaks the parent's deletion to readers
  //   - pending   — the parent itself is awaiting moderation; the
  //     reply would publish under content the site hasn't accepted
  //     yet (and would fire a `comment.reply` notification to an
  //     author whose own comment is still pending) — see #127
  const db = getDb();
  let parentAuthorId: string | null = null;
  if (input.parentId) {
    const [parent] = (await db
      .select({
        id: npComments.id,
        targetType: npComments.targetType,
        targetId: npComments.targetId,
        memberId: npComments.memberId,
        status: npComments.status,
      })
      .from(npComments)
      .where(eq(npComments.id, input.parentId))
      .limit(1)) as Array<{
      id: string;
      targetType: string;
      targetId: string;
      memberId: string;
      status: CommentStatus;
    }>;
    if (!parent) {
      throw new NpNotFoundError("comment", input.parentId);
    }
    if (parent.targetType !== input.targetType || parent.targetId !== input.targetId) {
      throw new NpValidationError("Invalid input", [
        { field: "parentId", message: "Parent comment belongs to a different document" },
      ]);
    }
    if (parent.status !== "visible") {
      throw new NpValidationError("Invalid input", [
        {
          field: "parentId",
          message: `Cannot reply to a comment with status '${parent.status}'`,
        },
      ]);
    }
    parentAuthorId = parent.memberId;
  }

  // Two adapters run in sequence: profanity (language-level) first,
  // then spam (intent-level). If profanity rejects we short-circuit
  // — no point billing the spam adapter's network call when the
  // content is already gone. Verdicts combine with the strongest-
  // wins rule: any reject → reject, any flag → pending, both pass
  // → visible.
  //
  // Adapter failures and malformed verdicts are isolated as `flag`:
  // the write remains available but cannot become public without
  // an operator seeing the runtime diagnostic.
  const ctx = {
    memberId: input.memberId,
    targetType: input.targetType,
    targetId: input.targetId,
    parentId: input.parentId ?? null,
  };
  const profanityVerdict = await runProfanityCheck(getProfanityAdapter(), input.bodyMd, ctx);
  if (profanityVerdict.kind === "reject") {
    throw new NpValidationError("Invalid input", [
      {
        field: "bodyMd",
        message: profanityVerdict.reason ?? "Comment contains prohibited language",
      },
    ]);
  }
  const spamVerdict = await runSpamCheck(getSpamAdapter(), input.bodyMd, ctx);
  if (spamVerdict.kind === "reject") {
    throw new NpValidationError("Invalid input", [
      {
        field: "bodyMd",
        message: spamVerdict.reason ?? "Comment was rejected by the site's spam filter",
      },
    ]);
  }
  const flaggedBy: Array<"profanity" | "spam"> = [];
  if (profanityVerdict.kind === "flag") flaggedBy.push("profanity");
  if (spamVerdict.kind === "flag") flaggedBy.push("spam");
  const initialStatus: CommentStatus = flaggedBy.length > 0 ? "pending" : "visible";

  const html = renderCommentMarkdown(input.bodyMd);
  // Phase 18 — derive site_id from the target document, which
  // already carries the canonical site (collections gained
  // `site_id` in Phase 15). Falls back to the request resolver
  // and finally to the default site so legacy single-tenant
  // tests / scripts (which don't seed a site_id on the target)
  // still produce a valid row.
  const targetSiteId =
    typeof targetDoc.siteId === "string" && targetDoc.siteId.length > 0
      ? targetDoc.siteId
      : ((await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID);
  const [row] = (await db
    .insert(npComments)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      parentId: input.parentId ?? null,
      memberId: input.memberId,
      bodyMd: input.bodyMd,
      bodyHtml: html,
      status: initialStatus,
      siteId: targetSiteId,
    })
    .returning()) as Array<NpCommentRow>;
  if (!row) throw new Error("Comment insert returned no row");
  const checkedRow = npRequireCommentRow(row);

  if (flaggedBy.length > 0) {
    // Surface flagged content in the audit log so mods can triage.
    // Recorded as a member-actor event so it threads with other
    // member-originated audit entries on the comment. The `sources`
    // array tells mods which adapter(s) flagged the row — useful
    // when a site runs both profanity and spam and wants to know
    // which signal to tune.
    await recordAuditEvent({
      actor: { kind: "member", memberId: input.memberId },
      action: "comment.flag",
      targetType: "comment",
      targetId: checkedRow.id,
      payload: {
        sources: flaggedBy,
        profanity:
          profanityVerdict.kind === "flag"
            ? {
                reason: profanityVerdict.reason ?? null,
                metadata: profanityVerdict.metadata ?? null,
              }
            : null,
        spam:
          spamVerdict.kind === "flag"
            ? {
                reason: spamVerdict.reason ?? null,
                metadata: spamVerdict.metadata ?? null,
              }
            : null,
      },
    });
  }

  // Reputation: only credit visible comments. Flagged content waits
  // for a mod restore — at that point the moderation surface can
  // decide whether to retroactively credit (not done in v1).
  if (initialStatus === "visible") {
    await applyReputation(input.memberId, {
      kind: "comment.created",
      commentId: checkedRow.id,
      memberId: input.memberId,
      targetType: input.targetType,
      targetId: input.targetId,
    });
  }

  if (initialStatus === "visible") {
    try {
      await notifyVisibleComment({
        row: checkedRow,
        targetDocument: targetDoc,
        parentAuthorId,
      });
    } catch (error) {
      // The comment is already durable. Notification delivery is a contained
      // side effect: preserve the successful write and make the failure
      // operator-visible instead of returning a misleading 500 to the author.
      npRecordCommunityRuntimeDiagnostic(
        "notifications",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return checkedRow;
}

async function notifyVisibleComment(input: {
  row: NpCommentRow;
  targetDocument: Record<string, unknown>;
  parentAuthorId: string | null;
}): Promise<void> {
  const { row, targetDocument, parentAuthorId } = input;
  const href = npResolveDocumentPublicHref(row.targetType, targetDocument);
  const commonPayload = {
    commentId: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    ...(href ? { href } : {}),
  };
  const alreadyNotified = new Set<string>([row.memberId]);

  // One event has a stable priority: direct reply, mention, document owner,
  // then general subscription. A recipient only receives the first matching
  // notification, preventing the reply+mention+subscription triple ping.
  if (parentAuthorId && parentAuthorId !== row.memberId) {
    await createNotification({
      memberId: parentAuthorId,
      kind: "comment.reply",
      actorMemberId: row.memberId,
      payload: { ...commonPayload, replyAuthorId: row.memberId },
    });
    alreadyNotified.add(parentAuthorId);
  }

  const mentionedMembers = await resolveMentionedMembers(extractMentionHandles(row.bodyMd));
  for (const member of mentionedMembers) {
    if (alreadyNotified.has(member.id)) continue;
    await createNotification({
      memberId: member.id,
      kind: "comment.mention",
      actorMemberId: row.memberId,
      payload: {
        ...commonPayload,
        mentionedMemberId: member.id,
        mentionedHandle: member.handle,
      },
    });
    alreadyNotified.add(member.id);
  }

  const ownerId =
    typeof targetDocument.memberAuthorId === "string" ? targetDocument.memberAuthorId : null;
  if (ownerId && !alreadyNotified.has(ownerId)) {
    await createNotification({
      memberId: ownerId,
      kind: "comment.received",
      actorMemberId: row.memberId,
      payload: commonPayload,
    });
    alreadyNotified.add(ownerId);
  }

  const config = getCollectionConfig(row.targetType);
  if (config.community?.follows === true && href) {
    await notifyFollowers({
      activity: "comment.created",
      subjectType: row.targetType,
      subjectId: row.targetId,
      targetType: row.targetType,
      targetId: row.targetId,
      commentId: row.id,
      href,
      actorMemberId: row.memberId,
      excludeMemberIds: [...alreadyNotified],
    });
  }
}

/**
 * Comment ordering options.
 *
 *   - `newest`  — created_at DESC (default; matches the
 *     surface a fresh thread should show)
 *   - `oldest`  — created_at ASC (chronological reads)
 *   - `top`     — reactions DESC, then created_at DESC as
 *     tiebreaker. Useful for high-traffic threads where the
 *     "best" comment should bubble up regardless of when
 *     it was posted.
 */
export async function listComments(
  targetType: string,
  targetId: string,
  options: NpCommentListOptions = {},
): Promise<NpCommentListResult> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const order = options.order ?? "newest";
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;

  // Phase 16.1 — apply viewer mute list as a NOT IN clause.
  // We resolve the muted ids once per call (single SELECT
  // bounded by the viewer's own mute list); for the typical
  // member with a handful of mutes the cost is trivial.
  // Empty mute list short-circuits — no NOT IN clause is
  // appended.
  const mutedAuthorIds: string[] = options.viewerMemberId
    ? Array.from(await getMutedTargetIds(options.viewerMemberId))
    : [];
  const muteFilter: SQL | undefined =
    mutedAuthorIds.length > 0 ? notInArray(npComments.memberId, mutedAuthorIds) : undefined;

  const baseWhere = options.includeHidden
    ? and(
        eq(npComments.siteId, siteId),
        eq(npComments.targetType, targetType),
        eq(npComments.targetId, targetId),
      )
    : and(
        eq(npComments.siteId, siteId),
        eq(npComments.targetType, targetType),
        eq(npComments.targetId, targetId),
        eq(npComments.status, "visible"),
      );

  const where = muteFilter ? and(baseWhere, muteFilter) : baseWhere;

  // `top` orders by reaction count via a correlated subquery,
  // then created_at DESC as a stable tiebreaker. The subquery
  // is bounded by the page size (limit 200 max), so the cost
  // stays linear in returned-row count rather than total
  // reactions across the table.
  const orderBy: SQL =
    order === "top"
      ? sql`(SELECT COUNT(*) FROM ${npReactions} WHERE ${npReactions.siteId} = ${siteId} AND ${npReactions.targetType} = 'comment' AND ${npReactions.targetId} = ${npComments.id}) DESC, ${npComments.createdAt} DESC`
      : order === "oldest"
        ? asc(npComments.createdAt)
        : desc(npComments.createdAt);

  // Phase 21.11 — LEFT JOIN against `np_members` so the response
  // carries the author's status (most callers want to render an
  // `(imported)` chip without a second round trip). The join is
  // bounded by `limit` (≤200), so the cost is the page-size lookup
  // rather than a table scan.
  // Rows and count must describe one snapshot. Without repeatable read, a
  // concurrent create/hide/delete between the two SELECTs can produce an
  // impossible exact window (for example one returned row with totalDocs=0).
  const window = await db.transaction(
    async (tx) => {
      const joinedRows = (await tx
        .select({
          comment: npComments,
          authorStatus: npMembers.status,
        })
        .from(npComments)
        .leftJoin(npMembers, eq(npComments.memberId, npMembers.id))
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset)) as Array<{
        comment: NpCommentRow;
        authorStatus: string | null;
      }>;
      const [totalRow] = (await tx
        .select({ total: count() })
        .from(npComments)
        .where(where)) as Array<{ total: number | string }>;
      return { joinedRows, totalDocs: Number(totalRow?.total ?? 0) };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const { joinedRows, totalDocs } = window;
  const rows = joinedRows.map(({ comment, authorStatus }) =>
    npRequireCommentRow({ ...comment, authorStatus }),
  );
  const comments = await enrichCommentListItems(rows, options.viewerMemberId);
  return {
    comments,
    totalDocs,
    limit,
    offset,
    hasNextPage: offset + rows.length < totalDocs,
    hasPrevPage: offset > 0 && totalDocs > 0,
  };
}

async function enrichCommentListItems(
  rows: NpCommentRow[],
  viewerMemberId?: string,
): Promise<NpCommentListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const siteId = rows[0]?.siteId ?? NP_DEFAULT_SITE_ID;
  const db = getDb();
  const [profiles, countRows, viewerRows] = await Promise.all([
    getMemberProfiles(
      rows.map((row) => row.memberId),
      { avatarVariant: "thumbnail" },
    ),
    db
      .select({ targetId: npReactions.targetId, kind: npReactions.kind, total: count() })
      .from(npReactions)
      .where(
        and(
          eq(npReactions.siteId, siteId),
          eq(npReactions.targetType, "comment"),
          inArray(npReactions.targetId, ids),
        ),
      )
      .groupBy(npReactions.targetId, npReactions.kind),
    viewerMemberId
      ? db
          .select({ targetId: npReactions.targetId, kind: npReactions.kind })
          .from(npReactions)
          .where(
            and(
              eq(npReactions.siteId, siteId),
              eq(npReactions.targetType, "comment"),
              inArray(npReactions.targetId, ids),
              eq(npReactions.memberId, viewerMemberId),
            ),
          )
      : Promise.resolve([]),
  ]);

  const reactions = new Map<string, NpReactionSummaryWire>();
  for (const id of ids) reactions.set(id, { counts: {}, mine: [] });
  for (const row of countRows) {
    const summary = reactions.get(row.targetId);
    if (summary) summary.counts[row.kind] = Number(row.total);
  }
  for (const row of viewerRows) {
    const summary = reactions.get(row.targetId);
    if (summary) summary.mine.push(row.kind);
  }

  return rows.map((row) => {
    const profile = profiles.get(row.memberId);
    return {
      ...row,
      author: profile
        ? {
            handle: profile.handle,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
          }
        : null,
      reactions: npRequireReactionSummaryWire(reactions.get(row.id) ?? { counts: {}, mine: [] }),
    };
  });
}

export async function updateComment(input: NpCommentUpdateInput): Promise<NpCommentRow> {
  validateBody(input.bodyMd);
  const db = getDb();
  const [existing] = (await db
    .select()
    .from(npComments)
    .where(eq(npComments.id, input.commentId))
    .limit(1)) as NpCommentRow[];
  if (!existing) throw new NpNotFoundError("comment", input.commentId);
  npRequireCommentRow(existing);

  // Reject edits to soft-deleted comments. `deleteComment` clears
  // `bodyMd`/`bodyHtml` to honor erasure expectations; allowing the
  // owner to edit-back content would defeat that and let moderation
  // views surface text the user expected to disappear. (#50)
  if (existing.status === "deleted") {
    throw new NpValidationError("Invalid state", [
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
    throw new NpForbiddenError("comment", "update");
  }

  // Re-run profanity → spam on the new body. Pre-fix `updateComment`
  // skipped moderation entirely, so a member could create a clean
  // visible comment then PATCH it to spam / banned language and
  // the row stayed visible. Mirrors the create-time gate (#123):
  //   - reject → 400, no write
  //   - flag   → status forced to `pending` so mods triage the edit
  //   - pass   → status untouched
  // Mods don't get an automatic bypass; if a moderator needs to
  // commit otherwise-banned text intentionally (rare), they can
  // staff-restore the row afterward.
  const ctx = {
    memberId: input.memberId,
    targetType: existing.targetType,
    targetId: existing.targetId,
    parentId: existing.parentId,
  };
  let profanityFlag: { reason: string | null; metadata: NpCommunityJsonObject | null } | null =
    null;
  const profanityVerdict = await runProfanityCheck(getProfanityAdapter(), input.bodyMd, ctx);
  if (profanityVerdict.kind === "reject") {
    throw new NpValidationError("Invalid input", [
      {
        field: "bodyMd",
        message: profanityVerdict.reason ?? "Comment contains prohibited language",
      },
    ]);
  }
  if (profanityVerdict.kind === "flag") {
    profanityFlag = {
      reason: profanityVerdict.reason ?? null,
      metadata: profanityVerdict.metadata ?? null,
    };
  }
  let spamFlag: { reason: string | null; metadata: NpCommunityJsonObject | null } | null = null;
  const spamVerdict = await runSpamCheck(getSpamAdapter(), input.bodyMd, ctx);
  if (spamVerdict.kind === "reject") {
    throw new NpValidationError("Invalid input", [
      {
        field: "bodyMd",
        message: spamVerdict.reason ?? "Comment was rejected by the site's spam filter",
      },
    ]);
  }
  if (spamVerdict.kind === "flag") {
    spamFlag = {
      reason: spamVerdict.reason ?? null,
      metadata: spamVerdict.metadata ?? null,
    };
  }
  const editFlaggedBy: Array<"profanity" | "spam"> = [];
  if (profanityFlag) editFlaggedBy.push("profanity");
  if (spamFlag) editFlaggedBy.push("spam");

  const html = renderCommentMarkdown(input.bodyMd);
  const updateValues: Record<string, unknown> = {
    bodyMd: input.bodyMd,
    bodyHtml: html,
    editedAt: new Date(),
  };
  if (editFlaggedBy.length > 0) {
    updateValues.status = "pending";
  }
  const [updated] = (await db
    .update(npComments)
    .set(updateValues)
    .where(eq(npComments.id, input.commentId))
    .returning()) as NpCommentRow[];
  if (!updated) throw new Error("Comment update returned no row");
  const checkedUpdated = npRequireCommentRow(updated);

  if (editFlaggedBy.length > 0) {
    await recordAuditEvent({
      actor: { kind: "member", memberId: input.memberId },
      action: "comment.flag",
      targetType: "comment",
      targetId: checkedUpdated.id,
      payload: {
        event: "update",
        sources: editFlaggedBy,
        profanity: profanityFlag,
        spam: spamFlag,
      },
    });
  }

  // Phase 16.2 — @mention fan-out on edit. Only newly-added handles
  // notify (delta vs the prior body), so retoggling a single
  // unrelated word doesn't re-notify the same recipients. Skipped
  // on edits that flipped the row to `pending` (spam/profanity gate
  // matches the create-time policy: don't notify on content the
  // public can't see yet).
  if (checkedUpdated.status === "visible") {
    const previousHandles = new Set(extractMentionHandles(existing.bodyMd));
    await fanOutMentionNotifications({
      actorMemberId: input.memberId,
      kind: "comment.mention",
      source: input.bodyMd,
      previousHandles,
      payload: {
        commentId: checkedUpdated.id,
        targetType: existing.targetType,
        targetId: existing.targetId,
      },
    });
  }
  return checkedUpdated;
}

export async function deleteComment(input: NpCommentDeleteInput): Promise<void> {
  const db = getDb();
  const [existing] = (await db
    .select()
    .from(npComments)
    .where(eq(npComments.id, input.commentId))
    .limit(1)) as NpCommentRow[];
  if (!existing) throw new NpNotFoundError("comment", input.commentId);
  npRequireCommentRow(existing);

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
    throw new NpForbiddenError("comment", "delete");
  }

  // Soft-delete: keep the row so reply chains stay intact and audit
  // can resolve "who said what" later. Body fields are blanked so the
  // text is actually gone from the read path.
  await db
    .update(npComments)
    .set({ status: "deleted", bodyMd: "", bodyHtml: "", editedAt: new Date() })
    .where(eq(npComments.id, input.commentId));
}

export async function hideComment(input: NpCommentHideInput): Promise<void> {
  const db = getDb();
  const [existing] = (await db
    .select()
    .from(npComments)
    .where(eq(npComments.id, input.commentId))
    .limit(1)) as NpCommentRow[];
  if (!existing) throw new NpNotFoundError("comment", input.commentId);
  npRequireCommentRow(existing);

  const ok = await memberCan(input.memberId, "hide-comment", {
    type: "comment",
    id: existing.id,
    ownerId: existing.memberId,
    scopes: commentScopes(existing),
  });
  if (!ok) throw new NpForbiddenError("comment", "hide");

  await db
    .update(npComments)
    .set({
      status: "hidden",
      hiddenByMemberId: input.memberId,
      hiddenReason: input.reason ?? null,
    })
    .where(eq(npComments.id, input.commentId));

  await recordAuditEvent({
    actor: { kind: "member", memberId: input.memberId },
    action: "comment.hide",
    targetType: "comment",
    targetId: existing.id,
    payload: { reason: input.reason ?? null, collection: existing.targetType },
  });
}

export async function restoreComment(input: NpCommentRestoreInput): Promise<void> {
  const db = getDb();
  const [existing] = (await db
    .select()
    .from(npComments)
    .where(eq(npComments.id, input.commentId))
    .limit(1)) as NpCommentRow[];
  if (!existing) throw new NpNotFoundError("comment", input.commentId);
  npRequireCommentRow(existing);
  if (existing.status !== "hidden") {
    throw new NpValidationError("Invalid state", [
      { field: "status", message: `Comment is "${existing.status}", not "hidden"` },
    ]);
  }

  const ok = await memberCan(input.memberId, "restore-comment", {
    type: "comment",
    id: existing.id,
    ownerId: existing.memberId,
    scopes: commentScopes(existing),
  });
  if (!ok) throw new NpForbiddenError("comment", "restore");

  await db
    .update(npComments)
    .set({
      status: "visible",
      hiddenByUserId: null,
      hiddenByMemberId: null,
      hiddenReason: null,
    })
    .where(eq(npComments.id, input.commentId));

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
/**
 * Issue #364 — staff comment moderation was id-only. The list / read
 * paths were already site-scoped, but a staff user with the global
 * `community.moderate` capability and a foreign comment id could
 * hide / restore / delete content in another tenant. The loader now
 * pins the loaded row's `siteId` against the request site; callers
 * include `siteId` in their update predicate so the read-check and
 * the write cannot drift apart.
 */
async function loadCommentForStaffOp(commentId: string): Promise<{
  row: NpCommentRow;
  siteId: string;
}> {
  const db = getDb();
  const [existing] = (await db
    .select()
    .from(npComments)
    .where(eq(npComments.id, commentId))
    .limit(1)) as NpCommentRow[];
  if (!existing) throw new NpNotFoundError("comment", commentId);
  const checkedExisting = npRequireCommentRow(existing);
  const requestSiteId = await requireSiteId();
  if (checkedExisting.siteId !== requestSiteId) {
    throw new NpForbiddenError("comment", "cross-site");
  }
  return { row: checkedExisting, siteId: requestSiteId };
}

export async function staffHideComment(
  commentId: string,
  staffUserId: string,
  reason?: string | null,
): Promise<void> {
  const { row: existing, siteId } = await loadCommentForStaffOp(commentId);
  if (existing.status === "hidden") return;
  if (existing.status !== "visible" && existing.status !== "pending") {
    throw new NpValidationError("Invalid state", [
      {
        field: "status",
        message: `Comment is "${existing.status}" and cannot be hidden`,
      },
    ]);
  }
  const db = getDb();
  const [updated] = await db
    .update(npComments)
    .set({
      status: "hidden",
      hiddenByUserId: staffUserId,
      hiddenByMemberId: null,
      hiddenReason: reason ?? null,
    })
    .where(
      and(
        eq(npComments.id, commentId),
        eq(npComments.siteId, siteId),
        eq(npComments.status, existing.status),
      ),
    )
    .returning({ id: npComments.id });
  if (!updated) {
    const { row: current } = await loadCommentForStaffOp(commentId);
    if (current.status === "hidden") return;
    throw new NpValidationError("Invalid state", [
      { field: "status", message: "Comment status changed concurrently" },
    ]);
  }
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

export async function staffRestoreComment(commentId: string, staffUserId: string): Promise<void> {
  const { row: existing, siteId } = await loadCommentForStaffOp(commentId);
  // A "deleted" comment had its body wiped — flipping it back to visible
  // would surface a ghost row (author + timestamp intact, body empty).
  // Only `hidden` is reversible; member-side `restoreComment` enforces
  // the same invariant.
  if (existing.status !== "hidden") {
    throw new NpValidationError("Invalid state", [
      {
        field: "status",
        message: `Comment is "${existing.status}", not "hidden"`,
      },
    ]);
  }
  const db = getDb();
  await db
    .update(npComments)
    .set({
      status: "visible",
      hiddenByUserId: null,
      hiddenByMemberId: null,
      hiddenReason: null,
    })
    .where(and(eq(npComments.id, commentId), eq(npComments.siteId, siteId)));
  await recordAuditEvent({
    actor: { kind: "staff", userId: staffUserId },
    action: "comment.restore",
    targetType: "comment",
    targetId: commentId,
    payload: { byStaff: true },
  });
}

export async function staffDeleteComment(commentId: string, staffUserId: string): Promise<void> {
  const { row: existing, siteId } = await loadCommentForStaffOp(commentId);
  const db = getDb();
  await db
    .update(npComments)
    .set({ status: "deleted", bodyMd: "", bodyHtml: "" })
    .where(and(eq(npComments.id, commentId), eq(npComments.siteId, siteId)));
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
