import { getThemeSettings } from "@nexpress/core";

import {
  portfolioSettingsSchema,
  type PortfolioSettings,
} from "./settings.js";

/**
 * Phase F.9.1-A — typed accessor over `getThemeSettings("portfolio")`.
 *
 * Same pattern as docs / magazine: zod parses the persisted
 * unknown into the typed shape, falls back to schema defaults
 * on parse failure.
 */
export async function resolvePortfolioSettings(): Promise<PortfolioSettings> {
  const raw = await getThemeSettings("portfolio");
  const parsed = portfolioSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return portfolioSettingsSchema.parse({});
}
