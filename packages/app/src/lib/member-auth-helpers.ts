// Side-effect import triggers consumer's bootstrap.ts in Next bundler
// context (see lib/init-core.ts for the full rationale).
import "@/lib/bootstrap";
import { createMemberAuthHelpers, getDb } from "@nexpress/next";

export const {
  getMemberAuthRuntimeConfig,
  requireMember,
  optionalMember,
  setMemberAuthCookies,
  clearMemberAuthCookies,
} = createMemberAuthHelpers({ getDb });

export type { MemberAuthCookieTokens, MemberAuthRuntimeConfig } from "@nexpress/next";
