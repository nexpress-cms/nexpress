"use client";

import { Plus } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type Dispatch } from "react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import type { EditorAction } from "../editor-engine/index.js";
import { Button } from "../../ui/button.js";
import { cn } from "../../ui/utils.js";

import { BlockRow } from "./block-row.js";
import { EditorToolbar } from "./editor-toolbar.js";
import { InlineSelectionToolbar } from "./inline-selection-toolbar.js";
import { SlashMenu, type SlashMenuPosition } from "./slash-menu.js";
import { wrapInlineMark } from "./wrap-inline-mark.js";

export interface DocCanvasProps {
  blocks: NpBlockInstance[];
  definitions: ReadonlyMap<string, NpBlockMetadata>;
  availableBlocks: NpBlockMetadata[];
  dispatch: Dispatch<EditorAction>;
  selectedBlockId: string | null;
  onSelectBlock: (id: string | null) => void;
}

/**
 * Notion-style canvas — Doc view of the in-page editor.
 *
 * Top-level only in v1: containers (grid / tabs) render as
 * read-only summary cards; their children edit in Page builder.
 * Slash menu and HTML5 drag/drop reorder land in commit 7. For
 * commit 6 the canvas covers the eight atom-block bodies plus
 * the existing rich-text and "complex" placeholder.
 */
