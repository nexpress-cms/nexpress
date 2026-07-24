"use client";

import {
  npRequireCommunityRealtimeEventWire,
  npRequireEngagementTarget,
  type NpCommunityRealtimeEventWire,
} from "@nexpress/core/community-contract";
import { useEffect } from "react";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const RECONNECT_INTERVAL_MS = 3_000;
const INVALIDATION_DEBOUNCE_MS = 150;

export type NpCommunityRealtimeInvalidation =
  NpCommunityRealtimeEventWire | { kind: "connected" | "poll"; id: null };

export interface NpCommunityRealtimeOptions {
  url: string;
  onInvalidate: (event: NpCommunityRealtimeInvalidation) => void | Promise<void>;
  /** Existing read API refresh cadence while EventSource is unavailable. */
  pollIntervalMs?: number;
}

export function npCommunityDocumentEventsUrl(targetType: string, targetId: string): string {
  const target = npRequireEngagementTarget({ targetType, targetId });
  const query = new URLSearchParams({ scope: "document", ...target });
  return `/api/community/events?${query.toString()}`;
}

export const NP_COMMUNITY_INBOX_EVENTS_URL = "/api/community/events?scope=inbox";

/**
 * Connect to the PII-free community SSE stream and fall back to bounded API
 * polling on unsupported browsers or transport errors. `connected` triggers
 * one refresh to close the initial-render/open race.
 */
export function useCommunityRealtime({
  url,
  onInvalidate,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: NpCommunityRealtimeOptions): void {
  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pending: NpCommunityRealtimeInvalidation | null = null;
    let queued: NpCommunityRealtimeInvalidation | null = null;
    let refreshing = false;
    const pollMs =
      Number.isFinite(pollIntervalMs) && pollIntervalMs >= 5_000
        ? Math.trunc(pollIntervalMs)
        : DEFAULT_POLL_INTERVAL_MS;

    const dispatch = (event: NpCommunityRealtimeInvalidation) => {
      if (disposed) return;
      pending = event;
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const next = pending;
        pending = null;
        if (!next) return;
        if (refreshing) {
          queued = next;
          return;
        }
        refreshing = true;
        void (async () => {
          let current: NpCommunityRealtimeInvalidation | null = next;
          while (current && !disposed) {
            queued = null;
            await Promise.resolve(onInvalidate(current)).catch(() => undefined);
            current = queued;
          }
          refreshing = false;
        })();
      }, INVALIDATION_DEBOUNCE_MS);
    };

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const startPolling = () => {
      if (disposed || pollTimer) return;
      pollTimer = setInterval(() => dispatch({ kind: "poll", id: null }), pollMs);
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer || typeof EventSource === "undefined") return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_INTERVAL_MS);
    };

    const restartWithPolling = () => {
      source?.close();
      source = null;
      startPolling();
      scheduleReconnect();
    };

    function connect() {
      if (disposed) return;
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      source?.close();
      source = null;
      let next: EventSource;
      try {
        next = new EventSource(url, { withCredentials: true });
      } catch {
        startPolling();
        scheduleReconnect();
        return;
      }
      source = next;
      next.onopen = () => {
        if (source !== next || disposed) return;
        stopPolling();
        dispatch({ kind: "connected", id: null });
      };
      next.onmessage = (message) => {
        if (source !== next || disposed) return;
        try {
          dispatch(npRequireCommunityRealtimeEventWire(JSON.parse(message.data)));
        } catch {
          restartWithPolling();
        }
      };
      next.onerror = () => {
        if (source !== next || disposed) return;
        startPolling();
        // CONNECTING preserves the browser's Last-Event-ID and honors the
        // server-provided retry delay. Only replace an EventSource that the
        // browser has declared permanently closed.
        if (next.readyState === EventSource.CLOSED) {
          source = null;
          scheduleReconnect();
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [onInvalidate, pollIntervalMs, url]);
}
