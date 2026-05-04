"use client";

import {
  useEffect,
  useMemo,
  useReducer,
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
  GripVertical,
  Plus,
  Trash2,
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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  NxBlockInstance,
  NxBlockMetadata,
  NxBlockPropField,
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

declare const crypto: { randomUUID(): string };

interface BlockPageEditorProps {
  blocks: NxBlockInstance[];
  onChange: (blocks: NxBlockInstance[]) => void;
  availableBlocks: NxBlockMetadata[];
}

type EditorAction =
  | { type: "RESET"; blocks: NxBlockInstance[] }
  | { type: "ADD"; blockType: string; parentId?: string }
  | { type: "DELETE"; id: string }
  | { type: "DUPLICATE"; id: string }
  | { type: "MOVE_WITHIN_PARENT"; parentId: string | null; fromId: string; toId: string }
  | { type: "MOVE_UP"; id: string }
  | { type: "MOVE_DOWN"; id: string }
  | { type: "UPDATE_PROPS"; id: string; props: Record<string, unknown> }
  | { type: "REPLACE_PROPS"; id: string; props: Record<string, unknown> };

const createBlockId = (): string => crypto.randomUUID();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getFieldValue = (field: NxBlockPropField, value: unknown): unknown => {
  if (value !== undefined) return value;
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.type === "boolean") return false;
  if (field.type === "number") return 0;
  return "";
};

const createBlockInstance = (definition: NxBlockMetadata): NxBlockInstance => ({
  id: createBlockId(),
  type: definition.type,
  props: { ...definition.defaultProps },
  // Eagerly seed an empty children array on containers so the
  // editor's add-child UI has something to push into without a
  // null-check round-trip.
  ...(definition.acceptsChildren ? { children: [] } : {}),
});

// Recursive tree helpers. The blocks tree is small (handfuls of
// blocks per page) so straightforward DFS beats threading a path
// through every action.

function mapTree(
  blocks: NxBlockInstance[],
  fn: (block: NxBlockInstance) => NxBlockInstance,
): NxBlockInstance[] {
  return blocks.map((block) => {
    const next = fn(block);
    if (next.children) {
      const nextChildren = mapTree(next.children, fn);
      return nextChildren === next.children ? next : { ...next, children: nextChildren };
    }
    return next;
  });
}

function filterTree(
  blocks: NxBlockInstance[],
  predicate: (block: NxBlockInstance) => boolean,
): NxBlockInstance[] {
  return blocks
    .filter(predicate)
    .map((block) =>
      block.children
        ? { ...block, children: filterTree(block.children, predicate) }
        : block,
    );
}

// Find the parent id (or null for top-level) and index of a target.
function locateBlock(
  blocks: NxBlockInstance[],
  id: string,
  parentId: string | null = null,
): { parentId: string | null; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === id) return { parentId, index: i };
    const childMatch = blocks[i].children
      ? locateBlock(blocks[i].children!, id, blocks[i].id)
      : null;
    if (childMatch) return childMatch;
  }
  return null;
}

// Update the children of a target container (or top-level when
// parentId is null) with `mutate`. Returns the new tree.
function updateContainerChildren(
  blocks: NxBlockInstance[],
  parentId: string | null,
  mutate: (children: NxBlockInstance[]) => NxBlockInstance[],
): NxBlockInstance[] {
  if (parentId === null) return mutate(blocks);
  return blocks.map((block) => {
    if (block.id === parentId) {
      return { ...block, children: mutate(block.children ?? []) };
    }
    if (block.children) {
      const nextChildren = updateContainerChildren(block.children, parentId, mutate);
      return nextChildren === block.children ? block : { ...block, children: nextChildren };
    }
    return block;
  });
}

const cloneBlockDeep = (block: NxBlockInstance): NxBlockInstance => ({
  id: createBlockId(),
  type: block.type,
  props: { ...block.props },
  ...(block.children ? { children: block.children.map(cloneBlockDeep) } : {}),
});

