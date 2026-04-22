"use client";

import { lazy, Suspense, type ComponentType } from "react";
import type { NxFieldConfig } from "@nexpress/core";
import type { NxBlockInstance } from "@nexpress/blocks";
import type { NxRichTextContent } from "@nexpress/editor";
import { ChevronDown } from "lucide-react";
import type { Control, FieldPath } from "react-hook-form";

import { ArrayFieldEditor } from "./fields/array-field-editor.js";
import { MediaPickerField } from "./fields/media-picker-field.js";
import { RelationshipField } from "./fields/relationship-field.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";

interface FieldRendererProps {
  field: NxFieldConfig;
  control: Control<Record<string, unknown>>;
  namePrefix?: string;
}

const LazyRichTextEditor = lazy(async () => {
  const module = await import("@nexpress/editor/client");
  return {
    default: module.NxRichTextEditor as ComponentType<{
      value: NxRichTextContent | null;
      onChange: (value: unknown) => void;
      config?: unknown;
    }>,
  };
});

const LazyBlockPageEditor = lazy(async () => {
  const module = await import("@nexpress/blocks/client");
  return {
    default: module.BlockPageEditor as ComponentType<{
      blocks: NxBlockInstance[];
      onChange: (blocks: NxBlockInstance[]) => void;
      availableBlocks: unknown[];
    }>,
  };
});

const buildFieldName = (fieldName: string, namePrefix?: string): string => (namePrefix ? `${namePrefix}.${fieldName}` : fieldName);

const isRichTextContent = (value: unknown): value is NxRichTextContent => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const root = (value as { root?: unknown }).root;
  return typeof root === "object" && root !== null;
};

const toBlockInstances = (value: unknown): NxBlockInstance[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const candidate = item as Partial<NxBlockInstance>;
    if (typeof candidate.id !== "string" || typeof candidate.type !== "string") {
      return [];
    }

    return [
      {
        id: candidate.id,
        type: candidate.type,
        props:
          typeof candidate.props === "object" && candidate.props !== null && !Array.isArray(candidate.props)
            ? (candidate.props)
            : {},
      },
    ];
  });
};

const formatDateValue = (value: unknown, includeTime: boolean): string => {
  if (typeof value === "string") {
    return includeTime ? value.slice(0, 16) : value.slice(0, 10);
  }

  if (value instanceof Date) {
    const iso = value.toISOString();
    return includeTime ? iso.slice(0, 16) : iso.slice(0, 10);
  }

  return "";
};

const renderDescription = (description?: string) =>
  description ? <FormDescription>{description}</FormDescription> : null;

