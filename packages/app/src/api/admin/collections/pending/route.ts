import {
  NpForbiddenError,
  listPendingMemberDocs,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

/**
 * Cross-collection moderation queue for member-authored docs that
 * landed `status = "pending"`. Staff-mod gated (admin / editor /
 * moderator) — same surface as `/api/admin/community/reports` and
 * comment moderation. Each row carries the resolved member-author
 * info so the UI can show "by @handle" without a follow-up
 * `/api/members/[id]` round-trip.
 */
function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("collection.pending", "list");
    }

    const params = request.nextUrl.searchParams;
    const slug = params.get("slug")?.trim();
    const limit = parsePositiveInt(params.get("limit"), 50, 200);
    const page = parsePositiveInt(params.get("page"), 1, 10_000);
    const offset = (page - 1) * limit;

    const result = await listPendingMemberDocs({
      collectionSlug: slug || undefined,
      limit,
      offset,
    });

    const totalPages = result.totalDocs === 0 ? 0 : Math.ceil(result.totalDocs / limit);

    return npSuccessResponse({
      docs: result.docs.map((doc) => ({
        ...doc,
        createdAt: doc.createdAt.toISOString(),
      })),
      totalDocs: result.totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1 && result.totalDocs > 0,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
