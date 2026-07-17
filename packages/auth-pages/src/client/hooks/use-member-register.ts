import { type FormEvent, useCallback, useState } from "react";

import type { NpAuthErrorCode } from "../../shared/types.js";
import { resolveMessages, submitJson } from "../internal/submit.js";
import { useControlledFields, type FieldBinding } from "../internal/use-controlled-fields.js";

export interface UseMemberRegisterOptions {
  endpoint?: string;
  messages?: Partial<Record<NpAuthErrorCode, string>>;
  onSuccess?: () => void;
  onError?: (err: { code: NpAuthErrorCode; message: string }) => void;
}

export interface UseMemberRegisterResult {
  fields: {
    email: FieldBinding;
    password: FieldBinding;
    handle: FieldBinding;
    displayName: FieldBinding;
  };
  errors: Partial<Record<"email" | "password" | "handle" | "displayName" | "_form", string>>;
  isSubmitting: boolean;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  /**
   * True after a successful submit. Pages typically use this to
   * swap the form for a "Check your email to verify your account"
   * confirmation, since the response is anti-enumeration constant
   * (`{ ok: true }`) and there's no useful payload to render.
   */
  isSuccess: boolean;
}

export function useMemberRegister(options: UseMemberRegisterOptions = {}): UseMemberRegisterResult {
  const endpoint = options.endpoint ?? "/api/members/register";
  const messages = resolveMessages(options.messages);
  const { values, fields } = useControlledFields({
    email: "",
    password: "",
    handle: "",
    displayName: "",
  });
  const [errors, setErrors] = useState<UseMemberRegisterResult["errors"]>({});
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
          const next: UseMemberRegisterResult["errors"] = {};
          if (result.fields) {
            for (const k of ["email", "password", "handle", "displayName"] as const) {
              if (result.fields[k]) next[k] = result.fields[k];
            }
          }
          if (Object.keys(next).length === 0) next._form = result.message;
          setErrors(next);
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
