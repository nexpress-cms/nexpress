import { useEffect, useMemo, useReducer, useState, type CSSProperties, type ReactNode } from "react";
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

import { BlockPalette } from "./block-palette.js";
import type { NxBlockDefinition, NxBlockInstance, NxBlockPropField } from "./types.js";

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
  if (value !== undefined) {
    return value;
  }

  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }

  if (field.type === "boolean") {
    return false;
  }

  if (field.type === "number") {
    return 0;
  }

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
        if (!definition) {
          return state;
        }

        const nextBlock = createBlockInstance(definition);
        if (!action.afterId) {
          return [...state, nextBlock];
        }

        const index = state.findIndex((block) => block.id === action.afterId);
        if (index === -1) {
          return [...state, nextBlock];
        }

        return [...state.slice(0, index + 1), nextBlock, ...state.slice(index + 1)];
      }
      case "DELETE":
        return state.filter((block) => block.id !== action.id);
      case "DUPLICATE": {
        const index = state.findIndex((block) => block.id === action.id);
        if (index === -1) {
          return state;
        }

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

        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
          return state;
        }

        return arrayMove(state, fromIndex, toIndex);
      }
      case "MOVE_UP": {
        const index = state.findIndex((block) => block.id === action.id);
        if (index <= 0) {
          return state;
        }

        return arrayMove(state, index, index - 1);
      }
      case "MOVE_DOWN": {
        const index = state.findIndex((block) => block.id === action.id);
        if (index === -1 || index >= state.length - 1) {
          return state;
        }

        return arrayMove(state, index, index + 1);
      }
      case "UPDATE_PROPS":
        return state.map((block) =>
          block.id === action.id
            ? {
                ...block,
                props: { ...block.props, ...action.props },
              }
            : block,
        );
      default:
        return state;
    }
  };
};

const parseFieldInput = (field: NxBlockPropField, rawValue: string | boolean): unknown => {
  if (field.type === "boolean") {
    return Boolean(rawValue);
  }

  if (field.type === "number") {
    if (typeof rawValue === "string") {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : field.defaultValue ?? 0;
    }

    return field.defaultValue ?? 0;
  }

  if (field.type === "richtext") {
    if (typeof rawValue !== "string") {
      return field.defaultValue ?? {};
    }

    try {
      const parsed: unknown = JSON.parse(rawValue);
      return isRecord(parsed) ? parsed : field.defaultValue ?? {};
    } catch {
      return rawValue;
    }
  }

  return rawValue;
};

const readValueFromEvent = (event: unknown): string =>
  (event as { currentTarget: { value: string } }).currentTarget.value;

const readCheckedFromEvent = (event: unknown): boolean =>
  (event as { currentTarget: { checked: boolean } }).currentTarget.checked;

const renderFieldControl = (
  field: NxBlockPropField,
  value: unknown,
  onChange: (nextValue: unknown) => void,
): ReactNode => {
  const commonStyle: CSSProperties = {
    width: "100%",
    padding: "0.75rem 0.9rem",
    borderRadius: "0.85rem",
    border: "1px solid rgba(15, 23, 42, 0.14)",
    background: "#ffffff",
    color: "#0f172a",
    font: "inherit",
  };

  if (field.type === "textarea" || field.type === "richtext") {
    return (
      <textarea
        rows={field.type === "richtext" ? 10 : 5}
        value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        onChange={(event) => onChange(parseFieldInput(field, readValueFromEvent(event)))}
        style={{ ...commonStyle, resize: "vertical" }}
      />
    );
  }

  if (field.type === "select") {
    return (
      <select
        value={typeof value === "string" ? value : typeof field.defaultValue === "string" ? field.defaultValue : ""}
        onChange={(event) => onChange(readValueFromEvent(event))}
        style={commonStyle}
      >
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "boolean") {
    return (
      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.65rem", color: "#0f172a" }}>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(readCheckedFromEvent(event))}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  return (
    <input
      type={field.type === "number" ? "number" : field.type === "url" || field.type === "image" ? "url" : "text"}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(event) => onChange(parseFieldInput(field, readValueFromEvent(event)))}
      style={commonStyle}
    />
  );
};

interface SortableBlockItemProps {
  block: NxBlockInstance;
  definition?: NxBlockDefinition;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateProps: (id: string, props: Record<string, unknown>) => void;
}

const SortableBlockItem = ({
  block,
  definition,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onUpdateProps,
}: SortableBlockItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.42 : 1,
    border: "1px solid rgba(15, 23, 42, 0.1)",
    borderRadius: "1.2rem",
    background: "#ffffff",
    boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
    overflow: "hidden",
  };

  return (
    <article ref={setNodeRef} style={style}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "1rem 1rem 0.9rem",
          background: "#f8fafc",
          borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", minWidth: 0 }}>
          <button
            type="button"
            aria-label={`Drag ${definition?.label ?? block.type}`}
            {...attributes}
            {...listeners}
            style={{
              border: "none",
              background: "transparent",
              cursor: "grab",
              fontSize: "1.15rem",
              color: "#475569",
            }}
          >
            ⠿
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: "#0f172a" }}>{definition?.label ?? block.type}</div>
            <div style={{ fontSize: "0.88rem", color: "#64748b" }}>{block.type}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => onMoveUp(block.id)} style={{ borderRadius: "999px", border: "1px solid rgba(15, 23, 42, 0.1)", background: "#ffffff", padding: "0.4rem 0.75rem" }}>
            ↑
          </button>
          <button type="button" onClick={() => onMoveDown(block.id)} style={{ borderRadius: "999px", border: "1px solid rgba(15, 23, 42, 0.1)", background: "#ffffff", padding: "0.4rem 0.75rem" }}>
            ↓
          </button>
          <button type="button" onClick={() => onDuplicate(block.id)} style={{ borderRadius: "999px", border: "1px solid rgba(15, 23, 42, 0.1)", background: "#ffffff", padding: "0.4rem 0.75rem" }}>
            Duplicate
          </button>
          <button type="button" onClick={() => onDelete(block.id)} style={{ borderRadius: "999px", border: "1px solid rgba(239, 68, 68, 0.16)", background: "#fef2f2", color: "#b91c1c", padding: "0.4rem 0.75rem" }}>
            Delete
          </button>
        </div>
      </header>
      <div style={{ padding: "1rem", display: "grid", gap: "1rem" }}>
        {definition ? (
          definition.propsSchema.map((field) => {
            const value = getFieldValue(field, block.props[field.name]);

            return (
              <label key={field.name} style={{ display: "grid", gap: "0.5rem" }}>
                {field.type === "boolean" ? null : (
                  <span style={{ fontSize: "0.92rem", fontWeight: 600, color: "#0f172a" }}>{field.label}</span>
                )}
                {renderFieldControl(field, value, (nextValue) => onUpdateProps(block.id, { [field.name]: nextValue }))}
              </label>
            );
          })
        ) : (
          <div style={{ color: "#b45309", background: "#fffbeb", borderRadius: "0.85rem", padding: "0.9rem 1rem" }}>
            Unknown block type: {block.type}
          </div>
        )}
      </div>
    </article>
  );
};

