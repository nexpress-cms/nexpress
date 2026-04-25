"use client";

import { useCallback, useEffect, useState } from "react";

interface CommentRow {
  id: string;
  bodyHtml: string;
  memberId: string;
  status: string;
  createdAt: string;
  editedAt: string | null;
}

interface CommentsProps {
  collectionSlug: string;
  documentId: string;
}

/**
 * Public-site comment block. Lists visible comments under a document,
 * lets a logged-in member post a new one. Optimistically reloads the
 * list after each successful action — paginated polling lands later
 * when reactions / notifications need it.
 *
 * The CSRF token comes from the `nx-mb-csrf` cookie which is non-
 * httpOnly so the client can read it. If a member isn't logged in,
 * the form is hidden and only the read view shows.
 */
export function Comments({ collectionSlug, documentId }: CommentsProps) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [bodyMd, setBodyMd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberKnown, setMemberKnown] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/collections/${collectionSlug}/${documentId}/comments?order=oldest`);
    if (res.ok) {
      const body = (await res.json()) as { comments: CommentRow[]; totalDocs: number };
      setComments(body.comments);
      setTotal(body.totalDocs);
    }
  }, [collectionSlug, documentId]);

  // Probe `/api/members/me` once on mount to show or hide the form. The
  // probe is cheap (single DB read by id) and avoids prop-drilling
  // session state into every page that mounts the comment block.
  useEffect(() => {
    fetch("/api/members/me", { credentials: "include" })
      .then((res) => setMemberKnown(res.ok))
      .catch(() => setMemberKnown(false));
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (!bodyMd.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const csrf = readCookie("nx-mb-csrf");
      const res = await fetch(`/api/collections/${collectionSlug}/${documentId}/comments`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ bodyMd }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      setBodyMd("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="nx-comments" style={{ marginTop: "3rem", maxWidth: 720 }}>
      <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
        Comments {total > 0 ? `(${total})` : ""}
      </h2>

      {comments.length === 0 ? (
        <p style={{ color: "#64748b" }}>No comments yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "1rem" }}>
          {comments.map((c) => (
            <li
              key={c.id}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "0.75rem 1rem",
                background: "#fff",
              }}
            >
              <div style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: "0.25rem" }}>
                {new Date(c.createdAt).toLocaleString()}
                {c.editedAt ? " · edited" : null}
              </div>
              <div
                className="nx-comment-body"
                dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
              />
            </li>
          ))}
        </ul>
      )}

      {memberKnown === false ? (
        <p style={{ marginTop: "1.5rem", color: "#64748b" }}>
          <a href="/members/login">Log in</a> to comment.
        </p>
      ) : memberKnown === true ? (
        <form
          style={{ marginTop: "1.5rem", display: "grid", gap: "0.5rem" }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            value={bodyMd}
            onChange={(event) => setBodyMd(event.target.value)}
            placeholder="Write a comment… **bold**, *italic*, `code` supported."
            rows={3}
            style={{ padding: "0.75rem", borderRadius: 6, border: "1px solid #cbd5e1", fontFamily: "inherit" }}
            maxLength={5000}
          />
          {error ? <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>{error}</p> : null}
          <button
            type="submit"
            disabled={submitting || !bodyMd.trim()}
            style={{
              alignSelf: "start",
              padding: "0.5rem 1rem",
              borderRadius: 6,
              border: 0,
              background: "#0f172a",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            {submitting ? "Posting…" : "Post comment"}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  return match ? decodeURIComponent(match[1]!) : null;
}
