import {
  getActiveTheme as coreGetActiveTheme,
  getRegisteredThemes as coreGetRegisteredThemes,
  getThemeById as coreGetThemeById,
} from "@nexpress/core";

import type { NxTheme } from "./define-theme.js";

/**
 * Typed re-exports of `@nexpress/core`'s registry lookups.
 *
 * Core keeps its React peer dep at zero by typing
 * `NxRegisteredTheme.impl` as `unknown`. Theme-aware callers
 * (the site layout, the catch-all page, theme docs) all want
 * `impl` typed as `NxThemeImpl` so they can read
 * `active.impl.shell` / `active.impl.slots.header` /
 * `active.impl.templates` without a cast every time.
 *
 * These wrappers narrow the return type. They're functionally
 * identical to the core helpers — same registry, same fallback
 * semantics — just with the strongly-typed shape sites
 * actually want to read.
 */
export async function getActiveTheme(): Promise<NxTheme | null> {
  return (await coreGetActiveTheme()) as NxTheme | null;
}

export function getThemeById(id: string): NxTheme | undefined {
  return coreGetThemeById(id) as NxTheme | undefined;
}

export function getRegisteredThemes(): NxTheme[] {
  return coreGetRegisteredThemes() as unknown as NxTheme[];
}
