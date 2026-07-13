import type { NpMemberSessionUser } from "@nexpress/core/auth-contract";
export type { NpMemberSessionUser } from "@nexpress/core/auth-contract";

/**
 * Shared types between the server route factories and the client
 * hooks. Lives in `src/shared/` so both bundles import from one
 * source — error codes that the server emits and the client maps
 * to user-facing strings stay in sync without a separate doc.
 */

export type NpAuthMember = NpMemberSessionUser;

/**
 * Stable error codes the auth routes return. The hook maps these
 * to user-facing strings via the `messages` option, so adding a
 * code is a non-breaking minor (default message kicks in) and
 * removing a code is a breaking minor (callers may have custom
 * messages keyed on it).
 */
export type NpAuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "REGISTRATION_DISABLED"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "NETWORK"
  | "SERVER_ERROR"
  | "UNAUTHORIZED";

/**
 * Default user-facing messages keyed by error code. The hook's
 * `messages` option accepts a partial override of this shape; any
 * code the caller doesn't customize falls back here. English-only
 * — sites that localize are expected to override entirely (or
 * funnel through `t()` themselves before passing).
 */
export const DEFAULT_AUTH_MESSAGES: Record<NpAuthErrorCode, string> = {
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  ACCOUNT_LOCKED: "Account is temporarily locked. Try again in a few minutes.",
  REGISTRATION_DISABLED: "Registration is currently closed.",
  VALIDATION: "Please check the form and try again.",
  RATE_LIMITED: "Too many attempts. Try again later.",
  TOKEN_INVALID: "This link is invalid or has already been used.",
  TOKEN_EXPIRED: "This link has expired. Request a new one.",
  NETWORK: "Network error. Please try again.",
  SERVER_ERROR: "Something went wrong. Please try again.",
  UNAUTHORIZED: "You need to be signed in to do that.",
};
