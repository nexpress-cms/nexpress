"use client";

import { useCallback, useEffect, useState } from "react";

interface FollowButtonProps {
  /** The id of the member being viewed (target of the follow). */
  memberId: string;
  labels?: {
    loading: string;
    signedOut: string;
    follow: string;
    following: string;
    actionFailed: string;
  };
}

const defaultLabels: NonNullable<FollowButtonProps["labels"]> = {
  loading: "Loading…",
  signedOut: "Log in to follow",
  follow: "Follow",
  following: "Following",
  actionFailed: "Action failed",
};

/**
 * Site-side follow / unfollow toggle. Fetches the viewer's session +
 * the current follow state on mount, then renders one of:
 *  - "Log in to follow" (no session)
 *  - hidden (viewing your own profile — server would reject)
 *  - "Follow" / "Following" toggle
 *
 * Optimistic — the button flips instantly and rolls back on API error.
 */
export function FollowButton({ memberId, labels = defaultLabels }: FollowButtonProps) {
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
        className="np-member-follow-action"
        data-np-member-follow="loading"
        type="button"
        disabled
      >
        {labels.loading}
      </button>
    );
  }

  if (viewerId === null) {
    return (
      <a
        className="np-member-follow-action"
        data-np-member-follow="signed-out"
        href="/members/login"
      >
        {labels.signedOut}
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
      setError(e instanceof Error ? e.message : labels.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  const label = following ? labels.following : labels.follow;
  return (
    <span className="np-member-follow-control">
      <button
        className="np-member-follow-action"
        data-np-member-follow={following ? "following" : "available"}
        type="button"
        onClick={() => {
          void toggle();
        }}
        disabled={busy || following === null}
        aria-pressed={Boolean(following)}
      >
        {label}
      </button>
      {error ? (
        <span className="np-member-follow-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}
