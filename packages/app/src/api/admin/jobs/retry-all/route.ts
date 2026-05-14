import {
  NpForbiddenError,
  getOptionalJobQueue,
  type NpJobState,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

/**
 * Phase 13.3 — bulk retry. Re-enqueues every job in the
 * specified state(s) as fresh jobs. Defaults to retrying
 * `failed` only; an explicit `?state=cancelled` etc. picks a
 * different bucket. Optional `?name=<queue>` narrows further.
 *
 * Cap at 200 per call so a runaway "retry everything" doesn't
 * stall the queue. Operators with a larger backlog can call
 * the endpoint repeatedly; the response includes the count
 * actually retried so the UI can re-fetch and surface
 * remaining work.
 *
 * Admin-only + CSRF; same gate as the per-job retry endpoint.
 */
const BULK_LIMIT = 200;
const RETRYABLE_STATES: ReadonlyArray<NpJobState> = [
  "failed",
  "cancelled",
  "expired",
];

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "retry-all");
    }
    const queue = getOptionalJobQueue();
    if (
      !queue ||
      typeof queue.listJobs !== "function" ||
      typeof queue.retryJob !== "function"
    ) {
      throw new Error(
        "Job queue is not wired or its adapter does not support listJobs/retryJob",
      );
    }

    const params = request.nextUrl.searchParams;
    const stateRaw = params.get("state");
    const state =
      stateRaw && (RETRYABLE_STATES as readonly string[]).includes(stateRaw)
        ? (stateRaw as NpJobState)
        : "failed";
    const name = params.get("name") ?? undefined;

    const list = await queue.listJobs({
      state,
      ...(name ? { name } : {}),
      limit: BULK_LIMIT,
      offset: 0,
    });

    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const job of list.jobs) {
      try {
        await queue.retryJob(job.id);
        results.push({ id: job.id, ok: true });
      } catch (error) {
        results.push({
          id: job.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const retried = results.filter((r) => r.ok).length;
    const failed = results.length - retried;

    return npSuccessResponse({
      retried,
      failed,
      // Total is `list.total` not `list.jobs.length` — surfaces
      // "you re-queued 200 of 542; click again to chip away
      // at the rest" through the UI.
      total: list.total,
      remaining: Math.max(0, list.total - retried),
      results,
    });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}
