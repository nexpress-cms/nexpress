import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard, AuthLayout } from "@nexpress/admin/client";

import { SetPasswordForm } from "./set-password-form";

// Opt into `<meta name="referrer" content="no-referrer">` so the reset token
// in the URL isn't leaked via Referer to any sub-request — even same-origin
// ones (analytics, fonts, images that might be added later).
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function SetPasswordPage() {
  return (
    <AuthLayout>
      <AuthCard
        title="Set password"
        description="Choose a password to finish activating your account."
      >
        <Suspense
          fallback={<p className="text-[13px] text-neutral-500 dark:text-neutral-400">Loading…</p>}
        >
          <SetPasswordForm />
        </Suspense>
      </AuthCard>
    </AuthLayout>
  );
}
