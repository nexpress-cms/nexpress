import { type FormEvent, useCallback, useState } from "react";

import type { NpAuthErrorCode } from "../../shared/types.js";
import { resolveMessages, submitJson } from "../internal/submit.js";
import { useControlledFields, type FieldBinding } from "../internal/use-controlled-fields.js";

export interface UseMemberResetPasswordOptions {
  /** Reset token from the email link. */
  token: string;
  endpoint?: string;
  messages?: Partial<Record<NpAuthErrorCode, string>>;
  onSuccess?: () => void;
  onError?: (err: { code: NpAuthErrorCode; message: string }) => void;
}

export interface UseMemberResetPasswordResult {
  fields: { password: FieldBinding };
  errors: Partial<Record<"password" | "_form", string>>;
  isSubmitting: boolean;
  isSuccess: boolean;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export function useMemberResetPassword(
  options: UseMemberResetPasswordOptions,
): UseMemberResetPasswordResult {
  const endpoint = options.endpoint ?? "/api/members/reset-password";
  const messages = resolveMessages(options.messages);
  const { values, fields } = useControlledFields({ password: "" });
  const [errors, setErrors] = useState<UseMemberResetPasswordResult["errors"]>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSubmitting) return;
      if (!options.token) {
        setErrors({ _form: messages.TOKEN_INVALID });
        return;
      }
      setIsSubmitting(true);
      setErrors({});
      try {
        const result = await submitJson<{ memberId: string; email: string }>(
          endpoint,
          { token: options.token, password: values.password },
          messages,
        );
        if (!result.ok) {
          if (result.fields?.password) setErrors({ password: result.fields.password });
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
