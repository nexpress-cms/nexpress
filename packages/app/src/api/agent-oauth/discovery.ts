import {
  npAgentOauthAuthorizationServerMetadataV1,
  npAgentOauthProtectedResourceMetadataV1,
} from "@nexpress/core/agent-contract";
import { requireSiteId } from "@nexpress/core/sites";

import { agentOauthNotFound, getAgentOauthSurface } from "../../lib/agents/oauth-http";
import { ensureFor } from "../../lib/init-core";
import { npFinalizeAgentGuardianHttpResponseV1 } from "../../lib/agents/guardian-http-observer";

async function authorizationServerMetadata() {
  await ensureFor("read");
  const surface = await getAgentOauthSurface(await requireSiteId());
  if (!surface) return agentOauthNotFound();
  return Response.json(npAgentOauthAuthorizationServerMetadataV1(surface.origin), {
    headers: { "cache-control": "no-store" },
  });
}

async function protectedResourceMetadata() {
  await ensureFor("read");
  const surface = await getAgentOauthSurface(await requireSiteId());
  if (!surface) return agentOauthNotFound();
  return Response.json(npAgentOauthProtectedResourceMetadataV1(surface.origin), {
    headers: { "cache-control": "no-store" },
  });
}

export async function agentOauthAuthorizationServerMetadataGET(request?: Request) {
  const response = await authorizationServerMetadata();
  return request
    ? npFinalizeAgentGuardianHttpResponseV1(request, "agent-oauth", response)
    : response;
}

export async function agentOauthProtectedResourceMetadataGET(request?: Request) {
  const response = await protectedResourceMetadata();
  return request
    ? npFinalizeAgentGuardianHttpResponseV1(request, "agent-oauth", response)
    : response;
}
