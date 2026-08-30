import {
  npAgentDisabledGatewaySettingsV1,
  npRequireAgentStudioOverviewV1,
} from "@nexpress/core/agent-contract";
import {
  getOptionalAgentStudioServerRuntimeV1,
  npAgentStudioRuntimeStatusV1,
} from "@nexpress/core/agents";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import {
  normalizeAgentStudioError,
  requireAgentStudioAdmin,
} from "../../../../lib/agents/studio-admin";
import { ensureFor } from "../../../../lib/init-core";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const { siteId } = await requireAgentStudioAdmin(request);
    const runtime = getOptionalAgentStudioServerRuntimeV1();
    const [connections, principals, gatewaySettings] = await Promise.all([
      runtime?.connections?.listConnections(siteId, 100) ?? [],
      runtime?.gateway?.listPrincipals(siteId, 100) ?? [],
      runtime?.resolveGatewaySettings(siteId) ?? npAgentDisabledGatewaySettingsV1,
    ]);
    return npSuccessResponse(
      npRequireAgentStudioOverviewV1({
        schemaVersion: "np.agent-studio-overview.v1",
        siteId,
        runtime: npAgentStudioRuntimeStatusV1(runtime),
        gatewaySettings,
        adapters: runtime?.adapters ?? [],
        connections,
        principals,
      }),
    );
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error));
  }
}

export const dynamic = "force-dynamic";
