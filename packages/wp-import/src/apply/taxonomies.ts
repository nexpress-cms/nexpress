import type { WpImportRecord, WpTerm } from "../parse/types.js";

/**
 * Phase 21.6 — wire WP `<category>` and `<post_tag>` term references
 * onto NexPress posts via a caller-supplied resolver.
 *
 * The resolver decides where terms physically live. The reference
 * app's shim points it at the `taxonomies` collection (one row per
 * unique `(taxonomy, slug)` pair); user projects with their own
 * taxonomy storage swap in a different resolver. The wp-import
 * package never reaches into a collection by name.
 *
 * Behavior:
 *
 *   - The applier collects every term across the whole bundle, runs
 *     each through the resolver once, then maps back per-post.
 *   - A resolver that throws or returns `null` for a given term is
 *     captured as an error/note in the report; the post still
 *     imports without that term wired.
 *   - Without a resolver the applier records a single notes line
 *     (one per import) — no per-record noise — and posts go in
 *     without `categories` / `tags` set.
 */

export interface TaxonomyKey {
  taxonomy: string;
  slug: string;
  name: string;
}

export interface TaxonomyResolver {
  /**
   * Look up the taxonomy term row by `(taxonomy, slug)`, creating
   * one if it doesn't exist. Returns the row's NexPress id, or
   * `null` if the resolver decided to skip this term (e.g. the
   * project doesn't track that taxonomy).
   */
  findOrCreate: (input: TaxonomyKey) => Promise<{ id: string } | null>;
}

export interface TaxonomyResolution {
  /** `taxonomy:slug` → NexPress term id. */
  termIds: Map<string, string>;
  /** Resolver failures. */
  errors: Array<{ key: TaxonomyKey; reason: string }>;
  /** Terms the resolver explicitly skipped (returned null). */
  skipped: TaxonomyKey[];
}

export function termCacheKey(taxonomy: string, slug: string): string {
  return `${taxonomy}:${slug}`;
}

/**
 * Walk every record's terms and the channel-level term list,
 * collapse them to a unique set, and resolve each through the
 * caller's resolver. Returns a lookup the applier can use when
 * building per-record `categories` / `tags` field values.
 */
export async function resolveTaxonomies(
  records: WpImportRecord[],
  channelTerms: WpTerm[],
  resolver: TaxonomyResolver,
): Promise<TaxonomyResolution> {
  const seen = new Map<string, TaxonomyKey>();

  const remember = (term: WpTerm): void => {
    if (!term.slug) return;
    const key = termCacheKey(term.taxonomy, term.slug);
    if (seen.has(key)) return;
    seen.set(key, { taxonomy: term.taxonomy, slug: term.slug, name: term.name || term.slug });
  };

  for (const term of channelTerms) remember(term);
  for (const record of records) {
    if (record.wpType === "attachment") continue;
    for (const term of record.terms) remember(term);
  }

  const termIds = new Map<string, string>();
  const errors: TaxonomyResolution["errors"] = [];
  const skipped: TaxonomyKey[] = [];

  for (const [key, value] of seen.entries()) {
    try {
      const result = await resolver.findOrCreate(value);
      if (!result) {
        skipped.push(value);
        continue;
      }
      termIds.set(key, result.id);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push({ key: value, reason });
    }
  }

  return { termIds, errors, skipped };
}

/**
 * Per-record helper — returns the resolved `(categoryIds, tagIds)`
 * pair for a record. Anything outside the two built-in WP taxonomies
 * is dropped; the applier mirrors WP's own admin which only renders
 * `category` and `post_tag` on the post edit screen.
 */
export function pickPostTermIds(
  record: WpImportRecord,
  resolution: TaxonomyResolution,
): { categoryIds: string[]; tagIds: string[] } {
  const categoryIds: string[] = [];
  const tagIds: string[] = [];
  const seenCategory = new Set<string>();
  const seenTag = new Set<string>();
  for (const term of record.terms) {
    if (!term.slug) continue;
    const id = resolution.termIds.get(termCacheKey(term.taxonomy, term.slug));
    if (!id) continue;
    if (term.taxonomy === "category" && !seenCategory.has(id)) {
      categoryIds.push(id);
      seenCategory.add(id);
    } else if (term.taxonomy === "post_tag" && !seenTag.has(id)) {
      tagIds.push(id);
      seenTag.add(id);
    }
  }
  return { categoryIds, tagIds };
}
