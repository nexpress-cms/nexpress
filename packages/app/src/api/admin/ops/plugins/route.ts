import { npWithAgentGuardianHttpResponseV1 } from "../../../../lib/agents/guardian-http-observer";
import { NpForbiddenError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { collectRuntimeOpsPluginsStatus } from "../../../../lib/ops-plugins-runtime";

async function npGuardianGET(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("ops-plugins", "read");
    }

    return npSuccessResponse(collectRuntimeOpsPluginsStatus());
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

export const GET = npWithAgentGuardianHttpResponseV1("admin", npGuardianGET);