const createEditorReducer = (availableBlocks: NxBlockMetadata[]) => {
  const definitions = new Map(availableBlocks.map((block) => [block.type, block]));

  return (state: NxBlockInstance[], action: EditorAction): NxBlockInstance[] => {
    switch (action.type) {
      case "RESET":
        return action.blocks;
      case "ADD": {
        const definition = definitions.get(action.blockType);
        if (!definition) return state;
        const next = createBlockInstance(definition);
        const parentId = action.parentId ?? null;
        return updateContainerChildren(state, parentId, (siblings) => [...siblings, next]);
      }
      case "DELETE":
        return filterTree(state, (block) => block.id !== action.id);
      case "DUPLICATE": {
        const loc = locateBlock(state, action.id);
        if (!loc) return state;
        return updateContainerChildren(state, loc.parentId, (siblings) => {
          const source = siblings[loc.index];
          if (!source) return siblings;
          const clone = cloneBlockDeep(source);
          return [
            ...siblings.slice(0, loc.index + 1),
            clone,
            ...siblings.slice(loc.index + 1),
          ];
        });
      }
      case "MOVE_WITHIN_PARENT": {
        return updateContainerChildren(state, action.parentId, (siblings) => {
          const fromIndex = siblings.findIndex((b) => b.id === action.fromId);
          const toIndex = siblings.findIndex((b) => b.id === action.toId);
          if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
            return siblings;
          }
          return arrayMove(siblings, fromIndex, toIndex);
        });
      }
      case "MOVE_UP": {
        const loc = locateBlock(state, action.id);
        if (!loc || loc.index === 0) return state;
        return updateContainerChildren(state, loc.parentId, (siblings) =>
          arrayMove(siblings, loc.index, loc.index - 1),
        );
      }
      case "MOVE_DOWN": {
        const loc = locateBlock(state, action.id);
        if (!loc) return state;
        return updateContainerChildren(state, loc.parentId, (siblings) => {
          if (loc.index >= siblings.length - 1) return siblings;
          return arrayMove(siblings, loc.index, loc.index + 1);
        });
      }
      case "UPDATE_PROPS":
        return mapTree(state, (block) =>
          block.id === action.id
            ? { ...block, props: { ...block.props, ...action.props } }
            : block,
        );
      case "REPLACE_PROPS":
        // JSON-edit dialog wants the operator to drop keys by
        // omitting them, so we replace rather than merge here.
        return mapTree(state, (block) =>
          block.id === action.id ? { ...block, props: action.props } : block,
        );
      default:
        return state;
    }
  };
};

const parseFieldInput = (
  field: NxBlockPropField,
  rawValue: string | boolean,
): unknown => {
  if (field.type === "boolean") return Boolean(rawValue);
  if (field.type === "number") {
    if (typeof rawValue === "string") {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : (field.defaultValue ?? 0);
    }
    return field.defaultValue ?? 0;
  }
  if (field.type === "richtext") {
    if (typeof rawValue !== "string") return field.defaultValue ?? {};
    try {
      const parsed: unknown = JSON.parse(rawValue);
      return isRecord(parsed) ? parsed : (field.defaultValue ?? {});
    } catch {
      return rawValue;
    }
  }
  return rawValue;
};

interface FieldControlProps {
  field: NxBlockPropField;
  value: unknown;
  onChange: (next: unknown) => void;
  inputId: string;
}

