import { NpForbiddenError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { gatherSystemHealth } from "../../../../lib/system-health";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("ops-health", "read");
    }

    const summary = await gatherSystemHealth();
    return npSuccessResponse({
      schemaVersion: "np.admin-ops-health.v1",
      ...summary,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
