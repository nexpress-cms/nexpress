"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import {
  collectContainerCandidates,
  findBlockInTreeFlat,
  locateBlock,
  type EditorAction,
} from "../editor-engine/index.js";
import type { NpPattern } from "../patterns.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { Input } from "../../ui/input.js";
import { cn } from "../../ui/utils.js";
import { PatternPreview } from "./pattern-preview.js";

/**
 * Cmd-K command palette for the page-builder. Built on the
 * existing Dialog primitive (no cmdk dep) — the action set is
 * small and the matching is just substring filter, so a custom
 * implementation keeps the bundle lean.
 *
 * Context-sensitive: when a row is focused at the moment the
 * menu opens, block-scoped actions (move, duplicate, delete,
 * hierarchy moves, save-as-pattern) target it; otherwise only
 * page-level + add-block + insert-pattern actions show.
 */

interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  // Group label for the section header — actions with the same
  // group render together with the group as the header.
  group: "Block" | "Pattern" | "Page" | "Add";
  /** Phase F.5.1 — optional sub-group (e.g. pattern category)
   *  rendered as a secondary header within the parent group.
   *  Patterns use this to show "Homepage" / "Section" / etc.
   *  bands inside the Pattern group. Other groups ignore it. */
  subgroup?: string;
  /** Phase F.5.1 — optional preview image URL. The picker
   *  renders a small thumbnail to the left of the label when
   *  present. Theme/plugin-shipped patterns supply this; built-
   *  in / custom patterns omit and render text-only. */
  preview?: string;
  run: () => void;
}

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableBlocks: NpBlockMetadata[];
  readFocusedBlockId: () => string | null;
  blocks: NpBlockInstance[];
  definitions: Map<string, NpBlockMetadata>;
  dispatch: (action: EditorAction) => void;
  onOpenPageJson: () => void;
  /**
   * Opens the paste-import dialog. Wired through the page editor
   * so the dialog state (and the resulting `INSERT_PATTERN`
   * dispatch) lives next to the rest of the editor's UI state.
   */
  onOpenPasteImport: () => void;
  patterns: NpPattern[];
  onSaveFocusedAsPattern: (focusedBlockId: string) => void;
  onDeletePattern: (patternId: string) => void;
}

