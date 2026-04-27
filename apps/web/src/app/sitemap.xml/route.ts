import { buildSitemap, renderSitemapXml } from "@nexpress/core";
import { unstable_cache } from "next/cache";

import { ensureCoreServices } from "@/lib/init-core";

/**
 * Phase 10.1 — sitemap.xml. The core helper walks every
 * collection that opts in via `seo.urlPath` and emits entries
 * for published documents. We layer on the static routes the
 * reference app exposes (home, /blog index, /discussions index,
 * /search) so crawlers find them too — those pages aren't
 * collection rows.
 *
 * `SITE_URL` provides the absolute origin. Sites that don't set
 * it fall back to `http://localhost:3000` which is fine for
 * dev (and the sitemap.org spec doesn't require a public URL
 * during local development).
 */
const STATIC_ROUTES: Array<{ loc: string; priority?: number; changefreq?: "daily" | "weekly" }> = [
  { loc: "/", priority: 1.0, changefreq: "daily" },
  { loc: "/blog", priority: 0.9, changefreq: "daily" },
  { loc: "/discussions", priority: 0.9, changefreq: "daily" },
  { loc: "/search", priority: 0.5, changefreq: "weekly" },
];

function siteOrigin(): string {
  const configured = process.env.SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return "http://localhost:3000";
}

/**
 * Direct (uncached) sitemap renderer. Reused as the fallback
 * path when `unstable_cache` can't reach Next's incremental
 * cache (integration tests calling the route directly, scripts
 * invoking the handler outside a request scope).
 */
async function buildSitemapDirect(origin: string): Promise<string> {
  const dynamicEntries = await buildSitemap();
  const seen = new Set<string>();
  const all = [...STATIC_ROUTES, ...dynamicEntries].filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });
  return renderSitemapXml(origin, all);
}

/**
 * Phase 14.1 — wrap the expensive collection walk in
 * `unstable_cache` keyed by `nx:sitemap`. The pipeline's
 * `revalidateCollection` (with the 14.1 tag bump) calls
 * `revalidateTag("nx:sitemap")` whenever a write to any
 * sitemap-tagged collection (`pages`, `posts`, ...) lands,
 * so the cache stays fresh without us re-walking the DB on
 * every crawler hit.
 *
 * Cache miss cost: one `findDocuments` call per opted-in
 * collection. Cache hit: zero DB load. The HTTP
 * `Cache-Control: s-maxage=600` below is independent and
 * still useful for downstream CDN caching.
 */
const buildSitemapCached = unstable_cache(
  buildSitemapDirect,
  ["nx-sitemap"],
  { tags: ["nx:sitemap"], revalidate: 600 },
);

export async function GET(): Promise<Response> {
  ensureCoreServices();
  const origin = siteOrigin();
  let body: string;
  try {
    body = await buildSitemapCached(origin);
  } catch (error) {
    // `unstable_cache` requires Next's incremental cache,
    // which is absent in route handlers invoked directly
    // (integration tests, scripts). Fall through to the
    // uncached path so the route still works in those
    // contexts; production traffic always has the cache.
    if (
      error instanceof Error &&
      /incrementalCache/i.test(error.message)
    ) {
      body = await buildSitemapDirect(origin);
    } else {
      throw error;
    }
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Layered caching: Next's data cache (above) avoids
      // re-walking the DB; the HTTP cache here lets a CDN /
      // browser hold the rendered XML for ~10 min so even the
      // origin Next process gets pinned less often.
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}
