"use client";

import { useMemberRegister } from "@nexpress/auth-pages/client";

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;

export function RegisterForm() {
  const { fields, errors, isSubmitting, isSuccess, submit } = useMemberRegister();

  if (isSuccess) {
    return (
      <div className="np-members-form">
        <div className="np-form-success" role="status">
          <p>
            <strong>Check your email.</strong>
          </p>
          <p>
            We sent a verification link to <code>{fields.email.value}</code>.
            Click it to activate your account; the link expires in 24 hours.
          </p>
          <p className="np-form-help">
            Didn&apos;t get the email? Check your spam folder, or refresh to
            try again.
          </p>
        </div>
      </div>
    );
  }

  const handleValid =
    fields.handle.value === "" || HANDLE_RE.test(fields.handle.value);

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
      <label className="np-form-field">
        <span className="np-form-label">Display name</span>
        <input
          type="text"
          required
          maxLength={80}
          autoComplete="name"
          {...fields.displayName}
          disabled={isSubmitting}
          className="np-form-input"
        />
        {errors.displayName ? (
          <span className="np-form-error">{errors.displayName}</span>
        ) : null}
      </label>
      <label className="np-form-field">
        <span className="np-form-label">Handle</span>
        <input
          type="text"
          required
          minLength={3}
          maxLength={30}
          pattern="[a-z0-9][a-z0-9_-]{2,29}"
          autoComplete="username"
          value={fields.handle.value}
          onChange={(e) =>
            fields.handle.onChange({
              ...e,
              target: { ...e.target, value: e.target.value.toLowerCase() },
            } as typeof e)
          }
          disabled={isSubmitting}
          className="np-form-input"
        />
        <small className="np-form-help">
          {handleValid
            ? "3–30 chars: lowercase letters, digits, underscore, dash. Must start with a letter or digit."
            : "Invalid format — see rules below."}
        </small>
        {errors.handle ? <span className="np-form-error">{errors.handle}</span> : null}
      </label>
      <label className="np-form-field">
        <span className="np-form-label">Password</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          {...fields.password}
          disabled={isSubmitting}
          className="np-form-input"
        />
        <small className="np-form-help">At least 8 characters.</small>
        {errors.password ? <span className="np-form-error">{errors.password}</span> : null}
      </label>
      <div className="np-form-actions">
        <button
          type="submit"
          className="np-button-primary"
          disabled={
            isSubmitting ||
            !fields.email.value.trim() ||
            fields.password.value.length < 8 ||
            !HANDLE_RE.test(fields.handle.value) ||
            fields.displayName.value.trim().length === 0
          }
        >
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </div>
    </form>
  );
}
