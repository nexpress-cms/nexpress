import {
  npRequireAgentServiceTokenV1,
  npRequireAgentStudioOneTimeTokenV1,
} from "@nexpress/core/agent-contract";
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
      operationId: "agents.gateway.principal_tokens.create",
      targetId: id,
      command: await readJsonBody(request),
    });
    return npSuccessResponse(
      npRequireAgentStudioOneTimeTokenV1({
        schemaVersion: "np.agent-studio-one-time-token.v1",
        token: npRequireAgentServiceTokenV1(result.output),
        value: result.oneTimeValue,
      }),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error), {
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export const dynamic = "force-dynamic";
