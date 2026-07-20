"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  npRequireFollowingWire,
  npRequireFollowWireRow,
  npRequireOkWire,
} from "@nexpress/core/community-contract";

export interface ForumSubscriptionActionProps {
  targetType: string;
  targetId: string;
  isAuthenticated: boolean;
  loginHref: string;
  labels: {
    subscribe: string;
    subscribed: string;
    loading: string;
    signIn: string;
    failed: string;
  };
}

export function ForumSubscriptionAction(props: ForumSubscriptionActionProps) {
  const targetKey = `${props.targetType}:${props.targetId}`;
  const currentTargetKey = useRef(targetKey);
  currentTargetKey.current = targetKey;
  const [following, setFollowing] = useState<boolean | null>(null);
  const [loadedTargetKey, setLoadedTargetKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = following !== null && loadedTargetKey === targetKey;

  const readState = useCallback(async (): Promise<boolean> => {
    const query = new URLSearchParams({ targetType: props.targetType, targetId: props.targetId });
    const response = await fetch(`/api/follows/check?${query.toString()}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status.toString()}`);
    return npRequireFollowingWire(await response.json()).following;
  }, [props.targetId, props.targetType]);

  useEffect(() => {
    if (!props.isAuthenticated) return;
    let active = true;
    setFollowing(null);
    setLoadedTargetKey(null);
    setBusy(false);
    setError(null);
    void readState()
      .then((next) => {
        if (active) {
          setFollowing(next);
          setLoadedTargetKey(targetKey);
        }
      })
      .catch(() => {
        if (active) {
          setFollowing(false);
          setError(props.labels.failed);
        }
      });
    return () => {
      active = false;
    };
  }, [props.isAuthenticated, props.labels.failed, readState, targetKey]);

  if (!props.isAuthenticated) {
    return (
      <span className="np-forum-subscription" data-np-forum-subscription="signed-out">
        <a href={props.loginHref}>{props.labels.signIn}</a>
      </span>
    );
  }

  const toggle = async () => {
    if (busy || !ready) return;
    const requestTargetKey = targetKey;
    const next = !following;
    setFollowing(next);
    setBusy(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const headers = {
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        "Content-Type": "application/json",
      };
      if (next) {
        const response = await fetch("/api/follows", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ targetType: props.targetType, targetId: props.targetId }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status.toString()}`);
        npRequireFollowWireRow(await response.json());
      } else {
        const query = new URLSearchParams({
          targetType: props.targetType,
          targetId: props.targetId,
        });
        const response = await fetch(`/api/follows?${query.toString()}`, {
          method: "DELETE",
          credentials: "include",
          headers,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status.toString()}`);
        npRequireOkWire(await response.json());
      }
    } catch {
      if (currentTargetKey.current === requestTargetKey) {
        setFollowing(!next);
        setError(props.labels.failed);
      }
    } finally {
      if (currentTargetKey.current === requestTargetKey) setBusy(false);
    }
  };

  return (
    <span
      className="np-forum-subscription"
      data-np-forum-subscription={following ? "subscribed" : "available"}
    >
      <button
        type="button"
        aria-pressed={following === true}
        disabled={busy || !ready}
        onClick={() => void toggle()}
      >
        {!ready
          ? props.labels.loading
          : following
            ? props.labels.subscribed
            : props.labels.subscribe}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </span>
  );
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}
