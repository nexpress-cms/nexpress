import { getAllCollectionSlugs, reindexCollection } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Bearer-token-protected search-vector reindex trigger. Useful after bulk
 * imports or migrations that bypass the pipeline. Pass `?collection=<slug>`
 * to scope to one collection; omit to reindex everything.
 *
 * Reuses NX_SCHEDULER_TOKEN — the same token guards all internal triggers.
 * Bundling under one secret avoids multiplying rotation surface.
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.NX_SCHEDULER_TOKEN;
    if (!expected) {
      return nxErrorResponse(
        new Error("Internal trigger token not configured (set NX_SCHEDULER_TOKEN)."),
      );
    }

    const header = request.headers.get("authorization") ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!supplied || supplied !== expected) {
      return nxErrorResponse(new Error("Unauthorized"));
    }

    await ensureWriteReady();

    const requested = request.nextUrl.searchParams.get("collection")?.trim();
    const slugs = requested ? [requested] : getAllCollectionSlugs();
    const results = [];
    for (const slug of slugs) {
      results.push(await reindexCollection(slug));
    }

    const total = results.reduce((sum, r) => sum + r.processed, 0);
    return nxSuccessResponse({ total, collections: results });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
