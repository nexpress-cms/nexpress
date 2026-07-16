import { getPluginDiscoveryItems } from "@nexpress/core";
import { npRequirePluginDiscoveryResponse } from "@nexpress/core/discovery";

import { ensureFor } from "../../../lib/init-core";
import { npSuccessResponse, npErrorResponse } from "../../../lib/api-response";

export async function GET() {
  try {
    await ensureFor("plugins");
    const items = getPluginDiscoveryItems();
    return npSuccessResponse(npRequirePluginDiscoveryResponse({ items }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
