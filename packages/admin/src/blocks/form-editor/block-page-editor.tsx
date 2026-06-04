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
import { Braces, Copy, Group, LayoutGrid, Plus, Redo2, Trash2, Undo2, X } from "lucide-react";
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
  evaluateContainerWarnings,
  findBlockInTreeFlat,
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
import { useContributedPatterns } from "../registry-context.js";
import {
  CommandMenu,
  ContainerWarningsPanel,
  EditorAsidePortal,
  ModeSwitch,
  OutlinePanel,
  PageJsonDialog,
  PastePatternDialog,
  PatternLibraryDialog,
  StatusBar,
  useAutosaveStatus,
  usePersistedView,
  useSaveEvents,
} from "../shared/index.js";
import { DocCanvas } from "../in-page-editor/index.js";
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
  /**
   * Optional persistence scope for the Document / Page builder
   * view toggle. Pass `<collection>.<field>` (e.g. `"pages.blocks"`)
   * so the operator's choice survives reloads. When omitted the
   * toggle still works in-session but the choice doesn't persist.
   */
  viewScope?: string;
  /**
   * DOM id of a host-provided mount target for the editor aside
   * (Outline + Container warnings panels). Default
   * `"np-block-editor-aside"` matches `CollectionEditView`'s
   * sticky right sidebar. Without the target the panels don't
   * render — the canvas keeps full width.
   *
   * The portal pattern lets the editor share the form's existing
   * sidebar instead of carving out a nested aside that would
   * narrow the canvas (the design's `editor-aside` is a single
   * right column with Status / Slug / Page tree / Warnings stacked
   * together).
   */
  asideMountId?: string;
}

