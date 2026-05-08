import { createStaffAuthRoutes } from "@nexpress/auth-pages/server";

import {
  clearAuthCookies,
  getAuthRuntimeConfig,
  optionalAuth,
  requireAuth,
  setAuthCookies,
} from "@/lib/auth-helpers";
import { ensureFor, getDb, nexpressConfig } from "@/lib/bootstrap";

/**
 * Bootstrapped staff-auth route handlers. Each
 * `app/api/auth/<flow>/route.ts` re-exports the matching
 * member as its HTTP-verb export — see those files for the
 * one-line wiring.
 *
 * Centralizing the config keeps DB / ensureFor / cookie /
 * site-identity wiring in one spot, so a security patch landing
 * in `@nexpress/auth-pages` doesn't require sweeping every
 * `app/api/auth/*` file by hand.
 *
 * Adding member auth: import `createMemberAuthRoutes` from
 * `@nexpress/auth-pages/server` and create a `memberAuthRoutes`
 * export below, then add the matching route files under
 * `app/api/members/*`. See the cookbook for the full member-side
 * recipe.
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
});
