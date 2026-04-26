"use client";

import { useState } from "react";

interface ApiErrorBody {
  error?: { message?: string; details?: Array<{ field?: string; message?: string }> };
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

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;

export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/members/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          handle: handle.trim().toLowerCase(),
          displayName: displayName.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown;
        setError(extractMessage(body) ?? "Registration failed");
        return;
      }
      // The API responds 200 even when the email/handle was already
      // taken (anti-enumeration). The honest UX is to always show
      // the same "check your email" confirmation regardless.
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="nx-members-form">
        <div className="nx-form-success" role="status">
          <p>
            <strong>Check your email.</strong>
          </p>
          <p>
            We sent a verification link to <code>{email}</code>. Click it to
            activate your account; the link expires in 24 hours.
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

  const handleValid = handle === "" || HANDLE_RE.test(handle);

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
      <label className="nx-form-field">
        <span className="nx-form-label">Display name</span>
        <input
          type="text"
          required
          maxLength={80}
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={submitting}
          className="nx-form-input"
        />
      </label>
      <label className="nx-form-field">
        <span className="nx-form-label">Handle</span>
        <input
          type="text"
          required
          minLength={3}
          maxLength={30}
          pattern="[a-z0-9][a-z0-9_-]{2,29}"
          autoComplete="username"
          value={handle}
          onChange={(e) => setHandle(e.target.value.toLowerCase())}
          disabled={submitting}
          className="nx-form-input"
        />
        <small className="nx-form-help">
          {handleValid
            ? "3–30 chars: lowercase letters, digits, underscore, dash. Must start with a letter or digit."
            : "Invalid format — see rules below."}
        </small>
      </label>
      <label className="nx-form-field">
        <span className="nx-form-label">Password</span>
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
      <div className="nx-form-actions">
        <button
          type="submit"
          className="nx-button-primary"
          disabled={
            submitting ||
            !email.trim() ||
            password.length < 8 ||
            !HANDLE_RE.test(handle) ||
            displayName.trim().length === 0
          }
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </div>
    </form>
  );
}
