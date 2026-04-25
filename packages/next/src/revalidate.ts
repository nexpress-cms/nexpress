import { revalidatePath } from "next/cache";

export interface CollectionRevalidationRule {
  /**
   * When the collection document is saved or deleted, invalidate these paths.
   * `{slug}` placeholder is substituted with the document's slug. If the
   * document has no slug (or the rule has no placeholder), the literal path
   * is revalidated.
   */
  paths: readonly string[];
}

export type RevalidationMap = Record<string, CollectionRevalidationRule>;

function substitute(path: string, documentSlug: string | undefined): string | null {
  if (!path.includes("{slug}")) return path;
  if (!documentSlug) return null;
  return path.replace("{slug}", documentSlug);
}

/**
 * Invalidates Next's render cache for routes that depend on a collection
 * document. Called inline after create/update/delete succeeds.
 *
 * Consumers provide a slug → paths map. Use the `{slug}` placeholder to
 * refer to the document's own slug (e.g. `/blog/{slug}`). If the document
 * has no slug at all, paths containing the placeholder are skipped.
 *
 * This is the MVP-α stand-in for the designed `content:afterPublish` →
 * `revalidateTag` job handler; once pg-boss is wired, this logic should
 * move into a worker.
 */
export function revalidateCollection(
  rules: RevalidationMap,
  slug: string,
  doc?: Record<string, unknown> | null,
): void {
  const rule = rules[slug];
  if (!rule) return;

  const documentSlug =
    doc && typeof doc.slug === "string" && doc.slug.length > 0 ? doc.slug : undefined;

  for (const raw of rule.paths) {
    const target = substitute(raw, documentSlug);
    if (!target) continue;
    try {
      revalidatePath(target);
    } catch (error) {
      // revalidatePath throws outside a Next request context (unit tests,
      // background workers, admin actions invoked via `pg-boss`). Silent
      // skip — real request traffic already ran it via the route that
      // produced the write; the worker path can invalidate on its own.
      if (process.env.NODE_ENV !== "test") {
        // eslint-disable-next-line no-console
        console.warn(`[revalidateCollection] ${target} skipped:`, error);
      }
    }
  }
}

/**
 * Common-sense defaults for the blog + pages reference layout. Consumers
 * can spread this into their own rule map or override per collection.
 */
export const defaultRevalidationRules: RevalidationMap = {
  posts: { paths: ["/blog", "/blog/{slug}"] },
  pages: { paths: ["/{slug}", "/"] },
};
