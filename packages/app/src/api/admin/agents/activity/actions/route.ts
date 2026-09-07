import {
  npAnalyzeAgentActivityActionsPageV1,
  npRequireAgentContractResult,
} from "@nexpress/core/agent-contract";
import { requireAgentStudioActivityRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import {
  normalizeAgentStudioError,
  requireAgentStudioAdmin,
  readAgentActivityQuery,
} from "../../../../../lib/agents/studio-admin";
import { ensureFor } from "../../../../../lib/init-core";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const { siteId, actor } = await requireAgentStudioAdmin(request);
    const { activity } = requireAgentStudioActivityRuntimeV1();
    const value = await activity.listActions({
      siteId,
      actor,
      query: readAgentActivityQuery(request, "actions"),
    });
    return npSuccessResponse(
      npRequireAgentContractResult(npAnalyzeAgentActivityActionsPageV1(value)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error), {
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export const dynamic = "force-dynamic";
