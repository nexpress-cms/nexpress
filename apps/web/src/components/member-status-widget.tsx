"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

interface MemberMe {
  id: string;
  handle: string;
  displayName: string;
}

/**
 * Site header widget that probes `/api/members/me` on mount and
 * shows either:
 *   - signed-in: "@handle" + Sign out button
 *   - anonymous: Sign in / Register links
 *
 * Client-side detection (vs reading from the server-rendered layout)
 * is the framework's existing pattern for member-aware site
 * components — see `<Comments />` and `<FollowButton />`. It avoids
 * re-rendering the entire `(site)` layout when auth state changes.
 */
export function MemberStatusWidget() {
  const router = useRouter();
  const [member, setMember] = useState<MemberMe | null | "loading">("loading");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/members/me", {
          credentials: "include",
        });
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
      // Ignore — even if the network call fails, we still want to
      // clear the local state and reload (cookies usually expire
      // server-side anyway).
    }
    setMember(null);
    setSigningOut(false);
    router.push("/");
    router.refresh();
  };

  if (member === "loading") {
    // Render a minimal placeholder so the header doesn't jump width
    // on hydration. Empty span keeps the flex slot.
    return <span className="nx-member-status nx-member-status-loading" aria-hidden="true" />;
  }

  if (member) {
    return (
      <div className="nx-member-status">
        <Link href={`/u/${member.handle}`} className="nx-member-status-handle">
          @{member.handle}
        </Link>
        <button
          type="button"
          className="nx-text-button"
          onClick={() => void onSignOut()}
          disabled={signingOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    );
  }

  return (
    <div className="nx-member-status">
      <Link href="/members/login">Sign in</Link>
      <Link href="/members/register" className="nx-button-primary">
        Register
      </Link>
    </div>
  );
}
