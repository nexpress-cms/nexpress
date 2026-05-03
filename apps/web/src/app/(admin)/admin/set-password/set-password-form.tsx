"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Status = "idle" | "submitting" | "done" | "error";

export function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const missingToken = token.length === 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setStatus("submitting");

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message ?? "Reset failed.");
        setStatus("error");
        return;
      }

      // Strip the token from the URL + browser history so a shared screenshot
      // or a resurrected back-button can't re-submit it. The token is already
      // single-use and has been cleared from the DB by reset-password, but
      // defence in depth.
      window.history.replaceState(null, "", "/admin/set-password");

      setStatus("done");
    } catch {
      setError("Network error");
      setStatus("error");
    }
  }

  if (missingToken) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          Missing reset token. Start from the forgot-password page or the invitation link in
          your email.
        </div>
        <Link
          href="/admin/forgot-password"
          className="block text-center text-sm text-muted-foreground hover:text-primary"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
          Password saved. You can now sign in with the new password.
        </div>
        <button
          type="button"
          onClick={() => router.push("/admin/login")}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  return (
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
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1 block text-sm font-medium">
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {status === "submitting" ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
