import { can, NpForbiddenError, listCommunityRoles } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

/**
 * Returns the registered community role definitions so the admin
 * "Grant role" picker can render selectable options. Staff-mod
 * gating mirrors the rest of the community admin surface even
 * though the response itself isn't sensitive — it keeps the
 * authentication signal consistent across the page's network
 * calls.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("communityRoles", "list");
    }
    const docs = listCommunityRoles();
    return npSuccessResponse({ docs });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
