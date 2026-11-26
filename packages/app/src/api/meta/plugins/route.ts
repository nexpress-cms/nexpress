import { npWithAgentGuardianHttpOptionalRequestV1 } from "../../../lib/agents/guardian-http-observer";
import { getPluginDiscoveryItems, listEnabledPluginIds } from "@nexpress/core";
import { npRequirePluginDiscoveryResponse } from "@nexpress/core/discovery";

import { ensureFor } from "../../../lib/init-core";
import { npSuccessResponse, npErrorResponse } from "../../../lib/api-response";
import { getDb } from "../../../lib/db";

async function npGuardianGET() {
  try {
    await ensureFor("plugins");
    const activePluginIds = new Set(await listEnabledPluginIds(getDb()));
    const items = getPluginDiscoveryItems(activePluginIds);
    return npSuccessResponse(npRequirePluginDiscoveryResponse({ items }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const GET = npWithAgentGuardianHttpOptionalRequestV1("cms", npGuardianGET);
