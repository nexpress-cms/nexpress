import { npRequireAgentStudioPrincipalDetailV1 } from "@nexpress/core/agent-contract";
import { NpNotFoundError } from "@nexpress/core";
import { requireAgentStudioGatewayRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import {
  normalizeAgentStudioError,
  requireAgentStudioAdmin,
} from "../../../../../../lib/agents/studio-admin";
import { ensureFor } from "../../../../../../lib/init-core";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("read");
    const { siteId } = await requireAgentStudioAdmin(request);
    const { id } = await params;
    const runtime = requireAgentStudioGatewayRuntimeV1();
    const [principal, tokens] = await Promise.all([
      runtime.gateway.getPrincipal(siteId, id),
      runtime.gateway.listServiceTokens(siteId, id, 100),
    ]);
    if (!principal) throw new NpNotFoundError("agent-principal", id);
    return npSuccessResponse(
      npRequireAgentStudioPrincipalDetailV1({
        schemaVersion: "np.agent-studio-principal-detail.v1",
        principal,
        tokens,
      }),
    );
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error));
  }
}

export const dynamic = "force-dynamic";
