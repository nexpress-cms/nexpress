import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/member-login-form";
import { ensureCoreServices } from "@/lib/init-core";
import { getSiteMember } from "@/lib/site-member";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; verified?: string }>;
}

export default async function MemberLoginPage({ searchParams }: LoginPageProps) {
  ensureCoreServices();
  const { next, verified } = await searchParams;

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
      <LoginForm next={safeNext(next)} />
      <p className="nx-members-auth-alt">
        Don&apos;t have an account?{" "}
        <Link href={`/members/register${nextQuery(next)}`}>Create one</Link>
      </p>
    </div>
  );
}

/**
 * `next` is read from the URL — we can't trust it. Reject anything
 * that isn't a same-site relative path so an attacker can't craft
 * `?next=https://evil.example.com` and bounce the user off-site
 * after auth.
 */
function safeNext(next: string | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function nextQuery(next: string | undefined): string {
  const safe = safeNext(next);
  if (safe === "/") return "";
  return `?next=${encodeURIComponent(safe)}`;
}
