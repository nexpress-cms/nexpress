import { searchCollections } from "@nexpress/core";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { isLocale } from "@/i18n.config";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureCoreServices } from "@/lib/init-core";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
    ensureCoreServices();

    const params = request.nextUrl.searchParams;
    const q = params.get("q")?.trim() ?? "";
    if (q.length === 0) {
      return nxSuccessResponse({ results: [], total: 0, perCollection: {} });
    }

    const collectionsParam = params.get("collections");
    const collections = collectionsParam
      ? collectionsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const limit = parsePositiveInt(params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parsePositiveInt(params.get("offset"), 0, 10_000);

    // Phase 12.4 — locale resolution for search results.
    // Order: explicit `?locale=` query > request's own
    // `x-nx-locale` header (set by middleware) > Next's
    // `headers()` reader > undefined (cross-locale search).
    // Unknown locale strings are ignored rather than 400'd;
    // the search just doesn't filter.
    const explicitLocale = params.get("locale")?.trim() ?? null;
    let headerLocale: string | null = null;
    if (!explicitLocale) {
      headerLocale = request.headers.get("x-nx-locale");
      if (!headerLocale) {
        // `headers()` throws when invoked outside a request
        // scope (e.g. integration tests calling GET()
        // directly). Wrap so the route still works in those
        // contexts — locale just falls back to undefined.
        try {
          const headerList = await headers();
          headerLocale = headerList.get("x-nx-locale");
        } catch {
          headerLocale = null;
        }
      }
    }
    const candidate = explicitLocale || headerLocale || null;
    const locale =
      candidate && isLocale(candidate) ? candidate : undefined;

    const result = await searchCollections({
      q,
      collections,
      limit,
      offset,
      ...(locale ? { locale } : {}),
    });
    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
