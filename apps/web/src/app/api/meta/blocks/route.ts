import { getDefaultBlocks } from "@nexpress/blocks";

import { blockToManifest } from "@/lib/manifest";
import { nxSuccessResponse, nxErrorResponse } from "@/lib/api-response";

export function GET() {
  try {
    const items = getDefaultBlocks()
      .map(blockToManifest)
      .sort((a, b) => a.type.localeCompare(b.type));

    return nxSuccessResponse({ items });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
