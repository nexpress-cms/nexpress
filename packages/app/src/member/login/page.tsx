import Link from "next/link";
import { redirect } from "next/navigation";
import { isOAuthProviderAvailableFor, listOAuthProvidersFor } from "@nexpress/core/auth";

import { LoginForm } from "../../components/member-login-form";
import { ShellWrap } from "../../components/shell-wrap";
import { ensureFor } from "../../lib/init-core";
import { nextQuery, safeNext } from "../../lib/safe-next";
import { getSiteMember } from "@nexpress/next";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; verified?: string; reset?: string }>;
}

export default async function MemberLoginPage({ searchParams }: LoginPageProps) {
  await ensureFor("plugins");
  const { next, verified, reset } = await searchParams;

  // Already signed in? Skip the form and continue to wherever they
  // were going. Avoids the awkward "you're logged in, here's a
  // login form anyway" state.
  const member = await getSiteMember();
  if (member) {
    redirect(safeNext(next));
  }
  const providers = (
    await Promise.all(
      listOAuthProvidersFor("member").map(async (provider) =>
        (await isOAuthProviderAvailableFor(provider, "member"))
          ? { id: provider.id, label: provider.label ?? provider.id }
          : null,
      ),
    )
  ).filter((provider): provider is { id: string; label: string } => provider !== null);

  return (
    <ShellWrap surface="member">
      <div className="np-members-auth">
        <h1>Sign in</h1>
        {verified === "1" ? (
          <p className="np-form-success">Email confirmed — you can sign in now.</p>
        ) : null}
        {reset === "1" ? (
          <p className="np-form-success">Password updated — sign in with your new one.</p>
        ) : null}
        {providers.length > 0 ? <MemberOAuthLinks providers={providers} /> : null}
        <LoginForm next={safeNext(next)} />
        <p className="np-members-auth-alt">
          <Link href="/members/forgot-password">Forgot your password?</Link>
        </p>
        <p className="np-members-auth-alt">
          Don&apos;t have an account?{" "}
          <Link href={`/members/register${nextQuery(next)}`}>Create one</Link>
        </p>
      </div>
    </ShellWrap>
  );
}

interface LoginProvider {
  id: string;
  label: string;
}

function MemberOAuthLinks({ providers }: { providers: LoginProvider[] }) {
  return (
    <div className="np-members-oauth" aria-label="OAuth sign in options">
      {providers.map((provider) => {
        const providerPathId = encodeURIComponent(provider.id);
        return (
          <a
            key={provider.id}
            className="np-member-oauth-button"
            data-provider={provider.id.toLowerCase()}
            href={`/api/members/oauth/${providerPathId}/start`}
          >
            <ProviderIcon id={provider.id} />
            <span>Continue with {provider.label}</span>
          </a>
        );
      })}
      <div className="np-members-oauth-divider" aria-hidden="true">
        <span />
        <em>or</em>
        <span />
      </div>
    </div>
  );
}

function ProviderIcon({ id }: { id: string }) {
  const lower = id.toLowerCase();
  if (lower.includes("github")) {
    return (
      <svg
        viewBox="0 0 24 24"
        className="np-member-oauth-icon"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.07c-3.2.7-3.87-1.37-3.87-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.17.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.18-1.48 3.14-1.17 3.14-1.17.62 1.57.23 2.73.11 3.02.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
      </svg>
    );
  }
  if (lower.includes("google")) {
    return (
      <svg viewBox="0 0 24 24" className="np-member-oauth-icon" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.15-4.53H2.18v2.84A11 11 0 0 0 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.85 14.12A6.6 6.6 0 0 1 5.5 12c0-.74.13-1.45.35-2.12V7.04H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.96l3.67-2.84z"
        />
        <path
          fill="#EA4335"
          d="M12 5.4c1.62 0 3.07.56 4.21 1.64l3.16-3.16C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.04l3.67 2.84C6.71 7.33 9.14 5.4 12 5.4z"
        />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className="np-member-oauth-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
