import { renderAtomFeed } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { isLocale } from "@/i18n.config";
import { ensureCoreServices } from "@/lib/init-core";

/**
 * Phase 10.4 — Atom feed. Default collection is `posts`; sites
 * with multiple feed-able collections use the `?collection=` query
 * param (e.g. `/feed.xml?collection=discussions`). The collection
 * MUST declare `seo.urlPath` (the same opt-in the sitemap uses)
 * — collections without it return 404.
 *
 * Phase 12.4 — i18n collections accept a `?locale=` query
 * param scoping the feed to one locale's rows. Unknown locale
 * strings are silently ignored (the feed renders all rows
 * across locales rather than 400'ing — feed readers don't
 * surface error responses well).
 */
export async function GET(request: NextRequest): Promise<Response> {
  ensureCoreServices();
  const collection = request.nextUrl.searchParams.get("collection") ?? undefined;
  const localeParam = request.nextUrl.searchParams.get("locale")?.trim();
  const locale =
    localeParam && isLocale(localeParam) ? localeParam : undefined;
  const xml = await renderAtomFeed({
    collection,
    ...(locale ? { locale } : {}),
  });
  if (!xml) {
    return new Response("Feed not configured for this collection.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      // Crawlers and feed readers re-fetch every few minutes;
      // a short cache is plenty.
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}

export const dynamic = "force-dynamic";
