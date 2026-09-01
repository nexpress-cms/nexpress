import { requireSiteId } from "@nexpress/core/sites";
import type { NextRequest } from "next/server";

import {
  agentOauthNotFound,
  getAgentOauthSurface,
  oauthError,
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
    const initial = await readExactOauthForm(
      request,
      [
        "client_id",
        "code",
        "code_verifier",
        "grant_type",
        "redirect_uri",
        "refresh_token",
        "resource",
      ],
      ["client_id", "grant_type", "resource"],
    );
    if (initial.grant_type === "authorization_code") {
      for (const key of ["code", "code_verifier", "redirect_uri"]) {
        if (!(key in initial)) throw new Error("invalid_request");
      }
      if ("refresh_token" in initial) throw new Error("invalid_request");
      return oauthJson(
        await surface.oauth.exchangeAuthorizationCode({
          siteId,
          clientId: initial.client_id,
          code: initial.code,
          redirectUri: initial.redirect_uri,
          codeVerifier: initial.code_verifier,
          resource: initial.resource,
        }),
      );
    }
    if (initial.grant_type === "refresh_token") {
      if (
        !("refresh_token" in initial) ||
        "code" in initial ||
        "code_verifier" in initial ||
        "redirect_uri" in initial
      ) {
        throw new Error("invalid_request");
      }
      return oauthJson(
        await surface.oauth.exchangeRefreshToken({
          siteId,
          clientId: initial.client_id,
          refreshToken: initial.refresh_token,
          resource: initial.resource,
        }),
      );
    }
    throw new Error("unsupported_grant_type");
  } catch (error) {
    return oauthError(error);
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
