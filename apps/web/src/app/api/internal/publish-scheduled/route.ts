import { publishScheduledDocuments } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Bearer-token-protected trigger for the scheduled-publishing sweep. Designed
 * to be called by external cron (Vercel Cron, systemd timer, Kubernetes
 * CronJob, etc.) every minute or so — the handler is idempotent and cheap.
 *
 * Set `NX_SCHEDULER_TOKEN` in the environment and invoke with
 *   Authorization: Bearer <token>
 *
 * When the env var is unset the endpoint refuses every request so production
 * deploys can't accidentally leave it open.
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.NX_SCHEDULER_TOKEN;
    if (!expected) {
      return nxErrorResponse(
        new Error("Scheduler token not configured (set NX_SCHEDULER_TOKEN)."),
      );
    }

    const header = request.headers.get("authorization") ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!supplied || supplied !== expected) {
      return nxErrorResponse(new Error("Unauthorized"));
    }

    await ensureWriteReady();
    const result = await publishScheduledDocuments();
    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
