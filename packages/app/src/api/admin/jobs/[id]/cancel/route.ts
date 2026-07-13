import { NpForbiddenError, getOptionalJobQueue, can } from "@nexpress/core";
import { npRequireCancelJobWire } from "@nexpress/core/jobs-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";
import {
  npParseEmptyJobBody,
  npParseEmptyJobQuery,
  npParseJobId,
  npRequireJobApiResponse,
} from "../../../../../lib/job-api-contract";

/**
 * Phase 13 — cancel a still-pending job. Already-running
 * jobs can't be cancelled mid-flight (pg-boss has no
 * preemption); already-terminal jobs return 404. Admin-only
 * + CSRF.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "cancel");
    }
    const id = npParseJobId((await context.params).id);
    npParseEmptyJobQuery(request.nextUrl.searchParams);
    npParseEmptyJobBody(await readJsonBody(request));
    const queue = getOptionalJobQueue();
    if (!queue || typeof queue.cancelJob !== "function") {
      throw new Error("Job queue is not wired or its adapter does not support cancelJob");
    }
    await queue.cancelJob(id);
    return npSuccessResponse(npRequireJobApiResponse({ ok: true }, npRequireCancelJobWire));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
