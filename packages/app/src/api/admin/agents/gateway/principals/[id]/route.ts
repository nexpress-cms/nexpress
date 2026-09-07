import { npRequireAgentStudioPrincipalDetailV1 } from "@nexpress/core/agent-contract";
import { NpNotFoundError } from "@nexpress/core";
import {
  getOptionalAgentStudioServerRuntimeV1,
  requireAgentStudioGatewayRuntimeV1,
} from "@nexpress/core/agents";
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
    const { siteId, actor } = await requireAgentStudioAdmin(request);
    const { id } = await params;
    const runtime = getOptionalAgentStudioServerRuntimeV1();
    const principal = runtime?.activity
      ? await runtime.activity.getPrincipal({ siteId, actor, id })
      : await requireAgentStudioGatewayRuntimeV1().gateway.getPrincipal(siteId, id);
    if (!principal) throw new NpNotFoundError("agent-principal", id);
    const tokens =
      principal.kind === "external" && runtime?.gateway
        ? await runtime.gateway.listServiceTokens(siteId, id, 100)
        : [];
    return npSuccessResponse(
      npRequireAgentStudioPrincipalDetailV1({
        schemaVersion: "np.agent-studio-principal-detail.v1",
        principal,
        tokens,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error), {
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export const dynamic = "force-dynamic";
