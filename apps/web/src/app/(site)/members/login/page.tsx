import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/member-login-form";
import { ensureFor } from "@/lib/init-core";
import { nextQuery, safeNext } from "@/lib/safe-next";
import { getSiteMember } from "@/lib/site-member";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; verified?: string; reset?: string }>;
}

export default async function MemberLoginPage({ searchParams }: LoginPageProps) {
  await ensureFor("read");
  const { next, verified, reset } = await searchParams;

  // Already signed in? Skip the form and continue to wherever they
  // were going. Avoids the awkward "you're logged in, here's a
  // login form anyway" state.
  const member = await getSiteMember();
  if (member) {
    redirect(safeNext(next));
  }

  return (
    <div className="nx-members-auth">
      <h1>Sign in</h1>
      {verified === "1" ? (
        <p className="nx-form-success">
          Email confirmed — you can sign in now.
        </p>
      ) : null}
      {reset === "1" ? (
        <p className="nx-form-success">
          Password updated — sign in with your new one.
        </p>
      ) : null}
      <LoginForm next={safeNext(next)} />
      <p className="nx-members-auth-alt">
        <Link href="/members/forgot-password">Forgot your password?</Link>
      </p>
      <p className="nx-members-auth-alt">
        Don&apos;t have an account?{" "}
        <Link href={`/members/register${nextQuery(next)}`}>Create one</Link>
      </p>
    </div>
  );
}