function FieldControl({ field, value, onChange, inputId }: FieldControlProps) {
  if (field.type === "textarea" || field.type === "richtext") {
    return (
      <Textarea
        id={inputId}
        rows={field.type === "richtext" ? 8 : 4}
        value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        onChange={(event) => onChange(parseFieldInput(field, event.currentTarget.value))}
        className={field.type === "richtext" ? "font-mono text-xs" : ""}
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

  return (
    <Input
      id={inputId}
      type={
        field.type === "number"
          ? "number"
          : field.type === "url" || field.type === "image"
            ? "url"
            : "text"
      }
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(event) => onChange(parseFieldInput(field, event.currentTarget.value))}
    />
  );
}

interface SortableBlockItemProps {
  block: NxBlockInstance;
  definition?: NxBlockMetadata;
  parentBlock?: NxBlockInstance;
  parentDefinition?: NxBlockMetadata;
  availableBlocks: NxBlockMetadata[];
  definitions: Map<string, NxBlockMetadata>;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateProps: (id: string, props: Record<string, unknown>) => void;
  onReplaceProps: (id: string, props: Record<string, unknown>) => void;
  onAddChild: (parentId: string, blockType: string) => void;
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
}: SortableBlockItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const [open, setOpen] = useState(true);
  const [jsonOpen, setJsonOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const fieldIdPrefix = `nx-block-${block.id}`;
  const isContainer = Boolean(definition?.acceptsChildren);
  const isChildOfGrid = parentBlock?.type === "grid";

  return (
    <Card ref={setNodeRef} style={style} className="overflow-hidden border-border/60">
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Delete"
              onClick={() => onDelete(block.id)}
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
          onApply={(nextProps) => onReplaceProps(block.id, nextProps)}
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
                definition.propsSchema.map((field) => {
                  const value = getFieldValue(field, block.props[field.name]);
                  const inputId = `${fieldIdPrefix}-${field.name}`;
                  return (
                    <div key={field.name} className="grid gap-1.5">
                      {field.type !== "boolean" ? (
                        <Label htmlFor={inputId}>{field.label}</Label>
                      ) : null}
                      <FieldControl
                        field={field}
                        value={value}
                        onChange={(next) =>
                          onUpdateProps(block.id, { [field.name]: next })
                        }
                        inputId={inputId}
                      />
                    </div>
                  );
                })
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
              />
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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
  block: NxBlockInstance;
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
  container: NxBlockInstance;
  availableBlocks: NxBlockMetadata[];
  definitions: Map<string, NxBlockMetadata>;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateProps: (id: string, props: Record<string, unknown>) => void;
  onReplaceProps: (id: string, props: Record<string, unknown>) => void;
  onAddChild: (parentId: string, blockType: string) => void;
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
}: ChildrenAreaProps) {
  const children = container.children ?? [];
  const containerDefinition = definitions.get(container.type);
  return (
    <div className="grid gap-2 rounded-md border border-dashed border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Children ({children.length})
        </p>
        <BlockPalette
          availableBlocks={availableBlocks}
          onAdd={(type) => onAddChild(container.id, type)}
          trigger={
            <Button type="button" variant="outline" size="sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add child
            </Button>
          }
        />
      </div>
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
            children.map((child) => (
              <SortableBlockItem
                key={child.id}
                block={child}
                definition={definitions.get(child.type)}
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
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

interface DragPreviewProps {
  block?: NxBlockInstance;
  definition?: NxBlockMetadata;
}

interface BlockJsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockType: string;
  props: Record<string, unknown>;
  onApply: (nextProps: Record<string, unknown>) => void;
}

// Per-block JSON editor. Shows the block's `props` as pretty-
// printed JSON, lets the operator hand-edit, and dispatches
// REPLACE_PROPS on Apply (replace, not merge — operators expect
// "remove key in JSON" to actually remove). Validates JSON.parse
// + non-array object shape; richer schema validation is out of
// scope for v1 (server-side validation will catch the rest).
function BlockJsonDialog({
  open,
  onOpenChange,
  blockType,
  props,
  onApply,
}: BlockJsonDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reseed the textarea every time the dialog opens, so closing
  // and reopening reflects the latest committed state — operators
  // who tweak via the field form between JSON edits expect the
  // dialog to catch up.
  useEffect(() => {
    if (open) {
      setText(JSON.stringify(props, null, 2));
      setError(null);
    }
  }, [open, props]);

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
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setError(null);
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
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PageJsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: NxBlockInstance[];
  knownTypes: string[];
  onApply: (nextBlocks: NxBlockInstance[]) => void;
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

  useEffect(() => {
    if (open) {
      setText(JSON.stringify(blocks, null, 2));
      setError(null);
      setWarning(null);
    }
  }, [open, blocks]);

  function validateBlock(value: unknown, path: string): NxBlockInstance | string {
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
    let children: NxBlockInstance[] | undefined;
    if (Array.isArray(obj.children)) {
      const validated: NxBlockInstance[] = [];
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

  function handleApply() {
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
    const validated: NxBlockInstance[] = [];
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
    const unknown = collectUnknownTypes(validated, new Set(knownTypes));
    if (unknown.length > 0) {
      setWarning(
        `Unknown block type${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. The blocks will save but won't render until those types are registered.`,
      );
    }

    onApply(validated);
    onOpenChange(false);
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
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setError(null);
            setWarning(null);
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
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function collectUnknownTypes(
  blocks: NxBlockInstance[],
  known: Set<string>,
): string[] {
  const seen = new Set<string>();
  const walk = (arr: NxBlockInstance[]): void => {
    for (const b of arr) {
      if (!known.has(b.type)) seen.add(b.type);
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return [...seen].sort();
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
  const reducer = useMemo(
    () => createEditorReducer(availableBlocks),
    [availableBlocks],
  );
  const [blocks, dispatch] = useReducer(reducer, initialBlocks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pageJsonOpen, setPageJsonOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const initialBlocksKey = useMemo(
    () => JSON.stringify(initialBlocks),
    [initialBlocks],
  );

  useEffect(() => {
    dispatch({ type: "RESET", blocks: initialBlocks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBlocksKey]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onChange(blocks);
  }, [blocks, onChange]);

  // Locate the active block anywhere in the tree (it may be a
  // top-level block or nested inside a container). The drag
  // overlay just needs the label, so a flat search is enough.
  const findInTree = (arr: NxBlockInstance[], id: string): NxBlockInstance | undefined => {
    for (const b of arr) {
      if (b.id === id) return b;
      const inChild = b.children ? findInTree(b.children, id) : undefined;
      if (inChild) return inChild;
    }
    return undefined;
  };
  const activeBlock = activeId ? findInTree(blocks, activeId) : undefined;

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
    <section className={cn("nx-block-page-editor flex flex-col gap-4")}>
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
            {blocks.map((block) => (
              <SortableBlockItem
                key={block.id}
                block={block}
                definition={definitions.get(block.type)}
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
              />
            ))}
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
      </div>

      <PageJsonDialog
        open={pageJsonOpen}
        onOpenChange={setPageJsonOpen}
        blocks={blocks}
        knownTypes={availableBlocks.map((b) => b.type)}
        onApply={(nextBlocks) => dispatch({ type: "RESET", blocks: nextBlocks })}
      />
    </section>
  );
}
