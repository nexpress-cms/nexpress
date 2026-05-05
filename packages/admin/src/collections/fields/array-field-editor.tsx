import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { NpArrayField, NpFieldConfig } from "@nexpress/core";
import type { Control } from "react-hook-form";
import { useFieldArray } from "react-hook-form";

import { Button } from "../../ui/button.js";
import { FormDescription, FormItem, FormLabel, FormMessage } from "../../ui/form.js";

interface RenderFieldArgs {
  field: NpFieldConfig;
  control: Control<Record<string, unknown>>;
  namePrefix: string;
}

interface ArrayFieldEditorProps {
  field: NpArrayField;
  control: Control<Record<string, unknown>>;
  name: string;
  renderField: (args: RenderFieldArgs) => ReactNode;
}

const createEmptyRow = (fields: NpFieldConfig[]): Record<string, unknown> => {
  const row: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(row, createEmptyRow(field.fields));
      continue;
    }

    if (field.type === "group") {
      row[field.name] = createEmptyRow(field.fields);
      continue;
    }

    if (field.defaultValue !== undefined) {
      row[field.name] = field.defaultValue;
      continue;
    }

    if (field.type === "array") {
      row[field.name] = [];
      continue;
    }

    if (field.type === "checkbox") {
      row[field.name] = false;
      continue;
    }

    row[field.name] = "";
  }

  return row;
};

export function ArrayFieldEditor({ field, control, name, renderField }: ArrayFieldEditorProps) {
  const { fields, append, remove } = useFieldArray({
    control: control as never,
    name: name as never,
  });
  const canAdd = field.maxRows === undefined || fields.length < field.maxRows;

  return (
    <FormItem>
      <div className="space-y-1">
        <FormLabel>{field.label ?? field.name}</FormLabel>
        {field.admin?.description ? <FormDescription>{field.admin.description}</FormDescription> : null}
      </div>

      <div className="space-y-4">
        {fields.map((item, index) => {
          const rowPrefix = `${name}.${index}`;
          const canRemove = field.minRows === undefined || fields.length > field.minRows;
          const rowKey = typeof item === "object" && item !== null && "id" in item ? String(item.id) : `${name}-${index}`;

          return (
            <div key={rowKey} className="space-y-4 rounded-xl border border-border/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">Item {index + 1}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => remove(index)} disabled={!canRemove}>
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              </div>

              <div className="space-y-4">
                {field.fields.map((nestedField, nestedIndex) => (
                  <div
                    key={nestedField.type === "row" || nestedField.type === "collapsible" ? `${nestedField.type}-${nestedIndex}` : nestedField.name}
                  >
                    {renderField({
                      field: nestedField,
                      control,
                      namePrefix: rowPrefix,
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          onClick={() => append(createEmptyRow(field.fields) as never)}
          disabled={!canAdd}
        >
          <Plus className="size-3.5" />
          Add item
        </Button>
      </div>

      <FormMessage />
    </FormItem>
  );
}
