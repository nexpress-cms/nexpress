"use client";

import { Loader2, Plus, Settings, Trash2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
} from "react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import type { EditorAction } from "../editor-engine/index.js";
import { npFetch } from "../../lib/api-client.js";
import { Button } from "../../ui/button.js";
import { cn } from "../../ui/utils.js";
import { PaletteModal } from "../shared/palette-modal.js";

import { BlockSettingsDialog } from "./block-settings-dialog.js";

export interface DocCanvasProps {
  blocks: NpBlockInstance[];
  definitions: ReadonlyMap<string, NpBlockMetadata>;
  availableBlocks: NpBlockMetadata[];
  dispatch: Dispatch<EditorAction>;
  selectedBlockId: string | null;
  onSelectBlock: (id: string | null) => void;
}

const PREVIEW_ENDPOINT = "/api/admin/preview-blocks";
const DEBOUNCE_MS = 400;

interface OverlayPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Document-mode canvas: a server-rendered preview iframe with a
 * hover affordance overlay. Operators see the page exactly as it
 * would render on the public site (theme CSS + plugin blocks all
 * resolved server-side via `/api/admin/preview-blocks`); hovering
 * a block surfaces a settings / delete control, clicking
 * settings opens a propsSchema-driven dialog.
 *
 * The iframe is `srcDoc` + same-origin sandbox so the parent can
 * read `contentDocument` and observe mouse events inside the
 * iframe. Overlay icons render in PARENT, absolute-positioned at
 * (iframe rect + block rect) — keeping the icons in the parent
 * document means React state and Radix dialogs work normally
 * without postMessage gymnastics.
 *
 * Block insertion routes through the same `<PaletteModal>` Page
 * Builder uses — Doc and Page modes pick from one shared add-
 * block surface.
 */
