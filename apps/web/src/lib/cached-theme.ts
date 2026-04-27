import { getCachedActiveThemeId } from "@nexpress/next";
import { getRegisteredThemes, getThemeById } from "@nexpress/theme";
import type { NxTheme } from "@nexpress/theme";

/**
 * Phase 14.3 — typed-active-theme accessor that hits the
 * cache for the persisted id but resolves through
 * `@nexpress/theme`'s typed registry helpers so the rest of
 * the site code keeps reading `active.impl.templates` etc.
 * without casts.
 *
 * Mirrors `core.getActiveTheme()`'s semantics: if the
 * persisted id resolves to a registered theme, return it;
 * otherwise fall back to the first registered theme; otherwise
 * `null`.
 */
export async function getCachedActiveTheme(): Promise<NxTheme | null> {
  const id = await getCachedActiveThemeId();
  if (id) {
    const typed = getThemeById(id);
    if (typed) return typed;
  }
  const all = getRegisteredThemes();
  return all[0] ?? null;
}
