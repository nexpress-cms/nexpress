import {
  NP_DEFAULT_SITE_ID,
  getActiveThemeSeoHooks,
  getCurrentSiteId,
  getI18nConfig,
  getSiteById,
} from "@nexpress/core";
import {
  buildSitemap,
  npDefineSitemapEntries,
  renderSitemapIndexXml,
  renderSitemapXml,
} from "@nexpress/core/seo";
import { unstable_cache } from "next/cache";

import { ensureFor } from "../../lib/init-core";

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
const STATIC_ROUTES = npDefineSitemapEntries([
  { loc: "/", priority: 1.0, changefreq: "daily" },
  { loc: "/blog", priority: 0.9, changefreq: "daily" },
  { loc: "/discussions", priority: 0.9, changefreq: "daily" },
  { loc: "/search", priority: 0.5, changefreq: "weekly" },
]);

function fallbackOrigin(): string {
  const configured = process.env.SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return "http://localhost:3000";
}

/**
 * Phase 15.11 — resolve the absolute origin for sitemap
 * entries.
 *
 * In a multi-tenant deploy each site has its own hostname,
 * so a single `SITE_URL` env can't serve every tenant's
 * sitemap correctly. We look up the resolved site's row and
 * use its `hostname` to build the origin; falls back to the
 * env-driven origin when no site is resolved (single-tenant
 * deploys, background workers, scripts).
 *
 * The `https://` scheme is assumed for hostnames. Operators
 * running locally (`localhost:3000`) keep the SITE_URL
 * fallback because their dev hostname doesn't carry a
 * scheme.
 */
async function resolveSiteOrigin(siteId: string): Promise<string> {
  const fallback = fallbackOrigin();
  if (siteId === NP_DEFAULT_SITE_ID) return fallback;
  try {
    const site = await getSiteById(siteId);
    if (site?.hostname) {
      return `https://${site.hostname.replace(/\/+$/, "")}`;
    }
  } catch {
    // Site row gone or DB unreachable — fall through.
  }
  return fallback;
}

/**
 * Direct (uncached) sitemap renderer. Reused as the fallback
 * path when `unstable_cache` can't reach Next's incremental
 * cache (integration tests calling the route directly, scripts
 * invoking the handler outside a request scope).
 *
 * Phase 12.9 — when a `locale` is supplied, emits a per-locale
 * `<urlset>` (i18n collections filtered to that locale,
 * non-i18n collections only included for `defaultLocale`).
 * `null` keeps the legacy single-file behavior used when i18n
 * isn't configured.
 */
async function buildSitemapDirect(
  origin: string,
  locale: string | null,
): Promise<string> {
  const dynamicEntries = await buildSitemap(locale ? { locale } : {});
  // Phase F.7 — pull in theme-contributed entries (e.g. magazine
  // archive landing pages). Theme entries dedupe against the
  // framework output; framework wins on `loc` collision so the
  // theme can't accidentally hide a collection-walk URL.
  const seoHooks = await getActiveThemeSeoHooks();
  const themeEntries = seoHooks.sitemapEntries
    ? await seoHooks.sitemapEntries()
    : [];
  // Static routes only belong in the default-locale sitemap (or
  // the no-i18n single sitemap). Other locales' sitemaps would
  // re-emit the same path and create duplicates the dedup pass
  // can't catch across files.
  const i18n = getI18nConfig();
  const includeStatic =
    !locale || (i18n != null && locale === i18n.defaultLocale);
  const seen = new Set<string>();
  const all = [
    ...(includeStatic ? STATIC_ROUTES : []),
    ...dynamicEntries,
    // Theme entries last — the dedup pass below drops a theme
    // entry whose `loc` matches a framework one, preserving the
    // framework's metadata (priority, changefreq, lastmod).
    ...themeEntries,
  ].filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });
  return renderSitemapXml(origin, all);
}

/**
 * Phase 12.9 — sitemap-index renderer for i18n sites. Emits one
 * `<sitemap>` entry per configured locale pointing back at this
 * route with `?locale=…` so each child sitemap stays under the
 * sitemaps.org per-file cap.
 */
function buildSitemapIndexDirect(
  origin: string,
  locales: readonly string[],
): string {
  return renderSitemapIndexXml(
    origin,
    locales.map((locale) => ({
      loc: `/sitemap.xml?locale=${encodeURIComponent(locale)}`,
    })),
  );
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
export async function GET(req: Request): Promise<Response> {
  await ensureFor("read");
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const origin = await resolveSiteOrigin(siteId);
  const i18n = getI18nConfig();

  // Phase 12.9 — sitemap-index split for i18n sites. When the
  // request lacks a `?locale=…` param and i18n is configured,
  // we emit a `<sitemapindex>` whose entries point back at
  // `?locale=…` so each child stays under sitemaps.org's
  // per-file 50K cap. Otherwise (no i18n, or `?locale` is
  // present) the route renders a `<urlset>` directly.
  const url = new URL(req.url);
  // `?locale=` is meaningful only when i18n is configured. For
  // non-i18n sites we ignore the param entirely (treat as the
  // bare URL) so a stray query string returns the flat sitemap
  // rather than an empty `<urlset>` — buildSitemap with a locale
  // filter on a non-i18n site skips every collection AND drops
  // the static routes, which would silently 200 with no entries.
  const requestedLocale = i18n ? url.searchParams.get("locale") : null;
  if (i18n && requestedLocale && !i18n.locales.includes(requestedLocale)) {
    return new Response("Unknown locale", { status: 404 });
  }
  const mode: "index" | "urlset" =
    i18n && !requestedLocale ? "index" : "urlset";

  // Cache key includes the resolved mode + locale so the index
  // and each per-locale child get distinct cache entries (and
  // the per-locale `revalidateTag("nx:sitemap:<siteId>")` blow
  // still busts every variant for a site).
  const cacheKeyParts = [
    "np-sitemap",
    siteId,
    mode,
    requestedLocale ?? "",
  ];
  const buildBody = async (): Promise<string> => {
    if (mode === "index") {
      return buildSitemapIndexDirect(origin, i18n!.locales);
    }
    return buildSitemapDirect(origin, requestedLocale);
  };
  const buildSitemapCached = unstable_cache(buildBody, cacheKeyParts, {
    tags: [`nx:sitemap:${siteId}`, "nx:sitemap"],
    revalidate: 600,
  });
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
      body = await buildBody();
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

// Sitemap entries come from a per-tenant DB walk (with site
// resolution + collection iteration), so build-time prerender
// is both impossible (no DB at build) and pointless (the data
// changes after deploy). `unstable_cache` already covers the
// hot path at request time.
export const dynamic = "force-dynamic";
