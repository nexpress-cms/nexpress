"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface LoginFormProps {
  /** Pre-validated same-site relative path. Server component
   *  rejects unsafe values before passing here. */
  next: string;
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

export function LoginForm({ next }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/members/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown;
        // The API deliberately returns the same generic "Invalid
        // credentials" for bad password / pending account /
        // suspended account so the UI just surfaces what it gets.
        setError(extractMessage(body) ?? "Sign-in failed");
        return;
      }
      router.push(next);
      router.refresh();
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
      className="np-members-form"
    >
      {error ? (
        <div role="alert" className="np-form-error">
          {error}
        </div>
      ) : null}
      <label className="np-form-field">
        <span className="np-form-label">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="np-form-input"
        />
      </label>
      <label className="np-form-field">
        <span className="np-form-label">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="np-form-input"
        />
      </label>
      <div className="np-form-actions">
        <button
          type="submit"
          className="np-button-primary"
          disabled={submitting || !email.trim() || password.length === 0}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
