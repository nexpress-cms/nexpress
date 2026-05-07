"use client";

import { useEffect, useRef, useState } from "react";

import type { AutosaveStatus } from "./status-bar.js";

export interface UseAutosaveStatusResult {
  status: AutosaveStatus;
  savedLabel: string;
  /** Mark a state transition. Pass `"saved"` after a successful save resolves. */
  mark: (next: "dirty" | "saving" | "saved") => void;
}

/**
 * Tiny state machine that drives the status-bar's autosave
 * indicator. Transitions:
 *
 *   idle → dirty → saving → saved → idle (after 4s)
 *
 * Callers mark `"dirty"` from `onChange`, then `"saving"` when
 * a save kicks off, and `"saved"` when it resolves. The
 * `savedLabel` reflects the time-since-last-saved in
 * operator-friendly form (`"Just now"` / `"2m ago"` / etc.).
 */
export function useAutosaveStatus(): UseAutosaveStatusResult {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-render every 30 s while there's a savedAt anchor so
  // "Just now" rolls forward to "1m ago" etc. without an explicit
  // recompute.
  useEffect(() => {
    if (savedAt === null) return;
    const interval = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(interval);
  }, [savedAt]);

  const savedLabel = relativeLabel(savedAt);

  const mark = (next: "dirty" | "saving" | "saved") => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setStatus(next);
    if (next === "saved") {
      setSavedAt(Date.now());
      // Slip back to idle after a short delay so the pulse
      // settles. The savedLabel keeps the "X ago" anchor visible.
      idleTimerRef.current = setTimeout(() => setStatus("idle"), 4000);
    }
  };

  return { status, savedLabel, mark };
}

function relativeLabel(at: number | null): string {
  if (at === null) return "";
  const now = Date.now();
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 30) return "Just now";
  if (seconds < 60) return "Less than a minute ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  return `${hours} hours ago`;
}
