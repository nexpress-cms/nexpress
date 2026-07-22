import { getPluginDiscoveryItems, listEnabledPluginIds } from "@nexpress/core";
import { npRequirePluginDiscoveryResponse } from "@nexpress/core/discovery";

import { ensureFor } from "../../../lib/init-core";
import { npSuccessResponse, npErrorResponse } from "../../../lib/api-response";
import { getDb } from "../../../lib/db";

export async function GET() {
  try {
    await ensureFor("plugins");
    const activePluginIds = new Set(await listEnabledPluginIds(getDb()));
    const items = getPluginDiscoveryItems(activePluginIds);
    return npSuccessResponse(npRequirePluginDiscoveryResponse({ items }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
