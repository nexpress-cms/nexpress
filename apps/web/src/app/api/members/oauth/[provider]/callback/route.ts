import { randomBytes } from "node:crypto";

import {
  getLogger,
  getOAuthProvider,
  nxMemberSessions,
  resolveMemberOAuthLogin,
  sha256,
  signMemberToken,
  verifyOAuthState,
} from "@nexpress/core";
import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import { getMemberAuthRuntimeConfig, setMemberAuthCookies } from "@/lib/member-auth-helpers";
import { ensurePluginsLoaded } from "@/lib/init-core";

/**
 * Member-side OAuth callback. Mirrors the staff callback at
 * `/api/auth/oauth/{provider}/callback`:
 *
 *   - validate the `nx-mb-oauth-state` cookie, including HMAC + TTL
 *   - call `provider.exchange()` for the normalized profile
 *   - resolve the matching `nx_members` row via
 *     `resolveMemberOAuthLogin` (durable link → email-match → auto-
 *     provision with status='active')
 *   - mint `use="access"` + `use="refresh"` member tokens, persist
 *     both hashes in `nx_member_sessions`, set the cookies, redirect
 *     to `/`
 *
 * Failures redirect to `/members/login?oauth_error=<code>` — never
 * echo the provider's error text, only an opaque code the UI can
 * map to a friendly message.
 */

const STATE_COOKIE = "nx-mb-oauth-state";
const SUCCESS_REDIRECT = "/";
const FAIL_REDIRECT = "/members/login";

function buildRedirectUri(request: NextRequest, provider: string): string {
  const configured = process.env.SITE_URL;
  const base = configured ? new URL(configured) : new URL(request.url);
  return new URL(`/api/members/oauth/${provider}/callback`, base).toString();
}

function siteUrl(request: NextRequest): URL {
  const configured = process.env.SITE_URL;
  return configured ? new URL(configured) : new URL(request.url);
}

function failResponse(request: NextRequest, code: string): NextResponse {
  const target = new URL(FAIL_REDIRECT, siteUrl(request));
  target.searchParams.set("oauth_error", code);
  const response = NextResponse.redirect(target);
  response.cookies.set({
    name: STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/api/members/oauth",
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
  if (stateParam !== stateCookie) {
    return failResponse(request, "state_mismatch");
  }

  const { secret, tokenExpiration, refreshTokenExpiration } = getMemberAuthRuntimeConfig();
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
    getLogger().error("member oauth exchange failed", {
      provider: providerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return failResponse(request, "exchange_failed");
  }

  if (!profile?.providerUserId) {
    getLogger().error("member oauth exchange returned no providerUserId", {
      provider: providerId,
    });
    return failResponse(request, "exchange_failed");
  }

  let resolved;
  try {
    resolved = await resolveMemberOAuthLogin({ provider: providerId, profile });
  } catch (err) {
    getLogger().error("member oauth identity resolve failed", {
      provider: providerId,
      providerUserId: profile.providerUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return failResponse(request, "resolve_failed");
  }

  if (resolved.member.status !== "active") {
    // Suspended / deleted members can't sign in even via OAuth.
    return failResponse(request, "member_inactive");
  }

  // Mint + persist both access and refresh, mirroring the password
  // login path (`/api/members/login`). Without persisting both rows
  // the recently-fixed logout / refresh revocation flow (#45, #91)
  // wouldn't work for OAuth-originated sessions.
  const access = await signMemberToken(resolved.member, secret, tokenExpiration, "access");
  const refresh = await signMemberToken(
    resolved.member,
    secret,
    refreshTokenExpiration,
    "refresh",
  );
  const csrf = randomBytes(16).toString("hex");

  const db = getDb();
  const userAgent = request.headers.get("user-agent") ?? null;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await db.insert(nxMemberSessions).values([
    {
      memberId: resolved.member.id,
      tokenHash: await sha256(access),
      userAgent,
      ip,
      expiresAt: new Date(Date.now() + tokenExpiration * 1000),
    },
    {
      memberId: resolved.member.id,
      tokenHash: await sha256(refresh),
      userAgent,
      ip,
      expiresAt: new Date(Date.now() + refreshTokenExpiration * 1000),
    },
  ]);

  const target = new URL(SUCCESS_REDIRECT, siteUrl(request));
  const response = NextResponse.redirect(target);
  setMemberAuthCookies(response, { access, refresh, csrf });
  response.cookies.set({
    name: STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/api/members/oauth",
    maxAge: 0,
  });
  return response;
}
