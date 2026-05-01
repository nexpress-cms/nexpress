import { can, NxForbiddenError, getOptionalJobQueue, setJobsPauseState } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

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
      throw new NxForbiddenError("jobs", "resume");
    }

    const state = await setJobsPauseState({
      paused: false,
      changedByUserId: user.id,
      reason: null,
    });

    const queue = getOptionalJobQueue();
    if (queue && typeof queue.resumeProcessing === "function") {
      await queue.resumeProcessing();
    }

    return nxSuccessResponse({
      paused: state.paused,
      changedAt: state.changedAt,
      localApplied: Boolean(queue) && typeof queue?.resumeProcessing === "function",
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
