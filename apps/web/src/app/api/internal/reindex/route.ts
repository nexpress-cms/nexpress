import { NpAuthError, getAllCollectionSlugs, reindexCollection } from "@nexpress/core";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { ensureFor } from "@/lib/init-core";

/**
 * Bearer-token-protected search-vector reindex trigger. Useful after bulk
 * imports or migrations that bypass the pipeline. Pass `?collection=<slug>`
 * to scope to one collection; omit to reindex everything.
 *
 * Reuses NP_SCHEDULER_TOKEN — the same token guards all internal triggers.
 * Bundling under one secret avoids multiplying rotation surface.
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.NP_SCHEDULER_TOKEN;
    if (!expected) {
      // Misconfiguration on the operator side — distinguish from server
      // failure (500) so monitors can alert correctly.
      return NextResponse.json(
        {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Internal trigger token not configured (set NP_SCHEDULER_TOKEN).",
          },
          status: 503,
        },
        { status: 503 },
      );
    }

    const header = request.headers.get("authorization") ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!supplied || supplied !== expected) {
      throw new NpAuthError("Unauthorized");
    }

    await ensureFor("write");

    const requested = request.nextUrl.searchParams.get("collection")?.trim();
    const slugs = requested ? [requested] : getAllCollectionSlugs();
    const results = [];
    for (const slug of slugs) {
      results.push(await reindexCollection(slug));
    }

    const total = results.reduce((sum, r) => sum + r.processed, 0);
    return npSuccessResponse({ total, collections: results });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
