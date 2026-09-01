import { requireSiteId } from "@nexpress/core/sites";
import { handleAgentMcpHttpV1 } from "@nexpress/mcp/http";
import type { NextRequest } from "next/server";

import {
  agentOauthBearerChallenge,
  agentOauthNotFound,
  getAgentOauthSurface,
} from "../../lib/agents/oauth-http";
import { ensureFor } from "../../lib/init-core";

async function handle(request: NextRequest) {
  await ensureFor("read");
  const siteId = await requireSiteId();
  const surface = await getAgentOauthSurface(siteId);
  if (!surface) return agentOauthNotFound();
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Forbidden" } },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  if (
    requestUrl.origin !== surface.origin ||
    requestUrl.pathname !== "/api/mcp" ||
    requestUrl.search ||
    requestUrl.hash
  ) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Forbidden" } },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== surface.origin) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Forbidden" } },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  if (request.method === "OPTIONS") {
    return handleAgentMcpHttpV1({
      request,
      canonicalOrigin: surface.origin,
      authentication: null,
    });
  }
  let authentication;
  try {
    authentication = await surface.oauth.authenticateRemoteBearer({
      siteId,
      authorization: request.headers.get("authorization"),
    });
  } catch {
    return Response.json(
      { error: "invalid_token" },
      {
        status: 401,
        headers: {
          "cache-control": "no-store",
          "www-authenticate": agentOauthBearerChallenge(surface.origin, "invalid_token"),
          ...(origin === surface.origin
            ? { "access-control-allow-origin": surface.origin, vary: "Origin" }
            : {}),
        },
      },
    );
  }
  return handleAgentMcpHttpV1({
    request,
    canonicalOrigin: surface.origin,
    authentication,
  });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
