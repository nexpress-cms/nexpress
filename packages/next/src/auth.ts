import {
  NxAuthError,
  verifyCsrf,
  verifyTokenFull,
  type NxAuthUser,
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
  /** Read the secret on demand so tests can swap it; falls back to NX_SECRET env. */
  getSecret?: () => string;
}

function defaultGetSecret(): string {
  const secret =
    process.env.NX_SECRET ?? process.env.NX_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NX_SECRET must be set (see .env.example)");
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
    tokenExpiration: readNumber(process.env.NX_TOKEN_EXPIRATION, DEFAULT_TOKEN_EXPIRATION),
    refreshTokenExpiration: readNumber(
      process.env.NX_REFRESH_TOKEN_EXPIRATION,
      DEFAULT_REFRESH_TOKEN_EXPIRATION,
    ),
    maxLoginAttempts: readNumber(
      process.env.NX_MAX_LOGIN_ATTEMPTS,
      DEFAULT_MAX_LOGIN_ATTEMPTS,
    ),
    lockoutDuration: readNumber(
      process.env.NX_LOCKOUT_DURATION,
      DEFAULT_LOCKOUT_DURATION,
    ),
    secureCookies: process.env.NODE_ENV === "production",
  };
}

export type AuthHelpers = {
  readonly getAuthRuntimeConfig: (this: void) => AuthRuntimeConfig;
  readonly requireAuth: (this: void, request: NextRequest) => Promise<NxAuthUser>;
  readonly optionalAuth: (this: void, request: NextRequest) => Promise<NxAuthUser | null>;
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

  async function getSessionUser(request: NextRequest): Promise<NxAuthUser | null> {
    const token = request.cookies.get("nx-session")?.value;
    if (!token) return null;

    try {
      return await verifyTokenFull(token, readSecret(), options.getDb() as never);
    } catch {
      return null;
    }
  }

  const getAuthRuntimeConfig = (): AuthRuntimeConfig => getRuntimeConfig(readSecret());

  const requireAuth = async (request: NextRequest): Promise<NxAuthUser> => {
    const user = await getSessionUser(request);
    if (!user) throw new NxAuthError();
    return user;
  };

  const optionalAuth = (request: NextRequest): Promise<NxAuthUser | null> =>
    getSessionUser(request);

  const requireCsrf = (request: NextRequest): void => {
    const ok = verifyCsrf(
      request.method,
      request.cookies.get("nx-csrf")?.value,
      request.headers.get("x-csrf-token") ?? undefined,
    );
    if (!ok) throw new NxAuthError("Invalid CSRF token");
  };

  const setAuthCookies = (response: NextResponse, tokens: AuthCookieTokens): void => {
    const { tokenExpiration, refreshTokenExpiration, secureCookies } = getAuthRuntimeConfig();

    response.cookies.set({
      name: "nx-session",
      value: tokens.access,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: tokenExpiration,
    });

    response.cookies.set({
      name: "nx-refresh",
      value: tokens.refresh,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      path: "/api/auth/refresh",
      maxAge: refreshTokenExpiration,
    });

    response.cookies.set({
      name: "nx-csrf",
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
      ["nx-session", "/"],
      ["nx-refresh", "/api/auth/refresh"],
      ["nx-csrf", "/"],
    ] as const) {
      response.cookies.set({
        name,
        value: "",
        httpOnly: name !== "nx-csrf",
        secure: secureCookies,
        sameSite: name === "nx-refresh" ? "strict" : "lax",
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
