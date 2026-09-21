import { npRequireAgentOauthClientV1 } from "@nexpress/core/agent-contract";
import { requireAgentStudioOauthRuntimeV1 } from "@nexpress/core/agents";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npSuccessResponse } from "../../../../../lib/api-response";
import { requireAgentStudioAdmin } from "../../../../../lib/agents/studio-admin";
import { ensureFor } from "../../../../../lib/init-core";
import { agentStudioErrorResponse } from "../../../../../lib/agents/studio-error-response";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const { siteId } = await requireAgentStudioAdmin(request);
    const { oauth } = requireAgentStudioOauthRuntimeV1();
    return npSuccessResponse(await oauth.listClients(siteId, 100));
  } catch (error) {
    return agentStudioErrorResponse(error, "read");
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const { siteId, actor } = await requireAgentStudioAdmin(request);
    const { oauth } = requireAgentStudioOauthRuntimeV1();
    const result = await oauth.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.oauth_clients.create",
      targetId: null,
      command: await readJsonBody(request),
    });
    return npSuccessResponse(npRequireAgentOauthClientV1(result.output), { status: 201 });
  } catch (error) {
    return agentStudioErrorResponse(error, "mutation");
  }
}

export const dynamic = "force-dynamic";
