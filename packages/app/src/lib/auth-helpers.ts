import { NpForbiddenError, type NpAuthUser } from "@nexpress/core";
import { resolveSiteAuthUser } from "@nexpress/core/sites";
import { createAuthHelpers } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { getDb } from "@/lib/bootstrap";

const auth = createAuthHelpers({ getDb });

export const { getAuthRuntimeConfig, setAuthCookies, clearAuthCookies } = auth;
export const requireGlobalAuth = auth.requireAuth;

/**
 * Resolve authenticated staff onto the current site's persisted role before
 * any route or collection access policy sees the actor. This keeps the broad
 * route surface on the same membership/default/super-admin contract as
 * explicit `canOnSite()` checks.
 */
export async function requireAuth(request: NextRequest): Promise<NpAuthUser> {
  const user = await auth.requireAuth(request);
  const siteUser = await resolveSiteAuthUser(user);
  if (!siteUser) throw new NpForbiddenError("site", "access");
  return siteUser;
}

export async function optionalAuth(request: NextRequest): Promise<NpAuthUser | null> {
  const user = await auth.optionalAuth(request);
  return user ? resolveSiteAuthUser(user) : null;
}

export type { AuthCookieTokens, AuthRuntimeConfig } from "@nexpress/next";
