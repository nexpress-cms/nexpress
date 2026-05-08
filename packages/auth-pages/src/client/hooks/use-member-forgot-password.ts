import { type FormEvent, useCallback, useState } from "react";

import type { NpAuthErrorCode } from "../../shared/types.js";
import { resolveMessages, submitJson } from "../internal/submit.js";
import { useControlledFields, type FieldBinding } from "../internal/use-controlled-fields.js";

export interface UseMemberForgotPasswordOptions {
  endpoint?: string;
  messages?: Partial<Record<NpAuthErrorCode, string>>;
  onSuccess?: () => void;
  onError?: (err: { code: NpAuthErrorCode; message: string }) => void;
}

export interface UseMemberForgotPasswordResult {
  fields: { email: FieldBinding };
  errors: Partial<Record<"email" | "_form", string>>;
  isSubmitting: boolean;
  /**
   * True after the request returns 200. Anti-enumeration: same
   * value whether the email matched a member or not. Pages
   * typically swap to a "If we found that account, we sent a
   * link…" confirmation.
   */
  isSuccess: boolean;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export function useMemberForgotPassword(
  options: UseMemberForgotPasswordOptions = {},
): UseMemberForgotPasswordResult {
  const endpoint = options.endpoint ?? "/api/members/forgot-password";
  const messages = resolveMessages(options.messages);
  const { values, fields } = useControlledFields({ email: "" });
  const [errors, setErrors] = useState<UseMemberForgotPasswordResult["errors"]>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSubmitting) return;
      setIsSubmitting(true);
      setErrors({});
      try {
        const result = await submitJson<{ ok: true }>(endpoint, values, messages);
        if (!result.ok) {
          if (result.fields?.email) setErrors({ email: result.fields.email });
          else setErrors({ _form: result.message });
          options.onError?.({ code: result.code, message: result.message });
          return;
        }
        setIsSuccess(true);
        options.onSuccess?.();
      } finally {
        setIsSubmitting(false);
      }
    },
    [endpoint, isSubmitting, values, messages, options],
  );

  return { fields, errors, isSubmitting, submit, isSuccess };
}
