"use client";

import { useState } from "react";

import {
  npRequireNotificationPrefsUpdateWire,
  type NpDigestCadence,
  type NpNotificationKindMeta,
  type NpNotificationPrefs,
} from "@nexpress/core/community-contract";

interface NotificationPrefsFormProps {
  initialPrefs: NpNotificationPrefs;
  kinds: NpNotificationKindMeta[];
}

/**
 * Phase 16.3 + 16.4 — checkbox-per-kind form plus a digest
 * cadence dropdown. Persisted shape: deny list (`disabled:
 * string[]`) and `digest: "off" | "daily" | "weekly"`. UI flips
 * deny list to "enabled by default" so a fresh member sees all
 * toggles ON.
 */
export function NotificationPrefsForm({ initialPrefs, kinds }: NotificationPrefsFormProps) {
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set(initialPrefs.disabled));
  const [digest, setDigest] = useState<NpDigestCadence>(initialPrefs.digest);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const toggle = (kind: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    setSavedAt(null);
  };

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const res = await fetch("/api/members/me/notification-prefs", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ disabled: Array.from(disabled), digest }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      const knownKinds = new Set(kinds.map((kind) => kind.kind));
      const { prefs } = npRequireNotificationPrefsUpdateWire(body, knownKinds);
      setDisabled(new Set(prefs.disabled));
      setDigest(prefs.digest);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      style={{ display: "grid", gap: "1rem" }}
    >
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.75rem" }}>
        {kinds.map((meta) => {
          const enabled = !disabled.has(meta.kind);
          const inputId = `nxnotif-${meta.kind}`;
          return (
            <li
              key={meta.kind}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "0.75rem 1rem",
                background: "#fff",
                display: "flex",
                alignItems: "flex-start",
                gap: "0.75rem",
              }}
            >
              <input
                id={inputId}
                type="checkbox"
                checked={enabled}
                onChange={() => toggle(meta.kind)}
                style={{ marginTop: "0.25rem" }}
              />
              <label htmlFor={inputId} style={{ display: "grid", gap: "0.15rem" }}>
                <span style={{ fontWeight: 600 }}>{meta.label}</span>
                <span style={{ color: "#64748b", fontSize: "0.9rem" }}>{meta.description}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <fieldset
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          margin: 0,
          display: "grid",
          gap: "0.5rem",
        }}
      >
        <legend style={{ fontWeight: 600, padding: "0 0.25rem" }}>Email digest</legend>
        <p style={{ color: "#64748b", fontSize: "0.9rem", margin: 0 }}>
          Get a batched email of your unread notifications. Off by default.
        </p>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          <span>Cadence</span>
          <select
            value={digest}
            onChange={(event) => {
              setDigest(event.target.value as NpDigestCadence);
              setSavedAt(null);
            }}
            style={{
              padding: "0.35rem 0.5rem",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              background: "#fff",
            }}
          >
            <option value="off">Off</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
      </fieldset>

      {error ? (
        <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>
      ) : savedAt ? (
        <p style={{ color: "#16a34a", margin: 0 }}>Preferences saved.</p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 6,
            border: 0,
            background: "#0f172a",
            color: "#fff",
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}
