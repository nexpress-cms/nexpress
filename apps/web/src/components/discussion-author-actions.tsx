"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

interface DiscussionAuthorActionsProps {
  docId: string;
  slug: string;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}

/**
 * Edit + Delete buttons shown on a discussion detail page when the
 * viewing member is the row's `member_author_id`. The server
 * component upstream already verified ownership; this component is
 * the action surface only — both endpoints re-check ownership
 * server-side before mutating, so a stale isOwner client state is
 * not a security risk.
 */
export function DiscussionAuthorActions({ docId, slug }: DiscussionAuthorActionsProps) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const headers: Record<string, string> = csrf ? { "X-CSRF-Token": csrf } : {};
      const res = await fetch(`/api/collections/discussions/${docId}`, {
        method: "DELETE",
        credentials: "include",
        headers,
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      router.push("/discussions");
      router.refresh();
    } catch {
      setError("Delete failed. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="np-discussion-actions">
      <Link href={`/discussions/${slug}/edit`} className="np-tab">
        Edit
      </Link>
      <button
        type="button"
        onClick={() => setConfirmingDelete(true)}
        disabled={submitting}
        className="np-tab np-tab-destructive"
      >
        Delete
      </button>
      {error ? (
        <span role="alert" className="np-form-error">
          {error}
        </span>
      ) : null}

      {confirmingDelete ? (
        <div role="dialog" aria-modal="true" className="np-confirm-dialog">
          <p>Delete this discussion? This cannot be undone.</p>
          <div className="np-form-actions">
            <button
              type="button"
              className="np-tab"
              onClick={() => setConfirmingDelete(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="np-tab np-tab-destructive"
              onClick={() => void handleDelete()}
              disabled={submitting}
            >
              {submitting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
