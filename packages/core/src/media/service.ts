import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { Readable } from "node:stream";

import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";

import type { NpFindResult } from "../config/types.js";
import { readEnvPositiveInt } from "../config/env.js";
import { npMembers } from "../db/schema/community.js";
import { npMedia, npMediaFolders, npMediaRefs } from "../db/schema/media.js";
import { npUsers } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import { enqueueJob } from "../jobs/queue.js";
import { getLogger } from "../observability/logger.js";
import { getDb } from "../db/runtime.js";
import {
  npAssertMediaRecord,
  npValidateMediaProcessingOptions,
  npValidateMediaVariants,
} from "../media-contract/contract.js";
import type {
  NpMediaListItem,
  NpMediaProcessingOptions,
  NpMediaRecord,
  NpMediaStatus,
  NpMediaUploaderSummary,
  NpMediaVariants,
} from "../media-contract/types.js";
import { DEFAULT_IMAGE_SIZES, processImage, type NpProcessedImageResult } from "./processor.js";
import {
  npDeleteStorageObject,
  npGetStorageObjectStream,
  npUploadStorageObject,
} from "../storage/operations.js";
import { getStorageAdapter } from "../storage/registry.js";
import type { NpStorageAdapter } from "../storage/types.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/id-contract.js";

/**
 * Trailing-window for member upload quotas (`perDay` in
 * `npMemberUploadQuota`). Default 24h matches the historical
 * "daily quota" semantics; override via
 * `NP_MEMBER_QUOTA_WINDOW_HOURS` to shift to weekly or hourly
 * caps without touching code.
 */
const MEMBER_QUOTA_WINDOW_MS =
  readEnvPositiveInt("NP_MEMBER_QUOTA_WINDOW_HOURS", 24) * 60 * 60 * 1000;

interface SelectQuery extends Promise<unknown[]> {
  where(condition: ReturnType<typeof and> | ReturnType<typeof isNull>): SelectQuery;
  orderBy(order: ReturnType<typeof desc>): SelectQuery;
  limit(limit: number): SelectQuery;
  offset(offset: number): SelectQuery;
  for(strength: "update"): SelectQuery;
}

interface InsertValuesQuery extends Promise<unknown> {
  returning(): Promise<unknown[]>;
}

interface DrizzleDatabaseLike {
  insert(table: PgTable): {
    values(values: Record<string, unknown> | Record<string, unknown>[]): InsertValuesQuery;
  };
  update(table: PgTable): {
    set(values: Record<string, unknown>): {
      where(condition: ReturnType<typeof and> | ReturnType<typeof eq>): {
        returning(): Promise<unknown[]>;
      };
    };
  };
  delete(table: PgTable): {
    where(condition: ReturnType<typeof inArray>): Promise<unknown>;
  };
  select(selection?: Record<string, unknown>): {
    from(table: PgTable): SelectQuery;
  };
  transaction<T>(callback: (tx: DrizzleDatabaseLike) => Promise<T>): Promise<T>;
}

export { getStorageAdapter } from "../storage/registry.js";

/**
 * Polymorphic uploader: a row on `np_media` is owned by exactly
 * one of staff (`uploadedBy` → `np_users.id`) or member
 * (`uploadedByMemberId` → `np_members.id`, Phase 9.7j). Pass a
 * `null` value as the second argument to `uploadMedia` for plugin /
 * system uploads with no human owner — both columns stay null and
 * the audit log carries the actor.
 */
export type NpMediaUploader =
  { kind: "staff"; userId: string } | { kind: "member"; memberId: string } | null;

