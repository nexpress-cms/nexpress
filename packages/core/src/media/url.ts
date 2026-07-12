import { getMediaById, getStorageAdapter } from "./service.js";
import { npMediaVariantNamePattern } from "../media-contract/contract.js";
import type { NpGetMediaUrlOptions } from "../media-contract/types.js";

export type { NpGetMediaUrlOptions, NpMediaVariantName } from "../media-contract/types.js";

const variantNamePattern = new RegExp(npMediaVariantNamePattern, "u");

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
