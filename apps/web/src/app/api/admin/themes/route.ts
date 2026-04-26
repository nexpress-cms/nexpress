import {
  NxForbiddenError,
  getActiveThemeId,
  getRegisteredThemes,
  hasRole,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Phase 11.4 — registry listing for the admin theme switcher.
 *
 * Returns one entry per registered theme with the manifest
 * metadata the switcher needs to render a meaningful card
 * (name, version, description, author) plus a derived
 * `isActive` boolean so the UI can highlight the current
 * choice without a second round-trip.
 *
 * Editor-or-above is fine here — listing is read-only and the
 * data is already in the bundle. Activation (the destructive
 * action) is gated to admins on the PUT endpoint.
 *
 * Output shape:
 *   { docs: [{ id, name, version, description?, author?, isActive }, ...] }
 */
export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!hasRole(user, "editor")) {
      throw new NxForbiddenError("themes", "list");
    }
    const themes = getRegisteredThemes();
    const activeId = await getActiveThemeId();
    // When no `nx_settings.activeTheme` is persisted, the
    // resolver falls back to the first registered theme. Mirror
    // that behavior in the listing so the UI's "active" badge
    // matches what `getActiveTheme()` would return.
    const effectiveActiveId = activeId ?? themes[0]?.manifest.id ?? null;
    const docs = themes.map((theme) => ({
      id: theme.manifest.id,
      name: theme.manifest.name,
      version: theme.manifest.version,
      description: theme.manifest.description,
      author: theme.manifest.author,
      isActive: theme.manifest.id === effectiveActiveId,
    }));
    return nxSuccessResponse({ docs });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
