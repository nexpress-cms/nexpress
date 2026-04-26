import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { Readable } from "node:stream";

import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";

import type { NxFindResult, NxImageSize } from "../config/types.js";
import { nxMembers } from "../db/schema/community.js";
import { nxMedia, nxMediaRefs } from "../db/schema/media.js";
import { nxUsers } from "../db/schema/system.js";
import { enqueueJob } from "../jobs/queue.js";
import {
  DEFAULT_IMAGE_SIZES,
  processImage,
  type NxProcessedImageResult,
} from "./processor.js";
import type { NxStorageAdapter } from "../storage/types.js";

interface SelectQuery extends Promise<unknown[]> {
  where(condition: ReturnType<typeof and> | ReturnType<typeof isNull>): SelectQuery;
  orderBy(order: ReturnType<typeof desc>): SelectQuery;
  limit(limit: number): SelectQuery;
  offset(offset: number): SelectQuery;
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
    where(condition: ReturnType<typeof inArray>  ): Promise<unknown>;
  };
  select(selection?: Record<string, unknown>): {
    from(table: PgTable): SelectQuery;
  };
}

interface MediaRecord {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  filesize: number;
  width: number | null;
  height: number | null;
  sizes: Record<string, Record<string, unknown>> | null;
  storageKey: string;
  hash: string;
  status: "processing" | "ready" | "error";
  folderId: string | null;
  uploadedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let storageAdapter: NxStorageAdapter | null = null;
let dbInstance: NodePgDatabase<Record<string, unknown>> | null = null;

export function setStorageAdapter(adapter: NxStorageAdapter): void {
  storageAdapter = adapter;
}

export function getStorageAdapter(): NxStorageAdapter {
  if (!storageAdapter) {
    throw new Error("Storage adapter not initialized. Call setStorageAdapter() first.");
  }

  return storageAdapter;
}

export function setMediaDb(db: NodePgDatabase<Record<string, unknown>>): void {
  dbInstance = db;
}

export function getMediaDb(): NodePgDatabase<Record<string, unknown>> {
  if (!dbInstance) {
    throw new Error("Media database not initialized. Call setMediaDb() first.");
  }

  return dbInstance;
}

/**
 * Polymorphic uploader: a row on `nx_media` is owned by exactly
 * one of staff (`uploadedBy` → `nx_users.id`) or member
 * (`uploadedByMemberId` → `nx_members.id`, Phase 9.7j). Pass a
 * `null` value as the second argument to `uploadMedia` for plugin /
 * system uploads with no human owner — both columns stay null and
 * the audit log carries the actor.
 */
export type NxMediaUploader =
  | { kind: "staff"; userId: string }
  | { kind: "member"; memberId: string }
  | null;

export async function uploadMedia(
  file: { buffer: Buffer; originalFilename: string; mimeType: string },
  uploader: NxMediaUploader | string,
  folderId?: string,
): Promise<{ id: string; status: string }> {
  // Backwards-compat: the original signature was
  // `uploadMedia(file, userId: string | null, folderId?)`. Existing
  // callers (plugin context, admin bulk uploads, etc.) pass a bare
  // string. Coerce that into the staff variant of the polymorphic
  // shape so the rest of this function only deals with the union.
  const resolvedUploader: NxMediaUploader =
    typeof uploader === "string"
      ? { kind: "staff", userId: uploader }
      : uploader;

  const id = randomUUID();
  const extension = resolveFileExtension(file.originalFilename, file.mimeType);
  const storageKey = `media/${id}/original.${extension}`;
  const now = new Date();
  const insertValues = {
    id,
    filename: file.originalFilename,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    filesize: file.buffer.byteLength,
    storageKey,
    hash: createHash("sha256").update(file.buffer).digest("hex"),
    status: "processing" as const,
    folderId,
    uploadedBy:
      resolvedUploader && resolvedUploader.kind === "staff"
        ? resolvedUploader.userId
        : null,
    uploadedByMemberId:
      resolvedUploader && resolvedUploader.kind === "member"
        ? resolvedUploader.memberId
        : null,
    createdAt: now,
    updatedAt: now,
  };

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
    const dbPg = getMediaDb() as unknown as NodePgDatabase<Record<string, unknown>>;
    await dbPg.transaction(async (tx) => {
      // `pg_advisory_xact_lock` auto-releases on commit/rollback.
      // `hashtextextended` produces a stable int8 from a UUID
      // string — collisions across different member ids are
      // benign (worst case some unrelated members serialize).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${memberId}, 0))`,
      );
      await assertMemberUploadQuota(memberId, tx);
      await tx.insert(nxMedia).values(insertValues);
    });
  } else {
    const db = getMediaDb() as unknown as DrizzleDatabaseLike;
    await db.insert(nxMedia).values(insertValues);
  }

  const adapter = getStorageAdapter();
  try {
    await adapter.upload(storageKey, file.buffer, {
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
      const cleanupDb = getMediaDb() as unknown as DrizzleDatabaseLike;
      await cleanupDb.delete(nxMedia).where(eq(nxMedia.id, id));
    } catch {
      // swallow — the storage error matters more
    }
    throw err;
  }

  await enqueueJob("media:processImage", { mediaId: id });

  return { id, status: "processing" };
}

