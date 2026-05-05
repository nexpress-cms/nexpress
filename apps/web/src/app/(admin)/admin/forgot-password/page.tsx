"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AuthCard,
  AuthLayout,
  Button,
  Input,
  Label,
} from "@nexpress/admin/client";

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
    <AuthLayout>
      <AuthCard
        title="Reset password"
        description={
          status === "sent"
            ? undefined
            : "Enter the email on your account — we'll send a reset link if it matches."
        }
        footer={
          <Link
            href="/admin/login"
            className="text-[var(--nx-color-brand)] hover:underline underline-offset-[3px]"
          >
            ← Back to sign in
          </Link>
        }
      >
        {status === "sent" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] leading-[1.5] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            If an account exists for <strong className="font-semibold">{email}</strong>, a reset link has been sent.
            Check your email.
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="flex flex-col gap-3"
          >
            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-[12.5px]">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@workspace.com"
              />
            </div>
            <Button
              type="submit"
              disabled={status === "submitting"}
              className="mt-1 h-9 w-full justify-center"
            >
              {status === "submitting" ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
      </AuthCard>
    </AuthLayout>
  );
}
