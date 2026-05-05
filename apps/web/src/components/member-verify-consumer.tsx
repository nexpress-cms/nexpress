"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface VerifyTokenConsumerProps {
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

/**
 * Auto-consumes the email-verification token on mount, then either
 * redirects to /members/login (success — the user signs in with the
 * password they registered with) or shows an error.
 *
 * Why a client component for what's effectively a server task: the
 * verify endpoint is `POST /api/members/verify` (single-use token,
 * mutates `np_members.status` from `pending` to `active`). A server
 * page that POSTs server-side on every render would burn the token
 * on a page refresh; a client component fetches once-per-mount with
 * a guard that prevents React Strict-Mode double-fires from
 * double-consuming.
 */
export function VerifyTokenConsumer({ token }: VerifyTokenConsumerProps) {
  const router = useRouter();
  const [state, setState] = useState<"pending" | "success" | "error">("pending");
  const [error, setError] = useState<string | null>(null);
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/members/verify", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as unknown;
          setError(extractMessage(body) ?? "This verification link is invalid or has expired.");
          setState("error");
          return;
        }
        setState("success");
        // Land on the login page with a success banner. Don't
        // auto-sign-in — the user just confirmed their email; they
        // know their password and we want them to type it once
        // (matches industry norms + leaves session creation to the
        // /members/login API which does the proper cookie set).
        router.push("/members/login?verified=1");
      } catch {
        setError("Network error. Please try the link again.");
        setState("error");
      }
    })();
  }, [token, router]);

  if (state === "pending") {
    return <p>Confirming your email…</p>;
  }
  if (state === "error") {
    return (
      <div className="np-form-error" role="alert">
        <p>
          <strong>Verification failed.</strong>
        </p>
        <p>{error ?? "Unknown error."}</p>
        <p>
          <Link href="/members/register">Request a new verification email</Link>
        </p>
      </div>
    );
  }
  // Briefly visible while the router pushes.
  return <p>Email confirmed. Redirecting to sign in…</p>;
}
