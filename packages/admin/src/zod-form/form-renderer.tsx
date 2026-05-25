"use client";

import { useCallback, useRef, useState } from "react";
import type { NpThemeSettingsField } from "@nexpress/core";
import { Trash2, Plus } from "lucide-react";

import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { Switch } from "../ui/switch.js";

export type ZodFormValue = Record<string, unknown>;

export interface ZodFormProps {
  fields: NpThemeSettingsField[];
  initialValue: ZodFormValue;
  onChange: (next: ZodFormValue) => void;
}

/**
 * The orchestrator. Holds the form value as state, dispatches
 * to per-type sub-components, and surfaces every change to the
 * parent via `onChange` so the parent can wire submit handling
 * (which lives outside the form generator — different consumers
 * have different submit endpoints).
 *
 * `initialValue` is read once on mount (standard `useState`
 * semantics); to reset the form when switching to a different
 * source schema, parents must remount via `key={...}`. The
 * theme settings panel keys on `themeId` for this reason.
 */
export function ZodForm({ fields, initialValue, onChange }: ZodFormProps) {
  const [value, setValue] = useState<ZodFormValue>(initialValue);

  // Mirror the live value into a ref so `update` can compute
  // the next state synchronously and call `onChange` exactly
  // once per edit. Calling onChange inside a setState updater
  // function (the prior approach) violates React's purity
  // contract and double-fires under StrictMode.
  //
  // react-hooks/refs flags ref mutation during render. The
  // mutation IS during render, but it's idempotent and only
  // mirrors state that's already committed in `value` — re-runs
  // assign the same reference back. Standard "live ref" pattern;
  // disabling locally rather than threading a useEffect (which
  // would create a one-render staleness window the update path
  // depends on NOT having).
  const valueRef = useRef(value);
  // eslint-disable-next-line react-hooks/refs
  valueRef.current = value;

  const update = useCallback(
    (name: string, fieldValue: unknown) => {
      const next = { ...valueRef.current, [name]: fieldValue };
      setValue(next);
      onChange(next);
    },
    [onChange],
  );

  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This theme doesn't expose any operator settings.
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {fields.map((field) => (
        <FieldDispatch
          key={field.name}
          field={field}
          value={value[field.name]}
          onChange={(v) => update(field.name, v)}
        />
      ))}
    </div>
  );
}

interface FieldProps<T = unknown> {
  field: NpThemeSettingsField;
  value: T;
  onChange: (next: T) => void;
}

function FieldDispatch({ field, value, onChange }: FieldProps) {
  switch (field.type) {
    case "text":
      return <TextField field={field} value={value} onChange={onChange} />;
    case "textarea":
      return <TextareaField field={field} value={value} onChange={onChange} />;
    case "password":
      return <PasswordField field={field} value={value} onChange={onChange} />;
    case "url":
      return <UrlField field={field} value={value} onChange={onChange} />;
    case "color":
      return <ColorField field={field} value={value} onChange={onChange} />;
    case "number":
      return <NumberField field={field} value={value} onChange={onChange} />;
    case "boolean":
      return <BooleanField field={field} value={value} onChange={onChange} />;
    case "enum":
      return <EnumField field={field} value={value} onChange={onChange} />;
    case "object":
      return <ObjectField field={field} value={value} onChange={onChange} />;
    case "array":
      return <ArrayField field={field} value={value} onChange={onChange} />;
    case "string-array":
      return <StringArrayField field={field} value={value} onChange={onChange} />;
    case "unsupported":
      return <UnsupportedField field={field} value={value} onChange={onChange} />;
  }
}

function FieldShell({
  name,
  description,
  children,
}: {
  name: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={name} className="break-words">
        {description ?? name}
      </Label>
      {children}
    </div>
  );
}

/**
 * Convert a text-input's value to what the form should commit.
 * Mirrors `NumberField`'s empty-string-→-undefined treatment
 * for text-like fields (#603): when the field is NOT required,
 * clearing the input emits `undefined` rather than `""`, so
 * `z.string().url().optional()` and other optional text schemas
 * see the absence the operator intended. Required fields keep
 * the empty-string behavior so validation can surface
 * `required` / `min(1)` errors.
 */
function commitText(raw: string, required: boolean): string | undefined {
  if (raw === "" && !required) return undefined;
  return raw;
}

function TextField({ field, value, onChange }: FieldProps) {
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <Input
        id={field.name}
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(commitText(e.target.value, field.required))}
      />
    </FieldShell>
  );
}

function TextareaField({ field, value, onChange }: FieldProps) {
  const f = field as Extract<NpThemeSettingsField, { type: "textarea" }>;
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <Textarea
        id={field.name}
        rows={f.rows ?? 4}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(commitText(e.target.value, field.required))}
      />
    </FieldShell>
  );
}

function PasswordField({ field, value, onChange }: FieldProps) {
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <Input
        id={field.name}
        type="password"
        autoComplete="new-password"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(commitText(e.target.value, field.required))}
      />
    </FieldShell>
  );
}

function UrlField({ field, value, onChange }: FieldProps) {
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <Input
        id={field.name}
        type="url"
        placeholder="https://"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(commitText(e.target.value, field.required))}
      />
    </FieldShell>
  );
}

