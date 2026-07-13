import {
  NpAuthError,
  getLogger,
  getMemberFromTokenPayload,
  isTokenVerificationError,
  revokeMemberSession,
  verifyCsrf,
  verifyMemberToken,
  type NpMemberAuthRow,
} from "@nexpress/core";
import {
  npAuthContractLimits,
  npAuthRuntimeDefaults,
  npRequireAuthSecret,
} from "@nexpress/core/auth-contract";
import type { NextRequest, NextResponse } from "next/server";

import { npAssertRefreshLifetime, npReadBoundedPositiveInteger } from "./auth-runtime.js";

/**
 * Member-side counterpart to `createAuthHelpers`. Same shape, but reads
 * `np-mb-*` cookies, verifies JWTs with `aud: "member"` enforced, and
 * looks members up in `np_members`. Coexists with the staff helpers in
 * the same Next process.
 */

export interface MemberAuthCookieTokens {
  access: string;
  refresh: string;
  csrf: string;
}

export interface MemberAuthRuntimeConfig {
  secret: string;
  tokenExpiration: number;
  refreshTokenExpiration: number;
  maxLoginAttempts: number;
  lockoutDuration: number;
  secureCookies: boolean;
}

export interface CreateMemberAuthHelpersOptions<DB> {
  getDb: () => DB;
  getSecret?: () => string;
}

function defaultGetSecret(): string {
  const secret = process.env.NP_SECRET;
  if (!secret) throw new Error("NP_SECRET must be set (see .env.example)");
  return secret;
}

export type MemberAuthHelpers = {
  readonly getMemberAuthRuntimeConfig: (this: void) => MemberAuthRuntimeConfig;
  readonly requireMember: (this: void, request: NextRequest) => Promise<NpMemberAuthRow>;
  readonly optionalMember: (this: void, request: NextRequest) => Promise<NpMemberAuthRow | null>;
  readonly revokeCurrentMemberSession: (
    this: void,
    request: NextRequest,
  ) => Promise<NpMemberAuthRow | null>;
  readonly requireMemberCsrf: (this: void, request: NextRequest) => void;
  readonly setMemberAuthCookies: (
    this: void,
    response: NextResponse,
    tokens: MemberAuthCookieTokens,
  ) => void;
  readonly clearMemberAuthCookies: (this: void, response: NextResponse) => void;
};

