"use client";

import { lazy, Suspense, type ComponentType } from "react";
import type { NpFieldConfig } from "@nexpress/core";
import { isNpRichTextContent, npValidateBlockContent } from "@nexpress/core/fields";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import { useBlocksRegistry } from "../blocks/registry-context.js";
import type { NpEditorConfig, NpRichTextContent } from "@nexpress/editor";
import { ChevronDown } from "lucide-react";
import type { Control } from "react-hook-form";

import { ArrayFieldEditor } from "./fields/array-field-editor.js";
import { MediaPickerField } from "./fields/media-picker-field.js";
import { RelationshipField } from "./fields/relationship-field.js";
import { TemplatePickerField } from "./template-picker-field.js";
import { npFetch } from "../lib/api-client.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";

/**
 * Default staff-side image uploader for `NpRichTextEditor`'s
 * Insert Image dialog (Phase 9.7j). Posts to the framework's
 * convention endpoint `/api/media/upload`. Field configs may
 * override via `editor.onUploadImage` for sites with custom
 * media pipelines.
 */
async function defaultStaffImageUpload(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await npFetch("/api/media/upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string; details?: Array<{ message?: string }> };
    } | null;
    const detail = body?.error?.details?.[0]?.message;
    const message = detail ?? body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  const json = (await res.json()) as { data?: { url?: string }; url?: string } | null;
  const url = json?.data?.url ?? json?.url ?? null;
  if (!url) throw new Error("Upload succeeded but no URL was returned.");
  return { url };
}

interface FieldRendererProps {
  field: NpFieldConfig;
  control: Control<Record<string, unknown>>;
  namePrefix?: string;
  /**
   * Collection slug the field belongs to. Optional today —
   * only the Phase 11.3 `templatePicker` widget needs it (it
   * fetches `/api/admin/themes/active/templates?collection=…`
   * to populate the dropdown). Other widgets ignore it.
   */
  collectionSlug?: string;
}

const LazyRichTextEditor = lazy(async () => {
  const module = await import("@nexpress/editor/client");
  return {
    default: module.NpRichTextEditor as ComponentType<{
      value: NpRichTextContent | null;
      onChange: (value: unknown) => void;
      config?: unknown;
    }>,
  };
});

// The block page editor lives in `@nexpress/admin` itself (see
// ../blocks/) so it can use admin's Radix/Tailwind primitives
// directly. Lazy-loaded for the same reason richText is — page
// edit views rarely need both, and the editor pulls dnd-kit.
const LazyBlockPageEditor = lazy(async () => {
  const module = await import("../blocks/block-page-editor.js");
  return {
    default: module.BlockPageEditor as ComponentType<{
      blocks: NpBlockInstance[];
      onChange: (blocks: NpBlockInstance[]) => void;
      availableBlocks: NpBlockMetadata[];
      viewScope?: string;
    }>,
  };
});

const buildFieldName = (fieldName: string, namePrefix?: string): string =>
  namePrefix ? `${namePrefix}.${fieldName}` : fieldName;

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

const renderTextDescription = (
  description: string | undefined,
  value: unknown,
  maxLength: number | undefined,
) => {
  if (!description && maxLength === undefined) return null;
  const length = typeof value === "string" ? value.length : 0;
  return (
    <FormDescription className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      {description ? <span className="min-w-0 break-words">{description}</span> : <span />}
      {maxLength !== undefined ? (
        <span className="shrink-0 tabular-nums">
          {length}/{maxLength}
        </span>
      ) : null}
    </FormDescription>
  );
};

interface BlocksFieldRenderProps {
  control: Control<Record<string, unknown>>;
  name: string;
  label: string;
  allowedTypes: string[] | undefined;
  collectionSlug?: string;
}

