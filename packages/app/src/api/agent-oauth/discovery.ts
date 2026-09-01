import {
  npAgentOauthAuthorizationServerMetadataV1,
  npAgentOauthProtectedResourceMetadataV1,
} from "@nexpress/core/agent-contract";
import { requireSiteId } from "@nexpress/core/sites";

import { agentOauthNotFound, getAgentOauthSurface } from "../../lib/agents/oauth-http";
import { ensureFor } from "../../lib/init-core";

export async function agentOauthAuthorizationServerMetadataGET() {
  await ensureFor("read");
  const surface = await getAgentOauthSurface(await requireSiteId());
  if (!surface) return agentOauthNotFound();
  return Response.json(npAgentOauthAuthorizationServerMetadataV1(surface.origin), {
    headers: { "cache-control": "no-store" },
  });
}

export async function agentOauthProtectedResourceMetadataGET() {
  await ensureFor("read");
  const surface = await getAgentOauthSurface(await requireSiteId());
  if (!surface) return agentOauthNotFound();
  return Response.json(npAgentOauthProtectedResourceMetadataV1(surface.origin), {
    headers: { "cache-control": "no-store" },
  });
}
