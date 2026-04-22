import { NxValidationError } from "../errors.js";
import type { NxCollectionConfig } from "../config/types.js";

/**
 * Stable URL-slug derivation. Lowercases, strips diacritics, replaces runs of
 * non-alphanumerics with a single hyphen, trims edge hyphens, and caps at 96
 * chars so it fits standard DB slug columns without needing a larger index.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

/**
 * Ensures `data.slug` is set for collections that declare `slugField`.
 * - If the caller supplied `slug`, it gets normalized through slugify.
 * - If updating an existing doc, the previous slug is preserved when the
 *   caller didn't provide one (so titles can change without breaking URLs).
 * - Otherwise the slug is derived from the configured `useField` (default
 *   "title"). Throws `NxValidationError` if no candidate source exists.
 *
 * Mutates `data` in place.
 */
export function applySlugField(
  config: NxCollectionConfig,
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
    throw new NxValidationError("Slug generation failed", [
      {
        field: "slug",
        message: `Cannot derive a slug — provide "slug" or a non-empty "${useField}".`,
      },
    ]);
  }

  data.slug = candidate;
}
