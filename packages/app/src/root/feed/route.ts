import {
  NP_DEFAULT_SITE_ID,
  getActiveThemeSeoHooks,
  getCurrentSiteId,
  renderAtomFeed,
} from "@nexpress/core";
import { unstable_cache } from "next/cache";
import type { NextRequest } from "next/server";

import { isLocale } from "@/i18n.config";
import { ensureFor } from "../../lib/init-core";

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
  // Phase F.7 — pull theme-contributed extra entries (e.g. theme
  // archive / curated views that aren't in the collection walk).
  // Pass them to renderAtomFeed which dedups + re-sorts.
  const seoHooks = await getActiveThemeSeoHooks();
  const extraEntries = seoHooks.feedEntries
    ? await seoHooks.feedEntries()
    : undefined;
  return await renderAtomFeed({
    ...(collection ? { collection } : {}),
    ...(locale ? { locale } : {}),
    ...(extraEntries && extraEntries.length > 0 ? { extraEntries } : {}),
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  await ensureFor("read");
  const collection = request.nextUrl.searchParams.get("collection") ?? undefined;
  const localeParam = request.nextUrl.searchParams.get("locale")?.trim();
  const locale =
    localeParam && isLocale(localeParam) ? localeParam : undefined;
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  // Phase 14.8 — site-scoped tags so a multi-tenant deploy
  // doesn't bust feed caches across sites on every write. The
  // legacy `nx:feed` / `nx:feed:<collection>` tags are kept
  // alongside as a fallback for the existing global-bust
  // contract. Mirrors the 14.3 theme/nav pattern.
  const collectionKey = collection ?? "posts";
  const renderAtomFeedCached = unstable_cache(
    () => renderAtomFeedDirect(collection, locale),
    ["np-feed", siteId, collectionKey, locale ?? ""],
    {
      revalidate: 600,
      tags: [
        `nx:feed:${siteId}:${collectionKey}`,
        `nx:feed:${siteId}`,
        `nx:feed:${collectionKey}`,
        "nx:feed",
      ],
    },
  );
  let xml: string | null;
  try {
    xml = await renderAtomFeedCached();
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
      // a short cache is plenty. Phase 14.9 — SWR window so a
      // CDN can serve stale entries during the regen
      // round-trip; feed readers don't surface a 5-second
      // delay anyway.
      "Cache-Control":
        "public, max-age=600, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}

// Per-tenant DB-backed feed; build-time prerender is impossible
// (no DB at build) and pointless (data changes after deploy).
// `unstable_cache` already pins the hot path at request time.
export const dynamic = "force-dynamic";
