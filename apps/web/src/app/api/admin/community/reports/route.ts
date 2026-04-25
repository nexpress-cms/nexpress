import { NxForbiddenError, isStaffMod, listReports } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!isStaffMod(user)) {
      throw new NxForbiddenError("reports", "list");
    }

    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    const targetType = params.get("targetType")?.trim();
    const limit = parsePositiveInt(params.get("limit"), 50, 200);
    const page = parsePositiveInt(params.get("page"), 1, 10_000);
    const offset = (page - 1) * limit;

    const result = await listReports({
      status: status === "resolved" || status === "all" ? status : "unresolved",
      targetType: targetType || undefined,
      limit,
      offset,
    });

    const totalPages = result.totalDocs === 0 ? 0 : Math.ceil(result.totalDocs / limit);

    return nxSuccessResponse({
      docs: result.reports,
      totalDocs: result.totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1 && result.totalDocs > 0,
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
