import { getOAuthProvider, issueOAuthState } from "@nexpress/core";
import { NextResponse, type NextRequest } from "next/server";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { ensurePluginsLoaded } from "@/lib/init-core";

/**
 * Step 1 of the OAuth dance: mint a signed state token, set it as a
 * short-lived cookie, ask the provider for its authorize URL, and
 * 302 the browser there. The provider is registered by a plugin via
 * `registerOAuthProvider` at startup; if no provider matches the
 * route's `:provider` segment the request 404s.
 */

const STATE_COOKIE = "nx-oauth-state";
const STATE_COOKIE_MAX_AGE = 600;

function buildRedirectUri(request: NextRequest, provider: string): string {
  const configured = process.env.SITE_URL;
  const base = configured ? new URL(configured) : new URL(request.url);
  return new URL(`/api/auth/oauth/${provider}/callback`, base).toString();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  // Plugins register providers in their `setup()` callback; if the host
  // hasn't loaded plugins yet (cold start), do that first.
  await ensurePluginsLoaded();
  const { provider: providerId } = await params;
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    return NextResponse.json(
      {
        error: { code: "NOT_FOUND", message: `OAuth provider "${providerId}" not registered` },
        status: 404,
      },
      { status: 404 },
    );
  }

  const { secret, secureCookies } = getAuthRuntimeConfig();
  const state = issueOAuthState(providerId, secret);
  const redirectUri = buildRedirectUri(request, providerId);
  const authorizeUrl = await provider.authorize({ state, redirectUri });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  return response;
}
