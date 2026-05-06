"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  MoreHorizontal,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { Label } from "../ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { cn } from "../ui/utils.js";

import { BlockPalette } from "./block-palette.js";
import {
  canAcceptChild,
  collectContainerCandidates,
  deleteNeedsConfirmation,
  findBlockInTreeFlat,
  getFieldValue,
  getRowSummary,
  groupVisibleFields,
  lintFieldValue,
  locateBlock,
  useEditorState,
  type ContainerCandidate,
} from "./editor-engine/index.js";
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
} from "./patterns.js";
import { PreviewPanel } from "./preview-panel.js";
import {
  BlockJsonDialog,
  CommandMenu,
  DeleteBlockDialog,
  FieldControl,
  PageJsonDialog,
} from "./shared/index.js";

// Lexical editor — same lazy pattern the collection field-renderer
// uses (#XXX). Loads only when an `image` / `richtext` block prop
// actually mounts so pages without rich-text blocks don't pay for
// Lexical's bundle.


interface BlockPageEditorProps {
  blocks: NpBlockInstance[];
  onChange: (blocks: NpBlockInstance[]) => void;
  availableBlocks: NpBlockMetadata[];
}




interface InsertSlotProps {
  availableBlocks: NpBlockMetadata[];
  onInsert: (blockType: string) => void;
  ariaLabel?: string;
}

// Thin gap between rows that surfaces a "+" button on hover/focus.
// The button opens the standard BlockPalette popover; picking a
// block type fires `onInsert(type)` so the parent can dispatch the
// right INSERT_BEFORE / INSERT_AFTER action with the right target.
function InsertSlot({ availableBlocks, onInsert, ariaLabel }: InsertSlotProps) {
  return (
    <div className="group/slot relative -my-1 flex h-3 items-center justify-center">
      <BlockPalette
        availableBlocks={availableBlocks}
        onAdd={onInsert}
        trigger={
          <button
            type="button"
            aria-label={ariaLabel ?? "Insert block here"}
            className="invisible inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground shadow-sm transition hover:border-primary/60 hover:text-primary group-hover/slot:visible focus-visible:visible data-[state=open]:visible"
          >
            <Plus className="h-3 w-3" />
          </button>
        }
      />
    </div>
  );
}

interface SortableBlockItemProps {
  block: NpBlockInstance;
  definition?: NpBlockMetadata;
  parentBlock?: NpBlockInstance;
  parentDefinition?: NpBlockMetadata;
  availableBlocks: NpBlockMetadata[];
  definitions: Map<string, NpBlockMetadata>;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateProps: (id: string, props: Record<string, unknown>) => void;
  onReplaceProps: (id: string, props: Record<string, unknown>) => void;
  onAddChild: (parentId: string, blockType: string) => void;
  onInsert: (
    position: "before" | "after",
    targetId: string,
    blockType: string,
  ) => void;
  // Hierarchy moves (#467 follow-up): make MOVE_INTO / MOVE_OUT /
  // WRAP_IN reachable from the row's header dropdown so mouse
  // operators don't have to know the Cmd-K command names.
  onMoveOut: (id: string) => void;
  onMoveInto: (id: string, targetParentId: string) => void;
  onWrapIn: (id: string, containerType: string) => void;
  // Lazy candidate resolution — the dropdown calls this on open
  // so we don't pay the tree-walk cost on every render.
  getMoveIntoCandidates: (id: string) => ContainerCandidate[];
}

