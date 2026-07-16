import { NpValidationError } from "../errors.js";
import type { NpCollectionConfig } from "../config/types.js";
import { npNormalizeCollectionDocumentSlug } from "../collection-contract/contract.js";

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
  return npNormalizeCollectionDocumentSlug(value);
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

  if (typeof data.slug === "string") {
    const normalized = slugify(data.slug);
    if (normalized.length === 0) {
      throw new NpValidationError("Slug generation failed", [
        {
          field: "slug",
          message: "Explicit slug must contain at least one letter or number.",
        },
      ]);
    }
    data.slug = normalized;
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
