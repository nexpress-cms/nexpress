import { buildSitemap, renderSitemapXml } from "@nexpress/core";

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

export async function GET(): Promise<Response> {
  ensureCoreServices();
  const origin = siteOrigin();
  const dynamic = await buildSitemap();

  // Dedupe in case `seo.urlPath` ever returns a path that matches
  // a static route (unlikely with `/blog`, possible with `/`).
  const seen = new Set<string>();
  const all = [...STATIC_ROUTES, ...dynamic].filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });

  const body = renderSitemapXml(origin, all);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Crawlers are happy with a short cache; rebuild every
      // ~10 min so a freshly-published doc appears soon.
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}

export const dynamic = "force-dynamic";
