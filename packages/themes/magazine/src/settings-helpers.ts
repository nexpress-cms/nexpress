import { getCachedThemeSettings } from "@nexpress/next";

import { magazineSettingsSchema, type MagazineSettings } from "./settings.js";

/**
 * Phase F.9.1-A — typed accessor over the cached theme settings
 * read.
 *
 * Uses `getCachedThemeSettings` (wraps `unstable_cache` with
 * the `nx:theme:<siteId>` tag) instead of the raw
 * `getThemeSettings` so multiple settings reads in the same
 * request — e.g. a project-index template + N async project
 * cards each calling resolveSettings — share one DB hit. The
 * tag invalidation already covers settings-save / theme-switch
 * via the framework's bust paths, so the cache stays correct.
 *
 * Core returns `unknown` because it can't narrow to a specific
 * theme's schema; this wrapper parses through Zod so theme
 * components consume `MagazineSettings` directly. Falls back
 * to schema defaults on parse failure (admin shows the
 * "settings reset" banner via `getThemeSettingsWithStatus`).
 */
export async function resolveMagazineSettings(): Promise<MagazineSettings> {
  const raw = await getCachedThemeSettings("magazine");
  const parsed = magazineSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return magazineSettingsSchema.parse({});
}