function SortableBlockItem({
  block,
  definition,
  parentBlock,
  parentDefinition,
  availableBlocks,
  definitions,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onUpdateProps,
  onReplaceProps,
  onAddChild,
  onInsert,
  onMoveOut,
  onMoveInto,
  onWrapIn,
  getMoveIntoCandidates,
}: SortableBlockItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const [open, setOpen] = useState(true);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const fieldIdPrefix = `np-block-${block.id}`;
  const isContainer = Boolean(definition?.acceptsChildren);
  const isChildOfGrid = parentBlock?.type === "grid";
  const summary = getRowSummary(definition, block);
  const childCount = block.children?.length ?? 0;

  const handleDelete = () => {
    if (deleteNeedsConfirmation(definition, block)) {
      setDeleteOpen(true);
      return;
    }
    onDelete(block.id);
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      // Roving keyboard nav (#467) — every row is focusable as a
      // single tab stop. ArrowUp/Down moves between rows in DOM
      // order (the editor-level keydown handler does the work via
      // `[data-np-block-row]` query). `focus-within` highlights the
      // active subtree on container blocks so operators can tell
      // which level they're navigating.
      tabIndex={0}
      data-np-block-row={block.id}
      aria-label={`Block row: ${definition?.label ?? block.type}`}
      className={cn(
        "overflow-hidden border-border/60 outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary/40",
        isContainer && "focus-within:ring-2 focus-within:ring-primary/30",
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <header className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
          <button
            type="button"
            aria-label={`Drag ${definition?.label ?? block.type}`}
            {...attributes}
            {...listeners}
            className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={open ? "Collapse block" : "Expand block"}
            >
              {open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </CollapsibleTrigger>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {definition?.label ?? block.type}
              {isContainer ? (
                <span className="ml-2 inline-flex items-center rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                  container
                </span>
              ) : null}
              {summary ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  — {summary}
                </span>
              ) : null}
            </div>
            <div className="truncate font-mono text-xs text-muted-foreground">
              {block.type}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Move up"
              onClick={() => onMoveUp(block.id)}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Move down"
              onClick={() => onMoveDown(block.id)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Duplicate"
              onClick={() => onDuplicate(block.id)}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Edit as JSON"
              onClick={() => setJsonOpen(true)}
            >
              <Braces className="h-4 w-4" />
            </Button>
            <HierarchyMenu
              block={block}
              parentBlock={parentBlock}
              availableBlocks={availableBlocks}
              onMoveOut={onMoveOut}
              onMoveInto={onMoveInto}
              onWrapIn={onWrapIn}
              getMoveIntoCandidates={getMoveIntoCandidates}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Delete"
              onClick={handleDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <BlockJsonDialog
          open={jsonOpen}
          onOpenChange={setJsonOpen}
          blockType={block.type}
          props={block.props}
          propsSchema={definition?.propsSchema}
          onApply={(nextProps) => onReplaceProps(block.id, nextProps)}
        />
        <DeleteBlockDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          label={definition?.label ?? block.type}
          summary={summary}
          childCount={childCount}
          onConfirm={() => {
            setDeleteOpen(false);
            onDelete(block.id);
          }}
        />
        <CollapsibleContent>
          <div className="grid gap-4 p-4">
            {/* Grid-child layout control. Only shown when this
                block sits directly inside a `grid` container — the
                meta lives on the child's props as `_layout: { colSpan }`. */}
            {isChildOfGrid && parentDefinition ? (
              <GridChildLayoutControl
                block={block}
                inputId={`${fieldIdPrefix}-_layout-colSpan`}
                onChange={(colSpan) =>
                  onUpdateProps(block.id, {
                    _layout: { ...(getLayout(block.props) ?? {}), colSpan },
                  })
                }
              />
            ) : null}

            {definition ? (
              definition.propsSchema.length === 0 && !isContainer ? (
                <p className="text-xs text-muted-foreground">
                  This block has no editable props.
                </p>
              ) : (
                groupVisibleFields(definition.propsSchema, block.props).map(
                  (section) => (
                    <div
                      key={section.group ?? "__ungrouped__"}
                      className={cn(
                        section.group
                          ? "rounded-md border border-border/50 bg-muted/20 p-3"
                          : "contents",
                      )}
                    >
                      {section.group ? (
                        <div className="pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {section.group}
                        </div>
                      ) : null}
                      <div className="grid gap-4">
                        {section.fields.map((field) => {
                          // Required-missing checks the RAW prop, not the
                          // value-with-defaults (#467 post-review). For a
                          // number field with no default, getFieldValue
                          // returns `0` so a post-default check would never
                          // flag it as missing — looking at `block.props`
                          // directly recovers the "operator hasn't supplied
                          // a value yet" semantics.
                          const rawValue = block.props[field.name];
                          const value = getFieldValue(field, rawValue);
                          const inputId = `${fieldIdPrefix}-${field.name}`;
                          const isRequiredMissing =
                            field.required === true &&
                            (rawValue === undefined ||
                              rawValue === "" ||
                              rawValue === null);
                          const lintMessage = lintFieldValue(field, value);
                          return (
                            <div key={field.name} className="grid gap-1.5">
                              {field.type !== "boolean" ? (
                                <Label
                                  htmlFor={inputId}
                                  className="flex items-center gap-1"
                                >
                                  <span>{field.label}</span>
                                  {field.required ? (
                                    <span
                                      aria-label="required"
                                      className="text-rose-500"
                                    >
                                      *
                                    </span>
                                  ) : null}
                                </Label>
                              ) : null}
                              <FieldControl
                                field={field}
                                value={value}
                                onChange={(next) =>
                                  onUpdateProps(block.id, { [field.name]: next })
                                }
                                inputId={inputId}
                              />
                              {field.description ? (
                                <p className="text-xs text-muted-foreground">
                                  {field.description}
                                </p>
                              ) : null}
                              {isRequiredMissing ? (
                                <p className="text-xs text-rose-600 dark:text-rose-300">
                                  {field.label} is required.
                                </p>
                              ) : null}
                              {!isRequiredMissing && lintMessage ? (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                  {lintMessage}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ),
                )
              )
            ) : (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Unknown block type: <span className="font-mono">{block.type}</span>
              </div>
            )}

            {/* Children area for container blocks. Each container
                hosts its own SortableContext so children can be
                reordered within the container; cross-container
                drag is intentionally not supported in v1. */}
            {isContainer ? (
              <ChildrenArea
                container={block}
                availableBlocks={availableBlocks}
                definitions={definitions}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onUpdateProps={onUpdateProps}
                onReplaceProps={onReplaceProps}
                onAddChild={onAddChild}
                onInsert={onInsert}
                onMoveOut={onMoveOut}
                onMoveInto={onMoveInto}
                onWrapIn={onWrapIn}
                getMoveIntoCandidates={getMoveIntoCandidates}
              />
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

interface HierarchyMenuProps {
  block: NpBlockInstance;
  parentBlock?: NpBlockInstance;
  availableBlocks: NpBlockMetadata[];
  onMoveOut: (id: string) => void;
  onMoveInto: (id: string, targetParentId: string) => void;
  onWrapIn: (id: string, containerType: string) => void;
  getMoveIntoCandidates: (id: string) => ContainerCandidate[];
}

// Row-header dropdown for cross-hierarchy moves (#467 follow-up).
// Mirrors the Cmd-K commands so mouse operators don't need to
// know the keyboard shortcut. Move-into candidates are resolved
// lazily on dropdown open via `getMoveIntoCandidates(id)` so we
// don't pay the tree-walk cost on every render.
function HierarchyMenu({
  block,
  parentBlock,
  availableBlocks,
  onMoveOut,
  onMoveInto,
  onWrapIn,
  getMoveIntoCandidates,
}: HierarchyMenuProps) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<ContainerCandidate[]>([]);

  useEffect(() => {
    if (open) setCandidates(getMoveIntoCandidates(block.id));
  }, [open, block.id, getMoveIntoCandidates]);

  // Wrap-in targets — every container block except the source's
  // own type. We compute this every render because availableBlocks
  // is small + `acceptsChildren` is a flat field on the metadata
  // (no tree walk).
  const wrapTargets = availableBlocks.filter(
    (def) => def.acceptsChildren && def.type !== block.type,
  );
  const canMoveOut = parentBlock !== undefined;

  // Hide the dropdown entirely when there are no actions to
  // surface — keeps the row header tidy on a top-level leaf
  // block with no other containers in the page.
  const hasActions = canMoveOut || candidates.length > 0 || wrapTargets.length > 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="More actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {!hasActions ? (
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            No hierarchy moves available
          </DropdownMenuLabel>
        ) : null}
        {canMoveOut ? (
          <DropdownMenuItem onSelect={() => onMoveOut(block.id)}>
            Move out of {parentBlock?.type ?? "parent"}
          </DropdownMenuItem>
        ) : null}
        {candidates.length > 0 ? (
          <>
            {canMoveOut ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Move into
            </DropdownMenuLabel>
            {candidates.map((c) => (
              <DropdownMenuItem
                key={`into-${c.id}`}
                onSelect={() => onMoveInto(block.id, c.id)}
              >
                {c.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {wrapTargets.length > 0 ? (
          <>
            {canMoveOut || candidates.length > 0 ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Wrap in
            </DropdownMenuLabel>
            {wrapTargets.map((def) => (
              <DropdownMenuItem
                key={`wrap-${def.type}`}
                onSelect={() => onWrapIn(block.id, def.type)}
              >
                {def.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getLayout(props: Record<string, unknown>): Record<string, unknown> | null {
  const layout = props._layout;
  if (typeof layout === "object" && layout !== null && !Array.isArray(layout)) {
    return layout as Record<string, unknown>;
  }
  return null;
}

interface GridChildLayoutControlProps {
  block: NpBlockInstance;
  inputId: string;
  onChange: (colSpan: number) => void;
}

function GridChildLayoutControl({
  block,
  inputId,
  onChange,
}: GridChildLayoutControlProps) {
  const layout = getLayout(block.props);
  const current =
    typeof layout?.colSpan === "number" && layout.colSpan >= 1 && layout.colSpan <= 12
      ? layout.colSpan
      : 12;
  return (
    <div className="grid gap-1.5 rounded-md border border-primary/20 bg-primary/5 p-3">
      <Label htmlFor={inputId} className="text-xs uppercase tracking-[0.18em] text-primary">
        Grid column span
      </Label>
      <div className="flex items-center gap-3">
        <Select
          value={String(current)}
          onValueChange={(v) => onChange(Number(v))}
        >
          <SelectTrigger id={inputId} className="h-9 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">of 12 columns</span>
      </div>
    </div>
  );
}

interface ChildrenAreaProps {
  container: NpBlockInstance;
  availableBlocks: NpBlockMetadata[];
  definitions: Map<string, NpBlockMetadata>;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateProps: (id: string, props: Record<string, unknown>) => void;
  onReplaceProps: (id: string, props: Record<string, unknown>) => void;
  onAddChild: (parentId: string, blockType: string) => void;
  onInsert: (
    position: "before" | "after",
    targetId: string,
    blockType: string,
  ) => void;
  onMoveOut: (id: string) => void;
  onMoveInto: (id: string, targetParentId: string) => void;
  onWrapIn: (id: string, containerType: string) => void;
  getMoveIntoCandidates: (id: string) => ContainerCandidate[];
}

function ChildrenArea({
  container,
  availableBlocks,
  definitions,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onUpdateProps,
  onReplaceProps,
  onAddChild,
  onInsert,
  onMoveOut,
  onMoveInto,
  onWrapIn,
  getMoveIntoCandidates,
}: ChildrenAreaProps) {
  const children = container.children ?? [];
  const containerDefinition = definitions.get(container.type);
  // Container contracts (#467 phase 4) — filter the Add-block
  // popover to types this container actually accepts, hide the
  // Add UI when at `maxChildren`, and surface min/max status.
  const allowedChildBlocks = containerDefinition
    ? availableBlocks.filter((def) =>
        canAcceptChild(containerDefinition, def.type, children.length),
      )
    : availableBlocks;
  const max = containerDefinition?.maxChildren;
  const min = containerDefinition?.minChildren;
  const atMax = typeof max === "number" && children.length >= max;
  const belowMin = typeof min === "number" && children.length < min;
  return (
    <div className="grid gap-2 rounded-md border border-dashed border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Children ({children.length}
          {typeof max === "number" ? ` / ${max}` : ""})
        </p>
        {atMax ? (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Max reached
          </span>
        ) : (
          <BlockPalette
            availableBlocks={allowedChildBlocks}
            onAdd={(type) => onAddChild(container.id, type)}
            trigger={
              <Button type="button" variant="outline" size="sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add child
              </Button>
            }
          />
        )}
      </div>
      {belowMin ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          This container expects at least {min} child
          {min === 1 ? "" : "ren"}. Currently {children.length}.
        </p>
      ) : null}
      <SortableContext
        items={children.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="grid gap-2">
          {children.length === 0 ? (
            <p className="rounded-md bg-background/50 px-3 py-4 text-center text-xs text-muted-foreground">
              No children yet. Add one to start.
            </p>
          ) : (
            children.map((child, index) => {
              const childDefinition = definitions.get(child.type);
              const childLabel = childDefinition?.label ?? child.type;
              return (
                <Fragment key={child.id}>
                  {index === 0 ? (
                    <InsertSlot
                      availableBlocks={availableBlocks}
                      onInsert={(blockType) => onInsert("before", child.id, blockType)}
                      ariaLabel={`Insert block before ${childLabel}`}
                    />
                  ) : null}
                  <SortableBlockItem
                    block={child}
                    definition={childDefinition}
                    parentBlock={container}
                    parentDefinition={containerDefinition}
                    availableBlocks={availableBlocks}
                    definitions={definitions}
                    onMoveUp={onMoveUp}
                    onMoveDown={onMoveDown}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                    onUpdateProps={onUpdateProps}
                    onReplaceProps={onReplaceProps}
                    onAddChild={onAddChild}
                    onInsert={onInsert}
                    onMoveOut={onMoveOut}
                    onMoveInto={onMoveInto}
                    onWrapIn={onWrapIn}
                    getMoveIntoCandidates={getMoveIntoCandidates}
                  />
                  <InsertSlot
                    availableBlocks={availableBlocks}
                    onInsert={(blockType) => onInsert("after", child.id, blockType)}
                    ariaLabel={`Insert block after ${childLabel}`}
                  />
                </Fragment>
              );
            })
          )}
        </div>
      </SortableContext>
    </div>
  );
}

interface DragPreviewProps {
  block?: NpBlockInstance;
  definition?: NpBlockMetadata;
}


// Lints `props` against the registered prop schema and returns
// soft warnings (missing required, unknown keys). Returning a
// string (not throwing) keeps Apply non-blocking — operators can
// still save a paste that hasn't been schema-finalized yet, the
// banner just flags it.

// Per-block JSON editor. Shows the block's `props` as pretty-
// printed JSON, lets the operator hand-edit, and dispatches
// REPLACE_PROPS on Apply (replace, not merge — operators expect
// "remove key in JSON" to actually remove). Validates JSON.parse
// + non-array object shape, plus soft warnings against the
// registered propsSchema (missing required / unknown keys).


// Confirms a delete that would lose work — block has children OR
// has props that diverge from the registered defaults. Plain rows
// skip this dialog entirely (the trash button calls `onDelete`
// directly).


// Walk a tree and emit `id → type` pairs so the diff can detect
// "same id, different type" as a *modified* block instead of one
// add + one remove. We don't try to deep-diff props — that's what
// the per-block JSON editor is for; the page-level diff just
// summarizes structural delta.



// Page-level JSON editor. Shows the entire blocks tree, lets the
// operator hand-edit, and dispatches RESET on Apply. Validates:
//   1. valid JSON
//   2. top level is an array
//   3. each block has string `id` + string `type`
//   4. (warning, not blocking) every `type` is registered
//
// Unknown types are allowed but get an inline warning so operators
// can paste in JSON for plugin blocks that aren't loaded yet (the
// type might come back later) without being locked out.
//
// Two modes:
// - Replace (default): Apply replaces the entire tree.
// - Import as new blocks: validated input gets fresh ids and
//   appends to the existing tree. Lets operators paste a section
//   from another page without nuking the current one.




// Cmd-K command palette for the page-builder. Built on the
// existing Dialog primitive (no cmdk dep) — the action set is
// small and the matching is just substring filter, so a custom
// implementation keeps the bundle lean. Context-sensitive: when
// a row is focused at the moment the menu opens, block-scoped
// actions (move, duplicate, delete, edit-as-json) target it;
// otherwise only page-level + add-block actions show.







// Two-mode image input: paste a URL directly (escape hatch for
// external CDNs and remote assets) OR pick from the media library.
// Stores a URL string — block renders use the URL directly in
// `<img src=...>` / `background-image: url(...)`. The library
// picker translates the selected media doc's `url` into the value
// so the wire format stays simple (no relationship resolution
// at render time).
/**
 * Renders an `array`-typed prop field. Each entry is a record matching
 * `field.itemSchema`. `+ Add` pushes `field.itemDefault` (or a record
 * derived from each `itemSchema[].defaultValue`); the remove button
 * splices the entry out. v1 is intentionally light — no drag reorder,
 * no nested arrays — to keep the renderer + storage shape predictable.
 * The type system enforces no-nested-array on the source side; we
 * additionally skip rendering at runtime if an author bypassed that.
 */
// Normalize legacy `array` prop values into the structured shape
// the editor expects (`Record<string, unknown>[]`). The render-time
// parsers in @nexpress/blocks already accept legacy shapes, but
// the editor used to filter everything that wasn't already a
// record array down to `[]` — which made operators see an empty
// list, and the first Add / Remove silently overwrote real data.
//
// Two legacy shapes need to flow through:
//   - JSON-string: `'[{"q":"...","a":"..."}]'` (FAQ / Feature
//     Grid / Pricing / Image Gallery before the array-field PR).
//   - Primitive array: `["Name","Email","Company"]` (contact-form
//     fields before its itemSchema landed). Each entry gets wrapped
//     into `{ [firstFieldName]: value }` so the existing itemSchema
//     can edit it without authors having to know about the legacy
//     shape.


// Issue #467 phase 3 — richer media picker.
//
// Upgrades over the old picker:
// - Search the media library by filename / alt text instead of
//   browsing the first 24 items only.
// - Pagination via "Load more" so libraries with thousands of
//   assets stay reachable.
// - Drag-and-drop / click-to-upload right inside the dialog
//   (POSTs to the same /api/media endpoint the media page uses).
// - Broken-image state on the inline preview so a stale URL is
//   visible to the operator (instead of silently disappearing).
// - Replace / Remove affordances on the URL row.

function DragPreview({ block, definition }: DragPreviewProps): ReactNode {
  if (!block) return null;
  return (
    <Card className="min-w-[18rem] border-border/60 px-4 py-3 shadow-2xl">
      <div className="text-sm font-semibold">{definition?.label ?? block.type}</div>
      <div className="font-mono text-xs text-muted-foreground">{block.type}</div>
    </Card>
  );
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
  // Engine drives reducer + history + dispatch coalesce + onChange
  // effect (#467 refactor). The form-editor here is just one
  // surface; an in-page editor would use the same hook.
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
      // API unreachable — show local-only list.
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
            ...server.filter(
              (p) => !migrated.some((m) => m.id === p.id),
            ),
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
      // Try server first. Falls back to localStorage so the save
      // never silently fails — the operator just gets a local-only
      // pattern that a later refresh can promote.
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
    // Server delete is the canonical path — it returns 200 even
    // when the id wasn't there, so we always succeed when the
    // user has permission. Local cleanup runs unconditionally so
    // a server-only pattern doesn't leave a stale localStorage
    // copy behind, and a local-only pattern still gets removed
    // even if the API is unreachable.
    const ok = await deleteServerPattern(patternId);
    if (!ok) {
      // Server unreachable / forbidden — fall through and clear
      // the local copy at minimum.
    }
    deleteCustomPattern(patternId);
    setCustomPatterns((current) => current.filter((p) => p.id !== patternId));
  }, []);
  // Live preview toggle. Persisted in localStorage so an operator
  // who keeps it open across sessions doesn't need to flip it on
  // every page load. Defaults to off — preview costs an extra
  // server round trip and not every editor session needs it.
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("np-page-builder.preview");
      if (stored === "1") setPreviewOpen(true);
    } catch {
      // localStorage may throw in private-browsing or SSR contexts —
      // fall back to the default (closed).
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

  // Cmd/Ctrl-Z / Cmd-Shift-Z / Ctrl-Y bound at window level. We
  // skip the shortcut while focus sits on a text-entry surface so
  // operators still get native input undo while typing into prop
  // fields — the editor's coalesced UPDATE_PROPS history covers
  // the structural changes that survive blur.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.matches("input, textarea") ||
          target.isContentEditable)
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
  // top-level row. We skip when focus is inside a typing surface
  // (input / textarea / contenteditable) — operators editing prop
  // text expect arrow keys to move the caret.
  function handleKeyboardNav(event: React.KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.matches("input, textarea") || target.isContentEditable)
    ) {
      return;
    }

    // Cmd-K / Ctrl-K opens the command menu — works from anywhere
    // inside the editor, including from inside a focused row.
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
    if (next === currentIndex) {
      // Already at the boundary — let arrow keys propagate so
      // operators can scroll past the editor with the keyboard.
      return;
    }
    event.preventDefault();
    rows[next]?.focus();
  }

  // Currently-focused block id for the command menu's
  // context-sensitive actions. We read it lazily from the DOM
  // when the menu opens (focused row owns `:focus-visible`),
  // rather than mirroring focus into React state on every move
  // (which would re-render the editor on every Tab).
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
    // supported in v1; promote / demote via duplicate-and-delete
    // for now).
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
                      dispatch({
                        type: "MOVE_INTO",
                        id,
                        targetParentId,
                      })
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
          // Route through `dispatch` (not `historyDispatch RESET_HISTORY`)
          // so the apply lands as one undo step. JSON apply is the
          // most destructive operator action — losing the safety net
          // here would be a regression vs. the per-block JSON dialog.
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