function ColorField({ field, value, onChange }: FieldProps) {
  // Color is a special case: the `<input type="color">` always
  // has a non-empty value, so the only way to "clear" the field
  // is via the adjacent text input. Match the other text-like
  // fields' treatment of empty input for optional fields
  // (#603) — emit undefined when the operator clears the text
  // box while the schema is optional.
  const v = typeof value === "string" ? value : "#000000";
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <Input
          id={field.name}
          type="color"
          value={v}
          onChange={(e) => onChange(commitText(e.target.value, field.required))}
          className="h-9 w-16 cursor-pointer p-1"
        />
        <Input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(commitText(e.target.value, field.required))}
          className="min-w-0 font-mono text-xs"
          placeholder={field.required ? "#000000" : "(none)"}
        />
      </div>
    </FieldShell>
  );
}

function NumberField({ field, value, onChange }: FieldProps) {
  const f = field as Extract<NpThemeSettingsField, { type: "number" }>;
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <Input
        id={field.name}
        type="number"
        value={typeof value === "number" ? String(value) : ""}
        min={f.min}
        max={f.max}
        step={f.int ? 1 : "any"}
        onChange={(e) => {
          const n = e.target.value === "" ? undefined : Number(e.target.value);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
      />
    </FieldShell>
  );
}

function BooleanField({ field, value, onChange }: FieldProps) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <Label htmlFor={field.name} className="min-w-0 cursor-pointer break-words">
        {field.description ?? field.name}
      </Label>
      <Switch id={field.name} checked={value === true} onCheckedChange={onChange} />
    </div>
  );
}

function EnumField({ field, value, onChange }: FieldProps) {
  const f = field as Extract<NpThemeSettingsField, { type: "enum" }>;
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <Select value={typeof value === "string" ? value : undefined} onValueChange={onChange}>
        <SelectTrigger id={field.name} className="min-w-0">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {f.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

function ObjectField({ field, value, onChange }: FieldProps) {
  const f = field as Extract<NpThemeSettingsField, { type: "object" }>;
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return (
    <fieldset className="min-w-0 rounded-lg border border-border/60 bg-background/30 p-3">
      <legend className="max-w-full break-words px-1 text-xs font-medium text-muted-foreground">
        {field.description ?? field.name}
      </legend>
      <div className="min-w-0 space-y-3">
        {f.fields.map((child) => (
          <FieldDispatch
            key={child.name}
            field={child}
            value={v[child.name]}
            onChange={(next) => onChange({ ...v, [child.name]: next })}
          />
        ))}
      </div>
    </fieldset>
  );
}

function ArrayField({ field, value, onChange }: FieldProps) {
  const f = field as Extract<NpThemeSettingsField, { type: "array" }>;
  const items = Array.isArray(value) ? value : [];

  function emptyItem(): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const child of f.element) {
      if (child.default !== undefined) o[child.name] = child.default;
    }
    return o;
  }

  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <div className="min-w-0 space-y-2">
        {items.length === 0 ? <p className="text-xs text-muted-foreground">No items.</p> : null}
        {items.map((item, idx) => {
          const itemV = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
          return (
            <div
              key={idx}
              className="min-w-0 space-y-2 rounded-md border border-border/60 bg-background/30 p-3"
            >
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <span className="min-w-0 break-words text-xs font-medium text-muted-foreground">
                  Item {idx + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = items.filter((_, i) => i !== idx);
                    onChange(next);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              {f.element.map((child) => (
                <FieldDispatch
                  key={child.name}
                  field={child}
                  value={itemV[child.name]}
                  onChange={(next) => {
                    const merged = { ...itemV, [child.name]: next };
                    const arr = items.slice();
                    arr[idx] = merged;
                    onChange(arr);
                  }}
                />
              ))}
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, emptyItem()])}
          className="w-full sm:w-auto"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add item
        </Button>
      </div>
    </FieldShell>
  );
}

function StringArrayField({ field, value, onChange }: FieldProps) {
  // Phase G follow-up — `z.array(z.string())` editor.
  //
  // Renders one item per line in a `<textarea>`. Empty lines are
  // dropped on **blur**, not on every keystroke (#599): while
  // the operator is mid-edit, the textarea owns its content
  // verbatim, including trailing blank lines, so typing
  // multi-line input works naturally. On blur we normalize
  // (split/trim/drop-empty) and emit the parsed array; the
  // textarea returns to being controlled by `value`.
  //
  // Plugin / theme authors who want richer affordances (chips,
  // drag-reorder, paste-from-CSV) can still target this surface
  // — for the common OAuth-scopes / category-list / tag-
  // allowlist case the line-buffer shape is the simplest
  // operator-readable representation.
  const items = Array.isArray(value)
    ? (value as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  // `draft` is null while the textarea is in sync with `value`,
  // and a raw string while the operator is mid-edit. The
  // display value falls back to the parsed-from-value joined
  // string so external resets (parent re-renders with a new
  // value) take effect when no edit is pending.
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft ?? items.join("\n");
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <Textarea
        id={field.name}
        rows={Math.max(3, items.length + 1)}
        value={displayValue}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={() => {
          if (draft === null) return;
          const lines = draft
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          onChange(lines);
          setDraft(null);
        }}
        placeholder="One item per line"
      />
    </FieldShell>
  );
}

function UnsupportedField({ field, value, onChange }: FieldProps) {
  const f = field as Extract<NpThemeSettingsField, { type: "unsupported" }>;
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <textarea
        className="h-24 w-full min-w-0 rounded-md border border-border/60 bg-background/40 p-2 font-mono text-xs"
        value={
          value === undefined
            ? ""
            : typeof value === "string"
              ? value
              : JSON.stringify(value, null, 2)
        }
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            onChange(e.target.value);
          }
        }}
      />
      <p className="break-words text-[11px] text-muted-foreground">
        Field type <code className="break-all">{f.zodTypeName}</code> doesn't have a dedicated
        editor in v0.2 — edit as JSON.
      </p>
    </FieldShell>
  );
}
