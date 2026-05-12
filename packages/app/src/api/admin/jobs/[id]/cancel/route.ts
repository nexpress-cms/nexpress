import {
  NpForbiddenError,
  NpValidationError,
  getOptionalJobQueue,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 13 — cancel a still-pending job. Already-running
 * jobs can't be cancelled mid-flight (pg-boss has no
 * preemption); already-terminal jobs return 404. Admin-only
 * + CSRF.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "cancel");
    }
    const { id } = await context.params;
    if (!id) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: "Job id is required" },
      ]);
    }
    const queue = getOptionalJobQueue();
    if (!queue || typeof queue.cancelJob !== "function") {
      throw new Error(
        "Job queue is not wired or its adapter does not support cancelJob",
      );
    }
    await queue.cancelJob(id);
    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
