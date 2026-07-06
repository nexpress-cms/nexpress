"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface MemberMe {
  id: string;
  handle: string;
  displayName: string;
}

export interface MemberStatusWidgetProps {
  initialMember?: MemberMe | null;
  initialUnreadNotifications?: number | null;
}

/**
 * Site header widget that renders either signed-in (`@handle` + Sign out) or anonymous
 * (Sign in / Register links). Phase 11.2 moved this from
 * `apps/web/components` into the theme package — it's shipped
 * as a default-theme detail, not framework-level chrome, so
 * a theme that wants a different auth UX can omit or replace it.
 *
 * DefaultHeader passes a server-resolved initial member so the
 * header does not flicker from loading chrome into auth buttons.
 * The client probe remains as a fallback for standalone consumers
 * that render the widget without an initial value.
 */
export function MemberStatusWidget({
  initialMember,
  initialUnreadNotifications,
}: MemberStatusWidgetProps = {}) {
  const router = useRouter();
  const [member, setMember] = useState<MemberMe | null>(initialMember ?? null);
  const [unreadNotifications, setUnreadNotifications] = useState<number | null>(() =>
    initialUnreadNotifications === undefined ? null : normalizeUnread(initialUnreadNotifications),
  );
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (initialMember !== undefined) return;

    void (async () => {
      try {
        const res = await fetch("/api/members/me", { credentials: "include" });
        if (!res.ok) {
          setMember(null);
          return;
        }
        const body = (await res.json().catch(() => null)) as {
          data?: { member?: MemberMe };
          member?: MemberMe;
        } | null;
        const m = body?.data?.member ?? body?.member ?? null;
        setMember(m && m.id ? m : null);
      } catch {
        setMember(null);
      }
    })();
  }, [initialMember]);

  useEffect(() => {
    if (!member?.id) {
      setUnreadNotifications(null);
      return;
    }
    if (initialUnreadNotifications !== undefined) {
      setUnreadNotifications(normalizeUnread(initialUnreadNotifications));
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const unread = await fetchUnreadNotificationCount(controller.signal);
        setUnreadNotifications(unread);
      } catch {
        if (!controller.signal.aborted) setUnreadNotifications(null);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [initialUnreadNotifications, member?.id]);

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
    setUnreadNotifications(null);
    setSigningOut(false);
    router.push("/");
    router.refresh();
  };

  if (member) {
    return (
      <div className="np-member-status">
        <Link href={`/u/${member.handle}`} className="np-member-status-handle">
          @{member.handle}
        </Link>
        <Link
          href="/members/me/notifications"
          className="np-member-notifications"
          aria-label={notificationLabel(unreadNotifications)}
        >
          <BellIcon />
          {unreadNotifications && unreadNotifications > 0 ? (
            <span className="np-member-notification-badge">
              {formatUnreadCount(unreadNotifications)}
            </span>
          ) : null}
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

async function fetchUnreadNotificationCount(signal: AbortSignal): Promise<number> {
  const res = await fetch("/api/notifications?count=1", {
    credentials: "include",
    signal,
  });
  if (!res.ok) return 0;

  const body = (await res.json().catch(() => null)) as {
    data?: { unread?: unknown };
    unread?: unknown;
  } | null;
  return normalizeUnread(body?.data?.unread ?? body?.unread);
}

function normalizeUnread(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function formatUnreadCount(value: number): string {
  return value > 99 ? "99+" : value.toString();
}

function notificationLabel(unreadNotifications: number | null): string {
  if (!unreadNotifications) return "Notifications";
  return `${formatUnreadCount(unreadNotifications)} unread notifications`;
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    </svg>
  );
}
