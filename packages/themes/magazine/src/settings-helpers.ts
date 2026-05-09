import { getThemeSettings } from "@nexpress/core";

import { magazineSettingsSchema, type MagazineSettings } from "./settings.js";

/**
 * Phase F.9.1-A — typed accessor over `getThemeSettings("magazine")`.
 *
 * Core returns `unknown` because it can't narrow to a specific
 * theme's schema; this wrapper parses through Zod so theme
 * components consume `MagazineSettings` directly. Falls back
 * to schema defaults on parse failure (admin shows the
 * "settings reset" banner via `getThemeSettingsWithStatus`).
 */
export async function resolveMagazineSettings(): Promise<MagazineSettings> {
  const raw = await getThemeSettings("magazine");
  const parsed = magazineSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return magazineSettingsSchema.parse({});
}
