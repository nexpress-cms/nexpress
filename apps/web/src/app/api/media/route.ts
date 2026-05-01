import { can, NxForbiddenError, NxValidationError, listMedia } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureFor } from "@/lib/init-core";

function parsePositiveInt(
  value: string | null,
  field: string,
  fallback: number,
  max?: number,
): number {
  if (value === null || value.length === 0) return fallback;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
    throw new NxValidationError("Invalid query parameters", [
      {
        field,
        message:
          max === undefined
            ? "Must be a positive integer"
            : `Must be a positive integer no greater than ${max}`,
      },
    ]);
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    // Library metadata (storage keys, hashes, original filenames,
    // uploader linkage) was readable anonymously via `optionalAuth`
    // (#73). The public site uses `getMediaById` server-side and
    // serves storage URLs directly; no anonymous client needs the
    // admin-library shape. Require at least an editor session.
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NxForbiddenError("media", "list");
    }
    await ensureFor("read");

    const params = request.nextUrl.searchParams;
    const page = parsePositiveInt(params.get("page"), "page", 1);
    const limit = parsePositiveInt(params.get("limit"), "limit", 20, 100);
    const folderId = params.get("folderId") ?? undefined;
    const mimeType = params.get("mimeType") ?? undefined;
    // Phase 9.7k: optional uploader filters for the moderation
    // surface. Anything other than the two enum values is treated
    // as "no filter" — we don't 400 on a typo because the param
    // is operator-typed in URLs.
    const uploaderKindRaw = params.get("uploaderKind");
    const uploaderKind =
      uploaderKindRaw === "staff" || uploaderKindRaw === "member"
        ? uploaderKindRaw
        : undefined;
    const uploadedByMemberId = params.get("uploadedByMemberId") ?? undefined;

    const result = await listMedia({
      page,
      limit,
      folderId,
      mimeType,
      uploaderKind,
      uploadedByMemberId,
    });

    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
