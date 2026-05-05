import {
  NpAuthError,
  getLogger,
  getMemberFromTokenPayload,
  isTokenVerificationError,
  verifyCsrf,
  verifyMemberToken,
  type NpMemberAuthRow,
} from "@nexpress/core";
import type { NextRequest, NextResponse } from "next/server";

/**
 * Member-side counterpart to `createAuthHelpers`. Same shape, but reads
 * `np-mb-*` cookies, verifies JWTs with `aud: "member"` enforced, and
 * looks members up in `nx_members`. Coexists with the staff helpers in
 * the same Next process.
 */

const DEFAULT_TOKEN_EXPIRATION = 60 * 60 * 2;
const DEFAULT_REFRESH_TOKEN_EXPIRATION = 60 * 60 * 24 * 7;

export interface MemberAuthCookieTokens {
  access: string;
  refresh: string;
  csrf: string;
}

export interface MemberAuthRuntimeConfig {
  secret: string;
  tokenExpiration: number;
  refreshTokenExpiration: number;
  secureCookies: boolean;
}

export interface CreateMemberAuthHelpersOptions<DB> {
  getDb: () => DB;
  getSecret?: () => string;
}

function defaultGetSecret(): string {
  const secret = process.env.NX_SECRET ?? process.env.NX_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error("NX_SECRET must be set (see .env.example)");
  return secret;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type MemberAuthHelpers = {
  readonly getMemberAuthRuntimeConfig: (this: void) => MemberAuthRuntimeConfig;
  readonly requireMember: (this: void, request: NextRequest) => Promise<NpMemberAuthRow>;
  readonly optionalMember: (this: void, request: NextRequest) => Promise<NpMemberAuthRow | null>;
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
    const token = request.cookies.get("nx-mb-session")?.value;
    if (!token) return null;
    try {
      // Refuse refresh tokens presented in the session cookie — without
      // this check a leaked refresh JWT was indistinguishable from an
      // access JWT to the auth path because both kinds were stored as
      // fungible rows in `nx_member_sessions` (#91).
      const payload = await verifyMemberToken(token, readSecret(), "access");
      // Pass the raw access token so the resolver can verify a live
      // row exists in nx_member_sessions — that's what makes
      // `/api/members/logout` actually revoke the token. (#45)
      const member = await getMemberFromTokenPayload(
        options.getDb() as never,
        payload,
        token,
      );
      // Suspended / deleted members lose their session immediately —
      // their JWT may still be cryptographically valid, but the row
      // they reference is no longer allowed to act.
      if (!member || member.status === "suspended" || member.status === "deleted") {
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

  const getMemberAuthRuntimeConfig = (): MemberAuthRuntimeConfig => ({
    secret: readSecret(),
    tokenExpiration: readNumber(process.env.NX_TOKEN_EXPIRATION, DEFAULT_TOKEN_EXPIRATION),
    refreshTokenExpiration: readNumber(
      process.env.NX_REFRESH_TOKEN_EXPIRATION,
      DEFAULT_REFRESH_TOKEN_EXPIRATION,
    ),
    secureCookies: process.env.NODE_ENV === "production",
  });

  const requireMember = async (request: NextRequest): Promise<NpMemberAuthRow> => {
    const member = await getSessionMember(request);
    if (!member) throw new NpAuthError();
    return member;
  };

  const optionalMember = (request: NextRequest): Promise<NpMemberAuthRow | null> =>
    getSessionMember(request);

  const requireMemberCsrf = (request: NextRequest): void => {
    const ok = verifyCsrf(
      request.method,
      request.cookies.get("nx-mb-csrf")?.value,
      request.headers.get("x-csrf-token") ?? undefined,
    );
    if (!ok) throw new NpAuthError("Invalid CSRF token");
  };

  const setMemberAuthCookies = (
    response: NextResponse,
    tokens: MemberAuthCookieTokens,
  ): void => {
    const { tokenExpiration, refreshTokenExpiration, secureCookies } =
      getMemberAuthRuntimeConfig();

    response.cookies.set({
      name: "nx-mb-session",
      value: tokens.access,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: tokenExpiration,
    });

    response.cookies.set({
      name: "nx-mb-refresh",
      value: tokens.refresh,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      path: "/api/members/refresh",
      maxAge: refreshTokenExpiration,
    });

    response.cookies.set({
      name: "nx-mb-csrf",
      value: tokens.csrf,
      httpOnly: false,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: tokenExpiration,
    });
  };

  const clearMemberAuthCookies = (response: NextResponse): void => {
    const { secureCookies } = getMemberAuthRuntimeConfig();
    for (const [name, path] of [
      ["nx-mb-session", "/"],
      ["nx-mb-refresh", "/api/members/refresh"],
      ["nx-mb-csrf", "/"],
    ] as const) {
      response.cookies.set({
        name,
        value: "",
        httpOnly: name !== "nx-mb-csrf",
        secure: secureCookies,
        sameSite: name === "nx-mb-refresh" ? "strict" : "lax",
        path,
        maxAge: 0,
      });
    }
  };

  return {
    getMemberAuthRuntimeConfig,
    requireMember,
    optionalMember,
    requireMemberCsrf,
    setMemberAuthCookies,
    clearMemberAuthCookies,
  };
}
