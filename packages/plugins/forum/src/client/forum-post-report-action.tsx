"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

interface ForumPostReportActionProps {
  collectionSlug: string;
  postId: string;
  labels: {
    report: string;
    title: string;
    help: string;
    placeholder: string;
    submit: string;
    submitting: string;
    success: string;
    close: string;
    cancel: string;
    failed: string;
  };
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}

export function ForumPostReportAction({
  collectionSlug,
  postId,
  labels,
}: ForumPostReportActionProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const titleId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    if (submitting) return;
    setOpen(false);
    setReason("");
    setError(null);
    setDone(false);
    triggerRef.current?.focus();
  }, [submitting]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    textareaRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [close, open]);

  const submit = async () => {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch("/api/reports", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({
          targetType: collectionSlug,
          targetId: postId,
          reason: reason.trim(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      }
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.failed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        {labels.report}
      </button>
      {open ? (
        <div
          className="np-forum-report-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={close}
        >
          <div className="np-forum-report-dialog" onClick={(event) => event.stopPropagation()}>
            <h2 id={titleId}>{labels.title}</h2>
            {done ? (
              <>
                <p role="status">{labels.success}</p>
                <div className="np-form-actions">
                  <button type="button" onClick={close} autoFocus>
                    {labels.close}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>{labels.help}</p>
                <textarea
                  ref={textareaRef}
                  aria-label={labels.placeholder}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={5}
                  maxLength={1000}
                  placeholder={labels.placeholder}
                />
                {error ? <p role="alert">{error}</p> : null}
                <div className="np-form-actions">
                  <button type="button" onClick={close} disabled={submitting}>
                    {labels.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={submitting || !reason.trim()}
                  >
                    {submitting ? labels.submitting : labels.submit}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
