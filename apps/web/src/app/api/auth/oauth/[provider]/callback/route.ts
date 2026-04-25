import {
  getLogger,
  getOAuthProvider,
  resolveOAuthLogin,
  signToken,
  verifyOAuthState,
} from "@nexpress/core";
import { NextResponse, type NextRequest } from "next/server";

import { getAuthRuntimeConfig, setAuthCookies } from "@/lib/auth-helpers";
import { ensurePluginsLoaded } from "@/lib/init-core";

/**
 * Step 2: validate the state cookie, ask the provider to exchange the
 * code for a profile, resolve (or create) the matching `nx_users` row,
 * mint session cookies, and redirect to the admin dashboard. Failures
 * land on `/admin/login?oauth_error=…` so the UI can render a clean
 * message — never expose provider-side error text directly.
 */

const STATE_COOKIE = "nx-oauth-state";
const SUCCESS_REDIRECT = "/admin";
const FAIL_REDIRECT = "/admin/login";

function buildRedirectUri(request: NextRequest, provider: string): string {
  const configured = process.env.SITE_URL;
  const base = configured ? new URL(configured) : new URL(request.url);
  return new URL(`/api/auth/oauth/${provider}/callback`, base).toString();
}

function siteUrl(request: NextRequest): URL {
  const configured = process.env.SITE_URL;
  return configured ? new URL(configured) : new URL(request.url);
}

function failResponse(request: NextRequest, code: string): NextResponse {
  const target = new URL(FAIL_REDIRECT, siteUrl(request));
  target.searchParams.set("oauth_error", code);
  const response = NextResponse.redirect(target);
  // Always invalidate the state cookie on the way out — it's single-use.
  response.cookies.set({
    name: STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: 0,
  });
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  await ensurePluginsLoaded();
  const { provider: providerId } = await params;
  const provider = getOAuthProvider(providerId);
  if (!provider) return failResponse(request, "unknown_provider");

  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;

  if (!code || !stateParam || !stateCookie) {
    return failResponse(request, "missing_params");
  }
  // The state in the cookie and in the redirect query MUST match — that's
  // the canonical CSRF guard for the OAuth callback.
  if (stateParam !== stateCookie) {
    return failResponse(request, "state_mismatch");
  }

  const { secret } = getAuthRuntimeConfig();
  const verification = verifyOAuthState(stateCookie, providerId, secret);
  if (!verification.ok || !verification.payload) {
    return failResponse(request, `state_${verification.reason ?? "invalid"}`);
  }

  let profile;
  try {
    profile = await provider.exchange({
      code,
      state: stateParam,
      redirectUri: buildRedirectUri(request, providerId),
      codeVerifier: verification.payload.codeVerifier,
    });
  } catch (err) {
    // Surface the provider error in logs — without it, a misconfigured
    // OAuth client (wrong secret, redirect-URI mismatch) hits the user
    // as a generic `oauth_error=exchange_failed` with no operator
    // breadcrumb. Provider error text is NOT echoed to the response.
    getLogger().error("oauth exchange failed", {
      provider: providerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return failResponse(request, "exchange_failed");
  }

  if (!profile?.providerUserId) {
    getLogger().error("oauth exchange returned no providerUserId", { provider: providerId });
    return failResponse(request, "exchange_failed");
  }

  let resolved;
  try {
    resolved = await resolveOAuthLogin({ provider: providerId, profile });
  } catch (err) {
    getLogger().error("oauth identity resolve failed", {
      provider: providerId,
      providerUserId: profile.providerUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return failResponse(request, "resolve_failed");
  }

  const config = getAuthRuntimeConfig();
  const access = await signToken(resolved.user, config.secret, config.tokenExpiration);
  const refresh = await signToken(
    resolved.user,
    config.secret,
    config.refreshTokenExpiration,
  );

  const target = new URL(SUCCESS_REDIRECT, siteUrl(request));
  const response = NextResponse.redirect(target);
  setAuthCookies(response, { access, refresh, csrf: crypto.randomUUID() });
  // Clear the single-use state cookie.
  response.cookies.set({
    name: STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: 0,
  });
  return response;
}
