import {
  NpAuthError,
  NpServiceUnavailableError,
  NpValidationError,
  getAllCollectionSlugs,
} from "@nexpress/core";
import {
  NpSearchContractError,
  npParseSearchReindexQuery,
  npRequireSearchReindexResponse,
  npSearchContractLimits,
  reindexCollection,
  type NpSearchReindexResult,
} from "@nexpress/core/search";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";

/**
 * Bearer-token-protected search reindex trigger. Rebuilds Postgres vectors and
 * any installed external indexing snapshot after bulk imports, migrations, or
 * first-time adapter installation. Pass `?collection=<slug>` to scope to one
 * collection; omit to reindex everything.
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
      throw new NpServiceUnavailableError(
        "Internal trigger token not configured (set NP_SCHEDULER_TOKEN).",
      );
    }

    const header = request.headers.get("authorization") ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!supplied || supplied !== expected) {
      throw new NpAuthError("Unauthorized");
    }

    const requested = npParseSearchReindexQuery(request.nextUrl.searchParams);
    await ensureFor("write");
    const slugs = requested ? [requested] : getAllCollectionSlugs();
    if (slugs.length > npSearchContractLimits.collectionCount) {
      throw new NpSearchContractError("Invalid search reindex request", [
        {
          code: "max-items",
          path: "search.reindex.collections",
          message: `at most ${npSearchContractLimits.collectionCount.toString()} collections may be reindexed in one request.`,
        },
      ]);
    }
    const results: NpSearchReindexResult[] = [];
    for (const slug of slugs) {
      results.push(await reindexCollection(slug));
    }

    const response = npRequireSearchReindexResponse({
      total: results.reduce((sum, result) => sum + result.processed, 0),
      collections: results,
    });
    return npSuccessResponse(response);
  } catch (error) {
    if (error instanceof NpSearchContractError) {
      return npErrorResponse(
        new NpValidationError(
          "Invalid search reindex request",
          error.issues.map((entry) => ({ field: entry.path, message: entry.message })),
        ),
      );
    }
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
