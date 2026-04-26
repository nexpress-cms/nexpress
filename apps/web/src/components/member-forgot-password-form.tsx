"use client";

import { useState } from "react";

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

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/members/forgot-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        // Validation-level errors only (malformed email). The
        // endpoint always 200s on a valid email shape, regardless
        // of whether it matched a member — anti-enumeration. So
        // anything we surface here is a client-side input issue.
        const body = (await res.json().catch(() => null)) as unknown;
        setError(extractMessage(body) ?? "Couldn't send the reset email.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    // Constant confirmation regardless of whether the email matched
    // a member — matches the API's anti-enumeration policy. We
    // never reveal whether the email is registered.
    return (
      <div className="nx-members-form">
        <div className="nx-form-success" role="status">
          <p>
            <strong>Check your email.</strong>
          </p>
          <p>
            If <code>{email}</code> matches an account, we&apos;ve sent a
            reset link. The link expires in 1 hour.
          </p>
          <p className="nx-form-help">
            Didn&apos;t get the email? Check your spam folder, or{" "}
            <button
              type="button"
              className="nx-text-button"
              onClick={() => {
                setSubmitted(false);
                setError(null);
              }}
            >
              try again
            </button>
            .
          </p>
        </div>
      </div>
    );
  }

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
        </div>
      ) : null}
      <label className="nx-form-field">
        <span className="nx-form-label">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="nx-form-input"
        />
      </label>
      <div className="nx-form-actions">
        <button
          type="submit"
          className="nx-button-primary"
          disabled={submitting || !email.trim()}
        >
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </div>
    </form>
  );
}
