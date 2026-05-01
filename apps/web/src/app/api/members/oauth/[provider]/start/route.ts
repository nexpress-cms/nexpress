import { getOAuthProvider, issueOAuthState } from "@nexpress/core";
import { NextResponse, type NextRequest } from "next/server";

import { getMemberAuthRuntimeConfig } from "@/lib/member-auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Member-side OAuth start. Mirrors the staff start route
 * (`/api/auth/oauth/{provider}/start`) but uses a separate state
 * cookie (`nx-mb-oauth-state`) and a separate callback path. The
 * provider registry is shared — a single registered GitHub provider
 * works for both staff and member logins; the routes just choose
 * which user pool to resolve to.
 */

const STATE_COOKIE = "nx-mb-oauth-state";
const STATE_COOKIE_MAX_AGE = 600;

function buildRedirectUri(request: NextRequest, provider: string): string {
  const configured = process.env.SITE_URL;
  const base = configured ? new URL(configured) : new URL(request.url);
  return new URL(`/api/members/oauth/${provider}/callback`, base).toString();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  await ensureFor("plugins");
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

  const { secret, secureCookies } = getMemberAuthRuntimeConfig();
  const { token, codeVerifier } = issueOAuthState(providerId, secret);
  const redirectUri = buildRedirectUri(request, providerId);
  const authorizeUrl = await provider.authorize({
    state: token,
    redirectUri,
    codeVerifier,
  });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set({
    name: STATE_COOKIE,
    value: token,
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/api/members/oauth",
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  return response;
}
