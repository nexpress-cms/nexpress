"use client";

import * as React from "react";
import { npAgentMcpTaskLimitsV1 } from "@nexpress/core/agent-contract";

/** Poll only retained active evidence; unknown/error evidence never authorizes another read loop. */
export function useAgentPolling(
  key: string,
  snapshot: unknown,
  active: boolean,
  loading: boolean,
  refresh: () => void,
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
    const delay = Math.min(
      npAgentMcpTaskLimitsV1.pollIntervalMaxMs,
      npAgentMcpTaskLimitsV1.pollIntervalDefaultMs * 2 ** Math.min(attempt.current, 3),
    );
    const timer = setTimeout(() => {
      attempt.current++;
      refresh();
    }, delay);
    return () => clearTimeout(timer);
  }, [key, snapshot, active, loading, refresh]);
}
