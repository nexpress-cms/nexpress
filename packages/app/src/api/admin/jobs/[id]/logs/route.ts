import {
  NpForbiddenError,
  NpValidationError,
  countJobLogs,
  listJobLogs,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireAuth } from "../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";

/**
 * Phase 20.3b — read the captured log stream for one job. Backs the
 * collapsible "Logs" panel in the admin Jobs view; the operator
 * expands a row, the panel fetches once, and renders timestamped
 * entries inline. Optional `?limit=` / `?offset=` for pagination,
 * defaulting to the helper's 200 cap (max 1000).
 *
 * Gated to `admin.manage` — same level as the rest of the
 * jobs admin surface. Job logs can include payload snippets,
 * member/user ids, import metadata, and failure messages, so
 * they shouldn't leak to editors. No CSRF gate because GET
 * is read-only.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("job-logs", "read");
    }
    const { id } = await context.params;
    if (!id) {
      throw new NpValidationError("Invalid input", [
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

    return npSuccessResponse({
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
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
