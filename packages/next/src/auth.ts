import {
  NpAuthError,
  getLogger,
  isTokenVerificationError,
  revokeStaffSession,
  verifyCsrf,
  verifyTokenFull,
  type NpAuthUser,
} from "@nexpress/core";
import {
  npAuthContractLimits,
  npAuthRuntimeDefaults,
  npRequireAuthSecret,
} from "@nexpress/core/auth-contract";
import type { NextRequest, NextResponse } from "next/server";

import { npAssertRefreshLifetime, npReadBoundedPositiveInteger } from "./auth-runtime.js";

export interface AuthCookieTokens {
  access: string;
  refresh: string;
  csrf: string;
}

export interface AuthRuntimeConfig {
  secret: string;
  tokenExpiration: number;
  refreshTokenExpiration: number;
  maxLoginAttempts: number;
  lockoutDuration: number;
  secureCookies: boolean;
}

export interface CreateAuthHelpersOptions<DB> {
  getDb: () => DB;
  /** Read the secret on demand so tests can swap it; falls back to NP_SECRET env. */
  getSecret?: () => string;
}

function defaultGetSecret(): string {
  const secret = process.env.NP_SECRET;
  if (!secret) {
    throw new Error("NP_SECRET must be set (see .env.example)");
  }
  return secret;
}

function getRuntimeConfig(secret: string): AuthRuntimeConfig {
  const signingSecret = npRequireAuthSecret(secret);
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
    secret: signingSecret,
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
}

export type AuthHelpers = {
  readonly getAuthRuntimeConfig: (this: void) => AuthRuntimeConfig;
  readonly requireAuth: (this: void, request: NextRequest) => Promise<NpAuthUser>;
  readonly optionalAuth: (this: void, request: NextRequest) => Promise<NpAuthUser | null>;
  readonly revokeCurrentAuthSession: (
    this: void,
    request: NextRequest,
  ) => Promise<NpAuthUser | null>;
  readonly requireCsrf: (this: void, request: NextRequest) => void;
  readonly setAuthCookies: (this: void, response: NextResponse, tokens: AuthCookieTokens) => void;
  readonly clearAuthCookies: (this: void, response: NextResponse) => void;
};

/**
 * Factory that produces the standard NexPress auth helpers bound to a
 * consumer-provided DB accessor. The helpers themselves are pure — this
 * function just wires them up with a closure over `getDb` so session
 * verification can reach the user/session tables without the helpers
 * having to know about your `lib/db.ts` shape.
 */
export function createAuthHelpers<DB>(options: CreateAuthHelpersOptions<DB>): AuthHelpers {
  const readSecret = options.getSecret ?? defaultGetSecret;

  async function getSessionUser(request: NextRequest): Promise<NpAuthUser | null> {
    const token = request.cookies.get("np-session")?.value;
    if (!token) return null;

    try {
      // Pass `"access"` so a refresh JWT (longer-lived `np-refresh`
      // cookie) cannot be replayed in the session cookie. `verifyToken`
      // throws `NpAuthError` on mismatch.
      return await verifyTokenFull(token, readSecret(), options.getDb() as never, "access");
    } catch (err) {
      // Distinguish "bad/forged token" (security signal, not an
      // outage — caller still gets 401) from "DB or other infra
      // failure" (real outage, must surface as 5xx so a Postgres
      // blip doesn't masquerade as "user logged out"). Forged-token
      // attempts get a debug log so the signal is at least visible
      // in structured logs without spamming every legitimate 401.
      if (isTokenVerificationError(err)) {
        getLogger().debug("auth: session token verification failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
      getLogger().error("auth: getSessionUser failed for non-token reason", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  const getAuthRuntimeConfig = (): AuthRuntimeConfig => getRuntimeConfig(readSecret());

  const requireAuth = async (request: NextRequest): Promise<NpAuthUser> => {
    const user = await getSessionUser(request);
    if (!user) throw new NpAuthError();
    return user;
  };

  const optionalAuth = (request: NextRequest): Promise<NpAuthUser | null> =>
    getSessionUser(request);

  const revokeCurrentAuthSession = async (request: NextRequest): Promise<NpAuthUser | null> => {
    const candidates = [
      [request.cookies.get("np-session")?.value, "access"],
      [request.cookies.get("np-refresh")?.value, "refresh"],
    ] as const;
    let revokedUser: NpAuthUser | null = null;
    for (const [token, use] of candidates) {
      if (!token) continue;
      try {
        const revoked = await revokeStaffSession(
          token,
          readSecret(),
          options.getDb() as never,
          use,
        );
        revokedUser ??= revoked;
      } catch (error) {
        if (!isTokenVerificationError(error)) throw error;
      }
    }
    return revokedUser;
  };

  const requireCsrf = (request: NextRequest): void => {
    const ok = verifyCsrf(
      request.method,
      request.cookies.get("np-csrf")?.value,
      request.headers.get("x-csrf-token") ?? undefined,
    );
    if (!ok) throw new NpAuthError("Invalid CSRF token");
  };

  const setAuthCookies = (response: NextResponse, tokens: AuthCookieTokens): void => {
    const { tokenExpiration, refreshTokenExpiration, secureCookies } = getAuthRuntimeConfig();

    response.cookies.set({
      name: "np-session",
      value: tokens.access,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: tokenExpiration,
    });

    response.cookies.set({
      name: "np-refresh",
      value: tokens.refresh,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      path: "/api/auth",
      maxAge: refreshTokenExpiration,
    });

    response.cookies.set({
      name: "np-csrf",
      value: tokens.csrf,
      httpOnly: false,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: tokenExpiration,
    });
  };

  const clearAuthCookies = (response: NextResponse): void => {
    const secureCookies = process.env.NODE_ENV === "production";

    for (const [name, path] of [
      ["np-session", "/"],
      ["np-refresh", "/api/auth"],
      ["np-csrf", "/"],
    ] as const) {
      response.cookies.set({
        name,
        value: "",
        httpOnly: name !== "np-csrf",
        secure: secureCookies,
        sameSite: name === "np-refresh" ? "strict" : "lax",
        path,
        maxAge: 0,
      });
    }
  };

  return {
    getAuthRuntimeConfig,
    requireAuth,
    optionalAuth,
    revokeCurrentAuthSession,
    requireCsrf,
    setAuthCookies,
    clearAuthCookies,
  };
}
