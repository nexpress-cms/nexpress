import { NpForbiddenError, getOptionalJobQueue, can } from "@nexpress/core";
import { npRequireJobListWire } from "@nexpress/core/jobs-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { requireGlobalAuth } from "../../../lib/auth-helpers";
import { ensureFor } from "../../../lib/init-core";
import { npParseJobListQuery, npRequireJobApiResponse } from "../../../lib/job-api-contract";

/**
 * Phase 13 — admin job list. Returns a unified view across
 * pgboss.job (active / pending / retry) and pgboss.archive
 * (completed / failed / expired). Admin-only because the
 * payloads can carry sensitive data.
 *
 * Query params:
 *   ?name=media.processImage  → filter to one queue
 *   ?state=failed             → filter to one state
 *   ?limit=50&offset=100      → pagination
 *
 * Returns 501 when no queue is wired (sites running without
 * pg-boss; the framework supports this via NP_ENABLE_JOBS=0)
 * or when the queue's adapter doesn't implement listJobs.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "list");
    }
    const query = npParseJobListQuery(request.nextUrl.searchParams);
    const queue = getOptionalJobQueue();
    if (!queue || typeof queue.listJobs !== "function") {
      return npSuccessResponse(
        npRequireJobApiResponse({ supported: false, jobs: [], total: 0 }, npRequireJobListWire),
      );
    }
    const result = await queue.listJobs(query);
    return npSuccessResponse(
      npRequireJobApiResponse({ supported: true, ...result }, npRequireJobListWire),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
