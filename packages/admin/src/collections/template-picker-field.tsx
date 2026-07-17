"use client";

import { useEffect, useState } from "react";
import type { Control } from "react-hook-form";

import { npFetch } from "../lib/api-client.js";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

interface TemplateSummary {
  id: string;
  label: string;
  description?: string;
}

interface TemplatePickerFieldProps {
  control: Control<Record<string, unknown>>;
  name: string;
  label: string;
  collection: string;
  description?: string;
}

/**
 * Phase 11.3 — admin replacement for fields marked
 * `admin.kind: "templatePicker"`. Fetches the available
 * templates from the active theme's registry on mount,
 * renders a Select. Falls back to a plain Input if the active
 * theme doesn't ship templates for this collection — the page
 * still saves a string value, just without UI guidance.
 *
 * Loading state shows a disabled placeholder so the form
 * doesn't reflow on hydrate.
 */
export function TemplatePickerField({
  control,
  name,
  label,
  collection,
  description,
}: TemplatePickerFieldProps) {
  const [templates, setTemplates] = useState<TemplateSummary[] | "loading" | "none">("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await npFetch(
          `/api/admin/themes/active/templates?collection=${encodeURIComponent(collection)}`,
        );
        if (!res.ok) {
          if (!cancelled) setTemplates("none");
          return;
        }
        const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const data = (raw?.data ?? raw) as { docs?: TemplateSummary[] };
        const docs = Array.isArray(data?.docs) ? data.docs : [];
        if (!cancelled) {
          setTemplates(docs.length > 0 ? docs : "none");
        }
      } catch {
        if (!cancelled) setTemplates("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collection]);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field: formField }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {templates === "loading" ? (
              <Input value="" disabled placeholder="Loading templates…" />
            ) : templates === "none" ? (
              // Active theme doesn't expose templates for this
              // collection. Keep the field editable as a plain
              // text input so admin can still type a value
              // (useful when activating a theme that shipped the
              // template id later).
              <Input
                {...formField}
                value={typeof formField.value === "string" ? formField.value : ""}
                placeholder="No templates registered by the active theme"
              />
            ) : (
              <Select
                value={
                  typeof formField.value === "string" && formField.value
                    ? formField.value
                    : "default"
                }
                onValueChange={(v) => formField.onChange(v === "default" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormControl>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          {Array.isArray(templates) && typeof formField.value === "string" ? (
            <ActiveDescriptionLine templates={templates} value={formField.value || "default"} />
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ActiveDescriptionLine({
  templates,
  value,
}: {
  templates: TemplateSummary[];
  value: string;
}) {
  const found = templates.find((t) => t.id === value);
  if (!found?.description) return null;
  return <p className="text-xs text-muted-foreground italic">{found.description}</p>;
}
