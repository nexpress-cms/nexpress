import { NpAuthError, NpServiceUnavailableError, publishScheduledDocuments } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";
import { revalidatePublishedDocuments } from "../../../lib/scheduled-publish-revalidate";

/**
 * Bearer-token-protected trigger for the scheduled-publishing sweep. Designed
 * to be called by external cron (Vercel Cron, systemd timer, Kubernetes
 * CronJob, etc.) every minute or so — the handler is idempotent and cheap.
 *
 * Set `NP_SCHEDULER_TOKEN` in the environment and invoke with
 *   Authorization: Bearer <token>
 *
 * When the env var is unset the endpoint refuses every request so production
 * deploys can't accidentally leave it open.
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.NP_SCHEDULER_TOKEN;
    if (!expected) {
      // Misconfiguration on the operator side — distinguish from server
      // failure (500) so monitors can alert correctly.
      throw new NpServiceUnavailableError(
        "Scheduler token not configured (set NP_SCHEDULER_TOKEN).",
      );
    }

    const header = request.headers.get("authorization") ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!supplied || supplied !== expected) {
      throw new NpAuthError("Unauthorized");
    }

    await ensureFor("write");
    const at = new Date();
    const result = await publishScheduledDocuments(at);
    await revalidatePublishedDocuments(result.byCollection);
    return npSuccessResponse({ ...result, at: at.toISOString() });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
