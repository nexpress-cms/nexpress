import {
  NpForbiddenError,
  NpJobPayloadValidationError,
  NpValidationError,
  enqueueJobWithResult,
  getKnownJobTypes,
  getOptionalJobQueue,
  can,
} from "@nexpress/core";
import { npRequireEnqueueJobWire } from "@nexpress/core/jobs-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import {
  npParseEmptyJobQuery,
  npParseEnqueueJobBody,
  npRequireJobApiResponse,
} from "../../../../lib/job-api-contract";

/**
 * Phase 13.3 — manual enqueue. Lets an admin trigger a
 * registered handler with a JSON payload from the admin UI.
 * Useful for one-off "reindex now" / "cleanup orphaned media"
 * style runs without dropping into a shell.
 *
 * Guard: only handler types that have a registered handler
 * will accept enqueues. This isn't a security boundary
 * (admin-only already gates the endpoint) — it's defensive
 * UX so a typo in the dispatch name doesn't sit in the queue
 * forever with no consumer.
 *
 * Admin-only + CSRF.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "enqueue");
    }
    npParseEmptyJobQuery(request.nextUrl.searchParams);
    const { type, data } = npParseEnqueueJobBody(await readJsonBody(request));
    const queue = getOptionalJobQueue();
    if (!queue) {
      throw new Error("Job queue is not wired (NP_ENABLE_JOBS=0?). Cannot enqueue.");
    }

    const handlers = getKnownJobTypes();
    if (!handlers.includes(type)) {
      const available = [...handlers];
      throw new NpValidationError("Invalid input", [
        {
          field: "type",
          message: `No handler registered for "${type}". Registered: ${available.join(", ") || "(none)"}`,
        },
      ]);
    }

    let enqueued;
    try {
      enqueued = await enqueueJobWithResult(type, data);
    } catch (error) {
      if (!(error instanceof NpJobPayloadValidationError)) throw error;
      throw new NpValidationError("Invalid input", [
        {
          field: "data",
          message: error.message,
        },
      ]);
    }
    return npSuccessResponse(npRequireJobApiResponse(enqueued, npRequireEnqueueJobWire));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
