import {
  NpForbiddenError,
  NpValidationError,
  enqueueJob,
  getAllJobHandlers,
  getOptionalJobQueue,
  type NpJobType,
  can,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

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
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "enqueue");
    }
    const queue = getOptionalJobQueue();
    if (!queue) {
      throw new Error(
        "Job queue is not wired (NP_ENABLE_JOBS=0?). Cannot enqueue.",
      );
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const typeRaw = body.type;
    if (typeof typeRaw !== "string" || typeRaw.length === 0) {
      throw new NpValidationError("Invalid input", [
        { field: "type", message: "Job type is required (e.g. 'media:cleanup')" },
      ]);
    }

    const handlers = getAllJobHandlers();
    if (!handlers.has(typeRaw as NpJobType)) {
      const available = Array.from(handlers.keys()).sort();
      throw new NpValidationError("Invalid input", [
        {
          field: "type",
          message: `No handler registered for "${typeRaw}". Registered: ${available.join(", ") || "(none)"}`,
        },
      ]);
    }

    const data =
      typeof body.data === "object" && body.data !== null ? body.data : {};
    const id = await enqueueJob(typeRaw as NpJobType, data);
    return npSuccessResponse({ id, type: typeRaw, data });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}
