import { NpForbiddenError, can } from "@nexpress/core";
import { getCustomRoutes } from "@nexpress/core/routes";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";

/**
 * Lists every developer-declared custom route registered via
 * `registerCustomRoute(...)`. Powers the Settings → Routes tab and
 * the navigation editor's URL autocomplete.
 *
 * Capability-gated on `admin.manage` because the list reveals app-
 * internal surface (paths the operator may not have publicized) and
 * shouldn't leak to anonymous traffic.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("custom-routes", "list");
    }

    return npSuccessResponse({ routes: getCustomRoutes() });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
