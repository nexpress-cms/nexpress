import { findPosts } from "@nexpress/core";

export interface FetchFrontListPostsOptions {
  /**
   * Restrict the fetch to a single post kind. Magazine should pass
   * `"article"`, portfolio should pass `"project"`. Omit on themes
   * that intentionally want every published post regardless of kind
   * (rare — most front layouts target one kind).
   */
  kind?: string;
  /** Defaults to 20. */
  limit?: number;
}

/**
 * Shared loader for "list front" page templates. Fetches published
 * posts (optionally scoped to one `kind`), sorted newest-first, and
 * returns the document array. Magazine and portfolio's front
 * templates wrap around this; they only diverge in which list
 * template they delegate to once docs are in hand.
 *
 * The list-template renderers cast `doc` to their per-theme shape
 * internally, so this helper returns the untyped pipeline shape
 * (`Record<string, unknown>[]`) instead of taking a generic that
 * tightens `where` to only the doc's literal keys.
 *
 * Lives in `@nexpress/next` (not `@nexpress/theme`) because
 * `findPosts` reads from the singleton DB handle — a server-only
 * dependency the `@nexpress/theme` package deliberately excludes
 * from its ambient `@nexpress/core` declaration so client bundles
 * can import theme tokens without dragging in `pg` / `sharp`.
 */
export async function fetchFrontListPosts(
  options: FetchFrontListPostsOptions = {},
): Promise<Record<string, unknown>[]> {
  const result = await findPosts({
    where:
      options.kind && options.kind.length > 0
        ? { status: "published", kind: options.kind }
        : { status: "published" },
    sort: "-publishedAt",
    limit: options.limit ?? 20,
  });
  return result.docs;
}
