import type {
  MemberAuthHelpers,
  MemberAuthRuntimeConfig,
} from "@nexpress/next";
import type { NextRequest, NextResponse } from "next/server";

export type { NpAuthErrorCode, NpAuthMember } from "../shared/types.js";

/**
 * The bootstrap intent the route should call before touching DB /
 * jobs / email. Apps thread their own `ensureFor` here so the
 * factory doesn't need to know which singleton-init module the
 * app uses (`@/lib/init-core` in the reference app, but a
 * `create-nexpress` site could rename freely).
 */
export type EnsureForFn = (intent: "read" | "plugins" | "write") => Promise<void>;

/**
 * Minimal subset of Drizzle's `NodePgDatabase` shape the routes
 * actually call. Kept structurally typed so different generated-
 * schema unions don't fight the factory. The app passes its
 * `getDb` directly.
 */
export type GetDbFn = () => unknown;

/**
 * Subset of the per-app member-auth helpers the factory consumes.
 * The app already creates the full set via `createMemberAuthHelpers`
 * in `@nexpress/next`; we accept that whole result here to keep
 * one wiring point.
 */
export interface MemberAuthHelpersForRoutes {
  setMemberAuthCookies: MemberAuthHelpers["setMemberAuthCookies"];
  clearMemberAuthCookies: MemberAuthHelpers["clearMemberAuthCookies"];
  getMemberAuthRuntimeConfig: () => MemberAuthRuntimeConfig;
  requireMember: MemberAuthHelpers["requireMember"];
}

/**
 * Wiring config passed once at app boot — `createMemberAuthRoutes`
 * returns one route handler per flow with this config baked in.
 *
 * Typical placement: `apps/<app>/src/lib/auth-routes.ts`. Each
 * `app/api/members/<flow>/route.ts` then exports the matching
 * member from this object as its `POST` / `GET`.
 */
export interface MemberAuthRoutesConfig {
  getDb: GetDbFn;
  ensureFor: EnsureForFn;
  authHelpers: MemberAuthHelpersForRoutes;
  /**
   * Site name and URL for emailed links. The framework can't
   * read these from `nexpressConfig` itself because the routes
   * package doesn't import the app's config; pass the resolved
   * values from the app.
   */
  site: { name: string; url?: string | null };
  /**
   * Per-flow knobs. Each key is optional — the factory falls
   * back to safe defaults that mirror the reference app's prior
   * behavior.
   */
  options?: MemberAuthRoutesOptions;
}

export interface MemberAuthRoutesOptions {
  login?: {
    /**
     * Failed-login attempts allowed before the account locks for
     * `lockoutDurationMs`. Default 5.
     */
    maxAttempts?: number;
    /** Default 15 minutes. */
    lockoutDurationMs?: number;
  };
  register?: {
    /** Default 8. */
    minPasswordLength?: number;
  };
  resetPassword?: {
    /** Default 8. */
    minPasswordLength?: number;
  };
  emailVerify?: {
    /** Default 24 hours. */
    tokenTtlMs?: number;
  };
  forgotPassword?: {
    /** Default 1 hour. */
    tokenTtlMs?: number;
  };
  oauth?: {
    /**
     * Where to redirect after a successful OAuth callback.
     * Default `"/"`. Use `?next=` cookie / search-param flow if
     * you need per-attempt destinations.
     */
    successRedirect?: string;
    /**
     * Where to bounce on OAuth failure. The factory adds
     * `?oauth_error=<code>`. Default `"/members/login"`.
     */
    failureRedirect?: string;
  };
}

/**
 * The route handlers `createMemberAuthRoutes` returns. App route
 * files re-export the matching property as their `GET` / `POST` /
 * `PATCH` / `DELETE`.
 */
export interface MemberAuthRoutes {
  /** POST /api/members/login */
  login: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/members/register */
  register: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/members/logout */
  logout: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/members/refresh */
  refresh: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/members/verify */
  verifyEmail: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/members/forgot-password */
  forgotPassword: (request: NextRequest) => Promise<NextResponse>;
  /** POST /api/members/reset-password */
  resetPassword: (request: NextRequest) => Promise<NextResponse>;
  /**
   * GET /api/members/oauth/[provider]/start
   * Reads the provider id from the dynamic route param (Next 15+
   * passes it via the second arg as `params: Promise<{ provider }>`).
   */
  oauthStart: (
    request: NextRequest,
    ctx: { params: Promise<{ provider: string }> },
  ) => Promise<NextResponse>;
  /**
   * GET /api/members/oauth/[provider]/callback. On success: sets
   * cookies + redirects. On failure: redirects to
   * `failureRedirect?oauth_error=<code>`.
   */
  oauthCallback: (
    request: NextRequest,
    ctx: { params: Promise<{ provider: string }> },
  ) => Promise<NextResponse>;
  /** GET /api/members/me — current member's profile (auth required). */
  meGet: (request: NextRequest) => Promise<NextResponse>;
  /** PATCH /api/members/me — profile update / password change (auth required). */
  mePatch: (request: NextRequest) => Promise<NextResponse>;
  /** DELETE /api/members/me — soft-delete the current member's account. */
  meDelete: (request: NextRequest) => Promise<NextResponse>;
}
