import { getAllCollectionSlugs, getCollectionConfig } from "@nexpress/core";

import { ensureFor } from "@/lib/init-core";
import { collectionToManifest } from "@/lib/manifest";
import { nxSuccessResponse, nxErrorResponse } from "@/lib/api-response";

export async function GET() {
  try {
    await ensureFor("read");

    const items = getAllCollectionSlugs()
      .map((slug) => collectionToManifest(getCollectionConfig(slug)))
      .sort((a, b) => a.slug.localeCompare(b.slug));

    return nxSuccessResponse({ items });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
