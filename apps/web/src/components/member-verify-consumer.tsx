"use client";

import { useMemberVerifyEmail } from "@nexpress/auth-pages/client";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface VerifyTokenConsumerProps {
  token: string;
}

/**
 * Auto-consumes the email-verification token on mount, then either
 * redirects to /members/login (success) or shows an error. The
 * hook handles the once-only fetch (Strict-Mode safe) and the
 * status state machine; this component owns the JSX + redirect.
 */
export function VerifyTokenConsumer({ token }: VerifyTokenConsumerProps) {
  const router = useRouter();
  const { status, error } = useMemberVerifyEmail({
    token,
    onSuccess: () => {
      // Don't auto-sign-in — let the user type their password once.
      router.push("/members/login?verified=1");
    },
  });

  if (status === "verifying" || status === "idle") {
    return <p>Confirming your email…</p>;
  }
  if (status === "error") {
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
  return <p>Email confirmed. Redirecting to sign in…</p>;
}
