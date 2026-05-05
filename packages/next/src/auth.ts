import {
  NpAuthError,
  getLogger,
  isTokenVerificationError,
  verifyCsrf,
  verifyTokenFull,
  type NpAuthUser,
} from "@nexpress/core";
import type { NextRequest, NextResponse } from "next/server";

const DEFAULT_TOKEN_EXPIRATION = 60 * 60 * 2;
const DEFAULT_REFRESH_TOKEN_EXPIRATION = 60 * 60 * 24 * 7;
const DEFAULT_MAX_LOGIN_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_DURATION = 60 * 15;

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
  const secret =
    process.env.NP_SECRET ?? process.env.NP_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NP_SECRET must be set (see .env.example)");
  }
  return secret;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRuntimeConfig(secret: string): AuthRuntimeConfig {
  return {
    secret,
    tokenExpiration: readNumber(process.env.NP_TOKEN_EXPIRATION, DEFAULT_TOKEN_EXPIRATION),
    refreshTokenExpiration: readNumber(
      process.env.NP_REFRESH_TOKEN_EXPIRATION,
      DEFAULT_REFRESH_TOKEN_EXPIRATION,
    ),
    maxLoginAttempts: readNumber(
      process.env.NP_MAX_LOGIN_ATTEMPTS,
      DEFAULT_MAX_LOGIN_ATTEMPTS,
    ),
    lockoutDuration: readNumber(
      process.env.NP_LOCKOUT_DURATION,
      DEFAULT_LOCKOUT_DURATION,
    ),
    secureCookies: process.env.NODE_ENV === "production",
  };
}

export type AuthHelpers = {
  readonly getAuthRuntimeConfig: (this: void) => AuthRuntimeConfig;
  readonly requireAuth: (this: void, request: NextRequest) => Promise<NpAuthUser>;
  readonly optionalAuth: (this: void, request: NextRequest) => Promise<NpAuthUser | null>;
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
      path: "/api/auth/refresh",
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
    const { secureCookies } = getAuthRuntimeConfig();

    for (const [name, path] of [
      ["np-session", "/"],
      ["np-refresh", "/api/auth/refresh"],
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
    requireCsrf,
    setAuthCookies,
    clearAuthCookies,
  };
}
