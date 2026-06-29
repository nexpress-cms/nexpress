import { NP_DEFAULT_SITE_ID, getCurrentSiteId, searchCollections } from "@nexpress/core";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { isLocale } from "@/i18n.config";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";
import { searchWithShortTtlCache } from "./cache";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_OFFSET = 10_000;

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseCollections(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const slug = raw.trim();
    if (slug) seen.add(slug);
  }
  return seen.size > 0 ? [...seen] : undefined;
}

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");

    const params = request.nextUrl.searchParams;
    const q = params.get("q")?.trim() ?? "";
    if (q.length === 0) {
      return npSuccessResponse({ results: [], total: 0, perCollection: {} });
    }

    const collections = parseCollections(params.get("collections"));

    const limit = parsePositiveInt(params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const page = parsePositiveInt(params.get("page"), 1, 500);
    const offset = params.has("offset")
      ? parsePositiveInt(params.get("offset"), 0, MAX_OFFSET)
      : Math.min((page - 1) * limit, MAX_OFFSET);

    // Phase 12.4 — locale resolution for search results.
    // Order: explicit `?locale=` query > request's own
    // `x-np-locale` header (set by middleware) > Next's
    // `headers()` reader > undefined (cross-locale search).
    // Unknown locale strings are ignored rather than 400'd;
    // the search just doesn't filter.
    const explicitLocale = params.get("locale")?.trim() ?? null;
    let headerLocale: string | null = null;
    if (!explicitLocale) {
      headerLocale = request.headers.get("x-np-locale");
      if (!headerLocale) {
        // `headers()` throws when invoked outside a request
        // scope (e.g. integration tests calling GET()
        // directly). Wrap so the route still works in those
        // contexts — locale just falls back to undefined.
        try {
          const headerList = await headers();
          headerLocale = headerList.get("x-np-locale");
        } catch {
          headerLocale = null;
        }
      }
    }
    const candidate = explicitLocale || headerLocale || null;
    const locale = candidate && isLocale(candidate) ? candidate : undefined;

    // Phase 14.7 — short-TTL cache around `searchCollections`.
    // Hot queries (header search box clicks for the same word
    // on the same locale) skip the DB walk; less-popular
    // queries pay the cache miss once per minute and serve
    // hits the rest of the time. Tagged so writes on any
    // collection invalidate the search cache atomically via
    // `revalidateCollection`.
    //
    // Cache cardinality is bounded by request shape (q,
    // collections, limit, offset, locale) — pathological
    // attackers spamming unique queries would still hit the
    // origin every time, but the per-key memory cost is the
    // result row, not a re-walk.
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const result = await searchWithShortTtlCache({
      siteId,
      q,
      collections,
      limit,
      offset,
      locale,
      search: searchCollections,
    });
    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
