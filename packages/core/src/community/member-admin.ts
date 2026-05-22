import { and, eq, isNull, ne } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import {
  deleteDocument,
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
  getDb,
} from "../collections/index.js";
import type { NpAuthUser } from "../config/types.js";
import { NpNotFoundError } from "../errors.js";
import { deleteMedia } from "../media/service.js";
import { npComments, npMembers } from "../db/schema/community.js";
import { npMedia } from "../db/schema/media.js";

import { recordAuditEvent } from "./audit.js";
import { staffDeleteComment } from "./comments.js";

/**
 * Aggregate result of a member content purge. Comments are
 * counted as deleted regardless of soft-vs-hard semantic (the
 * underlying `staffDeleteComment` is a soft delete that wipes the
 * body). Documents are reported per-collection because the staff
 * UI typically wants to call out "X discussions, Y posts" rather
 * than a flat total. Media has a `skipped` bucket because
 * `deleteMedia` refuses rows that are still referenced from a
 * doc (`np_media_refs`) — those need to be unlinked first; the
 * mod can re-run after the reference is gone.
 */
export interface NpMemberPurgeResult {
  comments: number;
  documents: Record<string, number>;
  media: { deleted: number; skipped: number };
}

/**
 * Wipes everything a single member authored: comments, top-level
 * docs in any collection that opted into `community.memberWrite`,
 * and uploaded media. Used by the moderation tooling to clean up
 * after a spam wave or a banned account.
 *
 * Failure mode is idempotent rather than atomic — if a transient
 * error interrupts the purge mid-way, the operator re-runs and
 * the helper skips items already removed (it always re-queries
 * the live state before each loop). The aggregate audit event
 * records the actual counts performed, not the intent.
 *
 * Out of scope (deliberately): banning, identity revocation,
 * follower / following links, reputation reset. Each of those is
 * a separate moderation action with its own UI; bundling them
 * into a single "purge" hides intent.
 */
export async function purgeMemberContent(
  memberId: string,
  staffUser: NpAuthUser,
): Promise<NpMemberPurgeResult> {
  // Refuse to act on a member that doesn't exist — saves the
  // operator a confusing zero-count response when the id is a
  // typo. Mirrors the 404 surface from the identities-admin
  // helpers.
  const db = getDb();
  const [memberRow] = (await db
    .select({ id: npMembers.id })
    .from(npMembers)
    .where(eq(npMembers.id, memberId))
    .limit(1)) as Array<{ id: string }>;
  if (!memberRow) {
    throw new NpNotFoundError("member", memberId);
  }

  // 1. Comments. Filter out already-deleted rows so re-running
  //    the purge after a partial failure doesn't re-fire delete
  //    events on tombstones.
  const liveComments = (await db
    .select({ id: npComments.id })
    .from(npComments)
    .where(
      and(eq(npComments.memberId, memberId), ne(npComments.status, "deleted")),
    )) as Array<{ id: string }>;
  let commentsDeleted = 0;
  for (const row of liveComments) {
    try {
      await staffDeleteComment(row.id, staffUser.id);
      commentsDeleted += 1;
    } catch (err) {
      if (err instanceof NpNotFoundError) continue;
      throw err;
    }
  }

  // 2. Member-authored docs in member-write collections. Iterate
  //    every collection that opted in via `community.memberWrite.create`
  //    so the call is automatically wired to whatever set of
  //    collections a site has registered (no hardcoded "discussions").
  const documents: Record<string, number> = {};
  for (const slug of getAllCollectionSlugs()) {
    let config;
    try {
      config = getCollectionConfig(slug);
    } catch {
      continue;
    }
    if (!config.community?.memberWrite?.create) continue;

    const table = getCollectionTable(slug) as PgTable;
    const memberAuthorCol = (table as unknown as Record<string, unknown>)
      .memberAuthorId;
    const idCol = (table as unknown as Record<string, unknown>).id;
    if (!memberAuthorCol || !idCol) continue;

    const rows = (await db
      .select({ id: idCol as never })
      .from(table)
      .where(eq(memberAuthorCol as never, memberId))) as Array<{ id: string }>;

    let perCollection = 0;
    for (const row of rows) {
      try {
        await deleteDocument(slug, row.id, staffUser);
        perCollection += 1;
      } catch (err) {
        if (err instanceof NpNotFoundError) continue;
        throw err;
      }
    }
    if (perCollection > 0) documents[slug] = perCollection;
  }

  // 3. Media. `deleteMedia` does its own reference check —
  //    rows referenced from `np_media_refs` (still embedded in
  //    a doc body, etc.) come back with `deleted: false` and
  //    `references` populated. Count those separately so the
  //    operator knows manual cleanup is still needed.
  const mediaDb = getDb();
  const liveMedia = (await mediaDb
    .select({ id: npMedia.id })
    .from(npMedia)
    .where(
      and(eq(npMedia.uploadedByMemberId, memberId), isNull(npMedia.deletedAt)),
    )) as Array<{ id: string }>;
  let mediaDeleted = 0;
  let mediaSkipped = 0;
  for (const row of liveMedia) {
    const result = await deleteMedia(row.id);
    if (result.deleted) mediaDeleted += 1;
    else mediaSkipped += 1;
  }

  // 4. Aggregate audit row. Each staff-delete already wrote its
  //    own per-target audit event (`comment.delete`,
  //    `content:afterDelete`, etc.); this one summarizes the
  //    operator's intent so the audit log shows a single
  //    `member.content.purge` row alongside the grain-level
  //    individual events.
  await recordAuditEvent({
    actor: { kind: "staff", userId: staffUser.id },
    action: "member.content.purge",
    targetType: "member",
    targetId: memberId,
    payload: {
      comments: commentsDeleted,
      documents,
      media: { deleted: mediaDeleted, skipped: mediaSkipped },
    },
  });

  return {
    comments: commentsDeleted,
    documents,
    media: { deleted: mediaDeleted, skipped: mediaSkipped },
  };
}
