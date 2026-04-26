"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

interface ResetPasswordFormProps {
  token: string;
}

interface ApiErrorBody {
  error?: { message?: string; details?: Array<{ message?: string }> };
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as ApiErrorBody).error;
  if (!err) return null;
  const detail = err.details?.[0]?.message;
  if (typeof detail === "string") return detail;
  if (typeof err.message === "string") return err.message;
  return null;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordsMatch = password.length > 0 && password === confirm;
  const passwordValid = password.length >= 8;

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    if (!passwordsMatch) {
      setError("Passwords don't match.");
      setSubmitting(false);
      return;
    }
    if (!passwordValid) {
      setError("Password must be at least 8 characters.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/members/reset-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown;
        // The most common failure here is an expired or already-
        // used token — surface the API's message verbatim so the
        // user understands they need a fresh email.
        setError(
          extractMessage(body) ??
            "Reset failed. The link may have expired or been used already.",
        );
        return;
      }
      // Token is invalidated server-side; any new sessions belong
      // to the new password. Send the user to login with a banner.
      router.push("/members/login?verified=1");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="nx-members-form"
    >
      {error ? (
        <div role="alert" className="nx-form-error">
          {error}
          <p className="nx-form-help">
            <Link href="/members/forgot-password">Request a new reset link</Link>
          </p>
        </div>
      ) : null}

      <label className="nx-form-field">
        <span className="nx-form-label">New password</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="nx-form-input"
        />
        <small className="nx-form-help">At least 8 characters.</small>
      </label>

      <label className="nx-form-field">
        <span className="nx-form-label">Confirm password</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={submitting}
          className="nx-form-input"
          aria-invalid={confirm.length > 0 && !passwordsMatch}
        />
        {confirm.length > 0 && !passwordsMatch ? (
          <small className="nx-form-error">Passwords don&apos;t match.</small>
        ) : null}
      </label>

      <div className="nx-form-actions">
        <button
          type="submit"
          className="nx-button-primary"
          disabled={submitting || !passwordValid || !passwordsMatch}
        >
          {submitting ? "Saving…" : "Set new password"}
        </button>
      </div>
    </form>
  );
}
