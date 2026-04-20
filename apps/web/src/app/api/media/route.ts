import { NxValidationError, listMedia } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { optionalAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureCoreServices } from "@/lib/init-core";

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
    await optionalAuth(request);
    ensureCoreServices();

    const params = request.nextUrl.searchParams;
    const page = parsePositiveInt(params.get("page"), "page", 1);
    const limit = parsePositiveInt(params.get("limit"), "limit", 20, 100);
    const folderId = params.get("folderId") ?? undefined;
    const mimeType = params.get("mimeType") ?? undefined;

    const result = await listMedia({ page, limit, folderId, mimeType });

    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
