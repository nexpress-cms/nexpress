import {
  NxForbiddenError,
  NxValidationError,
  getOptionalJobQueue,
  hasRole,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Phase 13 — re-enqueue a job's payload as a brand-new job.
 * Useful for failed jobs the operator wants to give another
 * shot after fixing the upstream issue. Admin-only + CSRF
 * because triggering a job has side effects (sending emails,
 * processing media, etc.).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    requireCsrf(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("jobs", "retry");
    }
    const { id } = await context.params;
    if (!id) {
      throw new NxValidationError("Invalid input", [
        { field: "id", message: "Job id is required" },
      ]);
    }
    const queue = getOptionalJobQueue();
    if (!queue || typeof queue.retryJob !== "function") {
      throw new Error(
        "Job queue is not wired or its adapter does not support retryJob",
      );
    }
    const newId = await queue.retryJob(id);
    return nxSuccessResponse({ id: newId });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
