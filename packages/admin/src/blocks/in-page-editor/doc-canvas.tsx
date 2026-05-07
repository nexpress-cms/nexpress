"use client";

import {
  GripVertical,
  Loader2,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import {
  useCallback,
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
import { QuickInsertBar } from "./quick-insert-bar.js";

export interface DocCanvasProps {
  blocks: NpBlockInstance[];
  definitions: ReadonlyMap<string, NpBlockMetadata>;
  availableBlocks: NpBlockMetadata[];
  dispatch: Dispatch<EditorAction>;
  // Kept for parity with the orchestrator's PageBuilderCanvas prop
  // shape — DocCanvas's selection is hover-driven, but accepting
  // the same prop set keeps the mode switch trivial. Future
  // additions (e.g. a persistent active ring) can read it.
  selectedBlockId?: string | null;
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
 * hover affordance overlay anchored to the LEFT edge of every
 * block. Operators see the page exactly as it would render on the
 * public site (theme CSS + plugin blocks resolve server-side via
 * `/api/admin/preview-blocks`); hovering a block surfaces a four-
 * button rail — insert-below / drag-handle / settings / delete.
 *
 * The iframe is `srcDoc` + same-origin sandbox so the parent can
 * read `contentDocument` and observe mouse events inside the
 * iframe. The rail itself renders in the PARENT document,
 * absolute-positioned at (iframe rect + block rect) — keeping the
 * controls in the parent means React state and Radix dialogs work
 * normally without postMessage gymnastics.
 *
 * Drag-reorder (top-level only in v1): mousedown on the grip mounts
 * a transparent drag-shield over the iframe; its mousemove resolves
 * the block under cursor via `iframe.contentDocument.elementFromPoint`,
 * mouseup dispatches `MOVE_WITHIN_PARENT`. Cross-container moves
 * still live in Page builder.
 *
 * Block insertion routes through the same `<PaletteModal>` Page
 * builder uses — Doc and Page modes share one picker. The
 * `<QuickInsertBar>` underneath the canvas adds a `/`-triggered
 * slash menu and a plain-text → rich-text shortcut.
 */
export function DocCanvas({
  blocks,
  definitions,
  availableBlocks,
  dispatch,
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
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

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

  // Top-level ids — used to scope MOVE_WITHIN_PARENT during drag.
  // The engine's `MOVE_WITHIN_PARENT` action takes a parentId; for
  // v1 doc-canvas drag we only support top-level reordering, so any
  // dragged block must resolve to a top-level id and the drop
  // target must too. Cross-container moves stay in Page builder.
  const topLevelIds = useMemo(
    () => new Set(blocks.map((b) => b.id)),
    [blocks],
  );

  // Bumps on every iframe `load` event — replaces the old
  // `[html]`-dependent listener attach. `srcDoc` is set
  // synchronously when the state changes, but the iframe parses
  // it asynchronously; if we attach to `contentDocument` right
  // when `html` updates, the doc is the PRIOR document (or null
  // mid-swap) and the listeners get torn down before the new
  // document mounts. Tracking load count instead means the
  // attach always runs against the freshly-parsed document.
  const [iframeLoadCount, setIframeLoadCount] = useState(0);

  // Hide-debounce timer + overlay-pin ref. When the cursor leaves
  // the iframe (e.g. crossing into the parent-doc rail), schedule
  // the hide on a 120 ms debounce; the rail's mouseEnter cancels
  // it AND pins the overlay so any racing iframe `mouseleave`
  // (which would re-arm a stray timer) is short-circuited. See
  // #467 follow-ups for the original race investigation.
  const hideTimerRef = useRef<number | null>(null);
  const overlayHoverRef = useRef(false);
  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);
  const scheduleHide = useCallback(() => {
    if (overlayHoverRef.current) return;
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      setHoveredId(null);
      setHoverRect(null);
      hideTimerRef.current = null;
    }, 120);
  }, [cancelHide]);
  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    },
    [],
  );

  // Resolve a parent-doc point (clientX / clientY) back to a block
  // id + visible rect inside the iframe. Reused by the hover-track
  // effect AND the drag-shield mousemove. Returns null when no
  // block is under the cursor.
  const resolveBlockAt = useCallback(
    (
      clientX: number,
      clientY: number,
    ): { id: string; rect: DOMRect; iframeRect: DOMRect } | null => {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!iframe || !doc) return null;
      const iframeRect = iframe.getBoundingClientRect();
      const x = clientX - iframeRect.left;
      const y = clientY - iframeRect.top;
      if (x < 0 || y < 0 || x > iframeRect.width || y > iframeRect.height) {
        return null;
      }
      const el = doc.elementFromPoint(x, y);
      if (!el) return null;
      const blockEl = el.closest<HTMLElement>("[data-np-block-id]");
      if (!blockEl) return null;
      const id = blockEl.dataset.npBlockId;
      if (!id) return null;
      return { id, rect: unionVisibleRect(blockEl), iframeRect };
    },
    [],
  );

  // Project a block rect (iframe-local) into the overlay container's
  // coordinate space so the rail aligns flush with the block.
  const projectRect = useCallback(
    (blockRect: DOMRect, iframeRect: DOMRect): OverlayPosition | null => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return null;
      return {
        top: iframeRect.top - containerRect.top + blockRect.top,
        left: iframeRect.left - containerRect.left + blockRect.left,
        width: blockRect.width,
        height: blockRect.height,
      };
    },
    [],
  );

  // Wire iframe hover → overlay rect. Re-runs after every iframe
  // load (each preview refetch swaps the document) so the hover
  // surface keeps tracking the freshly-rendered tree.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const onMove = (event: Event) => {
      // Cross-realm `instanceof` always returns false because the
      // iframe's HTMLElement constructor differs from the parent's.
      // Probe by capability instead.
      const target = event.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      if (typeof (target as HTMLElement).closest !== "function") return;
      const blockEl = (target as HTMLElement).closest<HTMLElement>(
        "[data-np-block-id]",
      );
      if (!blockEl) {
        setHoveredId(null);
        setHoverRect(null);
        return;
      }
      const id = blockEl.dataset.npBlockId;
      if (!id) return;
      const iframeRect = iframe.getBoundingClientRect();
      const projected = projectRect(unionVisibleRect(blockEl), iframeRect);
      if (!projected) return;
      cancelHide();
      setHoveredId(id);
      setHoverRect(projected);
    };

    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseleave", scheduleHide);
    iframe.addEventListener("mouseleave", scheduleHide);
    return () => {
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseleave", scheduleHide);
      iframe.removeEventListener("mouseleave", scheduleHide);
    };
  }, [iframeLoadCount, cancelHide, scheduleHide, projectRect]);

  // Recompute hover rect on parent scroll/resize so the overlay
  // icons stay glued to the hovered block as the page scrolls.
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
      const projected = projectRect(unionVisibleRect(blockEl), iframeRect);
      if (projected) setHoverRect(projected);
    };
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [hoveredId, projectRect]);

  const settingsBlock = settingsTargetId
    ? (blocksById.get(settingsTargetId) ?? null)
    : null;
  const settingsDefinition = settingsBlock
    ? (definitions.get(settingsBlock.type) ?? null)
    : null;

  const docFriendly = availableBlocks; // Doc mode picks from the same registry as Page builder.

  // Adding from the bottom inserter or quick-insert bar appends to
  // the top level. Adding from a hovered block's `+` rail inserts
  // the new block AFTER that block so the picked type slots into
  // the operator's reading flow.
  const handleAdd = (type: string) => {
    if (insertAfterId) {
      dispatch({ type: "INSERT_AFTER", targetId: insertAfterId, blockType: type });
    } else {
      dispatch({ type: "ADD", blockType: type });
    }
    setPaletteOpen(false);
    setInsertAfterId(null);
  };

  const handleInsertText = (text: string) => {
    // Plain text → rich-text block at the bottom. The rich-text
    // editor stores Lexical JSON; the simplest valid root for a
    // bare text run is one paragraph node carrying one text node.
    // ADD's optional `props` slot threads the content in at
    // insertion time so we don't need a post-dispatch hydration
    // race to find the new block's id.
    const lexicalRoot = {
      root: {
        type: "root",
        version: 1,
        format: "" as const,
        indent: 0,
        direction: "ltr" as const,
        children: [
          {
            type: "paragraph",
            version: 1,
            format: "" as const,
            indent: 0,
            direction: "ltr" as const,
            children: [
              {
                type: "text",
                version: 1,
                format: 0,
                style: "",
                mode: "normal" as const,
                text,
                detail: 0,
              },
            ],
          },
        ],
      },
    };
    dispatch({
      type: "ADD",
      blockType: "rich-text",
      props: { content: lexicalRoot },
    });
  };

  // ---- Drag-reorder (top-level only) ------------------------------
  // Grip mousedown starts the drag; we mount a transparent shield
  // over the iframe so subsequent mousemove + mouseup events fire
  // in the parent doc (the iframe wouldn't bubble them out
  // otherwise). On mouseup, dispatch MOVE_WITHIN_PARENT when source
  // and target are both top-level and distinct; otherwise no-op.
  const dragSourceRef = useRef<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const dragSideRef = useRef<"before" | "after">("before");
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverRect, setDragOverRect] = useState<OverlayPosition | null>(null);
  const [dragSide, setDragSide] = useState<"before" | "after">("before");

  // Single stable handler — the dragged id comes from the button's
  // `data-block-id` attribute rather than a per-render curry. Keeps
  // the ref accesses inside one closure that ESLint cleanly
  // identifies as an event handler.
  const onGripMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.blockId;
      if (!id || !topLevelIds.has(id)) return;
      event.preventDefault();
      event.stopPropagation();
      dragSourceRef.current = id;
      setDraggingId(id);
      overlayHoverRef.current = false;

      const onShieldMove = (e: MouseEvent) => {
        const hit = resolveBlockAt(e.clientX, e.clientY);
        if (!hit || !topLevelIds.has(hit.id)) {
          dragOverIdRef.current = null;
          setDragOverId(null);
          setDragOverRect(null);
          return;
        }
        // Pick the drop side from the cursor's vertical position
        // relative to the target's midpoint. Top half → "before",
        // bottom half → "after". The reducer adjusts the toIndex
        // accordingly so the visual indicator matches the outcome
        // regardless of drag direction.
        const midpointY = hit.iframeRect.top + hit.rect.top + hit.rect.height / 2;
        const side = e.clientY < midpointY ? "before" : "after";
        dragOverIdRef.current = hit.id;
        dragSideRef.current = side;
        setDragOverId(hit.id);
        setDragSide(side);
        const projected = projectRect(hit.rect, hit.iframeRect);
        if (projected) setDragOverRect(projected);
      };
      const cleanup = () => {
        window.removeEventListener("mousemove", onShieldMove, true);
        window.removeEventListener("mouseup", onShieldUp, true);
        window.removeEventListener("keydown", onEscape, true);
        dragSourceRef.current = null;
        dragOverIdRef.current = null;
        setDraggingId(null);
        setDragOverId(null);
        setDragOverRect(null);
      };
      const onShieldUp = () => {
        const source = dragSourceRef.current;
        const target = dragOverIdRef.current;
        const side = dragSideRef.current;
        cleanup();
        if (source && target && source !== target) {
          dispatch({
            type: "MOVE_WITHIN_PARENT",
            parentId: null,
            fromId: source,
            toId: target,
            side,
          });
        }
      };
      const onEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") cleanup();
      };

      window.addEventListener("mousemove", onShieldMove, true);
      window.addEventListener("mouseup", onShieldUp, true);
      window.addEventListener("keydown", onEscape, true);
    },
    [dispatch, projectRect, resolveBlockAt, topLevelIds],
  );

  const isDragging = draggingId !== null;
  // While dragging, the shield captures pointer events so cursor
  // movement above the iframe still fires mousemove on the parent.
  // The shield sits above the iframe (z-30) and the rail (z-10).
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
          // against the freshly-parsed document.
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

      {/* Hover overlay — outline ring + LEFT rail anchored to the
          block's top-left edge. Rail floats just OUTSIDE the
          block's left margin so it doesn't cover content. The four
          buttons (insert below / drag / settings / delete) all live
          here per the design's "everything in one place" rail. */}
      {hoverRect && hoveredId && !isDragging ? (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            top: hoverRect.top,
            left: hoverRect.left,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        >
          <div className="pointer-events-none absolute inset-0 rounded-md outline outline-2 outline-primary/40" />
          <div
            className={cn(
              "pointer-events-auto absolute -left-12 top-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5",
              "rounded-full border border-neutral-200/80 bg-background/95 px-1 py-1 shadow-md backdrop-blur",
              "dark:border-neutral-800/80",
            )}
            onMouseEnter={() => {
              overlayHoverRef.current = true;
              cancelHide();
              onSelectBlock(hoveredId);
            }}
            onMouseLeave={() => {
              overlayHoverRef.current = false;
              scheduleHide();
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="Insert block below"
              onClick={() => {
                setInsertAfterId(hoveredId);
                setPaletteOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <button
              type="button"
              aria-label="Drag to reorder"
              data-block-id={hoveredId}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground",
                "hover:bg-neutral-100 hover:text-foreground dark:hover:bg-neutral-800",
                topLevelIds.has(hoveredId) ? "cursor-grab" : "cursor-not-allowed opacity-40",
              )}
              onMouseDown={onGripMouseDown}
              title={
                topLevelIds.has(hoveredId)
                  ? "Drag to reorder"
                  : "Reorder lives in Page builder for nested blocks"
              }
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
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

      {/* Drag indicator — outline + accent ring on the drop target
          while the operator is dragging the grip. The hover rail
          unmounts during drag (above) so it doesn't compete with
          this indicator visually. */}
      {isDragging && dragOverRect && dragOverId !== draggingId ? (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            top: dragOverRect.top,
            left: dragOverRect.left,
            width: dragOverRect.width,
            height: dragOverRect.height,
          }}
        >
          <div className="pointer-events-none absolute inset-0 rounded-md outline outline-2 outline-primary/70" />
          {/* Drop bar — top edge for "before", bottom edge for
              "after" — so the visual matches the reducer's actual
              MOVE_WITHIN_PARENT outcome. */}
          {dragSide === "before" ? (
            <div className="pointer-events-none absolute -top-1 left-0 right-0 h-1 rounded-full bg-primary" />
          ) : (
            <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-1 rounded-full bg-primary" />
          )}
        </div>
      ) : null}

      {/* Drag-shield — spans the iframe area, captures all mouse
          events while dragging so the cursor doesn't fall into the
          iframe (which wouldn't bubble events back out). */}
      {isDragging ? (
        <div
          className="absolute inset-0 z-30 cursor-grabbing"
          aria-hidden="true"
        />
      ) : null}

      {/* Trailing add area — a quick-insert prompt + the standard
          palette trigger. Keeps the inline `/`-menu and the plain-
          text → rich-text shortcut close to the canvas without
          forcing the operator into a modal for the common case. */}
      <div className="mt-4 flex flex-col gap-3">
        <QuickInsertBar
          definitions={definitions}
          dispatch={dispatch}
          onInsertText={handleInsertText}
        />
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setInsertAfterId(null);
              setPaletteOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Browse all blocks
          </Button>
        </div>
      </div>

      <PaletteModal
        open={paletteOpen}
        onOpenChange={(open) => {
          setPaletteOpen(open);
          if (!open) setInsertAfterId(null);
        }}
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
 * rect when nothing visible is found.
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
      return;
    }
    for (const child of Array.from(node.children)) visit(child);
  };
  for (const child of Array.from(el.children)) visit(child);

  if (top === Infinity) return direct;
  return new DOMRect(left, top, right - left, bottom - top);
}
