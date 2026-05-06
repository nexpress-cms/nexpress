"use client";

import { Fragment, useState } from "react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import { BlockPalette } from "../block-palette.js";
import {
  canAcceptChild,
  deleteNeedsConfirmation,
  getFieldValue,
  getRowSummary,
  getRowValidationStatus,
  groupVisibleFields,
  lintFieldValue,
  type ContainerCandidate,
} from "../editor-engine/index.js";
import {
  BlockIcon,
  BlockJsonDialog,
  DeleteBlockDialog,
  FieldControl,
} from "../shared/index.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../ui/collapsible.js";
import { Label } from "../../ui/label.js";
import { cn } from "../../ui/utils.js";

import { GridChildLayoutControl, getLayout } from "./grid-child-layout.js";
import { HierarchyMenu } from "./hierarchy-menu.js";
import { InsertSlot } from "./insert-slot.js";

/**
 * Form-card row UI for a single block + the recursive
 * `ChildrenArea` that renders container children. Both are in the
 * same file because they call each other (a container's
 * `SortableBlockItem` mounts `ChildrenArea`, which in turn mounts
 * a `SortableBlockItem` per child). Splitting them into separate
 * modules works in ESM but the tight cycle reads cleaner here.
 *
 * The form-editor lives behind `useEditorState` from the engine —
 * this component never builds reducer state itself, only
 * dispatches the right action through the props the orchestrator
 * gave it.
 */

export interface SortableBlockItemProps {
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
  onMoveOut: (id: string) => void;
  onMoveInto: (id: string, targetParentId: string) => void;
  onWrapIn: (id: string, containerType: string) => void;
  getMoveIntoCandidates: (id: string) => ContainerCandidate[];
  // Collapsed/open state lifted to the orchestrator so it
  // persists across the same session — `BlockPageEditor` keeps a
  // Set<id> of explicitly-collapsed rows.
  /**
   * Lookup-by-id for the persisted "is this row expanded" state.
   * Lifted to `BlockPageEditor` so collapsed rows survive every
   * dispatch (re-creating sub-trees) and so the orchestrator can
   * persist the set across reloads via localStorage. The lookup
   * shape (vs a plain boolean) lets us propagate the same handle
   * recursively into ChildrenArea without each level having to
   * splice its own children's state.
   */
  isOpen: (id: string) => boolean;
  onOpenChange: (id: string, open: boolean) => void;
  /**
   * Lookup-by-id for the multi-select set (#467 #3). The
   * orchestrator owns the Set; rows just read by id and dispatch
   * toggles on click. Shift-click is handled in the click handler
   * itself — `onToggleSelected(id, { shift, meta })` carries the
   * modifier flags through so the orchestrator can range-select
   * relative to the last clicked id.
   */
  isSelected: (id: string) => boolean;
  onToggleSelected: (
    id: string,
    modifiers: { shift: boolean; meta: boolean },
  ) => void;
}

