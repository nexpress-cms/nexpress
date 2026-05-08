"use client";

import { useMemberForgotPassword } from "@nexpress/auth-pages/client";

export function ForgotPasswordForm() {
  const { fields, errors, isSubmitting, isSuccess, submit } = useMemberForgotPassword();

  if (isSuccess) {
    // Constant confirmation regardless of whether the email matched
    // a member — matches the API's anti-enumeration policy.
    return (
      <div className="np-members-form">
        <div className="np-form-success" role="status">
          <p>
            <strong>Check your email.</strong>
          </p>
          <p>
            If <code>{fields.email.value}</code> matches an account, we&apos;ve
            sent a reset link. The link expires in 1 hour.
          </p>
          <p className="np-form-help">
            Didn&apos;t get the email? Check your spam folder, or refresh to
            try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { void submit(e); }} className="np-members-form">
      {errors._form ? (
        <div role="alert" className="np-form-error">
          {errors._form}
        </div>
      ) : null}
      <label className="np-form-field">
        <span className="np-form-label">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          {...fields.email}
          disabled={isSubmitting}
          className="np-form-input"
        />
        {errors.email ? <span className="np-form-error">{errors.email}</span> : null}
      </label>
      <div className="np-form-actions">
        <button
          type="submit"
          className="np-button-primary"
          disabled={isSubmitting || !fields.email.value.trim()}
        >
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </div>
    </form>
  );
}
