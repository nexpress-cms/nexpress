import {
  NP_DEFAULT_SITE_ID,
  getCurrentSiteId,
  getSiteById,
} from "@nexpress/core";

import { ensureFor } from "@/lib/init-core";

/**
 * Phase 10.1 — robots.txt. Sane defaults: allow general crawl,
 * block authenticated surfaces (/admin, /api) where rendering
 * a meta-description is meaningless, and point at the
 * sitemap. Sites that need stricter rules (no-index for
 * staging, etc.) replace this file with their own copy.
 *
 * Phase 15.11 — robots's `Sitemap:` line resolves the current
 * site's hostname so each tenant in a multi-tenant deploy
 * advertises the right sitemap URL. Single-tenant deploys
 * keep the SITE_URL fallback unchanged.
 */
function fallbackOrigin(): string {
  const configured = process.env.SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return "http://localhost:3000";
}

async function resolveSiteOrigin(): Promise<string> {
  const fallback = fallbackOrigin();
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
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

export async function GET(): Promise<Response> {
  await ensureFor("read");
  const origin = await resolveSiteOrigin();
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /api",
    "Disallow: /members/login",
    "Disallow: /members/register",
    "Disallow: /members/forgot-password",
    "Disallow: /members/reset-password",
    "Disallow: /members/verify",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Phase 14.9 — SWR window so a CDN can serve stale
      // robots during the regen. Crawlers fetch this rarely
      // and tolerate stale entries; the smoothing matters at
      // expiry boundaries.
      "Cache-Control":
        "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

export const dynamic = "force-dynamic";
