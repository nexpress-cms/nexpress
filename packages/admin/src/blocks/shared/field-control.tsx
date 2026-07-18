"use client";

import { Suspense, lazy, type ComponentType } from "react";
import type { NpBlockPropField } from "@nexpress/blocks";
import { isNpRichTextContent } from "@nexpress/core/fields";

import { parseFieldInput } from "../editor-engine/index.js";
import { useCollectionOptions } from "../registry-context.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";

import { ArrayFieldControl } from "./array-field-control.js";
import { BlockImagePicker } from "./block-image-picker.js";

/**
 * Lexical editor — same lazy pattern the collection field-renderer
 * uses. Loads only when a `richtext` block prop actually
 * mounts so pages without rich-text blocks don't pay for Lexical's
 * bundle.
 */
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

/**
 * Type-guards a value as a NexPress rich-text v1 envelope.
 * Used to decide whether to feed the loaded editor an existing
 * value or `null` (initial state).
 */
export interface FieldControlProps {
  field: NpBlockPropField;
  value: unknown;
  onChange: (next: unknown) => void;
  inputId: string;
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported block prop field: ${String(value)}`);
}

/**
 * Switch on field type → renders the appropriate input. Pure
 * presentational layer over the engine's parse/validate helpers.
 * Both the form-card editor and Doc view's settings dialog mount
 * this component to render a single block prop.
 */
export function FieldControl({ field, value, onChange, inputId }: FieldControlProps) {
  // Hooks must run unconditionally so the React rules of hooks
  // hold even when the field type is something other than
  // "collection".
  const collectionOptions = useCollectionOptions();

  if (field.type === "collection") {
    // The option list is injected via context by the host's admin
    // layout (server-side, after bootstrap → after plugin
    // collections register). When the list is empty (older mounts
    // that didn't pass `collectionOptions`), we fall back to a
    // free-text input so the form still works — better than
    // disabling the field outright.
    const stringValue = typeof value === "string" ? value : "";
    if (collectionOptions.length === 0) {
      return (
        <Input
          id={inputId}
          value={stringValue}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="collection slug"
          className="min-w-0"
        />
      );
    }
    return (
      <Select value={stringValue} onValueChange={(v) => onChange(v)}>
        <SelectTrigger id={inputId} className="min-w-0">
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
        className="min-w-0"
      />
    );
  }

  if (field.type === "richtext") {
    // Real Lexical editor instead of the legacy JSON-in-textarea
    // fallback. The block prop stores the parsed Lexical content
    // object; the editor pushes updates back via onChange.
    return (
      <Suspense
        fallback={
          <div className="rounded-md border border-dashed border-border/60 px-3 py-3 text-xs text-muted-foreground">
            Loading editor…
          </div>
        }
      >
        <LazyRichTextEditor
          value={isNpRichTextContent(value) ? value : null}
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

  if (field.type === "array") {
    // ArrayFieldControl recurses back into FieldControl for its
    // child fields. Pass FieldControl through props to break the
    // import cycle.
    return (
      <ArrayFieldControl
        field={field}
        value={value}
        onChange={onChange}
        inputId={inputId}
        FieldControl={FieldControl}
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
        <SelectTrigger id={inputId} className="min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
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
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <Switch
          id={inputId}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
        <Label htmlFor={inputId} className="min-w-0 break-words text-sm font-normal">
          {field.label}
        </Label>
      </div>
    );
  }

  if (field.type === "color") {
    // Browser native picker. Store as `#rrggbb` so
    // `style={{ color }}` works directly. The text input next to
    // it lets operators paste arbitrary CSS colors
    // (rgb/hsl/var(...)) when the picker is too restrictive for
    // theme-token references.
    const stringValue = typeof value === "string" ? value : "";
    return (
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <input
          id={inputId}
          type="color"
          value={/^#([0-9a-fA-F]{6})$/.test(stringValue) ? stringValue : "#000000"}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="h-10 w-12 cursor-pointer rounded-md border border-input bg-background sm:h-9"
        />
        <Input
          value={stringValue}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="#000000 or var(--np-color-primary)"
          className="min-w-0 font-mono text-xs"
        />
      </div>
    );
  }

  if (field.type !== "text" && field.type !== "url" && field.type !== "number") {
    return assertNever(field);
  }

  const requiredMissing =
    field.required === true && (value === undefined || value === "" || value === null);

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
      min={field.type === "number" && typeof field.min === "number" ? field.min : undefined}
      max={field.type === "number" && typeof field.max === "number" ? field.max : undefined}
      step={field.type === "number" && typeof field.step === "number" ? field.step : undefined}
      pattern={
        (field.type === "text" || field.type === "url") && field.pattern ? field.pattern : undefined
      }
      aria-invalid={requiredMissing || undefined}
      className={
        requiredMissing ? "min-w-0 border-rose-500/60 focus-visible:ring-rose-500/40" : "min-w-0"
      }
    />
  );
}
