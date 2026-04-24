import type { Metadata } from "next";
import { Suspense } from "react";

import { SetPasswordForm } from "./set-password-form";

// Opt into `<meta name="referrer" content="no-referrer">` so the reset token
// in the URL isn't leaked via Referer to any sub-request — even same-origin
// ones (analytics, fonts, images that might be added later).
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-md">
        <h1 className="mb-2 text-center text-2xl font-bold">Set password</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Choose a password to finish activating your account.
        </p>
        <Suspense fallback={<p className="text-center text-sm">Loading…</p>}>
          <SetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
