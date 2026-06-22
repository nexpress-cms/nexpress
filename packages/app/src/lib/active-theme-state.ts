import { getActiveThemeId, getRegisteredThemes, getThemeById } from "@nexpress/core";

export type NpActiveThemeFallbackReason = "unset" | "missing" | null;

export interface NpActiveThemeState {
  persistedActiveId: string | null;
  effectiveActiveId: string | null;
  fallbackReason: NpActiveThemeFallbackReason;
}

/**
 * Mirrors `getActiveTheme()` without returning the full theme.
 * Admin APIs need both values: the effective id for the active
 * badge and the persisted id so the UI can explain stale settings
 * after a theme package is removed from `nexpress.config.ts`.
 */
export async function getActiveThemeState(): Promise<NpActiveThemeState> {
  const persistedActiveId = await getActiveThemeId();
  if (persistedActiveId && getThemeById(persistedActiveId)) {
    return {
      persistedActiveId,
      effectiveActiveId: persistedActiveId,
      fallbackReason: null,
    };
  }

  const firstRegisteredId = getRegisteredThemes()[0]?.manifest.id ?? null;
  return {
    persistedActiveId,
    effectiveActiveId: firstRegisteredId,
    fallbackReason: persistedActiveId ? "missing" : firstRegisteredId ? "unset" : null,
  };
}
