"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Braces, Eye, EyeOff, Plus, Redo2, Undo2 } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import { BlockPalette } from "../block-palette.js";
import {
  collectContainerCandidates,
  locateBlock,
  useEditorState,
} from "../editor-engine/index.js";
import {
  deleteCustomPattern,
  deleteServerPattern,
  fetchServerPatterns,
  getBuiltInPatterns,
  getCustomPatterns,
  migrateLocalPatternsToServer,
  saveCustomPattern,
  saveServerPattern,
  type NpPattern,
} from "../patterns.js";
import { PreviewPanel } from "../preview-panel.js";
import { CommandMenu, PageJsonDialog } from "../shared/index.js";
import { findBlockInTreeFlat } from "../editor-engine/index.js";
import { Button } from "../../ui/button.js";
import { cn } from "../../ui/utils.js";

import { DragPreview } from "./drag-preview.js";
import { InsertSlot } from "./insert-slot.js";
import { SortableBlockItem } from "./sortable-block-item.js";

/**
 * Form-card page-builder editor — the orchestrator. Mounts the
 * editor-engine state hook (`useEditorState`), wires top-level
 * keyboard shortcuts (Cmd-K, Undo/Redo), and renders the row-card
 * UI plus the shared dialogs / preview / command menu.
 *
 * An in-page editor would mount `useEditorState` the same way and
 * dispatch the same `EditorAction`s, but with its own row-render
 * surface (page-as-canvas instead of card list).
 */

interface BlockPageEditorProps {
  blocks: NpBlockInstance[];
  onChange: (blocks: NpBlockInstance[]) => void;
  availableBlocks: NpBlockMetadata[];
}

