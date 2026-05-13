import Link from "next/link";

import { ForgotPasswordForm } from "../../components/member-forgot-password-form";
import { ShellWrap } from "../../components/shell-wrap";
import { ensureFor } from "@/lib/init-core";

export default async function MemberForgotPasswordPage() {
  await ensureFor("read");
  // We deliberately don't redirect when a member is already signed
  // in — they may want to reset a password they're now signed in
  // with via a different mechanism (OAuth, etc.). The reset email
  // goes to the registered email address either way.

  return (
    <ShellWrap surface="member">
      <div className="np-members-auth">
        <h1>Forgot your password?</h1>
        <p>Enter your email and we&apos;ll send you a reset link.</p>
        <ForgotPasswordForm />
        <p className="np-members-auth-alt">
          Remembered it? <Link href="/members/login">Back to sign in</Link>
        </p>
      </div>
    </ShellWrap>
  );
}
