"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ComponentType } from "react";
import type { NpBlockPropField } from "@nexpress/blocks";

import { isRecord } from "../editor-engine/index.js";
import { Button } from "../../ui/button.js";
import { Label } from "../../ui/label.js";

/**
 * Renders an `array`-typed prop field. Each entry is a record
 * matching `field.itemSchema`. `+ Add` pushes `field.itemDefault`
 * (or a record derived from each `itemSchema[].defaultValue`);
 * the remove button splices the entry out. v1 is intentionally
 * light — no drag reorder, no nested arrays — to keep the
 * renderer + storage shape predictable.
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
  field: NpBlockPropField;
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
 * Normalize legacy `array` prop values into the structured shape
 * the editor expects (`Record<string, unknown>[]`). The render-time
 * parsers in `@nexpress/blocks` already accept legacy shapes, but
 * the editor used to filter everything that wasn't already a
 * record array down to `[]` — which made operators see an empty
 * list, and the first Add / Remove silently overwrote real data.
 *
 * Two legacy shapes need to flow through:
 *   - JSON-string: `'[{"q":"...","a":"..."}]'` (pre-array-field
 *     defaults for FAQ / Feature Grid / Pricing / Image Gallery).
 *   - Primitive array: `["Name","Email","Company"]` (contact-form
 *     fields before its itemSchema landed). Each entry gets
 *     wrapped into `{ [firstFieldName]: value }` so the existing
 *     itemSchema can edit it.
 */
export function normalizeArrayValue(
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

export function ArrayFieldControl({
  field,
  value,
  onChange,
  inputId,
  FieldControl,
}: ArrayFieldControlProps) {
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
