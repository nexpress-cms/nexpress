import { NpForbiddenError, NpValidationError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { gatherOpsReadiness, resolveOpsReadinessTarget } from "../../../../lib/ops-readiness";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("ops-readiness", "read");
    }

    const targetParam = request.nextUrl.searchParams.get("target");
    const resolved = resolveOpsReadinessTarget(targetParam);
    if (resolved.invalidTarget) {
      throw new NpValidationError("Invalid deploy target", [
        {
          field: "target",
          message: "target must be one of: vercel, railway, render, fly, docker",
        },
      ]);
    }

    const report = await gatherOpsReadiness({
      target: resolved.target,
      inferredTarget: resolved.inferred,
    });
    return npSuccessResponse(report);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
