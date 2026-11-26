import type { NpThemeSettingsField } from "../themes/settings-schema.js";

/** Initial values shared by theme settings and plugin config forms. */
export function settingsDefaultsFromFields(
  fields: NpThemeSettingsField[],
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.default !== undefined) {
      defaults[field.name] = field.default;
    } else if (field.type === "object") {
      defaults[field.name] = settingsDefaultsFromFields(field.fields);
    } else if (field.type === "array") {
      defaults[field.name] = [];
    }
  }
  return defaults;
}
