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
  ChevronDown,
  ChevronRight,
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
  NxBlockDefinition,
  NxBlockInstance,
  NxBlockPropField,
} from "@nexpress/blocks";

import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible.js";
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
  availableBlocks: NxBlockDefinition[];
}

type EditorAction =
  | { type: "RESET"; blocks: NxBlockInstance[] }
  | { type: "ADD"; blockType: string; afterId?: string }
  | { type: "DELETE"; id: string }
  | { type: "DUPLICATE"; id: string }
  | { type: "MOVE"; fromId: string; toId: string }
  | { type: "MOVE_UP"; id: string }
  | { type: "MOVE_DOWN"; id: string }
  | { type: "UPDATE_PROPS"; id: string; props: Record<string, unknown> };

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

const createBlockInstance = (definition: NxBlockDefinition): NxBlockInstance => ({
  id: createBlockId(),
  type: definition.type,
  props: { ...definition.defaultProps },
});

const createEditorReducer = (availableBlocks: NxBlockDefinition[]) => {
  const definitions = new Map(availableBlocks.map((block) => [block.type, block]));

  return (state: NxBlockInstance[], action: EditorAction): NxBlockInstance[] => {
    switch (action.type) {
      case "RESET":
        return action.blocks;
      case "ADD": {
        const definition = definitions.get(action.blockType);
        if (!definition) return state;
        const nextBlock = createBlockInstance(definition);
        if (!action.afterId) return [...state, nextBlock];
        const index = state.findIndex((block) => block.id === action.afterId);
        if (index === -1) return [...state, nextBlock];
        return [...state.slice(0, index + 1), nextBlock, ...state.slice(index + 1)];
      }
      case "DELETE":
        return state.filter((block) => block.id !== action.id);
      case "DUPLICATE": {
        const index = state.findIndex((block) => block.id === action.id);
        if (index === -1) return state;
        const source = state[index];
        const duplicate: NxBlockInstance = {
          id: createBlockId(),
          type: source.type,
          props: { ...source.props },
        };
        return [...state.slice(0, index + 1), duplicate, ...state.slice(index + 1)];
      }
      case "MOVE": {
        const fromIndex = state.findIndex((block) => block.id === action.fromId);
        const toIndex = state.findIndex((block) => block.id === action.toId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return state;
        return arrayMove(state, fromIndex, toIndex);
      }
      case "MOVE_UP": {
        const index = state.findIndex((block) => block.id === action.id);
        if (index <= 0) return state;
        return arrayMove(state, index, index - 1);
      }
      case "MOVE_DOWN": {
        const index = state.findIndex((block) => block.id === action.id);
        if (index === -1 || index >= state.length - 1) return state;
        return arrayMove(state, index, index + 1);
      }
      case "UPDATE_PROPS":
        return state.map((block) =>
          block.id === action.id
            ? { ...block, props: { ...block.props, ...action.props } }
            : block,
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
        // richtext is a JSON blob — monospace makes the structure
        // legible. textarea is freeform, normal font.
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
  definition?: NxBlockDefinition;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateProps: (id: string, props: Record<string, unknown>) => void;
}

function SortableBlockItem({
  block,
  definition,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onUpdateProps,
}: SortableBlockItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const [open, setOpen] = useState(true);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const fieldIdPrefix = `nx-block-${block.id}`;

  return (
    <Card ref={setNodeRef} style={style} className="overflow-hidden border-border/60">
      <Collapsible open={open} onOpenChange={setOpen}>
        <header className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
          <button
            type="button"
            aria-label={`Drag ${definition?.label ?? block.type}`}
            {...attributes}
            {...listeners}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-grab active:cursor-grabbing"
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
              <ChevronDown className="h-4 w-4 rotate-180" />
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
              aria-label="Delete"
              onClick={() => onDelete(block.id)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <CollapsibleContent>
          <div className="grid gap-4 p-4">
            {definition ? (
              definition.propsSchema.length === 0 ? (
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
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

interface DragPreviewProps {
  block?: NxBlockInstance;
  definition?: NxBlockDefinition;
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // The parent re-creates `initialBlocks` on every render (the
  // admin field renderer maps the form value through
  // `toBlockInstances`, which always returns a fresh array).
  // Reference comparison would re-fire RESET endlessly and
  // deadlock into a "Maximum update depth" storm. Use a serialized
  // key so RESET only runs when the *content* changes; pass the
  // original array to the reducer to skip a parse round-trip.
  const initialBlocksKey = useMemo(
    () => JSON.stringify(initialBlocks),
    [initialBlocks],
  );

  useEffect(() => {
    dispatch({ type: "RESET", blocks: initialBlocks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBlocksKey]);

  // Skip the mount echo so we don't bounce the value back to the
  // parent on first render and trigger a reset loop.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onChange(blocks);
  }, [blocks, onChange]);

  const activeBlock = activeId ? blocks.find((block) => block.id === activeId) : undefined;

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over) return;
    dispatch({ type: "MOVE", fromId: String(event.active.id), toId: String(event.over.id) });
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
                onMoveUp={(id) => dispatch({ type: "MOVE_UP", id })}
                onMoveDown={(id) => dispatch({ type: "MOVE_DOWN", id })}
                onDuplicate={(id) => dispatch({ type: "DUPLICATE", id })}
                onDelete={(id) => dispatch({ type: "DELETE", id })}
                onUpdateProps={(id, props) =>
                  dispatch({ type: "UPDATE_PROPS", id, props })
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

      <div className="flex justify-center">
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
      </div>
    </section>
  );
}
