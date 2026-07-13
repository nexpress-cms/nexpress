import { NpForbiddenError, getOptionalJobQueue, can } from "@nexpress/core";
import { npRequireJobListWire, npRequireRetryAllJobsWire } from "@nexpress/core/jobs-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import {
  npParseEmptyJobBody,
  npParseRetryAllQuery,
  npRequireJobApiResponse,
} from "../../../../lib/job-api-contract";

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
export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "retry-all");
    }
    const { state, name } = npParseRetryAllQuery(request.nextUrl.searchParams);
    npParseEmptyJobBody(await readJsonBody(request));
    const queue = getOptionalJobQueue();
    if (!queue || typeof queue.listJobs !== "function" || typeof queue.retryJob !== "function") {
      throw new Error("Job queue is not wired or its adapter does not support listJobs/retryJob");
    }

    const list = npRequireJobApiResponse(
      {
        supported: true,
        ...(await queue.listJobs({
          state,
          ...(name ? { name } : {}),
          limit: BULK_LIMIT,
          offset: 0,
        })),
      },
      npRequireJobListWire,
    );

    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const job of list.jobs) {
      try {
        await queue.retryJob(job.id);
        results.push({ id: job.id, ok: true });
      } catch (error) {
        results.push({
          id: job.id,
          ok: false,
          error:
            error instanceof Error
              ? error.message || "Unknown retry failure"
              : String(error) || "Unknown retry failure",
        });
      }
    }
    const retried = results.filter((r) => r.ok).length;
    const failed = results.length - retried;

    return npSuccessResponse(
      npRequireJobApiResponse(
        {
          retried,
          failed,
          total: list.total,
          remaining: Math.max(0, list.total - retried),
          results,
        },
        npRequireRetryAllJobsWire,
      ),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
