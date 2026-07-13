import { can, NpForbiddenError, getOptionalJobQueue, setJobsPauseState } from "@nexpress/core";
import { npRequireResumeJobsWire } from "@nexpress/core/jobs-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import {
  npParseEmptyJobBody,
  npParseEmptyJobQuery,
  npRequireJobApiResponse,
} from "../../../../lib/job-api-contract";

/**
 * Phase 20.2 — resume job processing. Mirror of `/pause`:
 * flips the persisted flag and re-registers the local adapter's
 * workers via `boss.work()` so the in-process worker starts
 * claiming again. Idempotent — calling resume on a
 * not-paused queue is a no-op.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "resume");
    }
    npParseEmptyJobQuery(request.nextUrl.searchParams);
    npParseEmptyJobBody(await readJsonBody(request));

    const state = await setJobsPauseState({
      paused: false,
      changedByUserId: user.id,
      reason: null,
    });

    const queue = getOptionalJobQueue();
    if (queue && typeof queue.resumeProcessing === "function") {
      await queue.resumeProcessing();
    }

    return npSuccessResponse(
      npRequireJobApiResponse(
        {
          paused: state.paused,
          changedAt: state.changedAt,
          localApplied: Boolean(queue) && typeof queue?.resumeProcessing === "function",
        },
        npRequireResumeJobsWire,
      ),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
