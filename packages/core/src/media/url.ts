import { getMediaById, getStorageAdapter } from "./service.js";
import { npMediaVariantNamePattern } from "../media-contract/contract.js";

const variantNamePattern = new RegExp(npMediaVariantNamePattern, "u");

/**
 * Built-in image variants. Plugin-defined custom variants are
 * accepted as plain strings — the lookup walks `media.sizes`
 * regardless of whether the variant was named in this union.
 */
export type NpMediaVariantName =
  "original" | "thumbnail" | "small" | "medium" | "large" | "xlarge" | "og" | (string & {});

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

/**
 * Resolve a media record's public URL via the active storage
 * adapter — works the same for local-disk and S3 deployments,
 * from the canonical persisted variant metadata. URLs are always
 * derived through the active adapter; ephemeral or deployment-specific
 * URLs are never persisted in `np_media.sizes`.
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
  if (variant !== "original" && !variantNamePattern.test(variant)) {
    throw new Error(
      `Invalid media variant "${variant}"; expected a canonical lowercase variant name.`,
    );
  }

  const row = await getMediaById(id);
  if (!row) return null;

  if (variant === "original") {
    return getStorageAdapter().getUrl(row.storageKey);
  }

  const size = row.sizes?.[variant];
  if (size) {
    return getStorageAdapter().getUrl(size.storageKey);
  }

  if (!fallback) return null;
  return getStorageAdapter().getUrl(row.storageKey);
}
