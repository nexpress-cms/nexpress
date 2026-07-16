import { getRegisteredBlockMetadata } from "@nexpress/blocks";
import { npRequireBlockDiscoveryResponse } from "@nexpress/core/discovery";

import { ensureFor } from "../../../lib/init-core";
import { blockToManifest } from "../../../lib/manifest";
import { npSuccessResponse, npErrorResponse } from "../../../lib/api-response";

export async function GET() {
  try {
    await ensureFor("plugins");
    const items = getRegisteredBlockMetadata()
      .map(blockToManifest)
      .sort((a, b) => a.type.localeCompare(b.type));

    return npSuccessResponse(npRequireBlockDiscoveryResponse({ items }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
