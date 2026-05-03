"use client";

import { useState } from "react";
import Link from "next/link";

type Status = "idle" | "submitting" | "sent" | "error";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("submitting");
    setError("");

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message ?? "Request failed");
        setStatus("error");
        return;
      }

      setStatus("sent");
    } catch {
      setError("Network error");
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-md">
        <h1 className="mb-2 text-center text-2xl font-bold">Reset password</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Enter the email on your account — we&rsquo;ll send a reset link if it matches.
        </p>

        {status === "sent" ? (
          <div className="space-y-4">
            <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
              If an account exists for <strong>{email}</strong>, a reset link has been sent.
              Check your email.
            </div>
            <Link
              href="/admin/login"
              className="block text-center text-sm text-muted-foreground hover:text-primary"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="space-y-4"
          >
            {error ? (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="admin@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={status === "submitting"}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {status === "submitting" ? "Sending…" : "Send reset link"}
            </button>
            <p className="text-center text-sm text-muted-foreground">
              <Link href="/admin/login" className="hover:text-primary">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
