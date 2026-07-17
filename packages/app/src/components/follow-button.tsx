"use client";

import { useCallback, useEffect, useState } from "react";

interface FollowButtonProps {
  /** The id of the member being viewed (target of the follow). */
  memberId: string;
}

/**
 * Site-side follow / unfollow toggle. Fetches the viewer's session +
 * the current follow state on mount, then renders one of:
 *  - "Log in to follow" (no session)
 *  - hidden (viewing your own profile — server would reject)
 *  - "Follow" / "Following" toggle
 *
 * Optimistic — the button flips instantly and rolls back on API error.
 */
export function FollowButton({ memberId }: FollowButtonProps) {
  const [viewerId, setViewerId] = useState<string | null | undefined>(undefined);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFollowState = useCallback(async () => {
    const params = new URLSearchParams({ targetType: "member", targetId: memberId });
    const res = await fetch(`/api/follows/check?${params.toString()}`, {
      credentials: "include",
    });
    if (res.ok) {
      const body = (await res.json()) as { following: boolean };
      setFollowing(body.following);
    } else {
      setFollowing(false);
    }
  }, [memberId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/members/me", { credentials: "include" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json()) as { member?: { id?: string } };
          const id = body.member?.id ?? null;
          setViewerId(id);
          if (id && id !== memberId) {
            void loadFollowState();
          }
        } else {
          setViewerId(null);
        }
      })
      .catch(() => {
        if (!cancelled) setViewerId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [memberId, loadFollowState]);

  if (viewerId === undefined) {
    return (
      <button
        type="button"
        disabled
        style={{
          border: "1px solid #e2e8f0",
          background: "#fff",
          color: "#94a3b8",
          borderRadius: 999,
          padding: "0.35rem 0.9rem",
          fontSize: "0.85rem",
        }}
      >
        Loading…
      </button>
    );
  }

  if (viewerId === null) {
    return (
      <a
        href="/members/login"
        style={{
          display: "inline-block",
          border: "1px solid #e2e8f0",
          background: "#fff",
          color: "#0f172a",
          borderRadius: 999,
          padding: "0.35rem 0.9rem",
          fontSize: "0.85rem",
          textDecoration: "none",
        }}
      >
        Log in to follow
      </a>
    );
  }

  // Don't render anything when viewing your own profile.
  if (viewerId === memberId) return null;

  const toggle = async () => {
    if (busy || following === null) return;
    setBusy(true);
    setError(null);
    const next = !following;
    setFollowing(next);
    try {
      const csrf = readCookie("np-mb-csrf");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      };
      let res: Response;
      if (next) {
        res = await fetch("/api/follows", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ targetType: "member", targetId: memberId }),
        });
      } else {
        const params = new URLSearchParams({ targetType: "member", targetId: memberId });
        res = await fetch(`/api/follows?${params.toString()}`, {
          method: "DELETE",
          credentials: "include",
          headers,
        });
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      // Roll back on failure.
      setFollowing(!next);
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const label = following ? "Following" : "Follow";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem" }}>
      <button
        type="button"
        onClick={() => {
          void toggle();
        }}
        disabled={busy || following === null}
        aria-pressed={Boolean(following)}
        style={{
          border: following ? "1px solid #0f172a" : "1px solid #e2e8f0",
          background: following ? "#0f172a" : "#fff",
          color: following ? "#fff" : "#0f172a",
          borderRadius: 999,
          padding: "0.35rem 0.9rem",
          fontSize: "0.85rem",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {label}
      </button>
      {error ? <span style={{ color: "#dc2626", fontSize: "0.8rem" }}>{error}</span> : null}
    </span>
  );
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}
