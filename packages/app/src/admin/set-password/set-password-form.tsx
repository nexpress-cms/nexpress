"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Label } from "@nexpress/admin/client";
import { npAuthContractLimits } from "@nexpress/core/auth-contract";

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

    if (password.length < npAuthContractLimits.passwordMinLength) {
      setError(
        `Password must be at least ${npAuthContractLimits.passwordMinLength.toString()} characters.`,
      );
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
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Missing reset token. Start from the forgot-password page or the invitation link in your
          email.
        </div>
        <Link
          href="/admin/forgot-password"
          className="text-center text-[13px] text-[var(--np-color-brand)] hover:underline underline-offset-[3px]"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          Password saved. You can now sign in with the new password.
        </div>
        <Button
          type="button"
          onClick={() => router.push("/admin/login")}
          className="h-9 w-full justify-center"
        >
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
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
        <Label htmlFor="password" className="text-[12.5px]">
          New password
        </Label>
        <Input
          id="password"
          type="password"
          minLength={npAuthContractLimits.passwordMinLength}
          maxLength={npAuthContractLimits.passwordMaxLength}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm" className="text-[12.5px]">
          Confirm password
        </Label>
        <Input
          id="confirm"
          type="password"
          minLength={npAuthContractLimits.passwordMinLength}
          maxLength={npAuthContractLimits.passwordMaxLength}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
      <Button
        type="submit"
        disabled={status === "submitting"}
        className="mt-1 h-9 w-full justify-center"
      >
        {status === "submitting" ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
