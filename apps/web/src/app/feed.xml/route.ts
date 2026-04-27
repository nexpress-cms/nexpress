import { renderAtomFeed } from "@nexpress/core";
import { unstable_cache } from "next/cache";
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
 *
 * Phase 14.1 — wrap rendering in `unstable_cache` keyed on
 * `nx:feed:{collection}` so writes to that collection bust
 * the cache via `revalidateTag` while every other write
 * leaves it warm. The HTTP `Cache-Control` below is layered
 * on top for downstream CDN / browser caching.
 */

/**
 * Direct (uncached) feed renderer. Reused as the fallback
 * path when `unstable_cache`'s incremental cache isn't
 * available (integration tests calling the route directly,
 * scripts, server actions outside a request scope).
 */
async function renderAtomFeedDirect(
  collection: string | undefined,
  locale: string | undefined,
): Promise<string | null> {
  return await renderAtomFeed({
    ...(collection ? { collection } : {}),
    ...(locale ? { locale } : {}),
  });
}

const renderAtomFeedCached = unstable_cache(
  renderAtomFeedDirect,
  ["nx-feed"],
  {
    revalidate: 600,
    // The base "nx:feed" tag plus per-collection sub-tags
    // (e.g. "nx:feed:posts") so writes can target a single
    // feed via `revalidateTag("nx:feed:posts")` without
    // collateral invalidating other collections' feeds.
    tags: ["nx:feed", "nx:feed:posts"],
  },
);

export async function GET(request: NextRequest): Promise<Response> {
  ensureCoreServices();
  const collection = request.nextUrl.searchParams.get("collection") ?? undefined;
  const localeParam = request.nextUrl.searchParams.get("locale")?.trim();
  const locale =
    localeParam && isLocale(localeParam) ? localeParam : undefined;
  let xml: string | null;
  try {
    xml = await renderAtomFeedCached(collection, locale);
  } catch (error) {
    if (
      error instanceof Error &&
      /incrementalCache/i.test(error.message)
    ) {
      xml = await renderAtomFeedDirect(collection, locale);
    } else {
      throw error;
    }
  }
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
