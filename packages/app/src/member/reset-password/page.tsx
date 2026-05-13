import Link from "next/link";

import { ResetPasswordForm } from "../../components/member-reset-password-form";
import { ShellWrap } from "../../components/shell-wrap";
import { ensureFor } from "@/lib/init-core";

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function MemberResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  await ensureFor("read");
  const { token } = await searchParams;

  if (!token) {
    return (
      <ShellWrap surface="member">
        <div className="np-members-auth">
          <h1>Reset your password</h1>
          <p className="np-form-error">
            Missing reset token. Open the link from the email we sent you, or{" "}
            <Link href="/members/forgot-password">request a new one</Link>.
          </p>
        </div>
      </ShellWrap>
    );
  }

  return (
    <ShellWrap surface="member">
      <div className="np-members-auth">
        <h1>Choose a new password</h1>
        {/* Token validity is checked server-side when the form posts
            — we don't pre-validate here because that would burn one
            DB round-trip per page load. The form's error state
            surfaces "expired or invalid" if the token is no longer
            good (the email link is single-use + 1h TTL). */}
        <ResetPasswordForm token={token} />
      </div>
    </ShellWrap>
  );
}
