import { getCachedThemeSettings } from "@nexpress/next";

import { communitySettingsSchema, type CommunitySettings } from "./settings.js";

export async function resolveCommunitySettings(): Promise<CommunitySettings> {
  const raw = await getCachedThemeSettings("community");
  const parsed = communitySettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : communitySettingsSchema.parse({});
}
