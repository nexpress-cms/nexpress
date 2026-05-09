import { getActiveTheme } from "./registry.js";

/**
 * Phase F.6 — extract the active theme's declared nav
 * locations as plain JSON metadata, narrowed structurally
 * because core treats `theme.impl` as opaque (`unknown`).
 *
 * Used by:
 *   - The admin nav editor's location-dropdown endpoint
 *     (`/api/navigation/locations`) so the dropdown surfaces
 *     theme-named slots with friendly labels.
 *   - Future cookbook recipes that surface "this theme
 *     expects you to fill in these menus" guidance.
 *
 * Returns `[]` when no theme is active or the active theme
 * doesn't declare any locations.
 */

export interface NpThemeNavLocationDescriptor {
  /** Location key, e.g. `"primary"`. Used as the `location`
   *  argument to `getNavigation(...)` and the database row's
   *  `(siteId, location)` lookup. */
  key: string;
  label: string;
  description?: string;
  maxItems?: number;
}

interface ImplShape {
  navLocations?: Record<
    string,
    {
      label?: unknown;
      description?: unknown;
      maxItems?: unknown;
    }
  >;
}

/**
 * Pure extractor — narrows a theme `impl` (opaque from core's
 * perspective) to a flat list of validated location
 * descriptors. Exported for unit testability without the DB
 * roundtrip that `getActiveThemeNavLocations` does.
 */
export function extractNavLocationsFromImpl(
  impl: unknown,
): NpThemeNavLocationDescriptor[] {
  const shape = impl as ImplShape | undefined;
  const declared = shape?.navLocations;
  if (!declared || typeof declared !== "object") return [];

  const out: NpThemeNavLocationDescriptor[] = [];
  for (const [key, raw] of Object.entries(declared)) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.label !== "string") continue;
    out.push({
      key,
      label: raw.label,
      description:
        typeof raw.description === "string" ? raw.description : undefined,
      maxItems:
        typeof raw.maxItems === "number" ? raw.maxItems : undefined,
    });
  }
  return out;
}

export async function getActiveThemeNavLocations(): Promise<
  NpThemeNavLocationDescriptor[]
> {
  const theme = await getActiveTheme();
  if (!theme) return [];
  return extractNavLocationsFromImpl(theme.impl);
}