function BlocksFieldRender({
  control,
  name,
  label,
  allowedTypes,
  collectionSlug,
}: BlocksFieldRenderProps) {
  // Read from the BlocksRegistryProvider context. The admin
  // protected layout populates that with the SERVER-resolved
  // registry (defaults + plugin contributions). Direct calls to
  // `getRegisteredBlocks()` would only see the browser module-
  // instance — defaults only, never the plugin blocks registered
  // during the Node-side bootstrap.
  const allDefinitions = useBlocksRegistry();
  const availableBlocks: NpBlockMetadata[] =
    allowedTypes && allowedTypes.length > 0
      ? allDefinitions.filter((definition) => allowedTypes.includes(definition.type))
      : allDefinitions;
  const blockLabels = availableBlocks
    .map((definition) => definition.label ?? definition.type)
    .join(", ");
  return (
    <FormField
      control={control}
      name={name as never}
      render={({ field: formField }) => {
        const validation = npValidateBlockContent(formField.value ?? []);
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            {validation.ok ? (
              <FormControl>
                <Suspense
                  fallback={
                    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      Loading blocks editor…
                    </div>
                  }
                >
                  <LazyBlockPageEditor
                    blocks={validation.value}
                    onChange={formField.onChange}
                    availableBlocks={availableBlocks}
                    viewScope={collectionSlug ? `${collectionSlug}.${name}` : undefined}
                  />
                </Suspense>
              </FormControl>
            ) : (
              <div
                role="alert"
                className="rounded-xl border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                This field contains invalid block content and cannot be edited safely:{" "}
                {validation.message}
              </div>
            )}
            <FormDescription>
              {availableBlocks.length === 0
                ? "No block definitions available."
                : `Available blocks: ${blockLabels}`}
            </FormDescription>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

const renderNamedField = (
  field: Extract<NpFieldConfig, { name: string }>,
  control: Control<Record<string, unknown>>,
  namePrefix?: string,
  collectionSlug?: string,
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
                <Input
                  {...formField}
                  minLength={field.minLength}
                  maxLength={field.maxLength}
                  value={typeof formField.value === "string" ? formField.value : ""}
                />
              </FormControl>
              {renderTextDescription(field.admin?.description, formField.value, field.maxLength)}
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
                  minLength={field.minLength}
                  maxLength={field.maxLength}
                  rows={field.rows ?? 5}
                  value={typeof formField.value === "string" ? formField.value : ""}
                />
              </FormControl>
              {renderTextDescription(field.admin?.description, formField.value, field.maxLength)}
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
                  value={
                    typeof formField.value === "number" || typeof formField.value === "string"
                      ? String(formField.value)
                      : ""
                  }
                  onChange={(event: { target: { value: string } }) => {
                    const value = event.target.value;
                    formField.onChange(
                      value === ""
                        ? undefined
                        : field.integerOnly
                          ? parseInt(value, 10)
                          : Number(value),
                    );
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
                <Input
                  {...formField}
                  type="email"
                  value={typeof formField.value === "string" ? formField.value : ""}
                />
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
                <Suspense
                  fallback={
                    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      Loading editor…
                    </div>
                  }
                >
                  <LazyRichTextEditor
                    value={isNpRichTextContent(formField.value) ? formField.value : null}
                    onChange={formField.onChange}
                    config={{
                      ...field.editor,
                      // Default to the framework `/api/media/upload`
                      // staff endpoint when the field config doesn't
                      // already override the uploader. `field.editor`
                      // is `NpEditorConfig` from core (intentionally
                      // minimal — no `File` types); cast through
                      // editor's full `NpEditorConfig` to read the
                      // optional uploader.
                      onUploadImage:
                        (field.editor as NpEditorConfig | undefined)?.onUploadImage ??
                        defaultStaffImageUpload,
                    }}
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
      // Subcomponent so the registry hook is called from a real
      // component (renderNamedField is a plain helper — calling a
      // hook from it would violate rules-of-hooks).
      return (
        <BlocksFieldRender
          control={control}
          name={name}
          label={label}
          allowedTypes={field.allowedBlocks}
          collectionSlug={collectionSlug}
        />
      );
    case "checkbox":
      return (
        <FormField
          control={control}
          name={name}
          render={({ field: formField }) => (
            <FormItem className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <FormLabel className="break-words">{label}</FormLabel>
                {renderDescription(field.admin?.description)}
              </div>
              <FormControl>
                <Switch
                  checked={formField.value === true}
                  onCheckedChange={formField.onChange}
                  className="shrink-0"
                />
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
              <Select
                value={typeof formField.value === "string" ? formField.value : undefined}
                onValueChange={formField.onChange}
              >
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
                    <label
                      key={option.value}
                      className="flex min-h-10 min-w-0 items-center gap-3 text-sm sm:min-h-0"
                    >
                      <input
                        type="radio"
                        name={formField.name}
                        value={option.value}
                        checked={formField.value === option.value}
                        onChange={() => formField.onChange(option.value)}
                        className="size-5 accent-primary sm:size-4"
                      />
                      <span className="min-w-0 break-words">{option.label}</span>
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
              <FormDescription>
                Enter valid JSON or keep editing until the structure is complete.
              </FormDescription>
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
          renderField={({
            field: nestedField,
            control: nestedControl,
            namePrefix: nestedPrefix,
          }) => (
            <FieldRenderer field={nestedField} control={nestedControl} namePrefix={nestedPrefix} />
          )}
        />
      );
    case "group":
      return (
        <fieldset className="min-w-0 space-y-4 rounded-xl border border-border/60 p-4 sm:p-5">
          <legend className="max-w-full break-words px-2 text-sm font-semibold text-foreground">
            {label}
          </legend>
          {field.fields.map((nestedField, index) => (
            <FieldRenderer
              key={
                nestedField.type === "row" || nestedField.type === "collapsible"
                  ? `${nestedField.type}-${index}`
                  : nestedField.name
              }
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

export function FieldRenderer({ field, control, namePrefix, collectionSlug }: FieldRendererProps) {
  if (field.type === "row") {
    return (
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start">
        {field.fields.map((nestedField, index) => (
          <div
            key={
              nestedField.type === "row" || nestedField.type === "collapsible"
                ? `${nestedField.type}-${index}`
                : nestedField.name
            }
            className="min-w-0 flex-1"
          >
            <FieldRenderer
              field={nestedField}
              control={control}
              namePrefix={namePrefix}
              collectionSlug={collectionSlug}
            />
          </div>
        ))}
      </div>
    );
  }

  if (field.type === "collapsible") {
    return (
      <Collapsible className="min-w-0 overflow-hidden rounded-xl border border-border/60">
        <CollapsibleTrigger className="flex min-h-12 min-w-0 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium sm:min-h-0">
          <span className="min-w-0 break-words">{field.label}</span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </CollapsibleTrigger>
        <CollapsibleContent className="min-w-0 space-y-4 border-t border-border/60 px-4 py-4">
          {field.fields.map((nestedField, index) => (
            <FieldRenderer
              key={
                nestedField.type === "row" || nestedField.type === "collapsible"
                  ? `${nestedField.type}-${index}`
                  : nestedField.name
              }
              field={nestedField}
              control={control}
              namePrefix={namePrefix}
              collectionSlug={collectionSlug}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Phase 11.3 — special-cased widget. Fields opt into the
  // template picker via `admin.kind: "templatePicker"`; the
  // picker fetches available templates from the active theme
  // and renders a Select. Without `collectionSlug` we can't
  // know which collection's template registry to query, so
  // fall through to the standard renderer in that case (a
  // sub-form lacking the prop just keeps the plain text input).
  if ("name" in field && field.admin?.kind === "templatePicker" && collectionSlug) {
    return (
      <TemplatePickerField
        control={control}
        name={buildFieldName(field.name, namePrefix)}
        label={field.label ?? field.name}
        collection={collectionSlug}
        description={field.admin?.description}
      />
    );
  }

  // Title-kind text fields render as a large borderless headline
  // that sits flush above the editor canvas. The label is omitted
  // (the field is its own visual cue); placeholder fills in for
  // empty states. The edit view skips the surrounding Card wrapper
  // so the title flows into whatever follows (typically a blocks
  // editor) with no card seam between them.
  //
  // `admin.description` is intentionally NOT rendered for title
  // fields — a description sitting under a giant headline reads as
  // body copy and breaks the title→editor visual flow. Authors
  // who set a description on a `kind: "title"` field probably
  // didn't intend it; treat it as advisory metadata only.
  if ("name" in field && field.type === "text" && field.admin?.kind === "title") {
    return (
      <FormField
        control={control}
        name={buildFieldName(field.name, namePrefix)}
        render={({ field: rhField }) => (
          <FormItem className="px-1">
            <FormLabel className="sr-only">{field.label ?? field.name}</FormLabel>
            <FormControl>
              <input
                {...rhField}
                minLength={field.minLength}
                maxLength={field.maxLength}
                value={typeof rhField.value === "string" ? rhField.value : ""}
                placeholder={field.admin?.placeholder ?? "Untitled"}
                aria-label={field.label ?? field.name}
                className="w-full bg-transparent px-0 py-2 text-3xl font-semibold leading-tight tracking-[-0.02em] text-neutral-950 outline-none placeholder:text-neutral-300 focus:outline-none dark:text-neutral-50 dark:placeholder:text-neutral-700 sm:text-[2rem]"
                disabled={field.admin?.readOnly}
              />
            </FormControl>
            {renderTextDescription(undefined, rhField.value, field.maxLength)}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  return renderNamedField(field, control, namePrefix, collectionSlug);
}
