import { requireSiteId } from "@nexpress/core/sites";
import type { NextRequest } from "next/server";

import {
  agentOauthNotFound,
  getAgentOauthSurface,
  oauthJson,
  readExactOauthForm,
} from "../../../lib/agents/oauth-http";
import { ensureFor } from "../../../lib/init-core";

export async function POST(request: NextRequest) {
  await ensureFor("read");
  const siteId = await requireSiteId();
  const surface = await getAgentOauthSurface(siteId);
  if (!surface) return agentOauthNotFound();
  try {
    const form = await readExactOauthForm(
      request,
      ["client_id", "token", "token_type_hint"],
      ["client_id", "token"],
    );
    await surface.oauth.revokeToken({ siteId, clientId: form.client_id, token: form.token });
  } catch {
    // RFC 7009 keeps invalid and already-revoked tokens indistinguishable.
  }
  return oauthJson({});
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
