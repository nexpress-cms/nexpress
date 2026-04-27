import {
  NX_DEFAULT_SITE_ID,
  buildSitemap,
  getCurrentSiteId,
  renderSitemapXml,
} from "@nexpress/core";
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
 * `unstable_cache`. The pipeline's `revalidateCollection`
 * calls `revalidateTag("nx:sitemap")` whenever a write to a
 * sitemap-tagged collection lands, so the cache stays fresh
 * without re-walking the DB on every crawler hit.
 *
 * Phase 14.8 — site-scoped tag. In a multi-tenant deploy
 * where the same worker serves several sites, a write to
 * site A used to bust site B's cache too because both shared
 * `nx:sitemap`. The fresh tag is `nx:sitemap:<siteId>`; the
 * legacy `nx:sitemap` is kept as a fallback so existing
 * `revalidateTag("nx:sitemap")` callers (older plugins,
 * external CDNs, scripts) still work as a "blow away every
 * site" big hammer.
 *
 * Each request constructs a fresh `unstable_cache` wrapper
 * because the `tags` option is fixed at definition time and
 * we need it to vary by siteId. The factory call is cheap;
 * Next dedupes by key parts so repeat calls with the same
 * siteId still hit the same cache entry. Mirrors the 14.3
 * theme/nav pattern.
 */
export async function GET(): Promise<Response> {
  ensureCoreServices();
  const origin = siteOrigin();
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const buildSitemapCached = unstable_cache(
    () => buildSitemapDirect(origin),
    ["nx-sitemap", siteId],
    {
      tags: [`nx:sitemap:${siteId}`, "nx:sitemap"],
      revalidate: 600,
    },
  );
  let body: string;
  try {
    body = await buildSitemapCached();
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
      //
      // Phase 14.9 — `stale-while-revalidate=86400` lets a CDN
      // serve stale XML for up to a day after expiry while it
      // re-fetches in the background. Crawlers tolerate
      // slightly-stale sitemaps fine; the smoothing matters
      // when traffic spikes around the expiry boundary.
      "Cache-Control":
        "public, max-age=600, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}
