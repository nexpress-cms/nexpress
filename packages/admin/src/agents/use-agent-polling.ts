"use client";

import * as React from "react";
import { npAgentMcpTaskLimitsV1 } from "@nexpress/core/agent-contract";

const listRefreshIntervalMs = 30_000;

/** Schedule one read at a time from a validated snapshot, while the document is visible. */
export function useAgentPolling(
  key: string,
  snapshot: unknown,
  active: boolean,
  loading: boolean,
  refresh: () => void,
  mode: "detail" | "list" = "detail",
) {
  const attempt = React.useRef(0);
  React.useEffect(() => {
    attempt.current = 0;
  }, [key]);
  React.useEffect(() => {
    if (loading) return;
    if (!active) {
      attempt.current = 0;
      return;
    }
    const minimumDelay = npAgentMcpTaskLimitsV1.pollIntervalDefaultMs;
    const delay =
      mode === "list"
        ? listRefreshIntervalMs
        : Math.min(
            npAgentMcpTaskLimitsV1.pollIntervalMaxMs,
            minimumDelay * 2 ** Math.min(attempt.current, 3),
          );
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requested = false;

    function schedule(deadline: number) {
      clearTimeout(timer);
      if (requested || document.visibilityState !== "visible") return;
      timer = setTimeout(
        () => {
          if (document.visibilityState !== "visible") return;
          requested = true;
          if (mode === "detail") attempt.current++;
          refresh();
        },
        Math.max(0, deadline - Date.now()),
      );
    }

    function onReturn() {
      // Both visibility and window focus can fire when returning to a tab.
      schedule(startedAt + (mode === "list" ? minimumDelay : delay));
    }

    schedule(startedAt + delay);
    document.addEventListener("visibilitychange", onReturn);
    if (mode === "list") window.addEventListener("focus", onReturn);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onReturn);
      if (mode === "list") window.removeEventListener("focus", onReturn);
    };
  }, [key, snapshot, active, loading, refresh, mode]);
}
