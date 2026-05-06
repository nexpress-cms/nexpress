"use client";

import {
  Fragment,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
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
import type {
  NpBlockInstance,
  NpBlockMetadata,
  NpBlockPropField,
} from "@nexpress/blocks";

import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";
import { cn } from "../ui/utils.js";

import { BlockPalette } from "./block-palette.js";
import {
  canAcceptChild,
  cloneBlockDeep,
  collectContainerCandidates,
  deleteNeedsConfirmation,
  findBlockInTreeFlat,
  getFieldValue,
  getRowSummary,
  groupVisibleFields,
  isRecord,
  lintFieldValue,
  locateBlock,
  parseFieldInput,
  useEditorState,
  type ContainerCandidate,
  type EditorAction,
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
import { useCollectionOptions } from "./registry-context.js";

// Lexical editor — same lazy pattern the collection field-renderer
// uses (#XXX). Loads only when an `image` / `richtext` block prop
// actually mounts so pages without rich-text blocks don't pay for
// Lexical's bundle.
const LazyRichTextEditor = lazy(async () => {
  const module = await import("@nexpress/editor/client");
  return {
    default: module.NpRichTextEditor as ComponentType<{
      value: unknown;
      onChange: (value: unknown) => void;
      config?: unknown;
    }>,
  };
});

const isRichTextContent = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const root = (value as { root?: unknown }).root;
  return typeof root === "object" && root !== null;
};

interface BlockPageEditorProps {
  blocks: NpBlockInstance[];
  onChange: (blocks: NpBlockInstance[]) => void;
  availableBlocks: NpBlockMetadata[];
}


interface FieldControlProps {
  field: NpBlockPropField;
  value: unknown;
  onChange: (next: unknown) => void;
  inputId: string;
}

function FieldControl({ field, value, onChange, inputId }: FieldControlProps) {
  // Hooks must run unconditionally so the React rules of hooks hold even
  // when the field type is something other than "collection".
  const collectionOptions = useCollectionOptions();

  if (field.type === "collection") {
    // The option list is injected via context by the host's admin layout
    // (server-side, after bootstrap → after plugin collections register).
    // When the list is empty (older mounts that didn't pass
    // `collectionOptions`), we fall back to a free-text input so the
    // form still works — better than disabling the field outright.
    const stringValue = typeof value === "string" ? value : "";
    if (collectionOptions.length === 0) {
      return (
        <Input
          id={inputId}
          value={stringValue}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="collection slug"
        />
      );
    }
    return (
      <Select value={stringValue} onValueChange={(v) => onChange(v)}>
        <SelectTrigger id={inputId}>
          <SelectValue placeholder="Pick a collection" />
        </SelectTrigger>
        <SelectContent>
          {collectionOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "textarea") {
    return (
      <Textarea
        id={inputId}
        rows={typeof field.rows === "number" && field.rows > 0 ? field.rows : 4}
        placeholder={field.placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  if (field.type === "richtext") {
    // Real Lexical editor instead of the legacy JSON-in-textarea
    // fallback. The block prop stores the parsed Lexical content
    // object; the editor pushes updates back via onChange. Lazy-
    // loaded for the same reason the collection field-renderer
    // does — avoids dragging Lexical into the bundle for pages
    // that don't have rich-text fields.
    return (
      <Suspense
        fallback={
          <div className="rounded-md border border-dashed border-border/60 px-3 py-3 text-xs text-muted-foreground">
            Loading editor…
          </div>
        }
      >
        <LazyRichTextEditor
          value={isRichTextContent(value) ? value : null}
          onChange={(next) => onChange(next)}
        />
      </Suspense>
    );
  }

  if (field.type === "image") {
    return (
      <BlockImagePicker
        inputId={inputId}
        value={typeof value === "string" ? value : ""}
        onChange={(next) => onChange(next)}
      />
    );
  }

  if (field.type === "media") {
    // Until the admin grows a proper media-library browser, `media`
    // reuses the existing image picker — operators paste a URL or
    // upload through the same flow as the legacy `image` field. The
    // type still differs at the propsSchema level so block authors
    // can opt into the future picker without rewriting; today the
    // wire format (a string) matches `image` exactly.
    return (
      <BlockImagePicker
        inputId={inputId}
        value={typeof value === "string" ? value : ""}
        onChange={(next) => onChange(next)}
      />
    );
  }

  if (field.type === "array") {
    return (
      <ArrayFieldControl
        field={field}
        value={value}
        onChange={onChange}
        inputId={inputId}
      />
    );
  }

  if (field.type === "select") {
    const stringValue =
      typeof value === "string"
        ? value
        : typeof field.defaultValue === "string"
          ? field.defaultValue
          : "";
    return (
      <Select value={stringValue} onValueChange={(v) => onChange(v)}>
        <SelectTrigger id={inputId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Switch
          id={inputId}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
        <Label htmlFor={inputId} className="text-sm font-normal">
          {field.label}
        </Label>
      </div>
    );
  }

  if (field.type === "color") {
    // Browser native picker. Store as `#rrggbb` so `style={{ color }}`
    // works directly. The text input next to it lets operators paste
    // arbitrary CSS colors (rgb/hsl/var(...)) when the picker is too
    // restrictive for theme-token references.
    const stringValue = typeof value === "string" ? value : "";
    return (
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="color"
          value={/^#([0-9a-fA-F]{6})$/.test(stringValue) ? stringValue : "#000000"}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background"
        />
        <Input
          value={stringValue}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="#000000 or var(--np-color-primary)"
          className="flex-1 font-mono text-xs"
        />
      </div>
    );
  }

  const requiredMissing = field.required === true && (value === undefined || value === "" || value === null);

  return (
    <Input
      id={inputId}
      type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(event) => onChange(parseFieldInput(field, event.currentTarget.value))}
      placeholder={field.placeholder}
      // Number-input attributes (#467 phase 3). The runtime
      // validator (`lintFieldValue`) re-checks them so blocks
      // saved through the JSON dialog or the API also surface
      // bounds violations as warnings — these here just give
      // operators native browser feedback while typing.
      min={
        field.type === "number" && typeof field.min === "number"
          ? field.min
          : undefined
      }
      max={
        field.type === "number" && typeof field.max === "number"
          ? field.max
          : undefined
      }
      step={
        field.type === "number" && typeof field.step === "number"
          ? field.step
          : undefined
      }
      pattern={
        (field.type === "text" || field.type === "url") && field.pattern
          ? field.pattern
          : undefined
      }
      aria-invalid={requiredMissing || undefined}
      className={
        requiredMissing
          ? "border-rose-500/60 focus-visible:ring-rose-500/40"
          : undefined
      }
    />
  );
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

interface BlockJsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockType: string;
  props: Record<string, unknown>;
  propsSchema?: NpBlockPropField[];
  onApply: (nextProps: Record<string, unknown>) => void;
}

// Lints `props` against the registered prop schema and returns
// soft warnings (missing required, unknown keys). Returning a
// string (not throwing) keeps Apply non-blocking — operators can
// still save a paste that hasn't been schema-finalized yet, the
// banner just flags it.
function lintBlockProps(
  props: Record<string, unknown>,
  schema: NpBlockPropField[] | undefined,
): string | null {
  if (!schema || schema.length === 0) return null;
  const known = new Set(schema.map((field) => field.name));
  const warnings: string[] = [];

  for (const field of schema) {
    if (!field.required) continue;
    const value = props[field.name];
    if (value === undefined || value === "" || value === null) {
      warnings.push(`missing required \`${field.name}\``);
    }
  }

  for (const key of Object.keys(props)) {
    if (key === "_layout") continue; // grid-child layout meta, not in propsSchema
    if (!known.has(key)) warnings.push(`unknown key \`${key}\``);
  }

  return warnings.length > 0 ? warnings.join("; ") : null;
}

// Per-block JSON editor. Shows the block's `props` as pretty-
// printed JSON, lets the operator hand-edit, and dispatches
// REPLACE_PROPS on Apply (replace, not merge — operators expect
// "remove key in JSON" to actually remove). Validates JSON.parse
// + non-array object shape, plus soft warnings against the
// registered propsSchema (missing required / unknown keys).
function BlockJsonDialog({
  open,
  onOpenChange,
  blockType,
  props,
  propsSchema,
  onApply,
}: BlockJsonDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reseed the textarea every time the dialog opens, so closing
  // and reopening reflects the latest committed state — operators
  // who tweak via the field form between JSON edits expect the
  // dialog to catch up.
  useEffect(() => {
    if (open) {
      setText(JSON.stringify(props, null, 2));
      setError(null);
      setWarning(null);
      setCopied(false);
    }
  }, [open, props]);

  function handleFormat() {
    try {
      const parsed: unknown = JSON.parse(text);
      setText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API failures are silent — operators can still
      // select-all + Cmd-C from the textarea.
    }
  }

  // Two-stage Apply when there's a lint warning. The first click
  // surfaces the banner (so the operator actually sees it); the
  // second click commits. When the input lints clean, Apply is
  // one click as before.
  function handleApply() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("Block props must be a JSON object.");
      return;
    }
    const lintWarning = lintBlockProps(parsed as Record<string, unknown>, propsSchema);
    if (lintWarning && lintWarning !== warning) {
      // First time seeing this exact warning — show it and pause.
      // The operator clicks Apply again to confirm; the comparison
      // resets the moment they edit the textarea (`onChange` clears
      // `warning`).
      setWarning(lintWarning);
      return;
    }
    onApply(parsed as Record<string, unknown>);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit block props as JSON</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{blockType}</span> — Apply replaces
            the entire <code>props</code> object. Keys you remove here will
            be dropped on save.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleFormat}>
            Format
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void handleCopy();
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setError(null);
            setWarning(null);
          }}
          rows={16}
          className="font-mono text-xs"
          spellCheck={false}
        />
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        ) : null}
        {warning ? (
          <div
            role="status"
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          >
            Schema warning: {warning}. Click Apply again to commit anyway.
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            {warning ? "Apply anyway" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteBlockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  summary: string | null;
  childCount: number;
  onConfirm: () => void;
}

// Confirms a delete that would lose work — block has children OR
// has props that diverge from the registered defaults. Plain rows
// skip this dialog entirely (the trash button calls `onDelete`
// directly).
function DeleteBlockDialog({
  open,
  onOpenChange,
  label,
  summary,
  childCount,
  onConfirm,
}: DeleteBlockDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this block?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <div>
                <span className="font-semibold text-foreground">{label}</span>
                {summary ? (
                  <span className="ml-1 text-muted-foreground">— {summary}</span>
                ) : null}
              </div>
              {childCount > 0 ? (
                <div className="text-sm text-muted-foreground">
                  Contains {childCount} nested block
                  {childCount === 1 ? "" : "s"}, which will also be removed.
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  This block has edits that will be lost. Use Undo to restore
                  if you delete by mistake.
                </div>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PageJsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: NpBlockInstance[];
  knownTypes: string[];
  onApply: (nextBlocks: NpBlockInstance[]) => void;
}

// Walk a tree and emit `id → type` pairs so the diff can detect
// "same id, different type" as a *modified* block instead of one
// add + one remove. We don't try to deep-diff props — that's what
// the per-block JSON editor is for; the page-level diff just
// summarizes structural delta.
function flattenIdTypes(blocks: NpBlockInstance[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (arr: NpBlockInstance[]): void => {
    for (const b of arr) {
      out.set(b.id, b.type);
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

interface ApplyDiff {
  totalBefore: number;
  totalAfter: number;
  added: number;
  removed: number;
  modified: number;
}

function summarizeApplyDiff(
  before: NpBlockInstance[],
  after: NpBlockInstance[],
): ApplyDiff {
  const beforeMap = flattenIdTypes(before);
  const afterMap = flattenIdTypes(after);
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const [id, type] of afterMap) {
    const prev = beforeMap.get(id);
    if (prev === undefined) added += 1;
    else if (prev !== type) modified += 1;
  }
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) removed += 1;
  }
  return {
    totalBefore: beforeMap.size,
    totalAfter: afterMap.size,
    added,
    removed,
    modified,
  };
}

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
function PageJsonDialog({
  open,
  onOpenChange,
  blocks,
  knownTypes,
  onApply,
}: PageJsonDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importAsNew, setImportAsNew] = useState(false);
  const [pendingApply, setPendingApply] = useState<{
    next: NpBlockInstance[];
    diff: ApplyDiff;
    warning: string | null;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setText(JSON.stringify(blocks, null, 2));
      setError(null);
      setWarning(null);
      setCopied(false);
      setImportAsNew(false);
      setPendingApply(null);
    }
  }, [open, blocks]);

  function validateBlock(value: unknown, path: string): NpBlockInstance | string {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return `${path}: expected a JSON object`;
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.id !== "string") return `${path}: missing string \`id\``;
    if (typeof obj.type !== "string") return `${path}: missing string \`type\``;
    const props =
      obj.props !== undefined && typeof obj.props === "object" && obj.props !== null
        ? (obj.props as Record<string, unknown>)
        : {};
    let children: NpBlockInstance[] | undefined;
    if (Array.isArray(obj.children)) {
      const validated: NpBlockInstance[] = [];
      for (let i = 0; i < obj.children.length; i++) {
        const childResult = validateBlock(obj.children[i], `${path}.children[${i}]`);
        if (typeof childResult === "string") return childResult;
        validated.push(childResult);
      }
      children = validated;
    }
    return {
      id: obj.id,
      type: obj.type,
      props,
      ...(children ? { children } : {}),
    };
  }

  function handleFormat() {
    try {
      const parsed: unknown = JSON.parse(text);
      setText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API failures are silent — operators can still
      // select-all + Cmd-C from the textarea.
    }
  }

  // Stage-1 click: validate JSON + compute the apply diff and
  // park the pending result. Stage-2 click confirms.
  function handlePreview() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    if (!Array.isArray(parsed)) {
      setError("Expected a top-level array of block instances.");
      return;
    }
    const validated: NpBlockInstance[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const result = validateBlock(parsed[i], `[${i}]`);
      if (typeof result === "string") {
        setError(result);
        return;
      }
      validated.push(result);
    }

    // Soft-warn on unknown types — block authors might paste in
    // plugin-block JSON before the plugin is enabled. The save
    // path doesn't strip these; the editor just shows "Unknown
    // block type" in the row UI until the type is registered.
    const unknownTypes = collectUnknownTypes(validated, new Set(knownTypes));
    const unknownWarning =
      unknownTypes.length > 0
        ? `Unknown block type${unknownTypes.length > 1 ? "s" : ""}: ${unknownTypes.join(", ")}. The blocks will save but won't render until those types are registered.`
        : null;

    // `cloneBlockDeep` re-ids the whole subtree (recursive over
    // `children`), so a paste from another page doesn't bring its
    // source ids along — those would collide with existing rows
    // or carry stale dnd-kit state across sessions.
    const next = importAsNew
      ? [...blocks, ...validated.map(cloneBlockDeep)]
      : validated;
    const diff = summarizeApplyDiff(blocks, next);
    setPendingApply({ next, diff, warning: unknownWarning });
    setWarning(unknownWarning);
  }

  function handleConfirm() {
    if (!pendingApply) return;
    onApply(pendingApply.next);
    onOpenChange(false);
  }

  function clearPreview() {
    setPendingApply(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit page blocks as JSON</DialogTitle>
          <DialogDescription>
            Apply replaces the entire block tree. Use this for bulk edits,
            paste-from-another-page, or recovering from a corrupted state.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleFormat}>
            Format
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void handleCopy();
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Switch
              id="np-page-json-import-as-new"
              checked={importAsNew}
              onCheckedChange={(checked) => {
                setImportAsNew(checked);
                clearPreview();
              }}
            />
            <Label
              htmlFor="np-page-json-import-as-new"
              className="text-xs font-normal text-muted-foreground"
            >
              Import as new blocks (append, fresh ids)
            </Label>
          </div>
        </div>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setError(null);
            setWarning(null);
            clearPreview();
          }}
          rows={20}
          className="font-mono text-xs"
          spellCheck={false}
        />
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        ) : null}
        {warning ? (
          <div
            role="status"
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          >
            {warning}
          </div>
        ) : null}
        {pendingApply ? (
          <div
            role="status"
            className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs"
          >
            <div className="font-medium uppercase tracking-wider text-primary">
              Apply preview
            </div>
            <div className="mt-1 text-foreground">
              {pendingApply.diff.totalBefore} block
              {pendingApply.diff.totalBefore === 1 ? "" : "s"} →{" "}
              {pendingApply.diff.totalAfter} block
              {pendingApply.diff.totalAfter === 1 ? "" : "s"} (
              <span className="text-emerald-600 dark:text-emerald-400">
                +{pendingApply.diff.added}
              </span>
              {" "}
              <span className="text-rose-600 dark:text-rose-400">
                −{pendingApply.diff.removed}
              </span>
              {" "}
              <span className="text-amber-600 dark:text-amber-400">
                ~{pendingApply.diff.modified}
              </span>
              )
            </div>
            <div className="mt-1 text-muted-foreground">
              {importAsNew
                ? "Import-as-new mode — validated input appends with fresh ids."
                : "Replace mode — current tree is overwritten."}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {pendingApply ? (
            <>
              <Button type="button" variant="outline" onClick={clearPreview}>
                Edit more
              </Button>
              <Button type="button" onClick={handleConfirm}>
                Confirm apply
              </Button>
            </>
          ) : (
            <Button type="button" onClick={handlePreview}>
              Preview
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function collectUnknownTypes(
  blocks: NpBlockInstance[],
  known: Set<string>,
): string[] {
  const seen = new Set<string>();
  const walk = (arr: NpBlockInstance[]): void => {
    for (const b of arr) {
      if (!known.has(b.type)) seen.add(b.type);
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return [...seen].sort();
}

interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  // Group label for the section header — actions with the same
  // group render together with the group as the header.
  group: "Block" | "Pattern" | "Page" | "Add";
  run: () => void;
}

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableBlocks: NpBlockMetadata[];
  readFocusedBlockId: () => string | null;
  blocks: NpBlockInstance[];
  definitions: Map<string, NpBlockMetadata>;
  dispatch: (action: EditorAction) => void;
  onOpenPageJson: () => void;
  patterns: NpPattern[];
  onSaveFocusedAsPattern: (focusedBlockId: string) => void;
  onDeletePattern: (patternId: string) => void;
}

// Cmd-K command palette for the page-builder. Built on the
// existing Dialog primitive (no cmdk dep) — the action set is
// small and the matching is just substring filter, so a custom
// implementation keeps the bundle lean. Context-sensitive: when
// a row is focused at the moment the menu opens, block-scoped
// actions (move, duplicate, delete, edit-as-json) target it;
// otherwise only page-level + add-block actions show.
function CommandMenu({
  open,
  onOpenChange,
  availableBlocks,
  readFocusedBlockId,
  blocks,
  definitions,
  dispatch,
  onOpenPageJson,
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
    if (open) {
      setQuery("");
      setFocusedBlockId(readFocusedBlockId());
    }
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

  const focusedBlock = focusedBlockId
    ? findBlockInTree(blocks, focusedBlockId)
    : null;
  const focusedDefinition = focusedBlock
    ? definitions.get(focusedBlock.type)
    : null;
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

    // Hierarchy moves (#467 phase 4). MOVE_OUT only shows when
    // the block has a grandparent; MOVE_INTO appears once per
    // candidate container so operators can pick a target without
    // a separate target-picker UI.
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
        run: () =>
          dispatch({ type: "MOVE_INTO", id, targetParentId: candidate.id }),
      });
    }
    // Wrap in container — currently the only built-in container
    // is `grid`; plugins / themes can ship more, and they show up
    // here automatically because the lookup walks `availableBlocks`.
    for (const def of availableBlocks) {
      if (!def.acceptsChildren) continue;
      // Skip wrapping a container in itself — the wrap is intended
      // to introduce structure around a leaf, not nest containers.
      if (def.type === focusedBlock.type) continue;
      actions.push({
        id: `block.wrap-in.${def.type}`,
        label: `Wrap ${focusedLabel} in ${def.label}`,
        group: "Block",
        run: () =>
          dispatch({ type: "WRAP_IN", id, containerType: def.type }),
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

  // Patterns (#467 phase 4 + follow-up). Built-ins ship with the
  // editor; custom patterns come from server (when available) and
  // localStorage. Both surface under the same "Pattern" group so
  // operators don't have to know which is which. Delete actions
  // appear only for custom patterns — built-ins are immutable.
  for (const pattern of patterns) {
    actions.push({
      id: `pattern.insert.${pattern.id}`,
      label: `Insert pattern: ${pattern.label}`,
      hint: pattern.source === "custom" ? "saved" : pattern.id,
      group: "Pattern",
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

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && filtered.length > 0) {
      event.preventDefault();
      runAction(filtered[0]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-2 p-0">
        <DialogHeader className="border-b border-border/60 px-3 py-2">
          <DialogTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Page-builder commands
          </DialogTitle>
          <DialogDescription className="sr-only">
            Run a context-sensitive page-builder action by typing a name.
          </DialogDescription>
        </DialogHeader>
        <div className="px-3 pt-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={
              focusedLabel
                ? `Run a command for ${focusedLabel}…`
                : "Type to filter commands…"
            }
            aria-label="Filter commands"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-1 pb-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No matching commands.
            </p>
          ) : (
            groups.map(({ group, items }) => (
              <div key={group} className="px-2 pt-2">
                <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                <ul className="space-y-0.5">
                  {items.map((action) => (
                    <li key={action.id}>
                      <button
                        type="button"
                        onClick={() => runAction(action)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm",
                          "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                          action.hint === "destructive" && "text-destructive",
                        )}
                      >
                        <span className="truncate">{action.label}</span>
                        {action.hint && action.hint !== "destructive" ? (
                          <span className="ml-2 truncate font-mono text-[10px] text-muted-foreground">
                            {action.hint}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function findBlockInTree(
  arr: NpBlockInstance[],
  id: string,
): NpBlockInstance | null {
  for (const b of arr) {
    if (b.id === id) return b;
    if (b.children) {
      const inChild = findBlockInTree(b.children, id);
      if (inChild) return inChild;
    }
  }
  return null;
}


function filterCommandActions(
  actions: CommandAction[],
  query: string,
): CommandAction[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return actions;
  return actions.filter((a) => {
    const haystack = `${a.label} ${a.hint ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}

function groupCommandActions(
  actions: CommandAction[],
): { group: CommandAction["group"]; items: CommandAction[] }[] {
  const order: CommandAction["group"][] = ["Block", "Pattern", "Add", "Page"];
  const buckets = new Map<CommandAction["group"], CommandAction[]>();
  for (const a of actions) {
    const list = buckets.get(a.group) ?? [];
    list.push(a);
    buckets.set(a.group, list);
  }
  return order
    .filter((g) => (buckets.get(g)?.length ?? 0) > 0)
    .map((g) => ({ group: g, items: buckets.get(g) ?? [] }));
}

interface BlockImagePickerProps {
  inputId: string;
  value: string;
  onChange: (next: string) => void;
}

interface MediaDoc {
  id: string;
  url?: string;
  filename?: string;
  alt?: string;
}

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
function normalizeArrayValue(
  value: unknown,
  itemSchema: readonly NpBlockPropField[],
): Record<string, unknown>[] {
  let source: unknown = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(source)) return [];

  const firstFieldName = itemSchema[0]?.name;
  const out: Record<string, unknown>[] = [];
  for (const entry of source) {
    if (isRecord(entry)) {
      out.push(entry);
      continue;
    }
    if (
      firstFieldName !== undefined &&
      (typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean")
    ) {
      out.push({ [firstFieldName]: entry });
    }
  }
  return out;
}

function ArrayFieldControl({
  field,
  value,
  onChange,
  inputId,
}: {
  field: NpBlockPropField;
  value: unknown;
  onChange: (next: unknown) => void;
  inputId: string;
}) {
  const itemSchema = (field.itemSchema ?? []).filter(
    (sub) => sub.type !== "array",
  );
  const items = normalizeArrayValue(value, itemSchema);

  const buildItemDefault = (): Record<string, unknown> => {
    if (field.itemDefault && typeof field.itemDefault === "object") {
      return { ...field.itemDefault };
    }
    const out: Record<string, unknown> = {};
    for (const sub of itemSchema) {
      if (sub.defaultValue !== undefined) out[sub.name] = sub.defaultValue;
    }
    return out;
  };

  const updateAt = (index: number, key: string, next: unknown) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, [key]: next } : item,
    );
    onChange(updated);
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No entries yet. Click &ldquo;Add&rdquo; below.
        </p>
      ) : null}
      {items.map((item, index) => (
        <div
          key={index}
          className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              #{index + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeAt(index)}
              aria-label={`Remove item ${index + 1}`}
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          </div>
          {itemSchema.map((sub) => {
            const subInputId = `${inputId}-${index}-${sub.name}`;
            return (
              <div key={sub.name} className="grid gap-1.5">
                {sub.type !== "boolean" ? (
                  <Label htmlFor={subInputId}>{sub.label}</Label>
                ) : null}
                <FieldControl
                  field={sub}
                  value={item[sub.name]}
                  onChange={(next) => updateAt(index, sub.name, next)}
                  inputId={subInputId}
                />
              </div>
            );
          })}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, buildItemDefault()])}
      >
        <Plus className="size-3.5" />
        Add
      </Button>
    </div>
  );
}

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
function BlockImagePicker({ inputId, value, onChange }: BlockImagePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<MediaDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewBroken, setPreviewBroken] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const PAGE_SIZE = 24;
  const UPLOAD_CONCURRENCY = 3;

  // Debounce query to avoid hammering the media API on every
  // keystroke while still feeling responsive.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Reset broken-state when the URL changes — operator may have
  // pasted a valid URL after a broken one. The <img onError> hook
  // re-flips it to true if the new URL also fails.
  useEffect(() => {
    setPreviewBroken(false);
  }, [value]);

  // Server-side search via /api/media `q` param (#467 follow-up).
  // The route runs an ILIKE over filename + alt and returns
  // matching docs only, so the picker can search the whole library
  // instead of paging through everything client-side.
  const loadMedia = useCallback(
    async (page: number, query: string, mode: "replace" | "append") => {
      // Cancel any in-flight request so a slow earlier query
      // can't overwrite the response from a newer query (#467
      // post-review). Debouncing alone doesn't cover the case
      // where the network is the bottleneck.
      if (loadAbortRef.current) loadAbortRef.current.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;

      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("page", String(page));
      const trimmed = query.trim();
      if (trimmed.length > 0) params.set("q", trimmed);
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/media?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Media load failed (${res.status})`);
        const payload = (await res.json()) as {
          docs?: MediaDoc[];
          totalDocs?: number;
          totalPages?: number;
          page?: number;
        };
        const next = Array.isArray(payload.docs) ? payload.docs : [];
        setItems((prev) => (mode === "append" ? [...prev, ...next] : next));
        const totalPages =
          typeof payload.totalPages === "number" ? payload.totalPages : page;
        setHasMore(page < totalPages);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load media.");
      } finally {
        if (loadAbortRef.current === controller) {
          loadAbortRef.current = null;
          setLoading(false);
        }
      }
    },
    [],
  );

  // Reset + load page 1 when the dialog opens OR the debounced
  // query changes. Server applies the filter so we re-fetch
  // instead of slicing the loaded page client-side.
  useEffect(() => {
    if (!open) return;
    void loadMedia(1, debouncedQuery, "replace");
  }, [open, debouncedQuery, loadMedia]);

  const currentPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      // Upload with a small concurrency cap (#467 post-review).
      // Pure `Promise.all` would let a 100-file drop kick off 100
      // simultaneous POSTs and saturate connections / rate limits.
      // The cap (`UPLOAD_CONCURRENCY`) keeps the parallel benefit
      // for typical 3-10 image batches without the multi-hundred
      // foot-gun. `allSettled` semantics preserved — one corrupt
      // file doesn't block the rest.
      const files = Array.from(fileList);
      type UploadOutcome =
        | { status: "fulfilled"; value: string | null }
        | { status: "rejected"; reason: unknown };
      const results: UploadOutcome[] = new Array(files.length);
      const uploadOne = async (file: File): Promise<string | null> => {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/media", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
        });
        if (!res.ok) {
          throw new Error(`Upload failed (${res.status})`);
        }
        const doc = (await res.json()) as { doc?: MediaDoc };
        return doc.doc?.url ?? null;
      };
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, files.length) },
        async () => {
          while (true) {
            const index = cursor++;
            if (index >= files.length) return;
            const file = files[index];
            try {
              const value = await uploadOne(file);
              results[index] = { status: "fulfilled", value };
            } catch (reason) {
              results[index] = { status: "rejected", reason };
            }
          }
        },
      );
      await Promise.all(workers);
      const failures = results.filter((r) => r.status === "rejected");
      // Pick the URL of the LAST successful upload to fill the
      // field — operators that drop a single file get that file;
      // batch uploads land the most-recent in the field, with the
      // rest available via the library.
      const successfulUrls = results
        .filter(
          (r): r is { status: "fulfilled"; value: string | null } =>
            r.status === "fulfilled",
        )
        .map((r) => r.value)
        .filter((url): url is string => typeof url === "string");
      const lastUrl = successfulUrls[successfulUrls.length - 1];
      if (lastUrl) onChange(lastUrl);
      if (failures.length > 0) {
        setError(
          failures.length === files.length
            ? "All uploads failed."
            : `${failures.length} of ${files.length} uploads failed.`,
        );
      }
      // Refresh listing so the new assets show at the top.
      await loadMedia(1, debouncedQuery, "replace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type="url"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder="https://… or pick from library"
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Library
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
            aria-label="Remove image"
          >
            Remove
          </Button>
        ) : null}
      </div>
      {value ? (
        // Inline preview with explicit broken-state so a stale or
        // 404-ing URL is visible instead of silently collapsing.
        <div className="overflow-hidden rounded-md border border-border/60 bg-muted/20">
          {previewBroken ? (
            <div className="flex h-32 items-center justify-center px-3 text-xs text-amber-600 dark:text-amber-400">
              Image preview failed to load. Check the URL or pick from the library.
            </div>
          ) : (
            <img
              src={value}
              alt=""
              className="block max-h-32 w-full object-cover"
              onError={() => setPreviewBroken(true)}
            />
          )}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Select an image</DialogTitle>
            <DialogDescription>
              Search the library, upload a new file, or paste a URL above.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search by filename or alt text"
              className="h-8 flex-1"
              autoFocus
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleUploadFiles(e.currentTarget.files);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          <div className="grid max-h-[28rem] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
            {items.length === 0 && !loading ? (
              <div className="col-span-full px-2 py-6 text-center text-xs text-muted-foreground">
                {debouncedQuery
                  ? "No assets match your search."
                  : "Library is empty. Use Upload to add an image."}
              </div>
            ) : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.url) onChange(item.url);
                  setOpen(false);
                }}
                className="flex flex-col gap-1 overflow-hidden rounded-md border border-border/60 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {item.url ? (
                  <img
                    src={item.url}
                    alt={item.alt ?? item.filename ?? ""}
                    className="block aspect-video w-full bg-muted object-cover"
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                    no preview
                  </div>
                )}
                <p className="truncate px-2 pb-2 text-xs">
                  {item.filename ?? item.id}
                </p>
              </button>
            ))}
          </div>
          <DialogFooter className="justify-between sm:justify-between">
            <div className="flex items-center gap-2">
              {hasMore ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() =>
                  void loadMedia(currentPage + 1, debouncedQuery, "append")
                }
                >
                  {loading ? "Loading…" : "Load more"}
                </Button>
              ) : null}
              {loading && !hasMore ? (
                <span className="text-xs text-muted-foreground">Loading…</span>
              ) : null}
            </div>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
