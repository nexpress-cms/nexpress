import type { AuthHelpers, AuthRuntimeConfig } from "@nexpress/next";
import type { NextRequest, NextResponse } from "next/server";

import type { EnsureForFn, GetDbFn } from "./types.js";

/**
 * Subset of the per-app staff-auth helpers the factory consumes.
 * The app already creates the full set via `createAuthHelpers`
 * in `@nexpress/next`; we accept that whole result here to keep
 * one wiring point (parallel to `MemberAuthHelpersForRoutes`).
 */
export interface StaffAuthHelpersForRoutes {
  setAuthCookies: AuthHelpers["setAuthCookies"];
  clearAuthCookies: AuthHelpers["clearAuthCookies"];
  getAuthRuntimeConfig: () => AuthRuntimeConfig;
  requireAuth: AuthHelpers["requireAuth"];
  optionalAuth: AuthHelpers["optionalAuth"];
  revokeCurrentAuthSession: AuthHelpers["revokeCurrentAuthSession"];
}

/**
 * Wiring config passed once at app boot — `createStaffAuthRoutes`
 * returns one route handler per flow with this config baked in.
 *
 * Typical placement: `apps/<app>/src/lib/auth-routes.ts` (same
 * file the member-auth bootstrap lives in). Each
 * `app/api/auth/<flow>/route.ts` then exports the matching
 * member from this object.
 */
export interface StaffAuthRoutesConfig {
  getDb: GetDbFn;
  ensureFor: EnsureForFn;
  authHelpers: StaffAuthHelpersForRoutes;
  /**
   * Site name and URL for emailed links. Staff reset emails build
   * a link to `/admin/set-password?token=…` against this base.
   */
  site: { name: string; url?: string | null };
  /**
   * Per-flow knobs. Each key is optional — the factory falls
   * back to the same defaults the reference app's routes used
   * before the migration.
   */
  options?: StaffAuthRoutesOptions;
}

export interface StaffAuthRoutesOptions {
  forgotPassword?: {
    /** Default 1 hour. */
    tokenTtlMs?: number;
  };
  oauth?: {
    /**
     * Where to redirect after a successful OAuth callback.
     * Default `"/admin"`.
     */
    successRedirect?: string;
    /**
     * Where to bounce on OAuth failure. The factory adds
     * `?oauth_error=<code>`. Default `"/admin/login"`.
     */
    failureRedirect?: string;
  };
  /**
   * Path the password-reset email links to. Default
   * `"/admin/set-password"`.
   */
  resetUrlPath?: string;
}

/**
 * The route handlers `createStaffAuthRoutes` returns. App route
 * files re-export the matching property as their HTTP-verb
 * export.
 *
 * Staff has no `register` (staff are admin-provisioned, not
 * self-registered) and no `verifyEmail` (no pending state — all
 * staff start active). It DOES have `changePassword` for the
 * authenticated-user flow that member's `/me` PATCH covers.
 */
export interface StaffAuthRoutes {
  /** POST /api/auth/login */
  login: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/auth/logout */
  logout: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/auth/refresh */
  refresh: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/auth/forgot-password */
  forgotPassword: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/auth/reset-password */
  resetPassword: (request: NextRequest) => Promise<NextResponse>;
  /** PATCH /api/auth/change-password — requires auth */
  changePassword: (request: NextRequest) => Promise<NextResponse>;
  /** GET /api/auth/oauth/[provider]/start */
  oauthStart: (
    request: NextRequest,
    ctx: { params: Promise<{ provider: string }> },
  ) => Promise<NextResponse>;
  /** GET /api/auth/oauth/[provider]/callback */
  oauthCallback: (
    request: NextRequest,
    ctx: { params: Promise<{ provider: string }> },
  ) => Promise<NextResponse>;
  /** GET /api/auth/me — current staff user (auth required) */
  meGet: (request: NextRequest) => Promise<NextResponse>;
}
