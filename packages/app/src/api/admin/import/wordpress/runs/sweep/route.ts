import { npWithAgentGuardianHttpResponseV1 } from "../../../../../../lib/agents/guardian-http-observer";
import { NpForbiddenError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import { requireAuth } from "../../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../../lib/init-core";
import { sweepStaleWordPressImportRuns } from "../../../../../../lib/wp-import-admin";

export const dynamic = "force-dynamic";

async function npGuardianPOST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("wp-import-runs", "sweep");
    }

    const result = await sweepStaleWordPressImportRuns();
    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const POST = npWithAgentGuardianHttpResponseV1("admin", npGuardianPOST);
