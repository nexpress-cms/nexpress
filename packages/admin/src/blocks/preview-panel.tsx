"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Monitor, Smartphone, Tablet } from "lucide-react";
import type { NpBlockInstance } from "@nexpress/blocks";

import { Button } from "../ui/button.js";
import { cn } from "../ui/utils.js";

type Viewport = "desktop" | "tablet" | "mobile";

interface ViewportConfig {
  id: Viewport;
  label: string;
  icon: typeof Monitor;
  // Pixel width — fixed for tablet/mobile, flexible (`100%`) for desktop.
  width: string;
}

const VIEWPORTS: readonly ViewportConfig[] = [
  { id: "desktop", label: "Desktop", icon: Monitor, width: "100%" },
  { id: "tablet", label: "Tablet", icon: Tablet, width: "768px" },
  { id: "mobile", label: "Mobile", icon: Smartphone, width: "375px" },
];

interface PreviewPanelProps {
  blocks: NpBlockInstance[];
  className?: string;
  /**
   * Currently-focused block id from the editor, or `null` when no
   * row has focus. The panel scrolls the matching element in the
   * preview iframe into view and applies a highlight outline.
   * Layout-neutral marker divs (`data-np-block-id`) are emitted by
   * the preview render path (`previewMarkers: true` on
   * `renderBlocks`).
   */
  selectedBlockId?: string | null;
}

const PREVIEW_ENDPOINT = "/api/admin/preview-blocks";
const DEBOUNCE_MS = 500;

/**
 * Issue #467 — page-builder live preview surface.
 *
 * Posts the editor's unsaved blocks to the preview API every time
 * the tree changes (debounced) and renders the resulting HTML
 * inside an iframe. Cross-origin / cross-frame isolation is via
 * `srcDoc` (the iframe's document is built locally in this script,
 * not loaded from a URL) so the editor doesn't leak admin cookies
 * into the preview render path.
 *
 * Three viewport widths so operators can spot mobile-only layout
 * issues without resizing the browser. Render errors come back as
 * a wrapped HTML document with a banner — the iframe still mounts,
 * editor state is preserved, the operator just sees the error
 * context inside the preview frame.
 */
export function PreviewPanel({
  blocks,
  className,
  selectedBlockId,
}: PreviewPanelProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Serialized payload — both for stable useEffect deps (otherwise
  // every re-render with the same blocks tree would re-fetch) and
  // as the request body.
  const payload = JSON.stringify({ blocks });

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    debounceRef.current = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      fetch(PREVIEW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal,
        credentials: "same-origin",
      })
        .then(async (res) => {
          if (!res.ok && res.status !== 200) {
            // Non-200 still returns an HTML error doc from the
            // route, so we render it. Surface a parallel error
            // banner above the iframe to make it obvious the
            // preview is in a degraded state.
            const text = await res.text();
            setHtml(text);
            setError(`Preview returned HTTP ${res.status}.`);
            return;
          }
          const text = await res.text();
          setHtml(text);
          setError(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") {
            // Superseded by a newer request — drop silently.
            return;
          }
          setError(err instanceof Error ? err.message : "Preview fetch failed.");
        })
        .finally(() => {
          if (abortRef.current === controller) {
            setLoading(false);
            abortRef.current = null;
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // We deliberately depend on the serialized payload, not on
    // `blocks` reference identity — re-renders with the same tree
    // shouldn't re-fetch.
  }, [payload]);

  const activeViewport =
    VIEWPORTS.find((v) => v.id === viewport) ?? VIEWPORTS[0];

  // Selection highlight + scroll-into-view. The iframe is
  // `srcDoc` + `sandbox="allow-same-origin"`, so the parent can
  // reach into `iframe.contentDocument` directly. We re-run the
  // effect on selection change AND on `html` change so a selection
  // applied while the iframe was still mid-load gets re-applied
  // after the new doc lands. CSS injection is idempotent — we look
  // for a stable `<style data-np-preview-selection>` and replace
  // its rules instead of appending duplicates.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc || !doc.body) return;

    let style = doc.querySelector<HTMLStyleElement>(
      "style[data-np-preview-selection]",
    );
    if (!style) {
      style = doc.createElement("style");
      style.setAttribute("data-np-preview-selection", "");
      doc.head.appendChild(style);
    }
    if (!selectedBlockId) {
      style.textContent = "";
      return;
    }
    // The marker wrapper is `display: contents`, so the outline
    // would do nothing if applied to it directly. Apply to its
    // first element-typed child instead via CSS — `:scope > *` is
    // exactly what we want.
    const escaped = selectedBlockId.replace(/"/g, '\\"');
    style.textContent = `
      [data-np-block-id="${escaped}"] > * {
        outline: 2px solid #6366f1 !important;
        outline-offset: 2px;
        scroll-margin-top: 1rem;
        scroll-margin-bottom: 1rem;
      }
    `;
    const target = doc.querySelector<HTMLElement>(
      `[data-np-block-id="${escaped}"]`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedBlockId, html]);

  return (
    <section
      className={cn(
        "np-preview-panel flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3",
        className,
      )}
      aria-label="Block preview"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Preview
        </span>
        {loading ? (
          <Loader2
            className="h-3.5 w-3.5 animate-spin text-muted-foreground"
            aria-label="Refreshing preview"
          />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {VIEWPORTS.map((v) => {
            const Icon = v.icon;
            const isActive = v.id === viewport;
            return (
              <Button
                key={v.id}
                type="button"
                variant={isActive ? "default" : "ghost"}
                size="sm"
                aria-pressed={isActive}
                onClick={() => setViewport(v.id)}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="ml-1.5">{v.label}</span>
              </Button>
            );
          })}
        </div>
      </div>
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          {error}
        </div>
      ) : null}
      <div className="flex justify-center overflow-hidden rounded-md border border-border/60 bg-background">
        <iframe
          ref={iframeRef}
          // `srcDoc` keeps the preview inside this document — no
          // navigation, no admin-cookie leakage into the rendered
          // tree, no separate URL. The route's HTML is fully self-
          // contained.
          srcDoc={html ?? "<!doctype html><html><body></body></html>"}
          title="Block preview"
          // Fixed minimum height so the panel doesn't collapse to
          // 0 while loading; the iframe content is whatever the
          // route returned.
          style={{
            width: activeViewport.width,
            height: "640px",
            border: "0",
            display: "block",
          }}
          sandbox="allow-same-origin"
        />
      </div>
    </section>
  );
}
