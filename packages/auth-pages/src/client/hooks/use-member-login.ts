import { type FormEvent, useCallback, useState } from "react";

import type { NpAuthErrorCode, NpAuthMember } from "../../shared/types.js";
import { resolveMessages, submitJson } from "../internal/submit.js";
import { useControlledFields, type FieldBinding } from "../internal/use-controlled-fields.js";

export interface UseMemberLoginOptions {
  /** Default `"/api/members/login"`. */
  endpoint?: string;
  /**
   * Override user-facing messages by error code. Anything you
   * don't override falls through to the framework default
   * (English). Sites that localize typically swap this whole
   * shape after running their `t()` lookups.
   */
  messages?: Partial<Record<NpAuthErrorCode, string>>;
  /**
   * Called after a successful sign-in. The `next` arg is the
   * raw `?next=` query-string value if present (your page
   * should sanitize it before redirecting).
   */
  onSuccess?: (payload: { member: NpAuthMember; next: string | null }) => void;
  /**
   * Called when the submit fails. Useful for analytics; the hook
   * already surfaces the user-facing message via `errors`.
   */
  onError?: (err: { code: NpAuthErrorCode; message: string }) => void;
}

export interface UseMemberLoginResult {
  fields: { email: FieldBinding; password: FieldBinding };
  errors: Partial<Record<"email" | "password" | "_form", string>>;
  isSubmitting: boolean;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  /** True after a successful submit; lets the page show "Redirecting…" */
  isSuccess: boolean;
}

/**
 * Sign-in form lifecycle. Exposes controlled `email` + `password`
 * bindings, normalized error state, and a `submit` handler bound
 * to the configured endpoint.
 */
export function useMemberLogin(options: UseMemberLoginOptions = {}): UseMemberLoginResult {
  const endpoint = options.endpoint ?? "/api/members/login";
  const messages = resolveMessages(options.messages);
  const { values, fields } = useControlledFields({ email: "", password: "" });
  const [errors, setErrors] = useState<UseMemberLoginResult["errors"]>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSubmitting) return;
      setIsSubmitting(true);
      setErrors({});
      try {
        const result = await submitJson<{ member: NpAuthMember }>(
          endpoint,
          values,
          messages,
        );
        if (!result.ok) {
          const fieldErrors: UseMemberLoginResult["errors"] = {};
          if (result.fields?.email) fieldErrors.email = result.fields.email;
          if (result.fields?.password) fieldErrors.password = result.fields.password;
          if (!fieldErrors.email && !fieldErrors.password) {
            fieldErrors._form = result.message;
          }
          setErrors(fieldErrors);
          options.onError?.({ code: result.code, message: result.message });
          return;
        }
        setIsSuccess(true);
        const next =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("next")
            : null;
        options.onSuccess?.({ member: result.data.member, next });
      } finally {
        setIsSubmitting(false);
      }
    },
    [endpoint, isSubmitting, values, messages, options],
  );

  return { fields, errors, isSubmitting, submit, isSuccess };
}
