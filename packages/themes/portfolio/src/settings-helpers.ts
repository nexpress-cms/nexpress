import { getCachedThemeSettings } from "@nexpress/next";

import { portfolioSettingsSchema, type PortfolioSettings } from "./settings.js";

/**
 * Phase F.9.1-A — typed accessor over the cached theme settings
 * read.
 *
 * Uses `getCachedThemeSettings` so multiple resolveSettings()
 * calls in the same request (shell + header + footer + N
 * cards) share one DB hit through Next's `unstable_cache`.
 * The `nx:theme:<siteId>` tag invalidation handles freshness;
 * settings-save / theme-switch already bust it.
 */
export async function resolvePortfolioSettings(): Promise<PortfolioSettings> {
  const raw = await getCachedThemeSettings("portfolio");
  const parsed = portfolioSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return portfolioSettingsSchema.parse({});
}