const renderNamedField = (
  field: Extract<NxFieldConfig, { name: string }>,
  control: Control<Record<string, unknown>>,
  namePrefix?: string,
) => {
  const name = buildFieldName(field.name, namePrefix);
  const label = field.label ?? field.name;

  switch (field.type) {
    case "text":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Input {...formField} value={typeof formField.value === "string" ? formField.value : ""} />
              </FormControl>
              {renderDescription(field.admin?.description)}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "textarea":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Textarea
                  {...formField}
                  rows={field.rows ?? 5}
                  value={typeof formField.value === "string" ? formField.value : ""}
                />
              </FormControl>
              {renderDescription(field.admin?.description)}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "number":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step ?? (field.integerOnly ? 1 : undefined)}
                  value={typeof formField.value === "number" || typeof formField.value === "string" ? String(formField.value) : ""}
                  onChange={(event: { target: { value: string } }) => {
                    const value = event.target.value;
                    formField.onChange(value === "" ? undefined : field.integerOnly ? parseInt(value, 10) : Number(value));
                  }}
                />
              </FormControl>
              {renderDescription(field.admin?.description)}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "email":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Input {...formField} type="email" value={typeof formField.value === "string" ? formField.value : ""} />
              </FormControl>
              {renderDescription(field.admin?.description)}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "richText":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Suspense fallback={<div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">Loading editor…</div>}>
                  <LazyRichTextEditor
                    value={isRichTextContent(formField.value) ? formField.value : null}
                    onChange={formField.onChange}
                    config={field.editor}
                  />
                </Suspense>
              </FormControl>
              {renderDescription(field.admin?.description)}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "blocks":
      return (
        <FormField
          control={control}
          name={name as never}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Suspense fallback={<div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">Loading blocks editor…</div>}>
                  <LazyBlockPageEditor
                    blocks={toBlockInstances(formField.value)}
                    onChange={formField.onChange}
                    availableBlocks={[]}
                  />
                </Suspense>
              </FormControl>
              <FormDescription>Allowed blocks: {(field.allowedBlocks ?? []).join(", ") || "No block registry connected yet."}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "checkbox":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-xl border border-border/60 px-4 py-3">
              <div className="space-y-1">
                <FormLabel>{label}</FormLabel>
                {renderDescription(field.admin?.description)}
              </div>
              <FormControl>
                <Switch checked={formField.value === true} onCheckedChange={formField.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "date":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => {
            const includeTime = Boolean(field.pickerOptions?.includeTime);

            return (
              <FormItem>
                <FormLabel>{label}</FormLabel>
                <FormControl>
                  <Input
                    type={includeTime ? "datetime-local" : "date"}
                    value={formatDateValue(formField.value, includeTime)}
                    onChange={formField.onChange}
                  />
                </FormControl>
                {renderDescription(field.admin?.description)}
                <FormMessage />
              </FormItem>
            );
          }}
        />
      );
    case "select":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <Select value={typeof formField.value === "string" ? formField.value : undefined} onValueChange={formField.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {field.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {renderDescription(field.admin?.description)}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "radio":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <fieldset className="space-y-3">
                  {field.options.map((option) => (
                    <label key={option.value} className="flex items-center gap-3 text-sm">
                      <input
                        type="radio"
                        name={formField.name}
                        value={option.value}
                        checked={formField.value === option.value}
                        onChange={() => formField.onChange(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </fieldset>
              </FormControl>
              {renderDescription(field.admin?.description)}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "upload":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <MediaPickerField
                  value={typeof formField.value === "string" ? formField.value : ""}
                  onChange={formField.onChange}
                  relationTo={field.relationTo}
                />
              </FormControl>
              {renderDescription(field.admin?.description)}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "relationship":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <RelationshipField
                  relationTo={field.relationTo}
                  hasMany={field.hasMany}
                  value={
                    field.hasMany
                      ? Array.isArray(formField.value)
                        ? formField.value.map((item: unknown) => String(item))
                        : []
                      : typeof formField.value === "string"
                        ? formField.value
                        : ""
                  }
                  onChange={formField.onChange}
                />
              </FormControl>
              {renderDescription(field.admin?.description)}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "json":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Textarea
                  rows={10}
                  value={JSON.stringify(formField.value ?? {}, null, 2)}
                  onChange={(event: { target: { value: string } }) => {
                    const nextValue = event.target.value;

                    try {
                      formField.onChange(nextValue.trim() ? JSON.parse(nextValue) : {});
                    } catch {
                      formField.onChange(nextValue);
                    }
                  }}
                />
              </FormControl>
              <FormDescription>Enter valid JSON or keep editing until the structure is complete.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case "array":
      return (
        <ArrayFieldEditor
          control={control}
          field={field}
          name={name}
          renderField={({ field: nestedField, control: nestedControl, namePrefix: nestedPrefix }) => (
            <FieldRenderer field={nestedField} control={nestedControl} namePrefix={nestedPrefix} />
          )}
        />
      );
    case "group":
      return (
        <fieldset className="space-y-4 rounded-2xl border border-border/60 p-5">
          <legend className="px-2 text-sm font-semibold text-foreground">{label}</legend>
          {field.fields.map((nestedField, index) => (
            <FieldRenderer
              key={nestedField.type === "row" || nestedField.type === "collapsible" ? `${nestedField.type}-${index}` : nestedField.name}
              field={nestedField}
              control={control}
              namePrefix={buildFieldName(field.name, namePrefix)}
            />
          ))}
        </fieldset>
      );
    default:
      return null;
  }
};

export function FieldRenderer({ field, control, namePrefix }: FieldRendererProps) {
  if (field.type === "row") {
    return (
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {field.fields.map((nestedField, index) => (
          <div
            key={nestedField.type === "row" || nestedField.type === "collapsible" ? `${nestedField.type}-${index}` : nestedField.name}
            className="flex-1"
          >
            <FieldRenderer field={nestedField} control={control} namePrefix={namePrefix} />
          </div>
        ))}
      </div>
    );
  }

  if (field.type === "collapsible") {
    return (
      <Collapsible className="rounded-2xl border border-border/60">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium">
          <span>{field.label}</span>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 border-t border-border/60 px-4 py-4">
          {field.fields.map((nestedField, index) => (
            <FieldRenderer
              key={nestedField.type === "row" || nestedField.type === "collapsible" ? `${nestedField.type}-${index}` : nestedField.name}
              field={nestedField}
              control={control}
              namePrefix={namePrefix}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return renderNamedField(field, control, namePrefix);
}
