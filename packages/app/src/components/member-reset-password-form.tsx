"use client";

import { useMemberResetPassword } from "@nexpress/auth-pages/client";
import { npAuthContractLimits } from "@nexpress/core/auth-contract";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");

  const { fields, errors, isSubmitting, submit } = useMemberResetPassword({
    token,
    onSuccess: () => {
      // Token is invalidated server-side and existing sessions are
      // killed. Send the user to login with the reset banner.
      router.push("/members/login?reset=1");
    },
  });

  const passwordValid =
    fields.password.value.length >= npAuthContractLimits.passwordMinLength &&
    fields.password.value.length <= npAuthContractLimits.passwordMaxLength;
  const passwordsMatch = fields.password.value.length > 0 && fields.password.value === confirm;

  return (
    <form
      onSubmit={(e) => {
        // Local match-check before delegating to the hook.
        if (!passwordsMatch) {
          e.preventDefault();
          return;
        }
        void submit(e);
      }}
      className="np-members-form"
    >
      {errors._form ? (
        <div role="alert" className="np-form-error">
          {errors._form}
          <p className="np-form-help">
            <Link href="/members/forgot-password">Request a new reset link</Link>
          </p>
        </div>
      ) : null}

      <label className="np-form-field">
        <span className="np-form-label">New password</span>
        <input
          type="password"
          required
          minLength={npAuthContractLimits.passwordMinLength}
          maxLength={npAuthContractLimits.passwordMaxLength}
          autoComplete="new-password"
          {...fields.password}
          disabled={isSubmitting}
          className="np-form-input"
        />
        <small className="np-form-help">
          {npAuthContractLimits.passwordMinLength}–{npAuthContractLimits.passwordMaxLength}{" "}
          characters.
        </small>
        {errors.password ? <span className="np-form-error">{errors.password}</span> : null}
      </label>

      <label className="np-form-field">
        <span className="np-form-label">Confirm password</span>
        <input
          type="password"
          required
          maxLength={npAuthContractLimits.passwordMaxLength}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={isSubmitting}
          className="np-form-input"
          aria-invalid={confirm.length > 0 && !passwordsMatch}
        />
        {confirm.length > 0 && !passwordsMatch ? (
          <small className="np-form-error">Passwords don&apos;t match.</small>
        ) : null}
      </label>

      <div className="np-form-actions">
        <button
          type="submit"
          className="np-button-primary"
          disabled={isSubmitting || !passwordValid || !passwordsMatch}
        >
          {isSubmitting ? "Saving…" : "Set new password"}
        </button>
      </div>
    </form>
  );
}
