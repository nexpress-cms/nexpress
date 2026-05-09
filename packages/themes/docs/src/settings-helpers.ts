import { getThemeSettings } from "@nexpress/core";

import { docsSettingsSchema, type DocsSettings } from "./settings.js";

/**
 * Phase F.9-B — typed accessor over the framework's
 * `getThemeSettings()`. Core returns `unknown` because it
 * can't narrow to a specific theme's schema; this wrapper
 * parses the persisted value through `docsSettingsSchema` so
 * theme components consume `DocsSettings` directly.
 *
 * On parse failure (theme upgrade changed the shape, etc.)
 * falls back to the schema defaults. The admin's
 * `getThemeSettingsWithStatus` surfaces a banner when this
 * happens; the runtime keeps rendering with safe values.
 */
export async function resolveDocsSettings(): Promise<DocsSettings> {
  const raw = await getThemeSettings("docs");
  const parsed = docsSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return docsSettingsSchema.parse({});
}
