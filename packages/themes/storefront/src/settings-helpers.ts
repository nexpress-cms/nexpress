import { getCachedThemeSettings } from "@nexpress/next";

import { storefrontSettingsSchema, type StorefrontSettings } from "./settings.js";

export async function resolveStorefrontSettings(): Promise<StorefrontSettings> {
  const raw = await getCachedThemeSettings("storefront");
  const parsed = storefrontSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : storefrontSettingsSchema.parse({});
}