export function DocCanvas({
  blocks,
  definitions,
  availableBlocks,
  dispatch,
  selectedBlockId,
  onSelectBlock,
}: DocCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverRect, setHoverRect] = useState<OverlayPosition | null>(null);
  const [settingsTargetId, setSettingsTargetId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Debounced server-side preview render. Same shape as the
  // existing PreviewPanel: post the (unsaved) blocks to the
  // preview API, render the resulting HTML inside an iframe.
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const payload = useMemo(() => JSON.stringify({ blocks }), [blocks]);

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
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(err instanceof Error ? err.message : "Preview fetch failed.");
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null;
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [payload]);

  // Walk every recursive block in the tree so the overlay can
  // resolve a hovered id to its definition + parent context.
  const blocksById = useMemo(() => {
    const map = new Map<string, NpBlockInstance>();
    const walk = (arr: NpBlockInstance[]): void => {
      for (const b of arr) {
        map.set(b.id, b);
        if (b.children) walk(b.children);
      }
    };
    walk(blocks);
    return map;
  }, [blocks]);

  // Bumps on every iframe `load` event — replaces the old
  // `[html]`-dependent listener attach. `srcDoc` is set
  // synchronously when the state changes, but the iframe parses
  // it asynchronously; if we attach to `contentDocument` right
  // when `html` updates, the doc is the PRIOR document (or null
  // mid-swap) and the listeners get torn down before the new
  // document mounts. Tracking load count instead means the
  // attach always runs against the freshly-parsed document.
  const [iframeLoadCount, setIframeLoadCount] = useState(0);

  // Wire iframe hover → overlay rect. Re-runs after every iframe
  // load (each preview refetch swaps the document) so the hover
  // surface keeps tracking the freshly-rendered tree.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const updateRect = (target: HTMLElement) => {
      const blockEl = target.closest<HTMLElement>("[data-np-block-id]");
      if (!blockEl) {
        setHoveredId(null);
        setHoverRect(null);
        return;
      }
      const id = blockEl.dataset.npBlockId;
      if (!id) return;
      const iframeRect = iframe.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      // The preview markers wrap each block with `style="display:
      // contents"` so the marker doesn't disturb grid / flex
      // layouts upstream — but a `display: contents` element has
      // NO layout box of its own, so `getBoundingClientRect()`
      // returns 0×0. Resolve the visible rect by walking the
      // marker's descendants and unioning their client rects;
      // that's what the operator actually sees on screen.
      const blockRect = unionVisibleRect(blockEl);
      if (!containerRect) return;
      // Block rect is relative to the iframe's viewport; project
      // back into the container's coordinate space.
      setHoveredId(id);
      setHoverRect({
        top: iframeRect.top - containerRect.top + blockRect.top,
        left: iframeRect.left - containerRect.left + blockRect.left,
        width: blockRect.width,
        height: blockRect.height,
      });
    };

    const onMove = (event: Event) => {
      // `event.target instanceof HTMLElement` is FALSE here even
      // when the target is a real element — the iframe runs in
      // its own JavaScript realm, so the parent's `HTMLElement`
      // constructor is a different reference from the iframe's.
      // Cross-realm `instanceof` always returns false. Probe by
      // capability (`nodeType === 1` + `closest` method) instead.
      const target = event.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      if (typeof (target as HTMLElement).closest !== "function") return;
      updateRect(target as HTMLElement);
    };
    const onLeave = () => {
      setHoveredId(null);
      setHoverRect(null);
    };

    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseleave", onLeave);
    iframe.addEventListener("mouseleave", onLeave);
    return () => {
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseleave", onLeave);
      iframe.removeEventListener("mouseleave", onLeave);
    };
  }, [iframeLoadCount]);

  // Recompute the hover rect on parent scroll / resize so the
  // overlay icons stay glued to the hovered block as the page
  // scrolls. Cheap — only fires when there's an active hover.
  useEffect(() => {
    if (!hoveredId) return;
    const recompute = () => {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!iframe || !doc) return;
      const blockEl = doc.querySelector<HTMLElement>(
        `[data-np-block-id="${hoveredId}"]`,
      );
      if (!blockEl) return;
      const iframeRect = iframe.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      const blockRect = unionVisibleRect(blockEl);
      setHoverRect({
        top: iframeRect.top - containerRect.top + blockRect.top,
        left: iframeRect.left - containerRect.left + blockRect.left,
        width: blockRect.width,
        height: blockRect.height,
      });
    };
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [hoveredId]);

  const settingsBlock = settingsTargetId
    ? (blocksById.get(settingsTargetId) ?? null)
    : null;
  const settingsDefinition = settingsBlock
    ? (definitions.get(settingsBlock.type) ?? null)
    : null;

  const docFriendly = availableBlocks; // No filtering — Doc mode picks from the same registry as Page builder.

  // Append a fresh block at the top level. Doc mode doesn't
  // surface "insert at position" affordances yet; the operator
  // can drag the new block around in Page builder, or use the
  // hover-actions Move-up / Move-down once it lands.
  const handleAdd = (type: string) => {
    dispatch({ type: "ADD", blockType: type });
    setPaletteOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-neutral-200/80 bg-background shadow-sm",
          "dark:border-neutral-800/80",
        )}
      >
        {error ? (
          <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <span aria-hidden="true">⚠</span>
            {error}
          </div>
        ) : null}
        <iframe
          ref={iframeRef}
          srcDoc={html ?? "<!doctype html><html><body></body></html>"}
          title="Document preview"
          // The preview HTML is server-rendered and same-origin via
          // srcDoc — `allow-same-origin` lets the parent observe
          // hover events inside `contentDocument`. No `allow-scripts`:
          // preview shouldn't execute client-side block JS, and the
          // overlay UI doesn't need it.
          sandbox="allow-same-origin"
          // Bump on every load so the hover-observer effect re-runs
          // against the freshly-parsed document. Without this hook
          // the listeners would attach to the prior document (or
          // null mid-swap) and the hover overlay never fires.
          onLoad={() => setIframeLoadCount((n) => n + 1)}
          style={{
            width: "100%",
            minHeight: "640px",
            border: "0",
            display: "block",
          }}
        />
      </div>

      {loading ? (
        <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Updating preview…
        </div>
      ) : null}

      {/* Hover overlay — a thin highlight ring around the
          currently-hovered block, with a small action rail anchored
          to the block's top-right. Click "Settings" → open the
          props dialog; click "Delete" → dispatch DELETE. Operators
          who want full reorder reach for Page builder. */}
      {hoverRect && hoveredId ? (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            top: hoverRect.top,
            left: hoverRect.left,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        >
          <div className="pointer-events-none absolute inset-0 rounded-md outline outline-2 outline-primary/60" />
          <div
            className="pointer-events-auto absolute right-2 top-2 flex items-center gap-1 rounded-full border border-neutral-200/80 bg-background/95 px-1 py-0.5 shadow-md backdrop-blur dark:border-neutral-800/80"
            // Block parent scroll handlers / iframe pointer events
            // from stealing clicks meant for the overlay buttons.
            onMouseEnter={() => onSelectBlock(hoveredId)}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label={`Settings for ${
                definitions.get(blocksById.get(hoveredId)?.type ?? "")?.label ??
                "block"
              }`}
              onClick={() => {
                setSettingsTargetId(hoveredId);
              }}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive hover:text-destructive"
              aria-label="Delete block"
              onClick={() => {
                dispatch({ type: "DELETE", id: hoveredId });
                setHoveredId(null);
                setHoverRect(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Trailing inserter — opens the same palette modal Page
          builder uses. Doc mode doesn't pre-filter the block list;
          operators pick from the full registry. */}
      <div className="mt-3 flex justify-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPaletteOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add block
        </Button>
      </div>

      <PaletteModal
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        availableBlocks={docFriendly}
        onAdd={handleAdd}
      />

      <BlockSettingsDialog
        open={settingsTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setSettingsTargetId(null);
        }}
        block={settingsBlock}
        definition={settingsDefinition}
        dispatch={dispatch}
      />
    </div>
  );
}

/**
 * Compute the union bounding rect of an element AND its
 * descendants. The block-marker divs ship `style="display:
 * contents"` so they don't disturb upstream grid / flex layouts —
 * but a `display: contents` element generates no boxes, so its
 * own `getBoundingClientRect()` is `0×0`. Walk down until we hit
 * elements that DO produce boxes, union their rects, and return
 * a real visible bound. Falls back to the original element's
 * rect when nothing visible is found (e.g. an empty container
 * with `display: none` children).
 */
function unionVisibleRect(el: Element): DOMRect {
  const direct = el.getBoundingClientRect();
  if (direct.width > 0 || direct.height > 0) return direct;

  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const visit = (node: Element) => {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      top = Math.min(top, rect.top);
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
      // Don't recurse into already-measurable children; their
      // outer rect already covers their subtree.
      return;
    }
    for (const child of Array.from(node.children)) visit(child);
  };
  for (const child of Array.from(el.children)) visit(child);

  if (top === Infinity) return direct;
  return new DOMRect(left, top, right - left, bottom - top);
}
