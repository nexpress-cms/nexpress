import { npRequireAgentPrincipalV1 } from "@nexpress/core/agent-contract";
import { requireAgentStudioGatewayRuntimeV1 } from "@nexpress/core/agents";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../../lib/api-response";
import {
  normalizeAgentStudioError,
  requireAgentStudioAdmin,
} from "../../../../../../../lib/agents/studio-admin";
import { ensureFor } from "../../../../../../../lib/init-core";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const { siteId, actor } = await requireAgentStudioAdmin(request);
    const { id } = await params;
    const runtime = requireAgentStudioGatewayRuntimeV1();
    const result = await runtime.gateway.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principals.revoke",
      targetId: id,
      command: await readJsonBody(request),
    });
    return npSuccessResponse(npRequireAgentPrincipalV1(result.output));
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error));
  }
}

export const dynamic = "force-dynamic";
