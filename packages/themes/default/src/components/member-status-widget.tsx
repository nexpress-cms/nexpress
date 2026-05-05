"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface MemberMe {
  id: string;
  handle: string;
  displayName: string;
}

/**
 * Site header widget that probes `/api/members/me` on mount and
 * renders either signed-in (`@handle` + Sign out) or anonymous
 * (Sign in / Register links). Phase 11.2 moved this from
 * `apps/web/components` into the theme package — it's shipped
 * as a default-theme detail, not framework-level chrome, so
 * a theme that wants a different auth UX can omit or replace it.
 *
 * Client-side detection avoids re-rendering the entire (site)
 * layout when auth state changes — the existing pattern used
 * by the `<Comments />` and `<FollowButton />` components.
 */
export function MemberStatusWidget() {
  const router = useRouter();
  const [member, setMember] = useState<MemberMe | null | "loading">("loading");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/members/me", { credentials: "include" });
        if (!res.ok) {
          setMember(null);
          return;
        }
        const body = (await res.json().catch(() => null)) as
          | { data?: { member?: MemberMe }; member?: MemberMe }
          | null;
        const m = body?.data?.member ?? body?.member ?? null;
        setMember(m && m.id ? m : null);
      } catch {
        setMember(null);
      }
    })();
  }, []);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/members/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore — local state still clears below; the cookie
      // typically expires server-side regardless.
    }
    setMember(null);
    setSigningOut(false);
    router.push("/");
    router.refresh();
  };

  if (member === "loading") {
    return (
      <span
        className="np-member-status np-member-status-loading"
        aria-hidden="true"
      />
    );
  }

  if (member) {
    return (
      <div className="np-member-status">
        <Link href={`/u/${member.handle}`} className="np-member-status-handle">
          @{member.handle}
        </Link>
        <button
          type="button"
          className="np-text-button"
          onClick={() => void onSignOut()}
          disabled={signingOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    );
  }

  return (
    <div className="np-member-status">
      <Link href="/members/login">Sign in</Link>
      <Link href="/members/register" className="np-button-primary">
        Register
      </Link>
    </div>
  );
}
