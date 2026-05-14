import {
  createMemberAuthRoutes,
  createStaffAuthRoutes,
} from "@nexpress/auth-pages/server";

import {
  clearAuthCookies,
  getAuthRuntimeConfig,
  optionalAuth,
  requireAuth,
  setAuthCookies,
} from "./auth-helpers";
import { getDb } from "@/lib/bootstrap";
import { ensureFor, nexpressConfig } from "./init-core";
import {
  clearMemberAuthCookies,
  getMemberAuthRuntimeConfig,
  requireMember,
  setMemberAuthCookies,
} from "./member-auth-helpers";
import { resetTtlMs, verifyTtlMs } from "./token-ttl";

/**
 * Bootstrapped member-auth route handlers. Each
 * `app/api/members/<flow>/route.ts` re-exports the matching
 * member as its `POST` / `GET` / `PATCH` / `DELETE` — see those
 * files for the one-line wiring.
 *
 * Centralizing the config here keeps DB / ensureFor / cookie /
 * site-identity wiring in one spot, so a security patch landing
 * in `@nexpress/auth-pages` doesn't require sweeping the app's
 * `app/api/members/*` files.
 */
export const memberAuthRoutes = createMemberAuthRoutes({
  getDb,
  ensureFor,
  authHelpers: {
    setMemberAuthCookies,
    clearMemberAuthCookies,
    getMemberAuthRuntimeConfig,
    requireMember,
  },
  site: {
    name: nexpressConfig.site.name,
    url: process.env.SITE_URL ?? null,
  },
  options: {
    emailVerify: { tokenTtlMs: verifyTtlMs },
    forgotPassword: { tokenTtlMs: resetTtlMs },
  },
});

/**
 * Bootstrapped staff-auth route handlers — same model as
 * `memberAuthRoutes`, but for the admin (`/api/auth/*`) user pool.
 * Different table (`np_users`), different cookie names, no
 * registration / email-verify flow, plus a `changePassword`
 * endpoint that the member side covers via `/me` PATCH.
 */
export const staffAuthRoutes = createStaffAuthRoutes({
  getDb,
  ensureFor,
  authHelpers: {
    setAuthCookies,
    clearAuthCookies,
    getAuthRuntimeConfig,
    requireAuth,
    optionalAuth,
  },
  site: {
    name: nexpressConfig.site.name,
    url: process.env.SITE_URL ?? null,
  },
  options: {
    forgotPassword: { tokenTtlMs: resetTtlMs },
  },
});
