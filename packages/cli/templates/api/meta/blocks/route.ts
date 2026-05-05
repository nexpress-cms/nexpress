import { getDefaultBlocks } from "@nexpress/blocks";

import { blockToManifest } from "@/lib/manifest";
import { npSuccessResponse, npErrorResponse } from "@/lib/api-response";

export function GET() {
  try {
    const items = getDefaultBlocks()
      .map(blockToManifest)
      .sort((a, b) => a.type.localeCompare(b.type));
    return npSuccessResponse({ items });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
