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
 * lets a logged-in member post, react, or report. Optimistically
 * reloads the list after each successful action — paginated polling
 * lands later when reactions / notifications need it.
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
            <CommentItem
              key={c.id}
              comment={c}
              memberKnown={memberKnown}
            />
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

interface CommentItemProps {
  comment: CommentRow;
  memberKnown: boolean | null;
}

function CommentItem({ comment, memberKnown }: CommentItemProps) {
  const [reportOpen, setReportOpen] = useState(false);
  return (
    <li
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: "0.25rem" }}>
        {new Date(comment.createdAt).toLocaleString()}
        {comment.editedAt ? " · edited" : null}
      </div>
      <div
        className="nx-comment-body"
        dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginTop: "0.5rem",
          fontSize: "0.85rem",
        }}
      >
        <ReactionButton commentId={comment.id} memberKnown={memberKnown} />
        {memberKnown === true ? (
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            style={{
              border: 0,
              background: "transparent",
              color: "#64748b",
              cursor: "pointer",
              padding: "0.25rem 0.4rem",
              fontSize: "0.85rem",
            }}
          >
            Report
          </button>
        ) : null}
      </div>
      {reportOpen ? (
        <ReportDialog
          targetType="comment"
          targetId={comment.id}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </li>
  );
}

interface ReactionButtonProps {
  commentId: string;
  memberKnown: boolean | null;
}

function ReactionButton({ commentId, memberKnown }: ReactionButtonProps) {
  const [count, setCount] = useState(0);
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      targetType: "comment",
      targetId: commentId,
      kind: "like",
    });
    const res = await fetch(`/api/reactions?${params.toString()}`, {
      credentials: "include",
    });
    if (res.ok) {
      const body = (await res.json()) as { counts: Record<string, number>; mine: string[] };
      setCount(Number(body.counts.like ?? 0));
      setMine(body.mine.includes("like"));
    }
  }, [commentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (memberKnown !== true || busy) return;
    setBusy(true);
    try {
      const csrf = readCookie("nx-mb-csrf");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      };
      if (mine) {
        const params = new URLSearchParams({
          targetType: "comment",
          targetId: commentId,
          kind: "like",
        });
        await fetch(`/api/reactions?${params.toString()}`, {
          method: "DELETE",
          credentials: "include",
          headers,
        });
      } else {
        await fetch(`/api/reactions`, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
        });
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const disabled = memberKnown !== true || busy;
  return (
    <button
      type="button"
      onClick={() => {
        void toggle();
      }}
      disabled={disabled}
      aria-pressed={mine}
      title={memberKnown === true ? (mine ? "Unlike" : "Like") : "Log in to react"}
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 999,
        padding: "0.2rem 0.6rem",
        background: mine ? "#fef3c7" : "#fff",
        color: mine ? "#854d0e" : "#475569",
        cursor: disabled ? "default" : "pointer",
        fontSize: "0.85rem",
        opacity: disabled && memberKnown !== true ? 0.7 : 1,
      }}
    >
      👍 {count}
    </button>
  );
}

interface ReportDialogProps {
  targetType: "comment" | "thread" | "reply" | "member";
  targetId: string;
  onClose: () => void;
}

function ReportDialog({ targetType, targetId, onClose }: ReportDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const csrf = readCookie("nx-mb-csrf");
      const res = await fetch("/api/reports", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ targetType, targetId, reason }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to file report");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.5)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "1.25rem",
          width: "min(420px, 92vw)",
          display: "grid",
          gap: "0.75rem",
          boxShadow: "0 12px 40px rgba(15, 23, 42, 0.2)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Report this {targetType}</h3>
        {done ? (
          <>
            <p style={{ margin: 0, color: "#475569", fontSize: "0.9rem" }}>
              Thanks — a moderator will review it.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  border: 0,
                  background: "#0f172a",
                  color: "#fff",
                  borderRadius: 6,
                  padding: "0.4rem 0.9rem",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.85rem" }}>
              Tell us briefly what's wrong. Moderators see this verbatim.
            </p>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="e.g. Spam, harassment, off-topic…"
              style={{
                padding: "0.6rem",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                fontFamily: "inherit",
                fontSize: "0.9rem",
              }}
            />
            {error ? (
              <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>
            ) : null}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  color: "#0f172a",
                  borderRadius: 6,
                  padding: "0.4rem 0.9rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void submit();
                }}
                disabled={submitting || !reason.trim()}
                style={{
                  border: 0,
                  background: "#dc2626",
                  color: "#fff",
                  borderRadius: 6,
                  padding: "0.4rem 0.9rem",
                  cursor: submitting || !reason.trim() ? "default" : "pointer",
                  opacity: submitting || !reason.trim() ? 0.7 : 1,
                }}
              >
                {submitting ? "Sending…" : "Send report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}
