"use client";

import { Plus } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
} from "react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import type { EditorAction } from "../editor-engine/index.js";
import { Button } from "../../ui/button.js";
import { cn } from "../../ui/utils.js";

import { BlockRow } from "./block-row.js";
import { EditorToolbar } from "./editor-toolbar.js";
import { SlashMenu, type SlashMenuPosition } from "./slash-menu.js";

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
  const docFriendly = availableBlocks.filter(
    (b) => b.docBodyKind && b.docBodyKind !== "complex",
  );
  const fallbackInsertType =
    docFriendly.find((b) => b.type === "paragraph")?.type ??
    docFriendly[0]?.type ??
    "paragraph";

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

  const activeBlock = selectedBlockId
    ? blocks.find((b) => b.id === selectedBlockId) ?? null
    : null;
  // Track whether focus sits inside a Lexical body — atom blocks
  // don't carry inline marks, so the toolbar's mark segment is
  // gated on this. v1 keeps it pessimistic (always false) since
  // the in-page rich-text body is itself a v1.1 follow-up.
  const [inRichText] = useState(false);

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
  const dismissedTextRef = useRef<{ blockId: string; text: string } | null>(
    null,
  );
  const [slashState, setSlashState] = useState<{
    blockId: string;
    query: string;
    position: SlashMenuPosition;
  } | null>(null);

  useEffect(() => {
    if (!selectedBlockId) {
      if (slashState) setSlashState(null);
      return;
    }
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) {
      if (slashState) setSlashState(null);
      return;
    }
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
    if (
      dismissed &&
      dismissed.blockId === block.id &&
      dismissed.text === text
    ) {
      // Same row, same text the operator just dismissed — keep
      // the menu closed. Editing the text resets the snapshot via
      // the branch above.
      return;
    }
    // Anchor under the row's textarea — best effort; falls back to
    // top-left if the row hasn't mounted yet.
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-np-block-row="${block.id}"] textarea`,
    );
    const containerRect = containerRef.current?.getBoundingClientRect();
    const rowRect = row?.getBoundingClientRect();
    const x =
      rowRect && containerRect ? rowRect.left - containerRect.left : 24;
    const y =
      rowRect && containerRect
        ? rowRect.bottom - containerRect.top + 6
        : 60;
    setSlashState({
      blockId: block.id,
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

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-2xl border border-neutral-200/80 bg-white/95 p-7 shadow-sm backdrop-blur-sm",
        "dark:border-neutral-800/80 dark:bg-neutral-950/95",
      )}
    >
      <EditorToolbar
        activeBlock={activeBlock}
        inRichText={inRichText}
        dispatch={dispatch}
      />
      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50/70 p-8 text-center text-sm text-muted-foreground dark:border-neutral-700 dark:bg-neutral-900/30">
          Empty page. Add a block to start writing.
        </div>
      ) : (
        blocks.map((block) => (
          <BlockRow
            key={block.id}
            block={block}
            meta={definitions.get(block.type)}
            availableBlocks={availableBlocks}
            dispatch={dispatch}
            isFocused={selectedBlockId === block.id}
            onFocus={() => onSelectBlock(block.id)}
            onAddBelow={() => insertAfter(block.id)}
          />
        ))
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => appendAtEnd()}
        className="mt-1 justify-start border border-dashed border-neutral-300 bg-transparent text-muted-foreground hover:border-neutral-400 hover:text-foreground dark:border-neutral-700"
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add block
      </Button>

      {slashState ? (
        <SlashMenu
          blocks={docFriendly}
          query={slashState.query}
          position={slashState.position}
          onPick={handleSlashPick}
          onClose={() => {
            // Snapshot the text-at-dismiss so the trigger detector
            // doesn't reopen the menu on the next render — the
            // snapshot invalidates as soon as the operator edits
            // the row again (see useEffect above).
            const block = blocks.find((b) => b.id === slashState.blockId);
            const text =
              block && typeof block.props.text === "string"
                ? block.props.text
                : "";
            dismissedTextRef.current = { blockId: slashState.blockId, text };
            setSlashState(null);
          }}
        />
      ) : null}
    </div>
  );
}