function filterCommandActions(actions: CommandAction[], query: string): CommandAction[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return actions;
  return actions.filter((a) => {
    const haystack = `${a.label} ${a.hint ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}

interface CommandSubgroup {
  /** Sub-header label, or null for actions without a subgroup
   *  (rendered as the first un-headered band). */
  subgroup: string | null;
  items: CommandAction[];
}

interface CommandGroup {
  group: CommandAction["group"];
  subgroups: CommandSubgroup[];
}

function groupCommandActions(actions: CommandAction[]): CommandGroup[] {
  const order: CommandAction["group"][] = ["Block", "Pattern", "Add", "Page"];
  const buckets = new Map<CommandAction["group"], CommandAction[]>();
  for (const a of actions) {
    const list = buckets.get(a.group) ?? [];
    list.push(a);
    buckets.set(a.group, list);
  }
  return order
    .filter((g) => (buckets.get(g)?.length ?? 0) > 0)
    .map((g) => ({
      group: g,
      subgroups: bucketBySubgroup(buckets.get(g) ?? []),
    }));
}

/**
 * Phase F.5.1 — within a group, bucket actions by `subgroup`
 * key. Items without a subgroup go into the first
 * (un-headered) band so the existing flat-list UX still
 * works for groups that don't carry categories.
 */
function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function bucketBySubgroup(items: CommandAction[]): CommandSubgroup[] {
  const order: string[] = [];
  const byKey = new Map<string | null, CommandAction[]>();
  for (const item of items) {
    const key = item.subgroup ?? null;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key === null ? "" : key);
    }
    byKey.get(key)!.push(item);
  }
  // Render un-headered band first; named subgroups follow in
  // declaration order. Doesn't sort alphabetically — operator
  // sees patterns in the registration order their themes /
  // plugins specified.
  const out: CommandSubgroup[] = [];
  if (byKey.has(null)) {
    out.push({ subgroup: null, items: byKey.get(null)! });
  }
  for (const k of order) {
    if (k === "") continue;
    out.push({ subgroup: k, items: byKey.get(k)! });
  }
  return out;
}

export function CommandMenu({
  open,
  onOpenChange,
  availableBlocks,
  readFocusedBlockId,
  blocks,
  definitions,
  dispatch,
  onOpenPageJson,
  onOpenPasteImport,
  patterns,
  onSaveFocusedAsPattern,
  onDeletePattern,
}: CommandMenuProps) {
  const [query, setQuery] = useState("");
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Resolve the focused row exactly once per open — not on every
  // keystroke. The DOM walk + closest() lookup is cheap, but
  // freezing it gives a stable "context block" so the menu's
  // labels don't flicker if focus shifts mid-typing.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      setQuery("");
      setFocusedBlockId(readFocusedBlockId());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, readFocusedBlockId]);

  // Dialog content auto-focuses its first focusable child, which
  // is the input — but on Radix the autofocus timing can lose to
  // the open animation. A microtask kick keeps it reliable.
  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  const focusedBlock = focusedBlockId ? findBlockInTreeFlat(blocks, focusedBlockId) : null;
  const focusedDefinition = focusedBlock ? definitions.get(focusedBlock.type) : null;
  const focusedLabel = focusedDefinition?.label ?? focusedBlock?.type ?? null;

  const actions: CommandAction[] = [];

  if (focusedBlock && focusedBlockId) {
    const id = focusedBlockId;
    actions.push(
      {
        id: "block.move-up",
        label: `Move ${focusedLabel} up`,
        group: "Block",
        run: () => dispatch({ type: "MOVE_UP", id }),
      },
      {
        id: "block.move-down",
        label: `Move ${focusedLabel} down`,
        group: "Block",
        run: () => dispatch({ type: "MOVE_DOWN", id }),
      },
      {
        id: "block.duplicate",
        label: `Duplicate ${focusedLabel}`,
        group: "Block",
        run: () => dispatch({ type: "DUPLICATE", id }),
      },
      {
        id: "block.delete",
        label: `Delete ${focusedLabel}`,
        hint: "destructive",
        group: "Block",
        run: () => dispatch({ type: "DELETE", id }),
      },
    );

    // Hierarchy moves. MOVE_OUT only shows when the block has a
    // grandparent; MOVE_INTO appears once per candidate container
    // so operators can pick a target without a separate target-
    // picker UI.
    const focusedLoc = locateBlock(blocks, id);
    if (focusedLoc && focusedLoc.parentId !== null) {
      actions.push({
        id: "block.move-out",
        label: `Move ${focusedLabel} out of parent`,
        group: "Block",
        run: () => dispatch({ type: "MOVE_OUT", id }),
      });
    }
    for (const candidate of collectContainerCandidates(blocks, id, definitions)) {
      actions.push({
        id: `block.move-into.${candidate.id}`,
        label: `Move ${focusedLabel} into ${candidate.label}`,
        hint: candidate.id.slice(0, 8),
        group: "Block",
        run: () => dispatch({ type: "MOVE_INTO", id, targetParentId: candidate.id }),
      });
    }
    for (const def of availableBlocks) {
      if (!def.acceptsChildren) continue;
      // Skip wrapping a container in itself — wrap is intended to
      // introduce structure around a leaf, not nest containers.
      if (def.type === focusedBlock.type) continue;
      actions.push({
        id: `block.wrap-in.${def.type}`,
        label: `Wrap ${focusedLabel} in ${def.label}`,
        group: "Block",
        run: () => dispatch({ type: "WRAP_IN", id, containerType: def.type }),
      });
    }
  }

  for (const def of availableBlocks) {
    actions.push({
      id: `add.${def.type}`,
      label: `Add block: ${def.label}`,
      hint: def.type,
      group: "Add",
      run: () => dispatch({ type: "ADD", blockType: def.type }),
    });
  }

  // Patterns. Built-ins ship with the editor; custom patterns
  // come from server (when available) and localStorage; plugins /
  // themes contribute via the bootstrap registry. All surface
  // under the same Pattern group with a source hint so the
  // operator can tell at a glance where each pattern came from.
  // Delete actions appear only for custom patterns — built-ins
  // and plugin/theme patterns are immutable from the operator's
  // side.
  for (const pattern of patterns) {
    const sourceHint =
      pattern.source === "custom"
        ? "saved"
        : pattern.source === "plugin"
          ? "plugin"
          : pattern.source === "theme"
            ? "theme"
            : pattern.source.startsWith("theme:")
              ? "theme"
              : pattern.source.startsWith("plugin:")
                ? "plugin"
                : pattern.id;
    actions.push({
      id: `pattern.insert.${pattern.id}`,
      label: `Insert pattern: ${pattern.label}`,
      hint: sourceHint,
      group: "Pattern",
      // Phase F.5.1 — pattern's `category` (homepage / page /
      // section / ...) renders as a sub-header inside the
      // Pattern group; `preview` shows a thumbnail next to the
      // action label.
      subgroup: pattern.category,
      preview: pattern.preview,
      run: () => dispatch({ type: "INSERT_PATTERN", pattern }),
    });
  }
  for (const pattern of patterns) {
    if (pattern.source !== "custom") continue;
    actions.push({
      id: `pattern.delete.${pattern.id}`,
      label: `Delete pattern: ${pattern.label}`,
      hint: "destructive",
      group: "Pattern",
      run: () => {
        const confirmed = window.confirm(
          `Delete the saved pattern "${pattern.label}"? This can't be undone.`,
        );
        if (confirmed) onDeletePattern(pattern.id);
      },
    });
  }
  if (focusedBlock && focusedBlockId) {
    actions.push({
      id: "pattern.save-focused",
      label: `Save ${focusedLabel ?? "block"} as pattern`,
      group: "Pattern",
      run: () => onSaveFocusedAsPattern(focusedBlockId),
    });
  }
  actions.push({
    id: "pattern.paste-import",
    label: "Paste blocks from JSON",
    hint: "import",
    group: "Pattern",
    run: onOpenPasteImport,
  });

  actions.push({
    id: "page.edit-json",
    label: "Edit page JSON",
    group: "Page",
    run: onOpenPageJson,
  });

  const filtered = filterCommandActions(actions, query);
  const groups = groupCommandActions(filtered);

  function runAction(action: CommandAction) {
    action.run();
    onOpenChange(false);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && filtered.length > 0) {
      event.preventDefault();
      runAction(filtered[0]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid min-w-0 max-h-[calc(100dvh-2rem)] max-w-lg grid-rows-[auto_auto_minmax(0,1fr)] gap-2 overflow-hidden p-0">
        <DialogHeader className="min-w-0 border-b border-border/60 px-3 py-2">
          <DialogTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Page-builder commands
          </DialogTitle>
          <DialogDescription className="sr-only">
            Run a context-sensitive page-builder action by typing a name.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 px-3 pt-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={
              focusedLabel ? `Run a command for ${focusedLabel}…` : "Type to filter commands…"
            }
            aria-label="Filter commands"
          />
        </div>
        <div className="min-h-0 min-w-0 overflow-y-auto px-1 pb-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No matching commands.
            </p>
          ) : (
            groups.map(({ group, subgroups }) => (
              <div key={group} className="min-w-0 px-2 pt-2">
                <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                {subgroups.map((sub, i) => (
                  <div key={sub.subgroup ?? `__default-${i.toString()}`} className="min-w-0">
                    {sub.subgroup ? (
                      <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/80">
                        {capitalize(sub.subgroup)}
                      </div>
                    ) : null}
                    <ul className="min-w-0 space-y-0.5">
                      {sub.items.map((action) => (
                        <li key={action.id} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => runAction(action)}
                            className={cn(
                              "flex min-h-10 min-w-0 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm sm:min-h-0 sm:py-1.5",
                              "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                              action.hint === "destructive" && "text-destructive",
                            )}
                          >
                            {action.preview ? (
                              <PatternPreview src={action.preview} alt="" size="thumb" />
                            ) : null}
                            <span className="min-w-0 flex-1 truncate">{action.label}</span>
                            {action.hint && action.hint !== "destructive" ? (
                              <span className="ml-2 max-w-[8rem] truncate font-mono text-[10px] text-muted-foreground">
                                {action.hint}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
