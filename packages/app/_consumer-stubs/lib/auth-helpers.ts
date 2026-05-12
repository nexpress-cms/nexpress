// Stub — see ./init-core.ts.
import type { NpAuthUser } from "@nexpress/core";
import type { NextRequest } from "next/server";

export function getAuthRuntimeConfig(): {
  secret: string;
  tokenExpiration: number;
  refreshTokenExpiration: number;
} {
  return { secret: "", tokenExpiration: 0, refreshTokenExpiration: 0 };
}

export async function requireAuth(_request?: NextRequest): Promise<NpAuthUser> {
  throw new Error("stub — overridden by consumer");
}

export async function optionalAuth(_request?: NextRequest): Promise<NpAuthUser | null> {
  return null;
}

export function setAuthCookies(_response: Response, _tokens: { access: string; refresh: string; csrf?: string }): void {}
export function clearAuthCookies(_response: Response): void {}

export type AuthCookieTokens = { access: string; refresh: string; csrf?: string };
export interface AuthRuntimeConfig {
  secret: string;
  tokenExpiration: number;
  refreshTokenExpiration: number;
}
