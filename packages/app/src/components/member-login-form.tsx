"use client";

import { useMemberLogin } from "@nexpress/auth-pages/client";
import { useRouter } from "next/navigation";

interface LoginFormProps {
  /** Pre-validated same-site relative path. Server component
   *  rejects unsafe values before passing here. */
  next: string;
}

export function LoginForm({ next }: LoginFormProps) {
  const router = useRouter();
  const { fields, errors, isSubmitting, isSuccess, submit } = useMemberLogin({
    onSuccess: () => {
      router.push(next);
      router.refresh();
    },
  });

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
          disabled={isSubmitting || isSuccess}
          className="np-form-input"
        />
        {errors.email ? <span className="np-form-error">{errors.email}</span> : null}
      </label>
      <label className="np-form-field">
        <span className="np-form-label">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          {...fields.password}
          disabled={isSubmitting || isSuccess}
          className="np-form-input"
        />
        {errors.password ? <span className="np-form-error">{errors.password}</span> : null}
      </label>
      <div className="np-form-actions">
        <button
          type="submit"
          className="np-button-primary"
          disabled={
            isSubmitting ||
            isSuccess ||
            !fields.email.value.trim() ||
            fields.password.value.length === 0
          }
        >
          {isSubmitting ? "Signing in…" : isSuccess ? "Redirecting…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
