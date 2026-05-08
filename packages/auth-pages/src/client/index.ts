/**
 * Headless React hooks for member auth pages. Each hook returns
 * controlled-input bindings, error state, and a submit handler so
 * pages can render their own JSX while the framework owns the
 * form lifecycle.
 *
 * Pages typically import one hook per route:
 *
 *   import { useMemberLogin } from "@nexpress/auth-pages/client";
 *
 *   function LoginPage() {
 *     const { fields, errors, isSubmitting, submit } = useMemberLogin();
 *     return <form onSubmit={submit}>...</form>;
 *   }
 */
export { useMemberLogin } from "./hooks/use-member-login.js";
export { useMemberRegister } from "./hooks/use-member-register.js";
export { useMemberLogout } from "./hooks/use-member-logout.js";
export { useMemberVerifyEmail } from "./hooks/use-member-verify-email.js";
export { useMemberForgotPassword } from "./hooks/use-member-forgot-password.js";
export { useMemberResetPassword } from "./hooks/use-member-reset-password.js";

export type {
  UseMemberLoginOptions,
  UseMemberLoginResult,
} from "./hooks/use-member-login.js";
export type {
  UseMemberRegisterOptions,
  UseMemberRegisterResult,
} from "./hooks/use-member-register.js";
export type {
  UseMemberLogoutOptions,
  UseMemberLogoutResult,
} from "./hooks/use-member-logout.js";
export type {
  UseMemberVerifyEmailOptions,
  UseMemberVerifyEmailResult,
} from "./hooks/use-member-verify-email.js";
export type {
  UseMemberForgotPasswordOptions,
  UseMemberForgotPasswordResult,
} from "./hooks/use-member-forgot-password.js";
export type {
  UseMemberResetPasswordOptions,
  UseMemberResetPasswordResult,
} from "./hooks/use-member-reset-password.js";

export type { NpAuthErrorCode, NpAuthMember } from "../shared/types.js";
export { DEFAULT_AUTH_MESSAGES } from "../shared/types.js";
