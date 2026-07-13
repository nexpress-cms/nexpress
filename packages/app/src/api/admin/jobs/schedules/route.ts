import { NpForbiddenError, getKnownJobTypes, getOptionalJobQueue, can } from "@nexpress/core";
import { npRequireScheduleListWire } from "@nexpress/core/jobs-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { npParseEmptyJobQuery, npRequireJobApiResponse } from "../../../../lib/job-api-contract";

/**
 * Phase 13.2 — admin introspection for the queue's recurring
 * surface. Returns:
 *   - `schedules` — every cron registered via `boss.schedule()`
 *     (read from `pgboss.schedule`)
 *   - `handlers` — built-in job contracts plus application job
 *     handlers registered in this process. Useful for checking the
 *     exact inventory accepted by manual enqueue.
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
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs/schedules", "list");
    }
    npParseEmptyJobQuery(request.nextUrl.searchParams);
    const queue = getOptionalJobQueue();
    const handlers = [...getKnownJobTypes()];
    if (!queue || typeof queue.listSchedules !== "function") {
      return npSuccessResponse(
        npRequireJobApiResponse(
          { supported: false, schedules: [], handlers },
          npRequireScheduleListWire,
        ),
      );
    }
    const schedules = await queue.listSchedules();
    return npSuccessResponse(
      npRequireJobApiResponse({ supported: true, schedules, handlers }, npRequireScheduleListWire),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
