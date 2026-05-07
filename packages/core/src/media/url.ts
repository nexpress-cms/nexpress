import { and, eq, isNull } from "drizzle-orm";

import { npMedia } from "../db/schema/media.js";
import { getDb } from "../db/runtime.js";
import { getStorageAdapter } from "./service.js";

/**
 * Built-in image variants. Plugin-defined custom variants are
 * accepted as plain strings — the lookup walks `media.sizes`
 * regardless of whether the variant was named in this union.
 */
export type NpMediaVariantName =
  | "original"
  | "thumbnail"
  | "small"
  | "medium"
  | "large"
  | "xlarge"
  | "og"
  | (string & {});

export interface NpGetMediaUrlOptions {
  /**
   * Which size to resolve. Defaults to `"original"` — the bytes
   * uploaded by the user. Sized variants (`thumbnail`, `medium`,
   * `og`, …) are only present for processed images; non-image
   * media has only `"original"`.
   */
  variant?: NpMediaVariantName;
  /**
   * When `true` (default) and the requested variant doesn't
   * exist on the media row, fall back to the original. Set to
   * `false` to get `null` instead — useful when you'd rather
   * skip rendering than serve a 5 MB original where a thumbnail
   * was expected.
   */
  fallbackToOriginal?: boolean;
}

interface MediaUrlRow {
  storageKey: string;
  sizes: Record<string, Record<string, unknown>> | null;
}

/**
 * Resolve a media record's public URL via the active storage
 * adapter — works the same for local-disk and S3 deployments,
 * and uses the URL cached on the size record when present
 * (avoids a redundant `presign` round-trip for S3).
 *
 * Returns `null` when:
 *  - the media id doesn't exist (or was soft-deleted),
 *  - the requested variant isn't available AND
 *    `fallbackToOriginal: false` was passed.
 *
 * Pure read — no side effects, safe to call from RSC.
 */
export async function getMediaUrl(
  id: string,
  options: NpGetMediaUrlOptions = {},
): Promise<string | null> {
  const variant = options.variant ?? "original";
  const fallback = options.fallbackToOriginal !== false;

  const db = getDb();
  const rows = await db
    .select({ storageKey: npMedia.storageKey, sizes: npMedia.sizes })
    .from(npMedia)
    .where(and(eq(npMedia.id, id), isNull(npMedia.deletedAt)))
    .limit(1);
  const row = rows[0] as MediaUrlRow | undefined;
  if (!row) return null;

  if (variant === "original") {
    return getStorageAdapter().getUrl(row.storageKey);
  }

  const size = row.sizes?.[variant];
  if (size && typeof size === "object") {
    const cachedUrl = (size as { url?: unknown }).url;
    if (typeof cachedUrl === "string" && cachedUrl.length > 0) {
      return cachedUrl;
    }
    const variantKey = (size as { storageKey?: unknown }).storageKey;
    if (typeof variantKey === "string" && variantKey.length > 0) {
      return getStorageAdapter().getUrl(variantKey);
    }
  }

  if (!fallback) return null;
  return getStorageAdapter().getUrl(row.storageKey);
}
