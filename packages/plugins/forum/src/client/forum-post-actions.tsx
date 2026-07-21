"use client";

import type { NpThreadModerationAction } from "@nexpress/core/community-contract";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface ForumPostActionsProps {
  basePath: string;
  collectionSlug: string;
  boardKey: string;
  postId: string;
  canEdit: boolean;
  canDelete: boolean;
  moderationActions: readonly NpThreadModerationAction[];
  labels: {
    edit: string;
    delete: string;
    deleteConfirm: string;
    cancel: string;
    deleting: string;
    deleteFailed: string;
    hide: string;
    restore: string;
    lock: string;
    unlock: string;
    pin: string;
    unpin: string;
    moderationFailed: string;
  };
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}

export function ForumPostActions({
  basePath,
  collectionSlug,
  boardKey,
  postId,
  canEdit,
  canDelete,
  moderationActions,
  labels,
}: ForumPostActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moderating, setModerating] = useState<NpThreadModerationAction | null>(null);

  const remove = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch(`/api/collections/${collectionSlug}/${postId}`, {
        method: "DELETE",
        credentials: "include",
        headers: csrf ? { "X-CSRF-Token": csrf } : {},
      });
      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      }
      router.push(`${basePath}/${boardKey}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.deleteFailed);
      setSubmitting(false);
    }
  };

  const moderate = async (action: NpThreadModerationAction) => {
    if (moderating) return;
    setModerating(action);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch(
        `/api/collections/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(postId)}/moderation`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          },
          body: JSON.stringify({ action }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? labels.moderationFailed);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.moderationFailed);
    } finally {
      setModerating(null);
    }
  };

  return (
    <div className="np-forum-post-actions np-forum-author-actions">
      {canEdit ? <Link href={`${basePath}/${boardKey}/${postId}/edit`}>{labels.edit}</Link> : null}
      {moderationActions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => void moderate(action)}
          disabled={moderating !== null || submitting}
          data-np-forum-moderation-action={action}
        >
          {labels[action]}
        </button>
      ))}
      {canDelete ? (
        <button type="button" onClick={() => setConfirming(true)} disabled={submitting}>
          {labels.delete}
        </button>
      ) : null}
      {error ? <span role="alert">{error}</span> : null}
      {confirming ? (
        <div role="dialog" aria-modal="true" className="np-confirm-dialog">
          <p>{labels.deleteConfirm}</p>
          <div className="np-form-actions">
            <button type="button" onClick={() => setConfirming(false)} disabled={submitting}>
              {labels.cancel}
            </button>
            <button type="button" onClick={() => void remove()} disabled={submitting}>
              {submitting ? labels.deleting : labels.delete}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
