import { NxAuthError, verifyCsrf, verifyTokenFull, type NxAuthUser } from "@nexpress/core";
import type { NextRequest, NextResponse } from "next/server";

import { getDb, type NxDb } from "@/lib/db";

const DEFAULT_TOKEN_EXPIRATION = 60 * 60 * 2;
const DEFAULT_REFRESH_TOKEN_EXPIRATION = 60 * 60 * 24 * 7;
const DEFAULT_MAX_LOGIN_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_DURATION = 60 * 15;

let authSecret = "";
let dbRef: NxDb | null = null;

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

export function initAuthHelpers(secret: string, db: NxDb): void {
  authSecret = secret;
  dbRef = db;
}

function readRequiredSecret(): string {
  const secret = process.env.NX_AUTH_SECRET ?? process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error("NX_AUTH_SECRET or AUTH_SECRET must be set");
  }

  return secret;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ensureInitialized(): { secret: string; db: NxDb } {
  if (!authSecret) {
    authSecret = readRequiredSecret();
  }

  if (!dbRef) {
    dbRef = getDb();
  }

  return { secret: authSecret, db: dbRef };
}

export function getAuthRuntimeConfig(): AuthRuntimeConfig {
  const { secret } = ensureInitialized();

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

async function getSessionUser(request: NextRequest): Promise<NxAuthUser | null> {
  const token = request.cookies.get("nx-session")?.value;

  if (!token) {
    return null;
  }

  const { secret, db } = ensureInitialized();

  try {
    return await verifyTokenFull(token, secret, db);
  } catch {
    return null;
  }
}

export async function requireAuth(request: NextRequest): Promise<NxAuthUser> {
  const user = await getSessionUser(request);

  if (!user) {
    throw new NxAuthError();
  }

  return user;
}

export function requireCsrf(request: NextRequest): void {
  const valid = verifyCsrf(
    request.method,
    request.cookies.get("nx-csrf")?.value,
    request.headers.get("x-csrf-token") ?? undefined,
  );

  if (!valid) {
    throw new NxAuthError("Invalid CSRF token");
  }
}

export async function optionalAuth(request: NextRequest): Promise<NxAuthUser | null> {
  return getSessionUser(request);
}

export function setAuthCookies(response: NextResponse, tokens: AuthCookieTokens): void {
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
}

export function clearAuthCookies(response: NextResponse): void {
  const { secureCookies } = getAuthRuntimeConfig();

  response.cookies.set({
    name: "nx-session",
    value: "",
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  response.cookies.set({
    name: "nx-refresh",
    value: "",
    httpOnly: true,
    secure: secureCookies,
    sameSite: "strict",
    path: "/api/auth/refresh",
    maxAge: 0,
  });

  response.cookies.set({
    name: "nx-csrf",
    value: "",
    httpOnly: false,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
