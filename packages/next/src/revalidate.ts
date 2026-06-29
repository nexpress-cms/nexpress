import { getCurrentSiteId } from "@nexpress/core";
import { invalidateCacheTargets } from "./cdn-purge.js";

export interface CollectionRevalidationRule {
  /**
   * When the collection document is saved or deleted, invalidate these paths.
   * `{slug}` placeholder is substituted with the document's slug. If the
   * document has no slug (or the rule has no placeholder), the literal path
   * is revalidated.
   *
   * Phase 15.10 — `{siteId}` placeholder is also supported for paths that
   * need site-scoping. Invalidations from a request without a resolved
   * siteId fall through to the legacy global tags only.
   */
  paths: readonly string[];
  /**
   * Phase 14.1 — cache tags to bust alongside path invalidation.
   * Routes using `unstable_cache(..., [], { tags })` (sitemap.xml,
   * feed.xml, etc.) re-render on the next request after a write
   * to this collection. Same `{slug}` / `{siteId}` placeholder rules
   * as paths.
   */
  tags?: readonly string[];
}

export type RevalidationMap = Record<string, CollectionRevalidationRule>;

interface SubstituteContext {
  documentSlug: string | undefined;
  siteId: string | null;
}

interface RevalidationTargets {
  paths: string[];
  tags: string[];
}

interface EmitContext {
  collection: string;
  documentSlug: string | undefined;
}

export function collectionCacheTag(slug: string): string {
  return `nx:collection:${slug}`;
}

function substitute(template: string, ctx: SubstituteContext): string | null {
  let out = template;
  if (out.includes("{slug}")) {
    if (!ctx.documentSlug) return null;
    out = out.replace("{slug}", ctx.documentSlug);
  }
  if (out.includes("{siteId}")) {
    if (!ctx.siteId) return null;
    out = out.replace("{siteId}", ctx.siteId);
  }
  return out;
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
  const rule = withCollectionCacheTag(rules[slug], slug);

  const documentSlug =
    doc && typeof doc.slug === "string" && doc.slug.length > 0 ? doc.slug : undefined;

  // First pass — emit every tag/path that doesn't depend on
  // siteId. This includes the legacy global tags (`nx:sitemap`,
  // `nx:feed:posts`, …) so existing site-scoped cache wrappers
  // (Phase 14.8) and global wrappers both clear.
  emit(rule, { documentSlug, siteId: null }, { collection: slug, documentSlug });

  // Second pass — resolve siteId asynchronously and re-fire
  // any rule entries that contain `{siteId}`. Fire-and-forget
  // so the (sync) caller doesn't have to await; if the
  // resolver returns null, this is a no-op. The first pass
  // already covered the global-tag invalidation as a safety
  // net, so a missed site-scoped tag is at worst over-
  // invalidation, never stale-cache.
  void emitSiteScopedTags(rule, slug, documentSlug);
}

function withCollectionCacheTag(
  rule: CollectionRevalidationRule | undefined,
  slug: string,
): CollectionRevalidationRule {
  return {
    paths: rule?.paths ?? [],
    tags: [...(rule?.tags ?? []), collectionCacheTag(slug)],
  };
}

function collectTargets(
  rule: CollectionRevalidationRule,
  ctx: SubstituteContext,
): RevalidationTargets {
  const paths: string[] = [];
  const tags: string[] = [];

  for (const raw of rule.paths) {
    const target = substitute(raw, ctx);
    if (target) paths.push(target);
  }

  for (const rawTag of rule.tags ?? []) {
    const target = substitute(rawTag, ctx);
    if (target) tags.push(target);
  }

  return { paths, tags };
}

function emit(
  rule: CollectionRevalidationRule,
  ctx: SubstituteContext,
  emitContext: EmitContext,
): void {
  const targets = collectTargets(rule, ctx);

  invalidateCacheTargets({
    source: "collection",
    collection: emitContext.collection,
    documentSlug: emitContext.documentSlug,
    siteId: ctx.siteId,
    paths: targets.paths,
    tags: targets.tags,
  });
}

async function emitSiteScopedTags(
  rule: CollectionRevalidationRule,
  collection: string,
  documentSlug: string | undefined,
): Promise<void> {
  // Skip the work entirely if no rule entry references {siteId}.
  const hasSiteScoped =
    rule.paths.some((p) => p.includes("{siteId}")) ||
    (rule.tags ?? []).some((t) => t.includes("{siteId}"));
  if (!hasSiteScoped) return;

  let siteId: string | null;
  try {
    siteId = await getCurrentSiteId();
  } catch {
    siteId = null;
  }
  if (!siteId) return;

  const siteScopedRule: CollectionRevalidationRule = {
    paths: rule.paths.filter((p) => p.includes("{siteId}")),
    tags: rule.tags?.filter((t) => t.includes("{siteId}")),
  };
  emit(siteScopedRule, { documentSlug, siteId }, { collection, documentSlug });
}

/**
 * Common-sense defaults for the blog + pages reference layout. Consumers
 * can spread this into their own rule map or override per collection.
 *
 * Phase 14.1 added the `tags` field so writes also invalidate the
 * sitemap / feed / homepage data caches that `unstable_cache`-wrapped
 * readers in the (site) routes depend on.
 *
 * Phase 14.7 added the `nx:search` tag so the short-TTL search cache
 * invalidates immediately on every write — without it the hot-query
 * cache could serve up to 60s of stale results after a publish.
 */
export const defaultRevalidationRules: RevalidationMap = {
  posts: {
    paths: ["/blog", "/blog/{slug}"],
    tags: [
      // Global tags — bust every-site caches (legacy contract).
      "nx:posts",
      "nx:sitemap",
      "nx:feed:posts",
      "nx:search",
      // Phase 15.10 — site-scoped tags so multi-tenant deploys
      // only invalidate the writing tenant's caches. Resolved
      // asynchronously by `revalidateCollection`; if the
      // current request has no resolved siteId, only the
      // global tags above fire (still correct, just over-
      // invalidating).
      "nx:sitemap:{siteId}",
      "nx:feed:{siteId}:posts",
      "nx:feed:{siteId}",
      "nx:search:{siteId}",
    ],
  },
  pages: {
    paths: ["/{slug}", "/"],
    tags: ["nx:pages", "nx:sitemap", "nx:search", "nx:sitemap:{siteId}", "nx:search:{siteId}"],
  },
};
