"use client";

import { useCallback, useRef, useState } from "react";
import type { NpThemeSettingsField } from "@nexpress/core";
import { Trash2, Plus } from "lucide-react";

import { Button } from "../ui/button.js";
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
  const valueRef = useRef(value);
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
    <div className="space-y-4">
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
    <div className="space-y-1.5">
      <Label htmlFor={name}>{description ?? name}</Label>
      {children}
    </div>
  );
}

function TextField({ field, value, onChange }: FieldProps) {
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <Input
        id={field.name}
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
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
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

function ColorField({ field, value, onChange }: FieldProps) {
  const v = typeof value === "string" ? value : "#000000";
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <div className="flex items-center gap-2">
        <Input
          id={field.name}
          type="color"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-16 cursor-pointer p-1"
        />
        <Input
          type="text"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
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
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <Label htmlFor={field.name} className="cursor-pointer">
        {field.description ?? field.name}
      </Label>
      <Switch
        id={field.name}
        checked={value === true}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function EnumField({ field, value, onChange }: FieldProps) {
  const f = field as Extract<NpThemeSettingsField, { type: "enum" }>;
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <Select
        value={typeof value === "string" ? value : undefined}
        onValueChange={onChange}
      >
        <SelectTrigger id={field.name}>
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
  const v = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return (
    <fieldset className="rounded-lg border border-border/60 bg-background/30 p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">
        {field.description ?? field.name}
      </legend>
      <div className="space-y-3">
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
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No items.</p>
        ) : null}
        {items.map((item, idx) => {
          const itemV = (item && typeof item === "object" ? item : {}) as Record<
            string,
            unknown
          >;
          return (
            <div
              key={idx}
              className="space-y-2 rounded-md border border-border/60 bg-background/30 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
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
        >
          <Plus className="mr-1 h-3 w-3" />
          Add item
        </Button>
      </div>
    </FieldShell>
  );
}

function UnsupportedField({ field, value, onChange }: FieldProps) {
  const f = field as Extract<NpThemeSettingsField, { type: "unsupported" }>;
  return (
    <FieldShell name={field.name} description={field.description ?? field.name}>
      <textarea
        className="font-mono text-xs h-24 w-full rounded-md border border-border/60 bg-background/40 p-2"
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
      <p className="text-[11px] text-muted-foreground">
        Field type <code>{f.zodTypeName}</code> doesn't have a dedicated editor
        in v0.2 — edit as JSON.
      </p>
    </FieldShell>
  );
}
