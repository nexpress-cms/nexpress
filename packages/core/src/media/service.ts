import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { Readable } from "node:stream";

import { and, count, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";

import type { NxFindResult, NxImageSize } from "../config/types.js";
import { nxMedia, nxMediaRefs } from "../db/schema/media.js";
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

export async function uploadMedia(
  file: { buffer: Buffer; originalFilename: string; mimeType: string },
  /**
   * Author of the upload. Pass a real `nx_users.id` UUID for staff
   * uploads, or `null` when the upload originated outside the
   * staff-user pool (e.g. a plugin's `ctx.media.upload`). The
   * column is a nullable FK; passing a non-UUID string used to fail
   * with a Postgres FK error and orphan the storage object. (#62)
   */
  userId: string | null,
  folderId?: string,
): Promise<{ id: string; status: string }> {
  const adapter = getStorageAdapter();
  const db = getMediaDb() as unknown as DrizzleDatabaseLike;
  const id = randomUUID();
  const extension = resolveFileExtension(file.originalFilename, file.mimeType);
  const storageKey = `media/${id}/original.${extension}`;
  const now = new Date();

  await adapter.upload(storageKey, file.buffer, {
    contentType: file.mimeType,
    contentLength: file.buffer.byteLength,
    originalFilename: file.originalFilename,
  });

  await db.insert(nxMedia).values({
    id,
    filename: file.originalFilename,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    filesize: file.buffer.byteLength,
    storageKey,
    hash: createHash("sha256").update(file.buffer).digest("hex"),
    status: "processing",
    folderId,
    uploadedBy: userId,
    createdAt: now,
    updatedAt: now,
  });

  await enqueueJob("media:processImage", { mediaId: id });

  return { id, status: "processing" };
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

export async function listMedia(options: {
  page?: number;
  limit?: number;
  folderId?: string;
  mimeType?: string;
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

  const whereClause = combineConditions(conditions);
  const docs = whereClause
    ? await db
        .select()
        .from(nxMedia)
        .where(whereClause)
        .orderBy(desc(nxMedia.createdAt))
        .limit(limit)
        .offset(offset)
    : await db.select().from(nxMedia).orderBy(desc(nxMedia.createdAt)).limit(limit).offset(offset);
  const [{ total }] = (whereClause
    ? await db.select({ total: count() }).from(nxMedia).where(whereClause)
    : await db.select({ total: count() }).from(nxMedia)) as Array<{ total: number | string }>;
  const totalDocs = Number(total ?? 0);
  const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);

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