export function BlockPageEditor({
  blocks: initialBlocks,
  onChange,
  availableBlocks,
}: BlockPageEditorProps) {
  const definitions = useMemo(
    () => new Map(availableBlocks.map((block) => [block.type, block])),
    [availableBlocks],
  );
  const { blocks, dispatch, undo, redo, canUndo, canRedo } = useEditorState({
    initialBlocks,
    availableBlocks,
    onChange,
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [pageJsonOpen, setPageJsonOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  // Section patterns (#467 phase 4 + follow-up).
  //
  // - Built-ins ship with the editor.
  // - Server patterns live in `np_settings` (per site, shared
  //   across operators on the same team) and arrive via
  //   `/api/admin/patterns`. They take precedence in the merged
  //   list so a team-shared "Featured CTA" overrides any locally
  //   saved pattern with the same id.
  // - Local-only fallback: when the API call fails (offline, lower
  //   role than admin.manage, server error) we fall back to the
  //   localStorage list so an operator can still keep working.
  //
  // We refresh on command-menu open so an out-of-band save (another
  // tab) flows through without a page reload.
  const [customPatterns, setCustomPatterns] = useState<NpPattern[]>([]);
  const refreshPatterns = useCallback(async () => {
    const server = await fetchServerPatterns();
    if (server === null) {
      setCustomPatterns(getCustomPatterns());
      return;
    }
    // First successful server fetch in this browser: migrate any
    // local-only patterns up to the server. Idempotent — guarded
    // by a localStorage flag inside `migrateLocalPatternsToServer`.
    const migrated = await migrateLocalPatternsToServer(server);
    const finalServer =
      migrated.length > 0
        ? [
            ...migrated,
            ...server.filter((p) => !migrated.some((m) => m.id === p.id)),
          ]
        : server;
    const local = getCustomPatterns(); // Re-read post-migration cleanup.
    const serverIds = new Set(finalServer.map((p) => p.id));
    const localOnly = local.filter((p) => !serverIds.has(p.id));
    setCustomPatterns([...finalServer, ...localOnly]);
  }, []);
  useEffect(() => {
    if (commandOpen) void refreshPatterns();
  }, [commandOpen, refreshPatterns]);
  const patterns = useMemo(
    () => [...getBuiltInPatterns(), ...customPatterns],
    [customPatterns],
  );
  const handleSaveFocusedAsPattern = useCallback(
    (focusedBlockId: string) => {
      const focused = findBlockInTreeFlat(blocks, focusedBlockId);
      if (!focused) return;
      const label = window.prompt(
        "Save as pattern — name?",
        focused.props.title?.toString() ??
          focused.props.heading?.toString() ??
          focused.type,
      );
      if (!label || label.trim().length === 0) return;
      const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const pattern: NpPattern = {
        id,
        label: label.trim(),
        source: "custom",
        blocks: [focused],
      };
      void saveServerPattern(pattern).then((saved) => {
        if (saved) {
          setCustomPatterns((current) => [
            saved,
            ...current.filter((p) => p.id !== saved.id),
          ]);
          return;
        }
        const next = saveCustomPattern(pattern);
        setCustomPatterns(next);
      });
    },
    [blocks],
  );
  const handleDeletePattern = useCallback(async (patternId: string) => {
    // Server delete is the canonical path. Local cleanup runs
    // unconditionally so a stale localStorage copy can't survive.
    await deleteServerPattern(patternId);
    deleteCustomPattern(patternId);
    setCustomPatterns((current) => current.filter((p) => p.id !== patternId));
  }, []);

  // Live preview toggle. Persisted in localStorage so an operator
  // who keeps it open across sessions doesn't reflip on every page
  // load. Defaults to off — preview costs an extra server round
  // trip per edit.
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("np-page-builder.preview");
      if (stored === "1") setPreviewOpen(true);
    } catch {
      // Private-browsing / SSR — fall back to default closed.
    }
  }, []);
  const togglePreview = () => {
    setPreviewOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(
          "np-page-builder.preview",
          next ? "1" : "0",
        );
      } catch {
        // Same as above — silent.
      }
      return next;
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Cmd/Ctrl-Z / Cmd-Shift-Z / Ctrl-Y bound at window level.
  // Skip while focus sits on a text-entry surface so operators
  // still get native input undo while typing into prop fields —
  // the editor's coalesced UPDATE_PROPS history covers structural
  // changes that survive blur.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.matches("input, textarea") || target.isContentEditable)
      ) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const onInsert = useCallback(
    (position: "before" | "after", targetId: string, blockType: string) => {
      dispatch({
        type: position === "before" ? "INSERT_BEFORE" : "INSERT_AFTER",
        targetId,
        blockType,
      });
    },
    [dispatch],
  );

  // Locate the active block anywhere in the tree (it may be a
  // top-level block or nested inside a container). The drag
  // overlay just needs the label, so a flat search is enough.
  const findInTree = (
    arr: NpBlockInstance[],
    id: string,
  ): NpBlockInstance | undefined => {
    for (const b of arr) {
      if (b.id === id) return b;
      const inChild = b.children ? findInTree(b.children, id) : undefined;
      if (inChild) return inChild;
    }
    return undefined;
  };
  const activeBlock = activeId ? findInTree(blocks, activeId) : undefined;

  // Roving keyboard navigation (#467). Editor section captures
  // ArrowUp / ArrowDown / Home / End and walks the
  // `[data-np-block-row]` set in DOM order so nested-container
  // children flow naturally between their parent and the next
  // top-level row.
  function handleKeyboardNav(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.matches("input, textarea") || target.isContentEditable)
    ) {
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setCommandOpen(true);
      return;
    }

    const key = event.key;
    if (
      key !== "ArrowDown" &&
      key !== "ArrowUp" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }
    const root = sectionRef.current;
    if (!root) return;
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>("[data-np-block-row]"),
    );
    if (rows.length === 0) return;
    const activeRow = target?.closest<HTMLElement>("[data-np-block-row]");
    const currentIndex = activeRow ? rows.indexOf(activeRow) : -1;
    let next = currentIndex;
    if (key === "ArrowDown") {
      next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, rows.length - 1);
    } else if (key === "ArrowUp") {
      next = currentIndex < 0 ? rows.length - 1 : Math.max(currentIndex - 1, 0);
    } else if (key === "Home") {
      next = 0;
    } else if (key === "End") {
      next = rows.length - 1;
    }
    if (next === currentIndex) return;
    event.preventDefault();
    rows[next]?.focus();
  }

  // Currently-focused block id for the command menu's
  // context-sensitive actions. We read it lazily from the DOM
  // when the menu opens (focused row owns `:focus-visible`),
  // rather than mirroring focus into React state on every move.
  function readFocusedBlockId(): string | null {
    if (typeof document === "undefined") return null;
    const focusedRow = document.activeElement?.closest<HTMLElement>(
      "[data-np-block-row]",
    );
    return focusedRow?.dataset.npBlockRow ?? null;
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over) return;
    const activeIdStr = String(event.active.id);
    const overIdStr = String(event.over.id);
    if (activeIdStr === overIdStr) return;
    // dnd-kit fires onDragEnd once for the whole context. Resolve
    // both ids to their containers — only reorder when both share
    // the same parent (cross-container drag is intentionally not
    // supported in v1).
    const activeLoc = locateBlock(blocks, activeIdStr);
    const overLoc = locateBlock(blocks, overIdStr);
    if (!activeLoc || !overLoc) return;
    if (activeLoc.parentId !== overLoc.parentId) return;
    dispatch({
      type: "MOVE_WITHIN_PARENT",
      parentId: activeLoc.parentId,
      fromId: activeIdStr,
      toId: overIdStr,
    });
  }

  return (
    <section
      ref={sectionRef}
      className={cn("np-block-page-editor flex flex-col gap-4")}
      onKeyDown={handleKeyboardNav}
    >
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Undo"
          onClick={undo}
          disabled={!canUndo}
        >
          <Undo2 className="mr-1.5 h-4 w-4" />
          Undo
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Redo"
          onClick={redo}
          disabled={!canRedo}
        >
          <Redo2 className="mr-1.5 h-4 w-4" />
          Redo
        </Button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => setActiveId(String(event.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={blocks.map((block) => block.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-3">
            {blocks.map((block, index) => {
              const blockDefinition = definitions.get(block.type);
              const blockLabel = blockDefinition?.label ?? block.type;
              return (
                <Fragment key={block.id}>
                  {index === 0 ? (
                    <InsertSlot
                      availableBlocks={availableBlocks}
                      onInsert={(blockType) =>
                        onInsert("before", block.id, blockType)
                      }
                      ariaLabel={`Insert block before ${blockLabel}`}
                    />
                  ) : null}
                  <SortableBlockItem
                    block={block}
                    definition={blockDefinition}
                    availableBlocks={availableBlocks}
                    definitions={definitions}
                    onMoveUp={(id) => dispatch({ type: "MOVE_UP", id })}
                    onMoveDown={(id) => dispatch({ type: "MOVE_DOWN", id })}
                    onDuplicate={(id) => dispatch({ type: "DUPLICATE", id })}
                    onDelete={(id) => dispatch({ type: "DELETE", id })}
                    onUpdateProps={(id, props) =>
                      dispatch({ type: "UPDATE_PROPS", id, props })
                    }
                    onReplaceProps={(id, props) =>
                      dispatch({ type: "REPLACE_PROPS", id, props })
                    }
                    onAddChild={(parentId, blockType) =>
                      dispatch({ type: "ADD", blockType, parentId })
                    }
                    onInsert={onInsert}
                    onMoveOut={(id) => dispatch({ type: "MOVE_OUT", id })}
                    onMoveInto={(id, targetParentId) =>
                      dispatch({ type: "MOVE_INTO", id, targetParentId })
                    }
                    onWrapIn={(id, containerType) =>
                      dispatch({ type: "WRAP_IN", id, containerType })
                    }
                    getMoveIntoCandidates={(id) =>
                      collectContainerCandidates(blocks, id, definitions)
                    }
                  />
                  <InsertSlot
                    availableBlocks={availableBlocks}
                    onInsert={(blockType) =>
                      onInsert("after", block.id, blockType)
                    }
                    ariaLabel={`Insert block after ${blockLabel}`}
                  />
                </Fragment>
              );
            })}
            {blocks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-6 py-10 text-center">
                <p className="mb-3 text-sm text-muted-foreground">
                  No blocks yet. Pick one to start building the page.
                </p>
              </div>
            ) : null}
          </div>
        </SortableContext>
        <DragOverlay>
          <DragPreview
            block={activeBlock}
            definition={activeBlock ? definitions.get(activeBlock.type) : undefined}
          />
        </DragOverlay>
      </DndContext>

      <div className="flex items-center justify-center gap-2">
        <BlockPalette
          availableBlocks={availableBlocks}
          onAdd={(type) => dispatch({ type: "ADD", blockType: type })}
          trigger={
            <Button type="button" variant="outline" size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              Add block
            </Button>
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPageJsonOpen(true)}
        >
          <Braces className="mr-1.5 h-4 w-4" />
          Edit JSON
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={previewOpen}
          onClick={togglePreview}
        >
          {previewOpen ? (
            <>
              <EyeOff className="mr-1.5 h-4 w-4" />
              Hide preview
            </>
          ) : (
            <>
              <Eye className="mr-1.5 h-4 w-4" />
              Show preview
            </>
          )}
        </Button>
      </div>

      {previewOpen ? <PreviewPanel blocks={blocks} /> : null}

      <PageJsonDialog
        open={pageJsonOpen}
        onOpenChange={setPageJsonOpen}
        blocks={blocks}
        knownTypes={availableBlocks.map((b) => b.type)}
        onApply={(nextBlocks) =>
          // Route through `dispatch` (not `historyDispatch
          // RESET_HISTORY`) so the apply lands as one undo step.
          // JSON apply is the most destructive operator action —
          // losing the safety net here would be a regression vs.
          // the per-block JSON dialog.
          dispatch({ type: "RESET", blocks: nextBlocks })
        }
      />

      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        availableBlocks={availableBlocks}
        readFocusedBlockId={readFocusedBlockId}
        blocks={blocks}
        definitions={definitions}
        dispatch={dispatch}
        onOpenPageJson={() => setPageJsonOpen(true)}
        patterns={patterns}
        onSaveFocusedAsPattern={handleSaveFocusedAsPattern}
        onDeletePattern={(id) => void handleDeletePattern(id)}
      />
    </section>
  );
}
