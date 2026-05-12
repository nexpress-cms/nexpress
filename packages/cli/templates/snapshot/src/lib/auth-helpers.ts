import { createAuthHelpers } from "@nexpress/next";

import { getDb } from "@/lib/bootstrap";

export const {
  getAuthRuntimeConfig,
  requireAuth,
  optionalAuth,
  setAuthCookies,
  clearAuthCookies,
} = createAuthHelpers({ getDb });

export type { AuthCookieTokens, AuthRuntimeConfig } from "@nexpress/next";
