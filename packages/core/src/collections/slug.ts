import { NpValidationError } from "../errors.js";
import type { NpCollectionConfig } from "../config/types.js";

/**
 * Stable URL-slug derivation. Lowercases, strips Latin diacritics
 * (Cr\u00e8me \u2192 creme), keeps any Unicode letter or number including
 * Korean/Japanese/Chinese/Cyrillic/Greek/etc., replaces runs of
 * separators (anything that isn't a letter or number) with a
 * single hyphen, trims edge hyphens, and caps at 96 chars so the
 * result fits standard DB slug columns without needing a larger
 * index.
 *
 * The two-step `NFKD \u2192 strip combining marks \u2192 NFC` dance does
 * the diacritic strip without permanently decomposing scripts
 * that NFKD breaks apart at the syllable level (most notably
 * Hangul, which NFKD turns into jamo and NFC then reassembles).
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

/**
 * Ensures `data.slug` is set for collections that declare `slugField`.
 * - If the caller supplied `slug`, it gets normalized through slugify.
 * - If updating an existing doc, the previous slug is preserved when the
 *   caller didn't provide one (so titles can change without breaking URLs).
 * - Otherwise the slug is derived from the configured `useField` (default
 *   "title"). Throws `NpValidationError` if no candidate source exists.
 *
 * Mutates `data` in place.
 */
export function applySlugField(
  config: NpCollectionConfig,
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
): void {
  if (!config.slugField) return;

  const existingSlug = typeof data.slug === "string" ? data.slug.trim() : "";

  if (existingSlug.length > 0) {
    data.slug = slugify(existingSlug) || existingSlug;
    return;
  }

  if (originalDoc && typeof originalDoc.slug === "string" && originalDoc.slug.length > 0) {
    data.slug = originalDoc.slug;
    return;
  }

  const useField =
    typeof config.slugField === "object" && config.slugField.useField
      ? config.slugField.useField
      : "title";
  const source = data[useField];
  const candidate = typeof source === "string" ? slugify(source) : "";

  if (candidate.length === 0) {
    throw new NpValidationError("Slug generation failed", [
      {
        field: "slug",
        message: `Cannot derive a slug — provide "slug" or a non-empty "${useField}".`,
      },
    ]);
  }

  data.slug = candidate;
}
