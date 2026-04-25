import { NxAuthError, publishScheduledDocuments } from "@nexpress/core";
import { NextResponse } from "next/server";
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
      // Misconfiguration on the operator side — distinguish from server
      // failure (500) so monitors can alert correctly.
      return NextResponse.json(
        {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Scheduler token not configured (set NX_SCHEDULER_TOKEN).",
          },
          status: 503,
        },
        { status: 503 },
      );
    }

    const header = request.headers.get("authorization") ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!supplied || supplied !== expected) {
      throw new NxAuthError("Unauthorized");
    }

    await ensureWriteReady();
    const result = await publishScheduledDocuments();
    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
