"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ComponentType } from "react";
import type { NpBlockArrayPropField, NpBlockPropField } from "@nexpress/blocks";

import { getFieldValue, isFieldHidden } from "../editor-engine/index.js";
import { Button } from "../../ui/button.js";
import { Label } from "../../ui/label.js";

/**
 * Renders an `array`-typed prop field. Each entry is a record
 * matching `field.itemSchema`. `+ Add` pushes `field.itemDefault`
 * (or a record derived from each `itemSchema[].defaultValue`);
 * the remove button splices the entry out. Nested arrays are
 * rendered by recursing back into FieldControl; this keeps blocks
 * like docs API tables editable without falling back to JSON.
 *
 * Takes the inner `FieldControl` as a prop to avoid the
 * `field-control.tsx` ↔ `array-field-control.tsx` import cycle.
 * The form editor wires `FieldControl` once at the top level.
 */

interface FieldControlComponentProps {
  field: NpBlockPropField;
  value: unknown;
  onChange: (next: unknown) => void;
  inputId: string;
}

interface ArrayFieldControlProps {
  field: NpBlockArrayPropField;
  value: unknown;
  onChange: (next: unknown) => void;
  inputId: string;
  /**
   * Inner field renderer. Pass `FieldControl` from the same
   * shared bundle — taking it as a prop keeps the array editor
   * decoupled from the field renderer's location.
   */
  FieldControl: ComponentType<FieldControlComponentProps>;
}

/**
 * Reads the exact v1 array value. Malformed input stays visibly invalid
 * instead of being coerced to an empty list and overwritten on the first edit.
 */
export function readArrayValue(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const prototype = Object.getPrototypeOf(entry) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return null;
  }
  return value as Record<string, unknown>[];
}

export function getVisibleArrayItemFields(
  field: NpBlockArrayPropField,
  item: Record<string, unknown>,
): readonly NpBlockPropField[] {
  return field.itemSchema.filter((sub) => !isFieldHidden(sub, item));
}

function cloneJsonValue<T>(value: T): T {
  return structuredClone(value);
}

export function ArrayFieldControl({
  field,
  value,
  onChange,
  inputId,
  FieldControl,
}: ArrayFieldControlProps) {
  const itemSchema = field.itemSchema;
  const items = readArrayValue(value);

  const buildItemDefault = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const sub of itemSchema) {
      if (sub.defaultValue !== undefined) out[sub.name] = cloneJsonValue(sub.defaultValue);
    }
    return field.itemDefault ? { ...out, ...cloneJsonValue(field.itemDefault) } : out;
  };

  const updateAt = (index: number, key: string, next: unknown) => {
    if (!items) return;
    const updated = items.map((item, i) => (i === index ? { ...item, [key]: next } : item));
    onChange(updated);
  };

  const removeAt = (index: number) => {
    if (!items) return;
    onChange(items.filter((_, i) => i !== index));
  };

  if (!items) {
    return (
      <div
        role="alert"
        className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
      >
        This value is not an array of objects. Repair it in the block JSON editor before editing
        entries.
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      {items.length === 0 ? (
        <p className="break-words text-xs text-muted-foreground italic">
          No entries yet. Click &ldquo;Add&rdquo; below.
        </p>
      ) : null}
      {items.map((item, index) => (
        <div
          key={index}
          className="min-w-0 space-y-2 rounded-md border border-border/60 bg-muted/30 p-3"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <span className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
          {getVisibleArrayItemFields(field, item).map((sub) => {
            const subInputId = `${inputId}-${index}-${sub.name}`;
            return (
              <div key={sub.name} className="grid min-w-0 gap-1.5">
                {sub.type !== "boolean" ? (
                  <Label htmlFor={subInputId} className="break-words">
                    {sub.label}
                  </Label>
                ) : null}
                <FieldControl
                  field={sub}
                  value={getFieldValue(sub, item[sub.name])}
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
        className="w-full sm:w-auto"
      >
        <Plus className="size-3.5" />
        Add
      </Button>
    </div>
  );
}