interface DragPreviewProps {
  block?: NxBlockInstance;
  definition?: NxBlockDefinition;
}

const DragPreview = ({ block, definition }: DragPreviewProps) => {
  if (!block) {
    return null;
  }

  return (
    <div
      style={{
        minWidth: "18rem",
        padding: "1rem 1.1rem",
        borderRadius: "1rem",
        background: "#ffffff",
        border: "1px solid rgba(15, 23, 42, 0.1)",
        boxShadow: "0 22px 60px rgba(15, 23, 42, 0.16)",
      }}
    >
      <div style={{ fontWeight: 700, color: "#0f172a" }}>{definition?.label ?? block.type}</div>
      <div style={{ fontSize: "0.88rem", color: "#64748b" }}>{block.type}</div>
    </div>
  );
};

export const BlockPageEditor = ({ blocks: initialBlocks, onChange, availableBlocks }: BlockPageEditorProps) => {
  const reducer = useMemo(() => createEditorReducer(availableBlocks), [availableBlocks]);
  const [blocks, dispatch] = useReducer(reducer, initialBlocks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const definitions = useMemo(() => new Map(availableBlocks.map((block) => [block.type, block])), [availableBlocks]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    dispatch({ type: "RESET", blocks: initialBlocks });
  }, [initialBlocks]);

  useEffect(() => {
    onChange(blocks);
  }, [blocks, onChange]);

  const activeBlock = activeId ? blocks.find((block) => block.id === activeId) : undefined;

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);

    if (!event.over) {
      return;
    }

    dispatch({ type: "MOVE", fromId: String(event.active.id), toId: String(event.over.id) });
  };

  return (
    <section className="nx-block-page-editor" style={{ display: "grid", gap: "1.5rem" }}>
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#0f172a" }}>Add blocks</h2>
        <BlockPalette blocks={availableBlocks} onAdd={(type) => dispatch({ type: "ADD", blockType: type })} />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => setActiveId(String(event.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
          <div style={{ display: "grid", gap: "1rem" }}>
            {blocks.map((block) => (
              <SortableBlockItem
                key={block.id}
                block={block}
                definition={definitions.get(block.type)}
                onMoveUp={(id) => dispatch({ type: "MOVE_UP", id })}
                onMoveDown={(id) => dispatch({ type: "MOVE_DOWN", id })}
                onDuplicate={(id) => dispatch({ type: "DUPLICATE", id })}
                onDelete={(id) => dispatch({ type: "DELETE", id })}
                onUpdateProps={(id, props) => dispatch({ type: "UPDATE_PROPS", id, props })}
              />
            ))}
            {blocks.length === 0 ? (
              <div
                style={{
                  borderRadius: "1.2rem",
                  border: "1px dashed rgba(15, 23, 42, 0.18)",
                  background: "#f8fafc",
                  padding: "1.4rem",
                  color: "#64748b",
                }}
              >
                Select a block above to start building the page.
              </div>
            ) : null}
          </div>
        </SortableContext>
        <DragOverlay>
          <DragPreview block={activeBlock} definition={activeBlock ? definitions.get(activeBlock.type) : undefined} />
        </DragOverlay>
      </DndContext>
    </section>
  );
};
