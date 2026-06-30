import type { NpCollectionConfig, NpFieldConfig } from "@nexpress/core";

function findNamedField(fields: NpFieldConfig[], name: string): NpFieldConfig | null {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      const nested = findNamedField(field.fields, name);
      if (nested) return nested;
      continue;
    }

    if (field.name === name) return field;

    if (field.type === "group") {
      const nested = findNamedField(field.fields, name);
      if (nested) return nested;
    }
  }

  return null;
}

export function resolveCreateKindPreset(
  config: NpCollectionConfig,
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;

  const kindField = findNamedField(config.fields, "kind");
  if (!kindField || kindField.type !== "select" || kindField.hasMany) return undefined;

  return kindField.options.some((option) => option.value === value) ? value : undefined;
}