export async function uploadMedia(
  file: { buffer: Buffer; originalFilename: string; mimeType: string },
  uploader: NpMediaUploader | string,
  folderId?: string,
): Promise<{ id: string; status: NpMediaStatus }> {
  // Backwards-compat: the original signature was
  // `uploadMedia(file, userId: string | null, folderId?)`. Existing
  // callers (plugin context, admin bulk uploads, etc.) pass a bare
  // string. Coerce that into the staff variant of the polymorphic
  // shape so the rest of this function only deals with the union.
  const resolvedUploader: NpMediaUploader =
    typeof uploader === "string" ? { kind: "staff", userId: uploader } : uploader;
  const siteId = await requireSiteId();

  const id = randomUUID();
  const isProcessableImage = file.mimeType.startsWith("image/");
  const status: NpMediaStatus = isProcessableImage ? "processing" : "ready";
  const extension = resolveFileExtension(file.originalFilename, file.mimeType);
  const storageKey = `media/${siteId}/${id}/original.${extension}`;
  const now = new Date();
  const insertValues = {
    id,
    siteId,
    filename: file.originalFilename,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    filesize: file.buffer.byteLength,
    width: null,
    height: null,
    alt: null,
    caption: null,
    focalPoint: null,
    sizes: null,
    storageKey,
    hash: createHash("sha256").update(file.buffer).digest("hex"),
    status,
    folderId: folderId ?? null,
    uploadedBy:
      resolvedUploader && resolvedUploader.kind === "staff" ? resolvedUploader.userId : null,
    uploadedByMemberId:
      resolvedUploader && resolvedUploader.kind === "member" ? resolvedUploader.memberId : null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  npAssertMediaRecord(insertValues);

  // Phase 9.7p: per-member upload quota. Staff uploads are never
  // gated. Phase 9.7p-followup (#120) — the count + insert must be
  // atomic per member, otherwise concurrent uploads can both
  // observe the same pre-insert count and both succeed past the
  // cap. Wrap the gated branch in a transaction holding a Postgres
  // advisory lock keyed on the member id; cross-member uploaders
  // don't contend (different lock keys), same-member concurrent
  // uploaders serialize and the second one sees the updated
  // count.
  //
  // Storage upload happens AFTER the DB row commits so the quota
  // count is correct before bytes touch storage. If the upload
  // fails (#138 follow-up), we hard-delete the just-inserted row
  // so it stops counting against quota and doesn't strand the
  // member with a permanent ghost. We do NOT just mark the row
  // `error` here — there's no storage object to inspect, no
  // processor will arrive (the job hasn't been enqueued yet),
  // and the quota count filters by `deletedAt IS NULL`, not
  // `status`. Hard delete is the right semantic.
  if (resolvedUploader && resolvedUploader.kind === "member") {
    const memberId = resolvedUploader.memberId;
    const dbPg = getDb();
    await dbPg.transaction(async (tx) => {
      // `pg_advisory_xact_lock` auto-releases on commit/rollback.
      // `hashtextextended` produces a stable int8 from a UUID
      // string — including the site keeps one member's independent
      // tenant quotas from contending. Hash collisions are
      // benign (worst case some unrelated members serialize).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${siteId}:${memberId}`}, 0))`,
      );
      await assertMediaFolderSite(folderId, siteId, tx as unknown as DrizzleDatabaseLike);
      await assertMemberUploadQuota(memberId, siteId, tx);
      await tx.insert(npMedia).values(insertValues);
    });
  } else {
    const db = getDb() as unknown as DrizzleDatabaseLike;
    await assertMediaFolderSite(folderId, siteId, db);
    await db.insert(npMedia).values(insertValues);
  }

  const adapter = getStorageAdapter();
  try {
    await npUploadStorageObject(adapter, storageKey, file.buffer, {
      contentType: file.mimeType,
      contentLength: file.buffer.byteLength,
      originalFilename: file.originalFilename,
    });
  } catch (err) {
    // Storage failed after the DB row committed. Roll the row
    // back so it doesn't (a) eat the member's quota allowance
    // for nothing, (b) confuse operators with a permanent
    // `processing` row that never gets a job. Cleanup is
    // best-effort — if the delete itself fails we still surface
    // the original storage error to the caller, since that's
    // what they need to act on.
    try {
      const cleanupDb = getDb() as unknown as DrizzleDatabaseLike;
      await cleanupDb
        .delete(npMedia)
        .where(and(eq(npMedia.id, id), eq(npMedia.siteId, siteId)) as never);
    } catch (cleanupErr) {
      // Swallow so the original storage error reaches the
      // caller — that's what they need to act on. But don't go
      // silent: a failed cleanup leaves a permanent ghost row
      // in `processing` that eats the member's quota with no
      // storage object to inspect and no job ever enqueued.
      // Operators need a signal to find and remediate it.
      getLogger().error("media upload cleanup failed", {
        mediaId: id,
        storageKey,
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
    throw err;
  }

  if (isProcessableImage) {
    await enqueueJob("media:processImage", { siteId, mediaId: id });
  }

  return { id, status };
}

/**
 * Throws `NpRateLimitError` (429) if the member is at or over
 * their per-day or lifetime upload cap. Both bounds count
 * non-deleted rows, so admin / member deletes free up quota the
 * same way (mirrors the 9.7l purge semantic). When both bounds
 * are `null` (the default), this function is a no-op aside from
 * a single settings read.
 *
 * Defer-loaded `getCommunitySettings` to avoid an import cycle
 * with `community/settings.ts` — that module reads `getDb()`,
 * which is wired by the same bootstrap that wires the media DB,
 * so they sit on the same module layer; deferring keeps a clean
 * one-way edge from media → community for this single call site.
 */
async function assertMemberUploadQuota(
  memberId: string,
  siteId: string,
  txDb?: NodePgDatabase<Record<string, unknown>>,
): Promise<void> {
  const { getCommunitySettings } = await import("../community/settings.js");
  const { NpRateLimitError } = await import("../errors.js");
  const settings = await getCommunitySettings();
  const { perDay, total } = settings.memberUploadQuota;
  if (perDay === null && total === null) return;

  // When invoked inside the upload transaction (#120 fix), the
  // count + downstream insert run under the same advisory lock,
  // so the count must use the tx handle to see writes by sibling
  // statements. When called from elsewhere we fall back to the
  // shared media DB.
  const db = txDb ?? getDb();

  if (total !== null) {
    const [row] = (await db
      .select({ value: count() })
      .from(npMedia)
      .where(
        and(
          eq(npMedia.siteId, siteId),
          eq(npMedia.uploadedByMemberId, memberId),
          isNull(npMedia.deletedAt),
        ),
      )) as Array<{
      value: number;
    }>;
    const used = row?.value ?? 0;
    if (used >= total) {
      throw new NpRateLimitError(
        `Upload quota exceeded — this account has reached its lifetime cap of ${total} uploads.`,
      );
    }
  }

  if (perDay !== null) {
    const since = new Date(Date.now() - MEMBER_QUOTA_WINDOW_MS);
    const [row] = (await db
      .select({ value: count() })
      .from(npMedia)
      .where(
        and(
          eq(npMedia.siteId, siteId),
          eq(npMedia.uploadedByMemberId, memberId),
          isNull(npMedia.deletedAt),
          gte(npMedia.createdAt, since),
        ),
      )) as Array<{ value: number }>;
    const recent = row?.value ?? 0;
    if (recent >= perDay) {
      throw new NpRateLimitError(
        `Upload rate limit exceeded — try again later (max ${perDay} uploads per 24 hours).`,
      );
    }
  }
}

export async function processMediaImage(
  mediaId: string,
  config: NpMediaProcessingOptions,
): Promise<void> {
  const siteId = await requireSiteId();
  const configValidation = npValidateMediaProcessingOptions(config);
  if (!configValidation.ok) {
    throw new Error(
      `Invalid media processing options at ${configValidation.issue.path}: ${configValidation.issue.message}`,
    );
  }
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const adapter = getStorageAdapter();
  const media = await getMediaRecordById(mediaId, siteId);

  if (!media) {
    throw new Error(`Media '${mediaId}' not found.`);
  }

  try {
    const originalStream = await npGetStorageObjectStream(adapter, media.storageKey);
    const originalBuffer = await consumeBuffer(Readable.fromWeb(originalStream));
    const processed = await processImage(originalBuffer, config.sizes ?? DEFAULT_IMAGE_SIZES, {
      format: config.format,
      quality: config.quality,
    });
    const format = config.format ?? "webp";
    const mimeType = getFormatMimeType(format);
    const sizes = await uploadImageVariants(adapter, siteId, media.id, processed, format, mimeType);
    const sizesValidation = npValidateMediaVariants(sizes);
    if (!sizesValidation.ok) {
      throw new Error(
        `Invalid processed media variants at ${sizesValidation.issue.path}: ${sizesValidation.issue.message}`,
      );
    }

    await db
      .update(npMedia)
      .set({
        sizes,
        width: processed.source.width,
        height: processed.source.height,
        status: "ready",
        updatedAt: new Date(),
      })
      .where(and(eq(npMedia.id, media.id), eq(npMedia.siteId, siteId)))
      .returning();
  } catch (error) {
    await db
      .update(npMedia)
      .set({
        status: "error",
        updatedAt: new Date(),
      })
      .where(and(eq(npMedia.id, media.id), eq(npMedia.siteId, siteId)))
      .returning();

    throw error;
  }
}

export async function getMediaById(id: string): Promise<NpMediaRecord | null> {
  const siteId = await resolveMediaReadSiteId();
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const [media] = await db
    .select()
    .from(npMedia)
    .where(and(eq(npMedia.siteId, siteId), eq(npMedia.id, id), isNull(npMedia.deletedAt)))
    .limit(1);

  return media ? toMediaRecord(media) : null;
}

export async function deleteMedia(
  id: string,
): Promise<{ deleted: boolean; references?: unknown[] }> {
  const siteId = await requireSiteId();
  const db = getDb() as unknown as DrizzleDatabaseLike;
  return db.transaction(async (tx) => {
    // Reference writers lock the same media row before inserting np_media_refs.
    // Taking the lock first makes the zero-ref check and soft-delete atomic
    // with respect to a concurrent document save.
    const [media] = await tx
      .select()
      .from(npMedia)
      .where(and(eq(npMedia.siteId, siteId), eq(npMedia.id, id), isNull(npMedia.deletedAt)))
      .limit(1)
      .for("update");

    if (!media) {
      return { deleted: false };
    }

    const references = await tx.select().from(npMediaRefs).where(eq(npMediaRefs.mediaId, id));
    const staffAvatars = (await tx
      .select({ id: npUsers.id })
      .from(npUsers)
      .where(eq(npUsers.avatar, id))) as Array<{ id: string }>;
    const memberAvatars = (await tx
      .select({ id: npMembers.id })
      .from(npMembers)
      .where(eq(npMembers.avatar, id))) as Array<{ id: string }>;
    const activeUses = [
      ...references,
      ...staffAvatars.map((row) => ({ kind: "staff-avatar", userId: row.id })),
      ...memberAvatars.map((row) => ({ kind: "member-avatar", memberId: row.id })),
    ];
    if (activeUses.length > 0) {
      return { deleted: false, references: activeUses };
    }

    await tx
      .update(npMedia)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(npMedia.siteId, siteId), eq(npMedia.id, id)))
      .returning();

    return { deleted: true };
  });
}

/**
 * Phase 9.7k uploader filters. `uploaderKind` partitions the
 * library into staff-uploaded rows (`uploaded_by IS NOT NULL`) vs
 * member-uploaded rows (`uploaded_by_member_id IS NOT NULL`) — the
 * two columns are mutually exclusive on every row written through
 * `uploadMedia`. `uploadedByMemberId` narrows to a specific member
 * for "show me everything @handle uploaded" investigations after a
 * spam wave.
 */
export type NpMediaUploaderKindFilter = "staff" | "member";

export async function listMedia(options: {
  page?: number;
  limit?: number;
  folderId?: string;
  mimeType?: string;
  uploaderKind?: NpMediaUploaderKindFilter;
  uploadedByMemberId?: string;
  /**
   * Substring match against `filename` and `alt`. Matches
   * server-side via `ILIKE`, so the page-builder block-image
   * picker can search the whole library without paging through
   * every result client-side. Empty / whitespace-only `q` is
   * treated as no filter.
   */
  q?: string;
}): Promise<NpFindResult<NpMediaListItem>> {
  const siteId = await resolveMediaReadSiteId();
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);
  const offset = (page - 1) * limit;
  const conditions = [eq(npMedia.siteId, siteId), isNull(npMedia.deletedAt)];

  if (options.folderId) {
    conditions.push(eq(npMedia.folderId, options.folderId));
  }

  if (options.mimeType) {
    conditions.push(eq(npMedia.mimeType, options.mimeType));
  }

  if (options.uploaderKind === "staff") {
    conditions.push(isNotNull(npMedia.uploadedBy));
  } else if (options.uploaderKind === "member") {
    conditions.push(isNotNull(npMedia.uploadedByMemberId));
  }

  if (options.uploadedByMemberId) {
    conditions.push(eq(npMedia.uploadedByMemberId, options.uploadedByMemberId));
  }

  // Substring search across filename + alt. We match `ILIKE
  // %q%` against both columns and OR them so the picker's
  // search box hits filenames the operator remembers and alt
  // text they wrote. SQL escapes the literal `%` / `_` chars
  // by doubling them so a filename containing them isn't
  // treated as a wildcard.
  if (options.q && options.q.trim().length > 0) {
    const needle = `%${options.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const search = or(ilike(npMedia.filename, needle), ilike(npMedia.alt, needle));
    if (search) conditions.push(search);
  }

  const whereClause = combineConditions(conditions);
  // The local `DrizzleDatabaseLike` interface in this file is
  // narrow on purpose (only `select/insert/update/delete`); a
  // proper leftJoin chain would require typing the full Drizzle
  // builder pipeline. Cast through `unknown` for this query —
  // safer than widening the interface and dragging join semantics
  // into every other media call site.
  const joined = (
    db as unknown as {
      select: (s: Record<string, unknown>) => {
        from: (t: PgTable) => {
          leftJoin: (
            j: PgTable,
            c: unknown,
          ) => {
            leftJoin: (
              j: PgTable,
              c: unknown,
            ) => {
              where: (c: unknown) => {
                orderBy: (o: unknown) => {
                  limit: (n: number) => {
                    offset: (n: number) => Promise<Array<Record<string, unknown>>>;
                  };
                };
              };
            };
          };
        };
      };
    }
  )
    .select({
      media: npMedia,
      userName: npUsers.name,
      userEmail: npUsers.email,
      memberHandle: npMembers.handle,
      memberDisplayName: npMembers.displayName,
    })
    .from(npMedia)
    .leftJoin(npUsers, eq(npMedia.uploadedBy, npUsers.id))
    .leftJoin(npMembers, eq(npMedia.uploadedByMemberId, npMembers.id))
    .where(whereClause)
    .orderBy(desc(npMedia.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = (await joined) as Array<{
    media: Record<string, unknown>;
    userName: string | null;
    userEmail: string | null;
    memberHandle: string | null;
    memberDisplayName: string | null;
  }>;
  const [{ total }] = (
    whereClause
      ? await db.select({ total: count() }).from(npMedia).where(whereClause)
      : await db.select({ total: count() }).from(npMedia)
  ) as Array<{ total: number | string }>;
  const totalDocs = Number(total ?? 0);
  const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);

  // Flatten the JOIN result so each doc carries an `uploader`
  // sub-object alongside the standard media columns. Keeps the
  // shape backwards-compatible (the existing media columns are
  // still at the top level).
  const docs = rows.map((row): NpMediaListItem => ({
    ...toMediaRecord(row.media),
    uploader: resolveUploaderSummary(row),
  }));

  return {
    docs: docs,
    totalDocs,
    totalPages,
    page,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1 && totalDocs > 0,
  };
}

export async function cleanupDeletedMedia(olderThanDays: number): Promise<number> {
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const adapter = getStorageAdapter();
  const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(npMedia)
    .where(and(isNotNull(npMedia.deletedAt), lt(npMedia.deletedAt, threshold)));
  const mediaRows = rows.map(toMediaRecord);

  if (mediaRows.length === 0) {
    return 0;
  }

  const deletedIds: string[] = [];
  for (const media of mediaRows) {
    const keys = new Set<string>([media.storageKey, ...extractVariantStorageKeys(media.sizes)]);
    let storageDeleteFailed = false;

    for (const key of keys) {
      try {
        await npDeleteStorageObject(adapter, key);
      } catch (error) {
        storageDeleteFailed = true;
        getLogger().warn("media cleanup storage delete failed", {
          mediaId: media.id,
          siteId: media.siteId,
          storageKey: key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Keep the tombstone when any object failed so a later cleanup run can
    // retry. Storage adapters treat an already-absent key as success, making
    // partial progress safe across retries.
    if (!storageDeleteFailed) deletedIds.push(media.id);
  }

  if (deletedIds.length === 0) return 0;

  await db.delete(npMedia).where(inArray(npMedia.id, deletedIds));

  return deletedIds.length;
}

async function getMediaRecordById(id: string, siteId: string): Promise<NpMediaRecord | null> {
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const [media] = await db
    .select()
    .from(npMedia)
    .where(and(eq(npMedia.siteId, siteId), eq(npMedia.id, id), isNull(npMedia.deletedAt)))
    .limit(1);

  return media ? toMediaRecord(media) : null;
}

async function uploadImageVariants(
  adapter: NpStorageAdapter,
  siteId: string,
  mediaId: string,
  processed: NpProcessedImageResult,
  format: string,
  mimeType: string,
): Promise<NpMediaVariants> {
  const entries = await Promise.all(
    processed.variants.map(async (variant) => {
      const filename = `${variant.name}.${format}`;
      const storageKey = `media/${siteId}/${mediaId}/${filename}`;

      await npUploadStorageObject(adapter, storageKey, variant.buffer, {
        contentType: mimeType,
        contentLength: variant.size,
        originalFilename: filename,
      });

      return [
        variant.name,
        {
          filename,
          mimeType,
          filesize: variant.size,
          width: variant.width,
          height: variant.height,
          storageKey,
        },
      ] as const;
    }),
  );

  return Object.fromEntries(entries);
}

async function resolveMediaReadSiteId(): Promise<string> {
  return (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
}

async function assertMediaFolderSite(
  folderId: string | undefined,
  siteId: string,
  db: DrizzleDatabaseLike,
): Promise<void> {
  if (!folderId) return;
  const [folder] = await db
    .select({ id: npMediaFolders.id })
    .from(npMediaFolders)
    .where(and(eq(npMediaFolders.siteId, siteId), eq(npMediaFolders.id, folderId)))
    .limit(1);
  if (!folder) {
    throw new NpValidationError("Invalid media folder", [
      { field: "folderId", message: "Folder must exist on the current site." },
    ]);
  }
}

function extractVariantStorageKeys(sizes: NpMediaVariants | null): string[] {
  if (!sizes) {
    return [];
  }

  return Object.values(sizes)
    .map((size) => size.storageKey)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function resolveFileExtension(originalFilename: string, mimeType: string): string {
  const extension = extname(originalFilename).slice(1).toLowerCase();

  if (/^[a-z0-9]{1,16}$/u.test(extension)) {
    return extension;
  }

  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    case "image/gif":
      return "gif";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

function getFormatMimeType(format: string): string {
  switch (format) {
    case "avif":
      return "image/avif";
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
    default:
      return "image/webp";
  }
}

function combineConditions(
  conditions: Array<ReturnType<typeof and> | ReturnType<typeof isNull>>,
): ReturnType<typeof and> | ReturnType<typeof isNull> | undefined {
  if (conditions.length === 0) {
    return undefined;
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return and(...conditions);
}

function normalizePage(page?: number): number {
  if (!page || page < 1) {
    return 1;
  }

  return Math.floor(page);
}

function normalizeLimit(limit?: number): number {
  if (!limit || limit < 1) {
    return 10;
  }

  return Math.floor(limit);
}

function toMediaRecord(value: unknown): NpMediaRecord {
  npAssertMediaRecord(value);
  return value;
}

function resolveUploaderSummary(row: {
  userName: string | null;
  userEmail: string | null;
  memberHandle: string | null;
  memberDisplayName: string | null;
}): NpMediaUploaderSummary | null {
  if (row.userName !== null || row.userEmail !== null) {
    return { kind: "staff", name: row.userName, email: row.userEmail };
  }
  if (row.memberHandle !== null) {
    return {
      kind: "member",
      handle: row.memberHandle,
      displayName: row.memberDisplayName,
    };
  }
  return null;
}