export function DocCanvas({
  blocks,
  definitions,
  availableBlocks,
  dispatch,
  selectedBlockId,
  onSelectBlock,
}: DocCanvasProps) {
  // Doc-friendly types — the slash menu and trailing "+" inserter
  // surface these. Containers + complex composites edit in Page
  // builder, so we hide them here.
  const docFriendly = availableBlocks.filter((b) => b.docBodyKind && b.docBodyKind !== "complex");
  const fallbackInsertType =
    docFriendly.find((b) => b.type === "paragraph")?.type ?? docFriendly[0]?.type ?? "paragraph";

  const insertAfter = (targetId: string, blockType?: string) =>
    dispatch({
      type: "INSERT_AFTER",
      targetId,
      blockType: blockType ?? fallbackInsertType,
    });

  const appendAtEnd = (blockType?: string) =>
    dispatch({
      type: "ADD",
      blockType: blockType ?? fallbackInsertType,
    });

  // Drag-reorder dispatch. Drops carry a source-id and a side
  // ("above" / "below" of the target). v1 supports same-parent
  // reorder only — Doc rows are top-level, so the canvas's
  // `blocks` array IS the parent's siblings list. The reducer's
  // MOVE_WITHIN_PARENT handles the index math; we just translate
  // "below this row" into "to the row's next sibling".
  const handleReorder = (sourceId: string, targetId: string, side: "above" | "below" | null) => {
    if (!side) return;
    const targetIndex = blocks.findIndex((b) => b.id === targetId);
    if (targetIndex === -1) return;
    const toId = side === "above" ? targetId : (blocks[targetIndex + 1]?.id ?? targetId);
    dispatch({
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: sourceId,
      toId,
    });
  };

  const activeBlock = selectedBlockId
    ? (blocks.find((b) => b.id === selectedBlockId) ?? null)
    : null;
  // Track whether focus sits inside a Lexical body. Atom blocks
  // don't carry inline marks, so the toolbar's mark segment is
  // gated on this — focusing a Lexical contenteditable lights up
  // Bold / Italic / etc., focusing an atom textarea greys them.
  // The check runs on every focusin / focusout inside the canvas;
  // ref guards prevent state thrash when focus moves between two
  // atom rows (status doesn't change).
  const [inRichText, setInRichText] = useState(false);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const update = () => {
      const active = document.activeElement;
      const inside = !!(active instanceof Element && active.closest("[data-np-rich-text-body]"));
      setInRichText((current) => (current === inside ? current : inside));
    };
    root.addEventListener("focusin", update);
    root.addEventListener("focusout", update);
    return () => {
      root.removeEventListener("focusin", update);
      root.removeEventListener("focusout", update);
    };
  }, []);

  // Slash-menu trigger detection. A paragraph whose `text` starts
  // with `/` is treated as a slash-menu invocation: the menu opens
  // anchored to the row, the query is everything after the `/`.
  // On pick we REPLACE_TYPE the slash-paragraph (preserving any
  // post-slash text into the new block's primary text slot is
  // intentionally NOT done — operators expect `/h2 ` to clear and
  // create a fresh heading).
  //
  // Esc closes the menu via a dismissedTextRef snapshot so the
  // open-on-leading-slash detector doesn't immediately re-open the
  // menu on the very next render. The snapshot clears as soon as
  // the operator edits the text again — typing past or deleting
  // the slash both invalidate it.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dismissedTextRef = useRef<{ blockId: string; text: string } | null>(null);
  const [slashState, setSlashState] = useState<{
    blockId: string;
    /** Parent container id, or `null` if the row is top-level. */
    parentId: string | null;
    query: string;
    position: SlashMenuPosition;
  } | null>(null);

  // Recursive lookup — finds the block + its direct parent id by
  // walking the tree. Top-level blocks return parentId=null. Used
  // by the slash-menu trigger detector so a row inside a container
  // can also open the menu (and so the parent's allowedChildTypes
  // contract gates the picker's options when nested).
  const findBlockWithParent = (
    arr: NpBlockInstance[],
    id: string,
    parentId: string | null = null,
  ): { block: NpBlockInstance; parentId: string | null } | null => {
    for (const b of arr) {
      if (b.id === id) return { block: b, parentId };
      if (Array.isArray(b.children)) {
        const inChild = findBlockWithParent(b.children, id, b.id);
        if (inChild) return inChild;
      }
    }
    return null;
  };

  useEffect(() => {
    if (!selectedBlockId) {
      if (slashState) setSlashState(null);
      return;
    }
    const found = findBlockWithParent(blocks, selectedBlockId);
    if (!found) {
      if (slashState) setSlashState(null);
      return;
    }
    const { block, parentId } = found;
    const meta = definitions.get(block.type);
    const isAtomText =
      meta?.docBodyKind === "paragraph" ||
      meta?.docBodyKind === "heading" ||
      meta?.docBodyKind === "heading-2" ||
      meta?.docBodyKind === "heading-3";
    if (!isAtomText) {
      if (slashState) setSlashState(null);
      return;
    }
    const text = typeof block.props.text === "string" ? block.props.text : "";
    if (!text.startsWith("/")) {
      // Operator edited past the slash — invalidate any prior
      // dismissal so a fresh `/` later in the same row reopens.
      dismissedTextRef.current = null;
      if (slashState) setSlashState(null);
      return;
    }
    const dismissed = dismissedTextRef.current;
    if (dismissed && dismissed.blockId === block.id && dismissed.text === text) {
      // Same row, same text the operator just dismissed — keep
      // the menu closed. Editing the text resets the snapshot via
      // the branch above.
      return;
    }
    // Anchor under the row's textarea — best effort; falls back to
    // top-level if the row hasn't mounted yet. The selector works
    // for nested rows too (data-np-block-row is on every BlockRow,
    // including children).
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-np-block-row="${block.id}"] textarea`,
    );
    const containerRect = containerRef.current?.getBoundingClientRect();
    const rowRect = row?.getBoundingClientRect();
    const x = rowRect && containerRect ? rowRect.left - containerRect.left : 24;
    const y = rowRect && containerRect ? rowRect.bottom - containerRect.top + 6 : 60;
    setSlashState({
      blockId: block.id,
      parentId,
      query: text.slice(1),
      position: { x, y },
    });
  }, [blocks, definitions, selectedBlockId, slashState]);

  const handleSlashPick = (newType: string) => {
    if (!slashState) return;
    dispatch({
      type: "REPLACE_TYPE",
      id: slashState.blockId,
      newType,
      preserveText: false,
    });
    setSlashState(null);
  };

  // When the slash row is INSIDE a container, filter the picker's
  // type list to types the container's `allowedChildTypes` contract
  // permits. Top-level rows (parentId=null) see the full doc-friendly
  // set.
  const slashCandidates = (() => {
    if (!slashState || slashState.parentId === null) return docFriendly;
    const parent = (() => {
      const found = findBlockWithParent(blocks, slashState.parentId);
      return found?.block;
    })();
    const parentMeta = parent ? definitions.get(parent.type) : null;
    const allowed = parentMeta?.allowedChildTypes;
    if (!allowed || allowed.length === 0 || allowed.includes("*")) {
      return docFriendly;
    }
    return docFriendly.filter((b) => allowed.includes(b.type));
  })();

  return (
    <div
      ref={containerRef}
      className={cn(
        // `gap-0.5` (2 px) matches the design's tight `.be-canvas`
        // row spacing. Looser gaps make the canvas feel like a
        // form rather than a Notion-style document.
        "relative flex flex-col gap-0.5 rounded-2xl border border-neutral-200/80 bg-white/95 p-7 shadow-sm backdrop-blur-sm",
        "dark:border-neutral-800/80 dark:bg-neutral-950/95",
      )}
    >
      <EditorToolbar activeBlock={activeBlock} inRichText={inRichText} dispatch={dispatch} />
      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50/70 p-8 text-center text-sm text-muted-foreground dark:border-neutral-700 dark:bg-neutral-900/30">
          Empty page. Add a block to start writing.
        </div>
      ) : (
        // Single Suspense boundary covering every BlockRow's
        // potentially-lazy body (rich-text → @nexpress/editor/client).
        // Without this hoist each rich-text row would render its own
        // "Loading…" fallback; here the whole list waits on one
        // module load, then all rows hydrate together.
        <Suspense
          fallback={
            <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50/70 p-4 text-center text-xs text-muted-foreground dark:border-neutral-700 dark:bg-neutral-900/30">
              Loading editor…
            </div>
          }
        >
          {blocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              meta={definitions.get(block.type)}
              availableBlocks={availableBlocks}
              definitions={definitions}
              dispatch={dispatch}
              isFocused={selectedBlockId === block.id}
              selectedBlockId={selectedBlockId}
              onFocus={() => onSelectBlock(block.id)}
              onSelectBlock={onSelectBlock}
              parentId={null}
              onAddBelow={() => insertAfter(block.id)}
              onReorder={(sourceId, side) => handleReorder(sourceId, block.id, side)}
            />
          ))}
        </Suspense>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => appendAtEnd()}
        className="mt-1 w-full justify-start border border-dashed border-neutral-300 bg-transparent text-muted-foreground hover:border-neutral-400 hover:text-foreground dark:border-neutral-700"
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add block
        <span className="ml-auto text-[11px] text-muted-foreground/70">
          type <code className="rounded bg-muted px-1 font-mono">/</code> for menu
        </span>
      </Button>

      {slashState ? (
        <SlashMenu
          blocks={slashCandidates}
          query={slashState.query}
          position={slashState.position}
          onPick={handleSlashPick}
          onClose={() => {
            // Snapshot the text-at-dismiss so the trigger detector
            // doesn't reopen the menu on the next render — the
            // snapshot invalidates as soon as the operator edits
            // the row again (see useEffect above). Walk recursively
            // because nested rows can also trigger the menu.
            const found = findBlockWithParent(blocks, slashState.blockId);
            const block = found?.block;
            const text = block && typeof block.props.text === "string" ? block.props.text : "";
            dismissedTextRef.current = { blockId: slashState.blockId, text };
            setSlashState(null);
          }}
        />
      ) : null}

      {/* Floating inline-selection toolbar — appears above any
          non-collapsed selection inside an atom-block textarea.
          Mirrors the design's `be-inline` surface: dark
          background, compact button row, B/I/U/S/Inline-code +
          Link (rich-text only). The shared `wrapInlineMark`
          helper produces the same dispatch the sticky toolbar
          uses, so operators get identical behavior whether they
          reach for the top toolbar or the floating one. */}
      <InlineSelectionToolbar containerRef={containerRef} onWrap={wrapInlineMark} />
    </div>
  );
}
