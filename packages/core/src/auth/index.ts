/**
 * `@nexpress/core/auth` — authentication, authorization, sessions.
 *
 * Capability checks (`can`), JWT signing/verification, OAuth provider
 * registry, password hashing, member-side auth, password reset flow,
 * identity admin. The principal type unifies staff vs member callers.
 */

export { authenticated, isAdmin, isEditorOrAbove, isOwnerOrAdmin } from "./access.js";
export { can } from "./capabilities.js";
export type { NpCapability } from "./capabilities.js";
export { verifyCsrf } from "./csrf.js";
export {
  listMemberIdentities,
  listUserIdentities,
  revokeMemberIdentity,
  revokeUserIdentity,
} from "./identities-admin.js";
export type { NpMemberIdentityRow, NpUserIdentityRow } from "./identities-admin.js";
export {
  consumeMemberEmailVerifyToken,
  consumeMemberPasswordReset,
  createMemberEmailVerifyToken,
  requestMemberPasswordReset,
} from "./member-credentials.js";
export type {
  NpConsumeMemberEmailVerifyResult,
  NpConsumeMemberResetResult,
  NpIssuedMemberToken,
  NpMemberResetRequestResult,
} from "./member-credentials.js";
export { getMemberFromTokenPayload, invalidateAllMemberSessions } from "./member-session.js";
export type { NpMemberAuthRow } from "./member-session.js";
export { signMemberToken, verifyMemberToken } from "./member-token.js";
export type { NpMemberTokenPayload } from "./member-token.js";
export { fromArctic } from "./oauth-arctic.js";
export type { ArcticLikeProvider, ArcticLikeTokens, FromArcticOptions } from "./oauth-arctic.js";
export {
  getOAuthProvider,
  listOAuthProviders,
  registerOAuthProvider,
  resetOAuthProviders,
} from "./oauth-providers.js";
export type {
  OAuthAuthorizeParams,
  OAuthExchangeParams,
  OAuthProfile,
  OAuthProvider,
} from "./oauth-providers.js";
export { resolveMemberOAuthLogin } from "./oauth-resolve-member.js";
export type {
  ResolveMemberOAuthLoginInput,
  ResolveMemberOAuthLoginResult,
  ResolvedOAuthMember,
} from "./oauth-resolve-member.js";
export { resolveOAuthLogin } from "./oauth-resolve.js";
export type {
  ResolveOAuthLoginInput,
  ResolveOAuthLoginResult,
  ResolvedOAuthUser,
} from "./oauth-resolve.js";
export { issueOAuthState, verifyOAuthState } from "./oauth-state.js";
export type { IssuedOAuthState, OAuthStatePayload, VerifyOAuthStateResult } from "./oauth-state.js";
export { ARGON2_OPTIONS, hashPassword, verifyPassword } from "./password.js";
export type { NpPrincipal } from "./principal.js";
export {
  consumePasswordResetToken,
  createPasswordResetToken,
  requestPasswordReset,
} from "./reset-token.js";
export type {
  NpConsumeResetTokenOptions,
  NpConsumeResetTokenResult,
  NpCreateResetTokenOptions,
  NpIssuedResetToken,
  NpPasswordResetPurpose,
  NpResetRequestResult,
} from "./reset-token.js";
export { invalidateAllSessions, sha256, verifyTokenFull } from "./session.js";
export { isTokenVerificationError, signToken, verifyToken } from "./token.js";
export type { NpTokenPayload } from "./token.js";
export { getUserById } from "./users.js";
export type { NpUserBasic } from "./users.js";
