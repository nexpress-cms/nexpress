"use client";

import { useCallback, useEffect, useState } from "react";
import {
  npRequireContentViewReceiptWire,
  npRequireReactionSummaryWire,
  type NpContentEngagementSummary,
} from "@nexpress/core/community-contract";

interface ForumPostEngagementProps {
  targetType: string;
  targetId: string;
  initial: NpContentEngagementSummary;
  locale: string;
  isAuthenticated: boolean;
  trackViews: boolean;
  labels: {
    views: string;
    comments: string;
    reactions: string;
    recommend: string;
    recommended: string;
    failed: string;
  };
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}

function reactionTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export function ForumPostEngagement({
  targetType,
  targetId,
  initial,
  locale,
  isAuthenticated,
  trackViews,
  labels,
}: ForumPostEngagementProps) {
  const [viewCount, setViewCount] = useState(initial.viewCount);
  const [counts, setCounts] = useState(initial.reactions);
  const [recommended, setRecommended] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readReactions = useCallback(async () => {
    const query = new URLSearchParams({ targetType, targetId, kind: "like" });
    const response = await fetch(`/api/reactions?${query.toString()}`, {
      credentials: "include",
    });
    if (!response.ok) return;
    const summary = npRequireReactionSummaryWire(await response.json());
    setCounts(summary.counts);
    setRecommended(summary.mine.includes("like"));
  }, [targetId, targetType]);

  useEffect(() => {
    if (trackViews) {
      void fetch("/api/views", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId }),
      })
        .then(async (response) => {
          if (!response.ok) return null;
          return npRequireContentViewReceiptWire(await response.json());
        })
        .then((receipt) => {
          if (receipt) setViewCount(receipt.viewCount);
        })
        .catch(() => undefined);
    }
    if (isAuthenticated) void readReactions();
  }, [isAuthenticated, readReactions, targetId, targetType, trackViews]);

  const toggleRecommendation = async () => {
    if (!isAuthenticated || submitting) return;
    setSubmitting(true);
    setError(null);
    const previous = recommended;
    const previousCounts = counts;
    const likeCount = counts.like ?? 0;
    setRecommended(!previous);
    setCounts({ ...counts, like: Math.max(0, likeCount + (previous ? -1 : 1)) });

    try {
      const csrf = readCookie("np-mb-csrf");
      const target = { targetType, targetId, kind: "like" };
      const response = previous
        ? await fetch(`/api/reactions?${new URLSearchParams(target).toString()}`, {
            method: "DELETE",
            credentials: "include",
            headers: csrf ? { "X-CSRF-Token": csrf } : {},
          })
        : await fetch("/api/reactions", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...(csrf ? { "X-CSRF-Token": csrf } : {}),
            },
            body: JSON.stringify(target),
          });
      if (!response.ok) throw new Error(`HTTP ${response.status.toString()}`);
      await readReactions();
    } catch {
      setRecommended(previous);
      setCounts(previousCounts);
      setError(labels.failed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="np-forum-engagement"
      data-np-forum-engagement="post"
      aria-label={labels.reactions}
    >
      <span data-np-forum-metric="views">
        {labels.views} <strong>{viewCount.toLocaleString(locale)}</strong>
      </span>
      <span data-np-forum-metric="comments">
        {labels.comments} <strong>{initial.commentCount.toLocaleString(locale)}</strong>
      </span>
      <span data-np-forum-metric="reactions">
        {labels.reactions} <strong>{reactionTotal(counts).toLocaleString(locale)}</strong>
      </span>
      {isAuthenticated ? (
        <button
          type="button"
          aria-pressed={recommended}
          disabled={submitting}
          onClick={() => void toggleRecommendation()}
        >
          {recommended ? labels.recommended : labels.recommend}
        </button>
      ) : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