export function BlockPageEditor({
  blocks: initialBlocks,
  onChange,
  availableBlocks,
  viewScope,
  asideMountId,
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
  const [pasteImportOpen, setPasteImportOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  // Phase F.5.2 — pattern library dialog (richer browse UI than
  // the Cmd-K command menu's text lines). Toggled via Cmd-Shift-P
  // or the toolbar button next to "Save" in the editor header.
  const [patternLibraryOpen, setPatternLibraryOpen] = useState(false);
  // Currently-focused row id (#467 #1). Tracked via focusin /
  // focusout listeners on the editor section so any focus surface
  // (row card, popover, dropdown) within a `[data-np-block-row]`
  // ancestor counts as "this block is the operator's current
  // target". The status bar's active-block chip + the outline
  // panel's highlight both read this value.
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  // Multi-select set (#467 #3). Lives at the orchestrator so a
  // single dispatch can act on every selected id at once. Also
  // remembers the "anchor" — the last id the operator clicked
  // without shift — so a subsequent shift-click extends the
  // range. Selection clears on most structural mutations
  // (DELETE_MANY clears, etc.) since stale ids would haunt the
  // bulk toolbar after a delete.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = sectionRef.current;
    if (!root) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const row = target.closest<HTMLElement>("[data-np-block-row]");
      if (!row) return;
      const id = row.dataset.npBlockRow;
      if (id) setSelectedBlockId(id);
    };
    root.addEventListener("focusin", onFocusIn);
    return () => root.removeEventListener("focusin", onFocusIn);
  }, []);

  // Per-row collapsed state (#467 quick-wins). Lives at the
  // orchestrator so it survives every dispatch (the row card itself
  // gets re-mounted on tree changes) and so we can persist it in
  // localStorage. Default is expanded — we track the collapsed
  // *set* instead of the open set so brand-new blocks open by
  // default without needing an explicit insert hook.
  const COLLAPSED_KEY = "np-page-builder.collapsed";
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY);
      if (!raw) return new Set();
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? new Set(parsed.filter((id): id is string => typeof id === "string"))
        : new Set();
    } catch {
      return new Set();
    }
  });
  const isRowOpen = useCallback((id: string) => !collapsedIds.has(id), [collapsedIds]);
  const setRowOpen = useCallback((id: string, open: boolean) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (open) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // Private mode / quota — drop the persistence, keep the
        // in-memory state. The collapsed set just resets next load.
      }
      return next;
    });
  }, []);

  // Focus-on-newly-inserted (#467 quick-wins). Diff the id set
  // across renders; if exactly one new top-level-or-nested id
  // appeared, scroll its row into view and move focus to it so the
  // operator can type into the new block immediately. Diffing is
  // cheap — pages have dozens of blocks at most, not thousands.
  // The first effect run just seeds the baseline so the auto-
  // focus doesn't fire on initial mount.
  const knownIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const collect = (arr: NpBlockInstance[], into: Set<string>): void => {
      for (const b of arr) {
        into.add(b.id);
        if (b.children) collect(b.children, into);
      }
    };
    const seen = new Set<string>();
    collect(blocks, seen);
    if (knownIdsRef.current === null) {
      knownIdsRef.current = seen;
      return;
    }
    const newIds: string[] = [];
    for (const id of seen) if (!knownIdsRef.current.has(id)) newIds.push(id);
    knownIdsRef.current = seen;
    if (newIds.length !== 1) return;
    const target = document.querySelector<HTMLElement>(`[data-np-block-row="${newIds[0]}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    target.focus({ preventScroll: true });
  }, [blocks]);

  // Selection helpers (#467 #3). `isSelected` is a stable lookup
  // for row props; `toggleSelected` handles the click semantics
  // (plain click toggles a single id, shift-click extends from the
  // anchor across the same parent's siblings — the common case
  // for "wrap these adjacent blocks", cmd/ctrl-click also toggles
  // additive). Selection is intentionally siblings-aware: a
  // shift-click that crosses parent boundaries falls back to a
  // plain toggle (extending across containers would create a
  // selection no bulk action could honor).
  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);
  const toggleSelected = useCallback(
    (id: string, modifiers: { shift: boolean; meta: boolean }) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (modifiers.shift && selectionAnchorRef.current) {
          const anchorLoc = locateBlock(blocks, selectionAnchorRef.current);
          const targetLoc = locateBlock(blocks, id);
          if (anchorLoc && targetLoc && anchorLoc.parentId === targetLoc.parentId) {
            const lo = Math.min(anchorLoc.index, targetLoc.index);
            const hi = Math.max(anchorLoc.index, targetLoc.index);
            // Resolve the parent's sibling array and add every id
            // in [lo..hi]. updateContainerChildren is overkill —
            // we just need a read of the siblings.
            const parentBlock =
              anchorLoc.parentId === null ? null : findBlockInTreeFlat(blocks, anchorLoc.parentId);
            const siblings = parentBlock?.children ?? (anchorLoc.parentId === null ? blocks : []);
            for (let i = lo; i <= hi; i++) {
              const sib = siblings[i];
              if (sib) next.add(sib.id);
            }
            return next;
          }
          // Cross-parent shift-click: fall through to plain toggle.
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        // Track the anchor for shift-click. Modifier-less click
        // and cmd/ctrl-click both reset the anchor to the just-
        // clicked id; shift-click leaves it alone.
        if (!modifiers.shift) selectionAnchorRef.current = id;
        return next;
      });
    },
    [blocks],
  );
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    selectionAnchorRef.current = null;
  }, []);

  // Drop ids that no longer exist in the tree (post-delete /
  // post-undo). Cheap because pages have dozens of blocks at
  // most. Without this, the bulk toolbar would show a stale
  // count after a single-block delete from outside the toolbar.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const live = new Set<string>();
    const collect = (arr: NpBlockInstance[]): void => {
      for (const b of arr) {
        live.add(b.id);
        if (b.children) collect(b.children);
      }
    };
    collect(blocks);
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedIds) {
      if (live.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedIds(next);
  }, [blocks, selectedIds]);
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
        ? [...migrated, ...server.filter((p) => !migrated.some((m) => m.id === p.id))]
        : server;
    const local = getCustomPatterns(); // Re-read post-migration cleanup.
    const serverIds = new Set(finalServer.map((p) => p.id));
    const localOnly = local.filter((p) => !serverIds.has(p.id));
    setCustomPatterns([...finalServer, ...localOnly]);
  }, []);
  useEffect(() => {
    if (commandOpen) void refreshPatterns();
  }, [commandOpen, refreshPatterns]);
  // Plugin / theme contributed patterns flow through the
  // registry-context (server-populated by the bootstrap). They sit
  // between built-ins and custom in the merged list — operators
  // expect their own saves to appear at the top, themes/plugins
  // below the canonical built-ins. De-dupe by id with built-ins
  // winning on collision so a misconfigured plugin can't shadow
  // the canonical "landing-hero" pattern.
  const contributedPatterns = useContributedPatterns();
  const patterns = useMemo(() => {
    const builtIns = getBuiltInPatterns();
    const builtInIds = new Set(builtIns.map((p) => p.id));
    const contributedDeduped = contributedPatterns.filter((p) => !builtInIds.has(p.id));
    return [...builtIns, ...contributedDeduped, ...customPatterns];
  }, [contributedPatterns, customPatterns]);
  const handleSaveFocusedAsPattern = useCallback(
    (focusedBlockId: string) => {
      const focused = findBlockInTreeFlat(blocks, focusedBlockId);
      if (!focused) return;
      const label = window.prompt(
        "Save as pattern — name?",
        focused.props.title?.toString() ?? focused.props.heading?.toString() ?? focused.type,
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
          setCustomPatterns((current) => [saved, ...current.filter((p) => p.id !== saved.id)]);
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

  // Live preview lived here briefly as a Page-builder-mode toggle
  // (`Show preview` button + bottom iframe). Removed once Doc view
  // became a true preview surface — switching to Doc mode IS the
  // preview now, and a second iframe at the bottom of Page builder
  // duplicated that for no operator benefit while costing a server
  // round trip per debounced edit.

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Document / Page builder toggle. Persists per `viewScope` in
  // localStorage when the orchestrator is mounted with one.
  // Default lands on Page builder (the muscle-memory view) so
  // existing operators see no behavior change until they opt in.
  const [view, setView] = usePersistedView(viewScope, "page");

  // Autosave status — driven by `onChange` (any tree mutation
  // marks the editor dirty). Save coordination lives in the
  // collection's form layer (react-hook-form's submit) — this
  // hook just surfaces a "Saved" / pulse cue in the status bar.
  // The form-card editor doesn't yet observe save resolution,
  // so for v1 we settle into a steady "Just now" anchor on
  // every dispatch. Wiring `mark("saved")` to the actual save
  // resolve lands when the orchestrator grows a save callback.
  const autosave = useAutosaveStatus();
  const lastBlocksRef = useRef(initialBlocks);
  useEffect(() => {
    if (lastBlocksRef.current !== blocks) {
      autosave.mark("dirty");
      lastBlocksRef.current = blocks;
    }
  }, [blocks, autosave]);
  // Bridge form-level save events to the orchestrator's autosave
  // indicator. The collection edit view emits "saving" before the
  // network call and "saved" / "error" after it resolves; we
  // forward the first two into the indicator's state machine.
  // Errors don't mark "saved" — the editor stays in a dirty state
  // so operators see they still need to retry the save.
  useSaveEvents((event) => {
    if (event === "saving") autosave.mark("saving");
    else if (event === "saved") autosave.mark("saved");
  });

  // Container contract warnings — surfaced as a side card and
  // referenced in the status bar's count. Driven by the engine's
  // pure `evaluateContainerWarnings`, recomputed on every tree
  // change (cheap — pages have dozens of blocks at most).
  const containerWarnings = useMemo(
    () => evaluateContainerWarnings(blocks, definitions),
    [blocks, definitions],
  );

  // Total count across the recursive tree (status-bar telemetry).
  const totalBlocks = useMemo(() => {
    let n = 0;
    const walk = (arr: NpBlockInstance[]): void => {
      for (const b of arr) {
        n += 1;
        if (b.children) walk(b.children);
      }
    };
    walk(blocks);
    return n;
  }, [blocks]);

  // Doc-mode word count — flatten every atom block's text-shaped
  // prop into one string and count whitespace-separated tokens.
  // Mirrors the design's `EditorScreen` formula. Computed
  // unconditionally (cheap), surfaced only in Doc view via the
  // status bar's `wordCount` prop.
  const docWordCount = useMemo(() => {
    const collect = (arr: NpBlockInstance[]): string[] => {
      const out: string[] = [];
      for (const b of arr) {
        const text = b.props.text;
        if (typeof text === "string") out.push(text);
        const heading = b.props.heading;
        if (typeof heading === "string") out.push(heading);
        const items = b.props.items;
        if (Array.isArray(items)) {
          for (const item of items) {
            if (typeof item === "string") out.push(item);
          }
        }
        const code = b.props.code;
        if (typeof code === "string") out.push(code);
        const caption = b.props.caption;
        if (typeof caption === "string") out.push(caption);
        if (b.children) out.push(...collect(b.children));
      }
      return out;
    };
    const joined = collect(blocks).join(" ").trim();
    if (joined.length === 0) return 0;
    return joined.split(/\s+/).filter(Boolean).length;
  }, [blocks]);

  // Reading-time minutes — the design uses 220 wpm
  // (`Math.max(1, Math.round(wordCount / 220))`). Stays at the
  // floor of 1 minute even for empty docs so the status bar reads
  // sensibly on first mount.
  const docReadingMinutes = useMemo(
    () => Math.max(1, Math.round(docWordCount / 220)),
    [docWordCount],
  );

  const activeBlockMeta = selectedBlockId
    ? (definitions.get(findBlockInTreeFlat(blocks, selectedBlockId)?.type ?? "") ?? null)
    : null;
  const activeBlockType = selectedBlockId
    ? (findBlockInTreeFlat(blocks, selectedBlockId)?.type ?? null)
    : null;

  /**
   * Scroll a block row into view + focus it. Reused by the
   * outline panel's pick handler and the warnings panel's pick
   * handler — both want the same "find the row, scroll, focus"
   * effect.
   */
  const focusBlockRow = useCallback((id: string) => {
    setSelectedBlockId(id);
    if (typeof document === "undefined") return;
    const target = document.querySelector<HTMLElement>(`[data-np-block-row="${id}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    target.focus({ preventScroll: true });
  }, []);

  // Cmd/Ctrl-Z / Cmd-Shift-Z / Ctrl-Y bound at window level.
  // Skip while focus sits on a text-entry surface so operators
  // still get native input undo while typing into prop fields —
  // the editor's coalesced UPDATE_PROPS history covers structural
  // changes that survive blur.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.matches("input, textarea") || target.isContentEditable)) {
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
  const findInTree = (arr: NpBlockInstance[], id: string): NpBlockInstance | undefined => {
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
    if (target && (target.matches("input, textarea") || target.isContentEditable)) {
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setCommandOpen(true);
      return;
    }

    // Phase F.5.2 — Cmd-Shift-P opens the pattern library. Picked
    // Cmd-Shift-P over Cmd-P (which most browsers reserve for
    // "Print this page") and over Cmd-L (which Chrome uses for
    // "Focus address bar"); Shift-P is unbound in Chrome / Safari
    // / Firefox out of the box.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      setPatternLibraryOpen(true);
      return;
    }

    const key = event.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") {
      return;
    }
    const root = sectionRef.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-np-block-row]"));
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
    const focusedRow = document.activeElement?.closest<HTMLElement>("[data-np-block-row]");
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

  // WRAP_MANY contract preview (#467 #3). Bulk-wrap requires all
  // selected ids to be contiguous siblings of one parent — same
  // gate the reducer enforces. Computing it once here lets the
  // toolbar disable the wrap button up front instead of failing
  // silently on dispatch.
  const wrapEligible = useMemo(() => {
    if (selectedIds.size < 2) return false;
    const ids = Array.from(selectedIds);
    const locs = ids.map((id) => locateBlock(blocks, id));
    if (locs.some((l) => l === null)) return false;
    const parentId = locs[0]!.parentId;
    if (locs.some((l) => l!.parentId !== parentId)) return false;
    const indices = locs.map((l) => l!.index).sort((a, b) => a - b);
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) return false;
    }
    return true;
  }, [blocks, selectedIds]);

  // Container types available for bulk-wrap. Filter to definitions
  // that accept children — the wrap reducer would reject leafs.
  const containerDefinitions = useMemo(
    () => availableBlocks.filter((def) => def.acceptsChildren),
    [availableBlocks],
  );
  const [wrapPickerOpen, setWrapPickerOpen] = useState(false);
  const wrapPickerRef = useRef<HTMLDivElement | null>(null);
  // Auto-close when the selection stops being wrap-eligible. The
  // render-time guard `{wrapPickerOpen && wrapEligible}` already
  // hides the popup visually, but without resetting state the
  // popup would re-appear on its own the moment eligibility came
  // back — without the operator clicking. Pin the state to the
  // gate so "open" only ever means "currently visible".
  useEffect(() => {
    if (!wrapEligible && wrapPickerOpen) setWrapPickerOpen(false);
  }, [wrapEligible, wrapPickerOpen]);
  // Outside-click dismiss. The ref wraps both the trigger button
  // and the popup, so clicks on either count as "inside" and
  // don't fire the close. `pointerdown` (not `click`) so we beat
  // any inner button's `onClick` that might unmount its own DOM.
  useEffect(() => {
    if (!wrapPickerOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (wrapPickerRef.current?.contains(target)) return;
      setWrapPickerOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [wrapPickerOpen]);

  return (
    <section
      ref={sectionRef}
      className={cn("np-block-page-editor flex min-w-0 flex-col gap-4")}
      onKeyDown={handleKeyboardNav}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <ModeSwitch view={view} onViewChange={setView} scope={viewScope} />
        <div className="grid min-w-0 w-full grid-cols-1 gap-1 min-[360px]:grid-cols-3 sm:flex sm:w-auto sm:items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full sm:w-auto"
            aria-label="Open pattern library (Cmd-Shift-P)"
            title="Pattern library (⌘⇧P)"
            onClick={() => setPatternLibraryOpen(true)}
          >
            <LayoutGrid className="mr-1.5 h-4 w-4" />
            Patterns
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full sm:w-auto"
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
            className="w-full sm:w-auto"
            aria-label="Redo"
            onClick={redo}
            disabled={!canRedo}
          >
            <Redo2 className="mr-1.5 h-4 w-4" />
            Redo
          </Button>
        </div>
      </div>
      {/* Bulk-action toolbar (#467 #3). Sticks above the row list
          while a multi-selection is live. Wrap is gated by
          contiguous-siblings; delete/duplicate work on any non-
          empty selection. */}
      {selectedIds.size >= 1 ? (
        <div
          className="sticky top-0 z-20 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 backdrop-blur"
          role="region"
          aria-label="Bulk block actions"
        >
          <span className="text-xs font-medium text-primary">{selectedIds.size} selected</span>
          <div className="grid min-w-0 w-full grid-cols-1 gap-1 min-[360px]:grid-cols-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
            <div className="relative" ref={wrapPickerRef}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                disabled={!wrapEligible}
                onClick={() => setWrapPickerOpen((v) => !v)}
                title={
                  wrapEligible
                    ? "Wrap selected blocks in a container"
                    : "Selected blocks must be contiguous siblings of one parent"
                }
              >
                <Group className="mr-1.5 h-3.5 w-3.5" />
                Wrap in…
              </Button>
              {wrapPickerOpen && wrapEligible ? (
                <div
                  className="absolute left-0 top-full z-30 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-md border border-border/60 bg-popover p-1 shadow-md sm:left-auto sm:right-0"
                  role="menu"
                >
                  {containerDefinitions.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      No container blocks registered.
                    </p>
                  ) : (
                    containerDefinitions.map((def) => (
                      <button
                        key={def.type}
                        type="button"
                        role="menuitem"
                        className="flex min-w-0 w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          dispatch({
                            type: "WRAP_MANY",
                            ids: Array.from(selectedIds),
                            containerType: def.type,
                          });
                          setWrapPickerOpen(false);
                          // Clear the multi-select after wrap so
                          // the operator sees the freshly-created
                          // container rather than a now-stale set.
                          clearSelection();
                        }}
                      >
                        <span className="min-w-0 truncate">{def.label}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {def.type}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => {
                dispatch({
                  type: "DUPLICATE_MANY",
                  ids: Array.from(selectedIds),
                });
                clearSelection();
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Duplicate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-destructive hover:text-destructive sm:w-auto"
              onClick={() => {
                const confirmed = window.confirm(
                  `Delete ${selectedIds.size} selected block${
                    selectedIds.size === 1 ? "" : "s"
                  }? This can be undone with Cmd-Z.`,
                );
                if (!confirmed) return;
                dispatch({
                  type: "DELETE_MANY",
                  ids: Array.from(selectedIds),
                });
                clearSelection();
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto"
              onClick={clearSelection}
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
      {view === "doc" ? (
        <DocCanvas
          blocks={blocks}
          definitions={definitions}
          availableBlocks={availableBlocks}
          dispatch={dispatch}
          selectedBlockId={selectedBlockId}
          onSelectBlock={setSelectedBlockId}
        />
      ) : null}
      {view === "page" ? (
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
            <div className="flex min-w-0 flex-col gap-3">
              {blocks.map((block, index) => {
                const blockDefinition = definitions.get(block.type);
                const blockLabel = blockDefinition?.label ?? block.type;
                return (
                  <Fragment key={block.id}>
                    {index === 0 ? (
                      <InsertSlot
                        availableBlocks={availableBlocks}
                        onInsert={(blockType) => onInsert("before", block.id, blockType)}
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
                      onUpdateProps={(id, props) => dispatch({ type: "UPDATE_PROPS", id, props })}
                      onReplaceProps={(id, props) => dispatch({ type: "REPLACE_PROPS", id, props })}
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
                      isOpen={isRowOpen}
                      onOpenChange={setRowOpen}
                      isSelected={isSelected}
                      onToggleSelected={toggleSelected}
                    />
                    <InsertSlot
                      availableBlocks={availableBlocks}
                      onInsert={(blockType) => onInsert("after", block.id, blockType)}
                      ariaLabel={`Insert block after ${blockLabel}`}
                    />
                  </Fragment>
                );
              })}
              {blocks.length === 0 ? (
                <div className="min-w-0 rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center sm:px-6 sm:py-10">
                  <p className="mb-4 text-sm text-muted-foreground">
                    No blocks yet. Pick one to start building the page.
                  </p>
                  {/* Recommended starters (#467 quick-wins). The
                    preference list is the typical "above the fold"
                    set — operators almost always lead with a
                    hero/heading and a paragraph or grid. We show
                    only blocks the host actually registered so a
                    plugin-light setup doesn't see broken buttons. */}
                  <div className="mx-auto grid min-w-0 w-full max-w-sm grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:max-w-none sm:flex-wrap sm:justify-center">
                    {(() => {
                      const preferred = ["hero", "heading", "text", "grid", "cta"];
                      const pickList: NpBlockMetadata[] = [];
                      for (const type of preferred) {
                        const def = definitions.get(type);
                        if (def) pickList.push(def);
                        if (pickList.length >= 4) break;
                      }
                      if (pickList.length < 4) {
                        for (const def of availableBlocks) {
                          if (pickList.includes(def)) continue;
                          if (def.acceptsChildren) continue;
                          pickList.push(def);
                          if (pickList.length >= 4) break;
                        }
                      }
                      return pickList.map((def) => (
                        <Button
                          key={def.type}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full sm:w-auto"
                          onClick={() => dispatch({ type: "ADD", blockType: def.type })}
                        >
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          {def.label}
                        </Button>
                      ));
                    })()}
                  </div>
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
      ) : null}

      {view === "page" ? (
        <div className="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:items-center sm:justify-center">
          <BlockPalette
            availableBlocks={availableBlocks}
            onAdd={(type) => dispatch({ type: "ADD", blockType: type })}
            trigger={
              <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto">
                <Plus className="mr-1.5 h-4 w-4" />
                Add block
              </Button>
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => setPageJsonOpen(true)}
          >
            <Braces className="mr-1.5 h-4 w-4" />
            Edit JSON
          </Button>
        </div>
      ) : null}

      <StatusBar
        totalBlocks={totalBlocks}
        // Doc view → words / blocks / reading time (matches the
        // design's `be-statusbar` Doc layout).
        // Page view → blocks total / in registry / warnings.
        // The status bar drops segments whose props aren't passed,
        // so toggling view rotates the surfaced stats without a
        // separate component per mode.
        wordCount={view === "doc" ? docWordCount : undefined}
        readingMinutes={view === "doc" ? docReadingMinutes : undefined}
        registrySize={view === "page" ? availableBlocks.length : undefined}
        warningsCount={view === "page" ? containerWarnings.length : undefined}
        activeMeta={activeBlockMeta}
        activeType={activeBlockType}
        savedLabel={autosave.savedLabel}
        status={autosave.status}
      />

      {/* Outline + container warnings live in the host's
              sidebar via a portal so the canvas above keeps full
              width. CollectionEditView mounts the matching
              `<div id="np-block-editor-aside" />`; if no host has
              mounted the target, EditorAsidePortal renders nothing
              (a console warning fires in dev). */}
      <EditorAsidePortal targetId={asideMountId}>
        <div className="flex min-w-0 flex-col gap-4">
          <OutlinePanel
            blocks={blocks}
            definitions={definitions}
            activeId={selectedBlockId}
            onPick={focusBlockRow}
            title="Page tree"
            footer="page.blocks · NpBlockInstance[] · live"
          />
          <ContainerWarningsPanel warnings={containerWarnings} onPick={focusBlockRow} />
        </div>
      </EditorAsidePortal>

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
        onOpenPasteImport={() => setPasteImportOpen(true)}
        patterns={patterns}
        onSaveFocusedAsPattern={handleSaveFocusedAsPattern}
        onDeletePattern={(id) => void handleDeletePattern(id)}
      />

      <PastePatternDialog
        open={pasteImportOpen}
        onOpenChange={setPasteImportOpen}
        knownTypes={availableBlocks.map((b) => b.type)}
        onApply={(pattern) => dispatch({ type: "INSERT_PATTERN", pattern })}
      />

      <PatternLibraryDialog
        open={patternLibraryOpen}
        onOpenChange={setPatternLibraryOpen}
        patterns={patterns}
        onInsert={(pattern) => dispatch({ type: "INSERT_PATTERN", pattern })}
      />
    </section>
  );
}
