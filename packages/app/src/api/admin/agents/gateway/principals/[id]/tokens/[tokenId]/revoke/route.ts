import { npRequireAgentServiceTokenV1 } from "@nexpress/core/agent-contract";
import { requireAgentStudioGatewayRuntimeV1 } from "@nexpress/core/agents";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../../../../lib/api-response";
import {
  normalizeAgentStudioError,
  requireAgentStudioAdmin,
} from "../../../../../../../../../lib/agents/studio-admin";
import { ensureFor } from "../../../../../../../../../lib/init-core";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tokenId: string }> },
) {
  try {
    await ensureFor("write");
    const { siteId, actor } = await requireAgentStudioAdmin(request);
    const { id, tokenId } = await params;
    const runtime = requireAgentStudioGatewayRuntimeV1();
    const result = await runtime.gateway.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principal_tokens.revoke",
      parentTargetId: id,
      targetId: tokenId,
      command: await readJsonBody(request),
    });
    return npSuccessResponse(npRequireAgentServiceTokenV1(result.output));
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error));
  }
}

export const dynamic = "force-dynamic";
