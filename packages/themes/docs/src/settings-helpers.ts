import { getCachedThemeSettings } from "@nexpress/next";

import { docsSettingsSchema, type DocsSettings } from "./settings.js";

/**
 * Phase F.9-B / F.9.1-B — typed accessor over the cached theme
 * settings read.
 *
 * Uses `getCachedThemeSettings` so multiple resolveSettings()
 * calls in the same request (header + sidebar + page template +
 * search) share one DB hit via Next's `unstable_cache`. The
 * `nx:theme:<siteId>` tag handles invalidation.
 *
 * On parse failure (theme upgrade changed the shape, etc.)
 * falls back to the schema defaults. The admin's
 * `getThemeSettingsWithStatus` surfaces a banner when this
 * happens; the runtime keeps rendering with safe values.
 */
export async function resolveDocsSettings(): Promise<DocsSettings> {
  const raw = await getCachedThemeSettings("docs");
  const parsed = docsSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return docsSettingsSchema.parse({});
}