export function SortableBlockItem({
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
  isOpen,
  onOpenChange,
  isSelected,
  onToggleSelected,
}: SortableBlockItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
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
  const validationStatus = getRowValidationStatus(definition, block);
  const selfOpen = isOpen(block.id);
  const selfSelected = isSelected(block.id);

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
      tabIndex={0}
      data-np-block-row={block.id}
      data-np-block-selected={selfSelected ? "true" : undefined}
      aria-label={`Block row: ${definition?.label ?? block.type}`}
      aria-selected={selfSelected}
      className={cn(
        "overflow-hidden rounded-2xl border border-neutral-200/80 bg-white/95 shadow-sm outline-none backdrop-blur-sm dark:border-neutral-800/80 dark:bg-neutral-950/95",
        "focus-visible:ring-2 focus-visible:ring-primary/40",
        isContainer && "focus-within:ring-2 focus-within:ring-primary/30",
        selfSelected && "ring-2 ring-primary/60 ring-offset-1",
      )}
    >
      <Collapsible
        open={selfOpen}
        onOpenChange={(next) => onOpenChange(block.id, next)}
      >
        <header className="flex items-center gap-2 border-b border-neutral-200/80 bg-neutral-50/60 px-3 py-2 dark:border-neutral-800/80 dark:bg-neutral-900/40">
          {/* Multi-select checkbox (#467 #3). Click toggles; shift-
              click extends from the last clicked id (the orchestrator
              owns the range logic). Stop propagation so the click
              doesn't also fire focusin handlers that would change
              the preview-selection target. */}
          <input
            type="checkbox"
            aria-label={
              selfSelected
                ? `Deselect ${definition?.label ?? block.type}`
                : `Select ${definition?.label ?? block.type}`
            }
            checked={selfSelected}
            onChange={() => {
              /* handled in onClick to read modifiers */
            }}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelected(block.id, {
                shift: event.shiftKey,
                meta: event.metaKey || event.ctrlKey,
              });
            }}
            className="h-3.5 w-3.5 cursor-pointer accent-primary"
          />
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
              aria-label={selfOpen ? "Collapse block" : "Expand block"}
            >
              {selfOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </CollapsibleTrigger>
          <BlockIcon
            icon={definition?.icon}
            kind={definition?.iconKind}
            className="text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {definition?.label ?? block.type}
              {definition?.source && definition.source !== "built-in" ? (
                <span
                  className={cn(
                    "ml-2 inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                    definition.source === "plugin"
                      ? "bg-primary/10 text-primary"
                      : definition.source === "theme"
                      ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                      : "bg-muted text-muted-foreground",
                  )}
                  aria-label={`${definition.source} block`}
                >
                  {definition.source}
                </span>
              ) : null}
              {isContainer ? (
                <span className="ml-2 inline-flex items-center rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  container
                </span>
              ) : null}
              {/* Validation status badge — visible whether the row
                  is collapsed or open so a missing required prop
                  buried inside a collapsed row stays visible. */}
              {validationStatus === "error" ? (
                <span
                  className="ml-2 inline-flex items-center rounded-sm bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-600 dark:text-rose-300"
                  aria-label="This block has missing required props"
                  title="Missing required props"
                >
                  required
                </span>
              ) : validationStatus === "warning" ? (
                <span
                  className="ml-2 inline-flex items-center rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300"
                  aria-label="This block has prop validation warnings"
                  title="Prop validation warnings"
                >
                  warning
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
                onChange={(breakpoint, value) => {
                  const current = getLayout(block.props) ?? {};
                  // Map UI breakpoint key → meta field. The base
                  // span is required; tablet / desktop are
                  // optional and dropped from the meta when set
                  // to Auto (`null`).
                  const fieldKey =
                    breakpoint === "base"
                      ? "colSpan"
                      : breakpoint === "md"
                        ? "mdColSpan"
                        : "lgColSpan";
                  const next = { ...current };
                  if (value === null) {
                    if (breakpoint === "base") next.colSpan = 12;
                    else delete next[fieldKey];
                  } else {
                    next[fieldKey] = value;
                  }
                  onUpdateProps(block.id, { _layout: next });
                }}
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
                          // value-with-defaults (#467 post-review).
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
                isOpen={isOpen}
                onOpenChange={onOpenChange}
                isSelected={isSelected}
                onToggleSelected={onToggleSelected}
              />
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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
  isOpen: (id: string) => boolean;
  onOpenChange: (id: string, open: boolean) => void;
  isSelected: (id: string) => boolean;
  onToggleSelected: (
    id: string,
    modifiers: { shift: boolean; meta: boolean },
  ) => void;
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
  isOpen,
  onOpenChange,
  isSelected,
  onToggleSelected,
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
                    isOpen={isOpen}
                    onOpenChange={onOpenChange}
                    isSelected={isSelected}
                    onToggleSelected={onToggleSelected}
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