/**
 * Throws `NxRateLimitError` (429) if the member is at or over
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
  txDb?: NodePgDatabase<Record<string, unknown>>,
): Promise<void> {
  const { getCommunitySettings } = await import(
    "../community/settings.js"
  );
  const { NxRateLimitError } = await import("../errors.js");
  const settings = await getCommunitySettings();
  const { perDay, total } = settings.memberUploadQuota;
  if (perDay === null && total === null) return;

  // When invoked inside the upload transaction (#120 fix), the
  // count + downstream insert run under the same advisory lock,
  // so the count must use the tx handle to see writes by sibling
  // statements. When called from elsewhere we fall back to the
  // shared media DB.
  const db =
    txDb ??
    (getMediaDb() as unknown as NodePgDatabase<Record<string, unknown>>);

  if (total !== null) {
    const [row] = (await db
      .select({ value: count() })
      .from(nxMedia)
      .where(
        and(
          eq(nxMedia.uploadedByMemberId, memberId),
          isNull(nxMedia.deletedAt),
        ),
      )) as Array<{ value: number }>;
    const used = row?.value ?? 0;
    if (used >= total) {
      throw new NxRateLimitError(
        `Upload quota exceeded — this account has reached its lifetime cap of ${total} uploads.`,
      );
    }
  }

  if (perDay !== null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = (await db
      .select({ value: count() })
      .from(nxMedia)
      .where(
        and(
          eq(nxMedia.uploadedByMemberId, memberId),
          isNull(nxMedia.deletedAt),
          gte(nxMedia.createdAt, since),
        ),
      )) as Array<{ value: number }>;
    const recent = row?.value ?? 0;
    if (recent >= perDay) {
      throw new NxRateLimitError(
        `Upload rate limit exceeded — try again later (max ${perDay} uploads per 24 hours).`,
      );
    }
  }
}

export async function processMediaImage(
  mediaId: string,
  config: { sizes?: NxImageSize[]; format?: string; quality?: number },
): Promise<void> {
  const db = getMediaDb() as unknown as DrizzleDatabaseLike;
  const adapter = getStorageAdapter();
  const media = await getMediaRecordById(mediaId);

  if (!media) {
    throw new Error(`Media '${mediaId}' not found.`);
  }

  try {
    const originalStream = await adapter.getStream(media.storageKey);
    const originalBuffer = await consumeBuffer(Readable.fromWeb(originalStream));
    const processed = await processImage(
      originalBuffer,
      config.sizes ?? DEFAULT_IMAGE_SIZES,
      { format: config.format, quality: config.quality },
    );
    const format = config.format ?? "webp";
    const mimeType = getFormatMimeType(format);
    const sizes = await uploadImageVariants(adapter, media.id, processed, format, mimeType);

    await db
      .update(nxMedia)
      .set({
        sizes,
        width: processed.source.width,
        height: processed.source.height,
        status: "ready",
        updatedAt: new Date(),
      })
      .where(eq(nxMedia.id, media.id))
      .returning();
  } catch (error) {
    await db
      .update(nxMedia)
      .set({
        status: "error",
        updatedAt: new Date(),
      })
      .where(eq(nxMedia.id, media.id))
      .returning();

    throw error;
  }
}

export async function getMediaById(id: string): Promise<Record<string, unknown> | null> {
  const db = getMediaDb() as unknown as DrizzleDatabaseLike;
  const [media] = await db
    .select()
    .from(nxMedia)
    .where(and(eq(nxMedia.id, id), isNull(nxMedia.deletedAt)))
    .limit(1);

  return media ? toRecord(media) : null;
}

export async function deleteMedia(
  id: string,
): Promise<{ deleted: boolean; references?: unknown[] }> {
  const db = getMediaDb() as unknown as DrizzleDatabaseLike;
  const references = await db.select().from(nxMediaRefs).where(eq(nxMediaRefs.mediaId, id));

  if (references.length > 0) {
    return { deleted: false, references };
  }

  const [media] = await db
    .select()
    .from(nxMedia)
    .where(and(eq(nxMedia.id, id), isNull(nxMedia.deletedAt)))
    .limit(1);

  if (!media) {
    return { deleted: false };
  }

  await db
    .update(nxMedia)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(nxMedia.id, id))
    .returning();

  return { deleted: true };
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
export type NxMediaUploaderKindFilter = "staff" | "member";

export async function listMedia(options: {
  page?: number;
  limit?: number;
  folderId?: string;
  mimeType?: string;
  uploaderKind?: NxMediaUploaderKindFilter;
  uploadedByMemberId?: string;
}): Promise<NxFindResult> {
  const db = getMediaDb() as unknown as DrizzleDatabaseLike;
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);
  const offset = (page - 1) * limit;
  const conditions = [isNull(nxMedia.deletedAt)];

  if (options.folderId) {
    conditions.push(eq(nxMedia.folderId, options.folderId));
  }

  if (options.mimeType) {
    conditions.push(eq(nxMedia.mimeType, options.mimeType));
  }

  if (options.uploaderKind === "staff") {
    conditions.push(isNotNull(nxMedia.uploadedBy));
  } else if (options.uploaderKind === "member") {
    conditions.push(isNotNull(nxMedia.uploadedByMemberId));
  }

  if (options.uploadedByMemberId) {
    conditions.push(eq(nxMedia.uploadedByMemberId, options.uploadedByMemberId));
  }

  const whereClause = combineConditions(conditions);
  // The local `DrizzleDatabaseLike` interface in this file is
  // narrow on purpose (only `select/insert/update/delete`); a
  // proper leftJoin chain would require typing the full Drizzle
  // builder pipeline. Cast through `unknown` for this query —
  // safer than widening the interface and dragging join semantics
  // into every other media call site.
  const joined = (db as unknown as {
    select: (s: Record<string, unknown>) => {
      from: (t: PgTable) => {
        leftJoin: (j: PgTable, c: unknown) => {
          leftJoin: (j: PgTable, c: unknown) => {
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
  })
    .select({
      media: nxMedia,
      userName: nxUsers.name,
      userEmail: nxUsers.email,
      memberHandle: nxMembers.handle,
      memberDisplayName: nxMembers.displayName,
    })
    .from(nxMedia)
    .leftJoin(nxUsers, eq(nxMedia.uploadedBy, nxUsers.id))
    .leftJoin(nxMembers, eq(nxMedia.uploadedByMemberId, nxMembers.id))
    .where(whereClause)
    .orderBy(desc(nxMedia.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = (await joined) as Array<{
    media: Record<string, unknown>;
    userName: string | null;
    userEmail: string | null;
    memberHandle: string | null;
    memberDisplayName: string | null;
  }>;
  const [{ total }] = (whereClause
    ? await db.select({ total: count() }).from(nxMedia).where(whereClause)
    : await db.select({ total: count() }).from(nxMedia)) as Array<{ total: number | string }>;
  const totalDocs = Number(total ?? 0);
  const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);

  // Flatten the JOIN result so each doc carries an `uploader`
  // sub-object alongside the standard media columns. Keeps the
  // shape backwards-compatible (the existing media columns are
  // still at the top level).
  const docs = rows.map((row) => ({
    ...row.media,
    uploader: row.userName !== null
      ? {
          kind: "staff" as const,
          name: row.userName,
          email: row.userEmail,
        }
      : row.memberHandle !== null
      ? {
          kind: "member" as const,
          handle: row.memberHandle,
          displayName: row.memberDisplayName,
        }
      : null,
  }));

  return {
    docs: docs as Record<string, unknown>[],
    totalDocs,
    totalPages,
    page,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1 && totalDocs > 0,
  };
}

export async function cleanupDeletedMedia(olderThanDays: number): Promise<number> {
  const db = getMediaDb() as unknown as DrizzleDatabaseLike;
  const adapter = getStorageAdapter();
  const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(nxMedia)
    .where(and(isNotNull(nxMedia.deletedAt), lt(nxMedia.deletedAt, threshold)));
  const mediaRows = rows.map(toMediaRecord);

  if (mediaRows.length === 0) {
    return 0;
  }

  for (const media of mediaRows) {
    const keys = new Set<string>([
      media.storageKey,
      ...extractVariantStorageKeys(media.sizes),
    ]);

    for (const key of keys) {
      try {
        await adapter.delete(key);
      } catch {
        continue;
      }
    }
  }

  await db.delete(nxMedia).where(inArray(nxMedia.id, mediaRows.map((media) => media.id)));

  return mediaRows.length;
}

async function getMediaRecordById(id: string): Promise<MediaRecord | null> {
  const db = getMediaDb() as unknown as DrizzleDatabaseLike;
  const [media] = await db
    .select()
    .from(nxMedia)
    .where(and(eq(nxMedia.id, id), isNull(nxMedia.deletedAt)))
    .limit(1);

  return media ? toMediaRecord(media) : null;
}

async function uploadImageVariants(
  adapter: NxStorageAdapter,
  mediaId: string,
  processed: NxProcessedImageResult,
  format: string,
  mimeType: string,
): Promise<Record<string, Record<string, unknown>>> {
  const entries = await Promise.all(
    processed.variants.map(async (variant) => {
      const filename = `${variant.name}.${format}`;
      const storageKey = `media/${mediaId}/${filename}`;

      await adapter.upload(storageKey, variant.buffer, {
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
          url: await adapter.getUrl(storageKey),
        },
      ] as const;
    }),
  );

  return Object.fromEntries(entries);
}

function extractVariantStorageKeys(
  sizes: Record<string, Record<string, unknown>> | null,
): string[] {
  if (!sizes) {
    return [];
  }

  return Object.values(sizes)
    .map((size) => size.storageKey)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function resolveFileExtension(originalFilename: string, mimeType: string): string {
  const extension = extname(originalFilename).slice(1).toLowerCase();

  if (extension) {
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
  conditions: Array<ReturnType<typeof and> | ReturnType<typeof isNull>  >,
): ReturnType<typeof and> | ReturnType<typeof isNull>   | undefined {
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

function toMediaRecord(value: unknown): MediaRecord {
  const record = toRecord(value);

  return {
    id: asString(record.id, "id"),
    filename: asString(record.filename, "filename"),
    originalFilename: asString(record.originalFilename, "originalFilename"),
    mimeType: asString(record.mimeType, "mimeType"),
    filesize: asNumber(record.filesize, "filesize"),
    width: asNullableNumber(record.width),
    height: asNullableNumber(record.height),
    sizes: asSizes(record.sizes),
    storageKey: asString(record.storageKey, "storageKey"),
    hash: asString(record.hash, "hash"),
    status: asMediaStatus(record.status),
    folderId: asNullableString(record.folderId),
    uploadedBy: asNullableString(record.uploadedBy),
    createdAt: asDate(record.createdAt, "createdAt"),
    updatedAt: asDate(record.updatedAt, "updatedAt"),
    deletedAt: asNullableDate(record.deletedAt),
  };
}

function asSizes(value: unknown): Record<string, Record<string, unknown>> | null {
  if (value == null) {
    return null;
  }

  const record = toRecord(value);
  const sizes: Record<string, Record<string, unknown>> = {};

  for (const [key, entry] of Object.entries(record)) {
    const sizeRecord = toRecord(entry);
    sizes[key] = sizeRecord;
  }

  return sizes;
}

function asMediaStatus(value: unknown): MediaRecord["status"] {
  if (value === "processing" || value === "ready" || value === "error") {
    return value;
  }

  throw new Error("Invalid media status.");
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${field}.`);
  }

  return value;
}

function asNullableString(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  return asString(value, "string field");
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(`Invalid ${field}.`);
  }

  return value;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  return asNumber(value, "number field");
}

function asDate(value: unknown, field: string): Date {
  if (!(value instanceof Date)) {
    throw new Error(`Invalid ${field}.`);
  }

  return value;
}

function asNullableDate(value: unknown): Date | null {
  if (value == null) {
    return null;
  }

  return asDate(value, "date field");
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object record.");
  }

  return value as Record<string, unknown>;
}
