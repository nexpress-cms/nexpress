import { npWithAgentGuardianHttpOptionalRequestV1 } from "../../../lib/agents/guardian-http-observer";
import { getRegisteredBlockMetadataForActiveSources } from "@nexpress/blocks";
import { npRequireBlockDiscoveryResponse } from "@nexpress/core/discovery";
import { createSiteScopedBlockRenderContext } from "@nexpress/next";

import { ensureFor } from "../../../lib/init-core";
import { blockToManifest } from "../../../lib/manifest";
import { npSuccessResponse, npErrorResponse } from "../../../lib/api-response";

async function npGuardianGET() {
  try {
    await ensureFor("plugins");
    const ctx = await createSiteScopedBlockRenderContext();
    const items = getRegisteredBlockMetadataForActiveSources(ctx.activeSources!)
      .map(blockToManifest)
      .sort((a, b) => a.type.localeCompare(b.type));

    return npSuccessResponse(npRequireBlockDiscoveryResponse({ items }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const GET = npWithAgentGuardianHttpOptionalRequestV1("cms", npGuardianGET);
