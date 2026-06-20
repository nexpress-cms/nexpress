import { useEffect, useMemo, useRef, useState } from "react";
import type { NpBlockInstance } from "@nexpress/blocks";

import { npFetch } from "../../lib/api-client.js";

const PREVIEW_ENDPOINT = "/api/admin/preview-blocks";
const DEFAULT_DEBOUNCE_MS = 400;

function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err
    ? err.name === "AbortError"
    : false;
}

export interface BlockPreviewState {
  /** Server-rendered HTML, ready to drop into an iframe `srcDoc`. */
  html: string | null;
  /** True while a fetch is in flight (after debounce arms). */
  loading: boolean;
  /** Most recent error message, or null when the last fetch succeeded. */
  error: string | null;
}

/**
 * Debounced server-render of an `NpBlockInstance[]` tree to a
 * preview HTML string. Owns its own AbortController so each new
 * render cancels the in-flight prior — Doc canvas's iframe always
 * shows the latest accepted snapshot, never an out-of-order one.
 *
 * Extracted from `doc-canvas.tsx` so the canvas body stops
 * juggling fetch lifecycle alongside hover + drag state.
 */
export function useBlockPreview(
  blocks: NpBlockInstance[],
  options: { debounceMs?: number } = {},
): BlockPreviewState {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable JSON of the blocks tree — `useEffect` dep so we re-run
  // only on real content changes, not every parent render.
  const payload = useMemo(() => JSON.stringify({ blocks }), [blocks]);

  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    debounceRef.current = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      npFetch(PREVIEW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal,
      })
        .then(async (res) => {
          const text = await res.text();
          if (!res.ok) {
            setHtml(text);
            setError(`Preview returned HTTP ${res.status}.`);
            return;
          }
          setHtml(text);
          setError(null);
        })
        .catch((err: unknown) => {
          if (isAbortError(err)) return;
          setError(err instanceof Error ? err.message : "Preview fetch failed.");
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null;
            setLoading(false);
          }
        });
    }, debounceMs);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [payload, debounceMs]);

  return { html, loading, error };
}
