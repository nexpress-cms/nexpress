import {
  npAnalyzeAgentActivityPrincipalsPageV1,
  npRequireAgentContractResult,
  npRequireAgentPrincipalV1,
} from "@nexpress/core/agent-contract";
import {
  requireAgentStudioActivityRuntimeV1,
  requireAgentStudioGatewayRuntimeV1,
} from "@nexpress/core/agents";
import { readJsonBody } from "@nexpress/next";
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
    const value = await activity.listPrincipals({
      siteId,
      actor,
      query: readAgentActivityQuery(request, "principals"),
    });
    return npSuccessResponse(
      npRequireAgentContractResult(npAnalyzeAgentActivityPrincipalsPageV1(value)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error), {
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const { siteId, actor } = await requireAgentStudioAdmin(request);
    const runtime = requireAgentStudioGatewayRuntimeV1();
    const result = await runtime.gateway.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principals.create",
      targetId: null,
      command: await readJsonBody(request),
    });
    return npSuccessResponse(npRequireAgentPrincipalV1(result.output), { status: 201 });
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error));
  }
}

export const dynamic = "force-dynamic";
