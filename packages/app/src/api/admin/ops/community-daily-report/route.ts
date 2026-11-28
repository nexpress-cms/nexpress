import { NpForbiddenError } from "@nexpress/core";
import type { NextRequest } from "next/server";
import { npWithAgentGuardianHttpResponseV1 } from "../../../../lib/agents/guardian-http-observer";
import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { readCommunityDailyOps } from "../../../../lib/community-daily-ops";
import { ensureFor } from "../../../../lib/init-core";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

async function npGuardianGET(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireGlobalAuth(request);
    const report = await readCommunityDailyOps(user);
    if (!report) throw new NpForbiddenError("community-daily-report", "read");
    return npSuccessResponse(report, { headers });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"), {
      headers,
    });
  }
}

export const GET = npWithAgentGuardianHttpResponseV1("admin", npGuardianGET);
