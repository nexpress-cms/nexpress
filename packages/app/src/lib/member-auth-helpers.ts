import { createMemberAuthHelpers } from "@nexpress/next";

import { getDb } from "@/lib/bootstrap";

export const {
  getMemberAuthRuntimeConfig,
  requireMember,
  optionalMember,
  revokeCurrentMemberSession,
  setMemberAuthCookies,
  clearMemberAuthCookies,
} = createMemberAuthHelpers({ getDb });

export type { MemberAuthCookieTokens, MemberAuthRuntimeConfig } from "@nexpress/next";
