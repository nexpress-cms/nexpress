import { requireSiteId } from "@nexpress/core/sites";

import { agentOauthNotFound, getAgentOauthSurface } from "../../../lib/agents/oauth-http";
import { ensureFor } from "../../../lib/init-core";

export async function GET() {
  await ensureFor("read");
  const siteId = await requireSiteId();
  const surface = await getAgentOauthSurface(siteId);
  if (!surface) return agentOauthNotFound();
  return Response.json(await surface.oauth.getJwks(siteId), {
    headers: { "cache-control": "public, max-age=300, must-revalidate" },
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
