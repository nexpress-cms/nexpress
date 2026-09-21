import { npRequireAgentConnectionV1 } from "@nexpress/core/agent-contract";
import { requireAgentStudioConnectionRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";

import { npSuccessResponse } from "../../../../../lib/api-response";
import { requireAgentStudioAdmin } from "../../../../../lib/agents/studio-admin";
import { ensureFor } from "../../../../../lib/init-core";
import { agentStudioErrorResponse } from "../../../../../lib/agents/studio-error-response";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("read");
    const { siteId } = await requireAgentStudioAdmin(request);
    const { id } = await params;
    const runtime = requireAgentStudioConnectionRuntimeV1();
    return npSuccessResponse(
      npRequireAgentConnectionV1(
        await runtime.connections.getConnection({ siteId, connectionId: id }),
      ),
    );
  } catch (error) {
    return agentStudioErrorResponse(error, "read");
  }
}

export const dynamic = "force-dynamic";
