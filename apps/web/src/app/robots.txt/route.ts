/**
 * Phase 10.1 — robots.txt. Sane defaults: allow general crawl,
 * block authenticated surfaces (/admin, /api) where rendering
 * a meta-description is meaningless, and point at the
 * sitemap. Sites that need stricter rules (no-index for
 * staging, etc.) replace this file with their own copy.
 */
function siteOrigin(): string {
  const configured = process.env.SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return "http://localhost:3000";
}

export function GET(): Response {
  const origin = siteOrigin();
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
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

export const dynamic = "force-dynamic";
