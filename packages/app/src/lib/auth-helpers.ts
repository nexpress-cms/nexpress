// Side-effect import triggers consumer's bootstrap.ts in Next bundler
// context (see lib/init-core.ts for the full rationale).
import "@/lib/bootstrap";
import { createAuthHelpers, getDb } from "@nexpress/next";

export const {
  getAuthRuntimeConfig,
  requireAuth,
  optionalAuth,
  setAuthCookies,
  clearAuthCookies,
} = createAuthHelpers({ getDb });

export type { AuthCookieTokens, AuthRuntimeConfig } from "@nexpress/next";
