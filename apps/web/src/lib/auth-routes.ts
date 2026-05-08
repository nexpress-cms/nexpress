import { createMemberAuthRoutes } from "@nexpress/auth-pages/server";

import { getDb } from "@/lib/bootstrap";
import { ensureFor, nexpressConfig } from "@/lib/init-core";
import {
  clearMemberAuthCookies,
  getMemberAuthRuntimeConfig,
  requireMember,
  setMemberAuthCookies,
} from "@/lib/member-auth-helpers";
import { resetTtlMs, verifyTtlMs } from "@/lib/token-ttl";

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
