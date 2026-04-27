import { runHook } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { clearAuthCookies, optionalAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensurePluginsLoaded } from "@/lib/init-core";

/**
 * Per-device logout. Clears the current `nx-session` / `nx-refresh` /
 * `nx-csrf` cookies. Previously this also called
 * `invalidateAllSessions(user.id)`, which bumped `nx_users.tokenVersion`
 * and forcibly logged the user out of every other device they had —
 * routine logout had global side effects. (#74)
 *
 * Global logout (kill every session for this user) should be a
 * separate explicit "log out everywhere" endpoint when we add one;
 * the staff JWTs already expire at their natural TTL, and any
 * compromised-token recovery flow can bump tokenVersion via the
 * password change / reset paths that already do it.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await optionalAuth(request);

    if (user) {
      await ensurePluginsLoaded();
      await runHook("auth:beforeLogout", {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      });
    }

    const response = nxSuccessResponse({ success: true });
    clearAuthCookies(response);

    // Phase 15.7 — clear the multi-site picker cookie
    // alongside the session cookies. Without this, the next
    // user logging in on the same device inherits the
    // previous user's site context (and might land on a
    // tenant they don't have access to, which leads to
    // confusing 403s in the admin UI even though it's not a
    // security hole — downstream role checks still gate).
    response.cookies.delete("nx-admin-site");

    return response;
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
