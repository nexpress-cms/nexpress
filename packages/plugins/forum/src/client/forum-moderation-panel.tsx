"use client";

import type {
  NpReportResolutionAction,
  NpReportTargetContextWire,
  NpReportWireRow,
} from "@nexpress/core/community-contract";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ForumModerationCase {
  report: NpReportWireRow;
  target: NpReportTargetContextWire;
  actions: NpReportResolutionAction[];
}

interface ForumModerationPanelProps {
  cases: readonly ForumModerationCase[];
  locale: string;
  labels: {
    title: string;
    reason: string;
    dismiss: string;
    hideComment: string;
    hidePost: string;
    resolving: string;
    failed: string;
  };
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const entry = document.cookie.split("; ").find((value) => value.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

export function ForumModerationPanel({ cases, locale, labels }: ForumModerationPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (cases.length === 0) return null;

  const resolve = async (
    reportId: string,
    action: "dismiss" | "hide-comment" | "unpublish-document",
  ) => {
    if (busy) return;
    setBusy(`${reportId}:${action}`);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/resolve`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? labels.failed);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.failed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="np-forum-moderation-panel" data-np-forum-moderation="reports">
      <header>
        <h2>{labels.title}</h2>
        <span>{cases.length.toLocaleString(locale)}</span>
      </header>
      <ul>
        {cases.map(({ report, target, actions }) => {
          const hideAction = actions.includes("hide-comment")
            ? ("hide-comment" as const)
            : actions.includes("unpublish-document")
              ? ("unpublish-document" as const)
              : null;
          return (
            <li key={report.id} data-np-forum-report={report.id}>
              <div>
                <strong>{target.label}</strong>
                <time dateTime={report.createdAt}>
                  {new Date(report.createdAt).toLocaleString(locale)}
                </time>
              </div>
              {target.excerpt ? <p>{target.excerpt}</p> : null}
              <p>
                <span>{labels.reason}</span> {report.reason}
              </p>
              <div className="np-forum-moderation-actions">
                {hideAction ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void resolve(report.id, hideAction)}
                  >
                    {busy === `${report.id}:${hideAction}`
                      ? labels.resolving
                      : hideAction === "hide-comment"
                        ? labels.hideComment
                        : labels.hidePost}
                  </button>
                ) : null}
                {actions.includes("dismiss") ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void resolve(report.id, "dismiss")}
                  >
                    {busy === `${report.id}:dismiss` ? labels.resolving : labels.dismiss}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
