"use client";

import { useState } from "react";
import {
  npRequireMarkNotificationsReadWire,
  npRequireNotificationHref,
  type NpNotificationWireRow,
} from "@nexpress/core/community-contract";

export type NotificationInboxItem = NpNotificationWireRow;

interface NotificationsInboxProps {
  initialNotifications: NotificationInboxItem[];
  initialUnread: number;
  totalDocs: number;
}

const LABELS: Record<string, string> = {
  "comment.reply": "New reply",
  "comment.received": "New comment",
  "comment.mention": "Comment mention",
  "document.mention": "Discussion mention",
  "reaction.received": "Reaction received",
  "follow.received": "New follower",
  "follow.activity": "Subscribed activity",
};

export function NotificationsInbox({
  initialNotifications,
  initialUnread,
  totalDocs,
}: NotificationsInboxProps) {
  const [items, setItems] = useState(initialNotifications);
  const [unread, setUnread] = useState(initialUnread);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const markOneRead = async (id: string): Promise<void> => {
    if (busyIds.has(id)) return;
    setError(null);
    setSavedAt(null);
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      const marked = await markRead({ ids: [id] });
      if (marked > 0) {
        const now = new Date().toISOString();
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, readAt: item.readAt ?? now } : item)),
        );
        setUnread((prev) => Math.max(0, prev - marked));
        setSavedAt(Date.now());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark notification read");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const markAllRead = async (): Promise<void> => {
    if (markingAll || unread === 0) return;
    setError(null);
    setSavedAt(null);
    setMarkingAll(true);
    try {
      await markRead({ all: true });
      const now = new Date().toISOString();
      setItems((prev) => prev.map((item) => ({ ...item, readAt: item.readAt ?? now })));
      setUnread(0);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark notifications read");
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <section style={{ display: "grid", gap: "1rem" }} aria-labelledby="notifications-inbox-title">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 id="notifications-inbox-title" style={{ fontSize: "1.15rem", margin: 0 }}>
            Inbox
          </h2>
          <p style={{ color: "#64748b", margin: "0.25rem 0 0" }}>
            {unread === 0
              ? "You are all caught up."
              : `${unread} unread notification${unread === 1 ? "" : "s"}.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={markingAll || unread === 0}
          style={{
            padding: "0.5rem 0.85rem",
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#0f172a",
            cursor: markingAll || unread === 0 ? "default" : "pointer",
            opacity: markingAll || unread === 0 ? 0.6 : 1,
          }}
        >
          {markingAll ? "Marking..." : "Mark all read"}
        </button>
      </div>

      {items.length === 0 ? (
        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "1rem",
            background: "#fff",
            color: "#64748b",
          }}
        >
          No notifications yet.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
          {items.map((item) => {
            const isUnread = item.readAt === null;
            const isBusy = busyIds.has(item.id);
            const href = hrefFor(item);
            return (
              <li
                key={item.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderLeft: `4px solid ${isUnread ? "#2563eb" : "#e2e8f0"}`,
                  borderRadius: 8,
                  padding: "0.85rem 1rem",
                  background: "#fff",
                  display: "grid",
                  gap: "0.5rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "grid", gap: "0.2rem", minWidth: 0 }}>
                    <strong style={{ color: "#0f172a" }}>{labelFor(item.kind)}</strong>
                    <span style={{ color: "#334155" }}>{summaryFor(item)}</span>
                    <span style={{ color: "#64748b", fontSize: "0.875rem" }}>
                      {formatWhen(item.createdAt)}
                    </span>
                  </div>
                  <span
                    style={{
                      borderRadius: 999,
                      padding: "0.2rem 0.5rem",
                      background: isUnread ? "#dbeafe" : "#f1f5f9",
                      color: isUnread ? "#1d4ed8" : "#64748b",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                    }}
                  >
                    {isUnread ? "Unread" : "Read"}
                  </span>
                </div>
                {isUnread || href ? (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {href ? (
                      <a
                        href={href}
                        onClick={() => {
                          if (isUnread) void markOneRead(item.id);
                        }}
                        style={{
                          padding: "0.4rem 0.7rem",
                          borderRadius: 6,
                          background: "#0f172a",
                          color: "#fff",
                          textDecoration: "none",
                        }}
                      >
                        View
                      </a>
                    ) : null}
                    {isUnread ? (
                      <button
                        type="button"
                        onClick={() => void markOneRead(item.id)}
                        disabled={isBusy}
                        style={{
                          padding: "0.4rem 0.7rem",
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                          background: "#fff",
                          color: "#0f172a",
                          cursor: isBusy ? "default" : "pointer",
                          opacity: isBusy ? 0.7 : 1,
                        }}
                      >
                        {isBusy ? "Marking..." : "Mark read"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {totalDocs > items.length ? (
        <p style={{ color: "#64748b", fontSize: "0.875rem", margin: 0 }}>
          Showing the latest {items.length} of {totalDocs} notifications.
        </p>
      ) : null}

      <div aria-live="polite">
        {error ? (
          <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>
        ) : savedAt ? (
          <p style={{ color: "#16a34a", margin: 0 }}>Notification status updated.</p>
        ) : null}
      </div>
    </section>
  );
}

async function markRead(input: { ids: string[] } | { all: true }): Promise<number> {
  const csrf = readCookie("np-mb-csrf");
  const res = await fetch("/api/notifications/mark-read", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  const body = await res.json();
  return npRequireMarkNotificationsReadWire(body).marked;
}

function labelFor(kind: string): string {
  return LABELS[kind] ?? `Notification (${kind})`;
}

function summaryFor(item: NotificationInboxItem): string {
  switch (item.kind) {
    case "comment.reply":
      return `Someone replied to ${targetPhrase(item.payload)}.`;
    case "comment.received":
      return `Someone commented on ${targetPhrase(item.payload)}.`;
    case "comment.mention":
      return `You were mentioned in a comment on ${targetPhrase(item.payload)}.`;
    case "document.mention":
      return `You were mentioned in ${targetPhrase(item.payload)}.`;
    case "reaction.received": {
      const reaction = readString(item.payload, "reactionKind");
      const label = reaction ? `${humanize(reaction)} reaction` : "reaction";
      return `Someone left a ${label} on ${targetPhrase(item.payload)}.`;
    }
    case "follow.received":
      return "A member followed your profile.";
    case "follow.activity":
      return item.payload.activity === "document.published"
        ? "A followed board has a new post."
        : "A followed discussion has a new comment.";
    default:
      return "A new notification was added to your inbox.";
  }
}

function hrefFor(item: NotificationInboxItem): string | null {
  const href = readString(item.payload, "href");
  if (!href) return null;
  try {
    return npRequireNotificationHref(href);
  } catch {
    return null;
  }
}

function targetPhrase(payload: Record<string, unknown>): string {
  const targetType = readString(payload, "targetType");
  if (!targetType) return "your content";
  if (targetType === "comment") return "your comment";
  if (targetType === "member") return "your profile";
  return `your ${humanize(targetType)} item`;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function humanize(value: string): string {
  return value.replace(/[-_]/g, " ");
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}
