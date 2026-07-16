import { getAllCollectionSlugs, getCollectionConfig } from "@nexpress/core";
import { npRequireCollectionDiscoveryResponse } from "@nexpress/core/discovery";

import { ensureFor } from "../../../lib/init-core";
import { collectionToManifest } from "../../../lib/manifest";
import { npSuccessResponse, npErrorResponse } from "../../../lib/api-response";

export async function GET() {
  try {
    await ensureFor("read");

    const items = getAllCollectionSlugs()
      .map((slug) => collectionToManifest(getCollectionConfig(slug)))
      .sort((a, b) => a.slug.localeCompare(b.slug));

    return npSuccessResponse(npRequireCollectionDiscoveryResponse({ items }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
