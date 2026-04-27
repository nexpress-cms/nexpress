import {
  NxForbiddenError,
  getAllJobHandlers,
  getOptionalJobQueue,
  hasRole,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Phase 13.2 — admin introspection for the queue's recurring
 * surface. Returns:
 *   - `schedules` — every cron registered via `boss.schedule()`
 *     (read from `pgboss.schedule`)
 *   - `handlers` — every job type with a registered handler.
 *     Useful so operators can confirm e.g. `media:processImage`
 *     is wired up before pushing a feature that enqueues it.
 *
 * Both lists are admin-only because they reveal the
 * deployment's job topology.
 *
 * Returns `supported: false` when no queue is wired so the
 * admin UI can render an empty-state without 500ing on every
 * tab visit.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("jobs/schedules", "list");
    }
    const queue = getOptionalJobQueue();
    const handlers = Array.from(getAllJobHandlers().keys()).sort();
    if (!queue || typeof queue.listSchedules !== "function") {
      return nxSuccessResponse({
        supported: false,
        schedules: [],
        handlers,
      });
    }
    const schedules = await queue.listSchedules();
    return nxSuccessResponse({
      supported: true,
      schedules,
      handlers,
    });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
