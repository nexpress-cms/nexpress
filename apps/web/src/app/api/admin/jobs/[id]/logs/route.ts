import {
  NxForbiddenError,
  NxValidationError,
  countJobLogs,
  listJobLogs,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 20.3b — read the captured log stream for one job. Backs the
 * collapsible "Logs" panel in the admin Jobs view; the operator
 * expands a row, the panel fetches once, and renders timestamped
 * entries inline. Optional `?limit=` / `?offset=` for pagination,
 * defaulting to the helper's 200 cap (max 1000).
 *
 * Gated to `editor` and above — the same level that sees the
 * jobs admin's other read endpoints. No CSRF gate because GET
 * is read-only.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NxForbiddenError("job-logs", "read");
    }
    const { id } = await context.params;
    if (!id) {
      throw new NxValidationError("Invalid input", [
        { field: "id", message: "Job id is required" },
      ]);
    }

    const params = request.nextUrl.searchParams;
    const limitRaw = params.get("limit");
    const offsetRaw = params.get("offset");
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
    const offset = offsetRaw ? parseInt(offsetRaw, 10) : undefined;

    const [entries, total] = await Promise.all([
      listJobLogs(id, {
        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        ...(offset !== undefined && Number.isFinite(offset) ? { offset } : {}),
      }),
      countJobLogs(id),
    ]);

    return nxSuccessResponse({
      jobId: id,
      total,
      entries: entries.map((e) => ({
        id: e.id,
        level: e.level,
        message: e.message,
        context: e.context,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