export function createMemberAuthHelpers<DB>(
  options: CreateMemberAuthHelpersOptions<DB>,
): MemberAuthHelpers {
  const readSecret = options.getSecret ?? defaultGetSecret;

  async function getSessionMember(request: NextRequest): Promise<NpMemberAuthRow | null> {
    const token = request.cookies.get("np-mb-session")?.value;
    if (!token) return null;
    try {
      // Refuse refresh tokens presented in the session cookie — without
      // this check a leaked refresh JWT was indistinguishable from an
      // access JWT to the auth path because both kinds were stored as
      // fungible rows in `np_member_sessions` (#91).
      const payload = await verifyMemberToken(token, readSecret(), "access");
      // Pass the raw access token so the resolver can verify a live
      // row exists in np_member_sessions — that's what makes
      // `/api/members/logout` actually revoke the token. (#45)
      const member = await getMemberFromTokenPayload(options.getDb() as never, payload, token);
      // Only active members may retain a session. This also fails closed for
      // pending/imported records, not just explicitly suspended/deleted ones.
      if (!member || member.status !== "active") {
        return null;
      }
      return member;
    } catch (err) {
      // Mirror staff `getSessionUser`: bad/forged tokens stay silent
      // null (caller surfaces 401); DB / unexpected failures bubble
      // so a real outage doesn't masquerade as "member logged out."
      if (isTokenVerificationError(err)) {
        getLogger().debug("member-auth: session token verification failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
      getLogger().error("member-auth: getSessionMember failed for non-token reason", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  const getMemberAuthRuntimeConfig = (): MemberAuthRuntimeConfig => {
    const tokenExpiration = npReadBoundedPositiveInteger(
      "NP_TOKEN_EXPIRATION",
      process.env.NP_TOKEN_EXPIRATION,
      npAuthRuntimeDefaults.accessTokenTtlSeconds,
      npAuthContractLimits.accessTokenTtlSeconds,
    );
    const refreshTokenExpiration = npReadBoundedPositiveInteger(
      "NP_REFRESH_TOKEN_EXPIRATION",
      process.env.NP_REFRESH_TOKEN_EXPIRATION,
      npAuthRuntimeDefaults.refreshTokenTtlSeconds,
      npAuthContractLimits.refreshTokenTtlSeconds,
    );
    npAssertRefreshLifetime(tokenExpiration, refreshTokenExpiration);
    return {
      secret: npRequireAuthSecret(readSecret()),
      tokenExpiration,
      refreshTokenExpiration,
      maxLoginAttempts: npReadBoundedPositiveInteger(
        "NP_MAX_LOGIN_ATTEMPTS",
        process.env.NP_MAX_LOGIN_ATTEMPTS,
        npAuthRuntimeDefaults.maxLoginAttempts,
        npAuthContractLimits.loginAttempts,
      ),
      lockoutDuration: npReadBoundedPositiveInteger(
        "NP_LOCKOUT_DURATION",
        process.env.NP_LOCKOUT_DURATION,
        npAuthRuntimeDefaults.lockoutTtlSeconds,
        npAuthContractLimits.lockoutTtlSeconds,
      ),
      secureCookies: process.env.NODE_ENV === "production",
    };
  };

  const requireMember = async (request: NextRequest): Promise<NpMemberAuthRow> => {
    const member = await getSessionMember(request);
    if (!member) throw new NpAuthError();
    return member;
  };

  const optionalMember = (request: NextRequest): Promise<NpMemberAuthRow | null> =>
    getSessionMember(request);

  const revokeCurrentMemberSession = async (
    request: NextRequest,
  ): Promise<NpMemberAuthRow | null> => {
    const candidates = [
      [request.cookies.get("np-mb-session")?.value, "access"],
      [request.cookies.get("np-mb-refresh")?.value, "refresh"],
    ] as const;
    let revokedMember: NpMemberAuthRow | null = null;
    for (const [token, use] of candidates) {
      if (!token) continue;
      try {
        const revoked = await revokeMemberSession(
          token,
          readSecret(),
          options.getDb() as never,
          use,
        );
        revokedMember ??= revoked;
      } catch (error) {
        if (!isTokenVerificationError(error)) throw error;
      }
    }
    return revokedMember;
  };

  const requireMemberCsrf = (request: NextRequest): void => {
    const ok = verifyCsrf(
      request.method,
      request.cookies.get("np-mb-csrf")?.value,
      request.headers.get("x-csrf-token") ?? undefined,
    );
    if (!ok) throw new NpAuthError("Invalid CSRF token");
  };

  const setMemberAuthCookies = (response: NextResponse, tokens: MemberAuthCookieTokens): void => {
    const { tokenExpiration, refreshTokenExpiration, secureCookies } = getMemberAuthRuntimeConfig();

    response.cookies.set({
      name: "np-mb-session",
      value: tokens.access,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: tokenExpiration,
    });

    response.cookies.set({
      name: "np-mb-refresh",
      value: tokens.refresh,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      path: "/api/members",
      maxAge: refreshTokenExpiration,
    });

    response.cookies.set({
      name: "np-mb-csrf",
      value: tokens.csrf,
      httpOnly: false,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: tokenExpiration,
    });
  };

  const clearMemberAuthCookies = (response: NextResponse): void => {
    const secureCookies = process.env.NODE_ENV === "production";
    for (const [name, path] of [
      ["np-mb-session", "/"],
      ["np-mb-refresh", "/api/members"],
      ["np-mb-csrf", "/"],
    ] as const) {
      response.cookies.set({
        name,
        value: "",
        httpOnly: name !== "np-mb-csrf",
        secure: secureCookies,
        sameSite: name === "np-mb-refresh" ? "strict" : "lax",
        path,
        maxAge: 0,
      });
    }
  };

  return {
    getMemberAuthRuntimeConfig,
    requireMember,
    optionalMember,
    revokeCurrentMemberSession,
    requireMemberCsrf,
    setMemberAuthCookies,
    clearMemberAuthCookies,
  };
}
