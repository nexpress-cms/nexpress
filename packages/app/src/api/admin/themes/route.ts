import {
  NpForbiddenError,
  checkThemeRequirements,
  getAllCollectionSlugs,
  getCollectionConfig,
  getRegisteredThemes,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { getActiveThemeState } from "../../../lib/active-theme-state";
import { requireAuth } from "../../../lib/auth-helpers";
import { ensureFor } from "../../../lib/init-core";

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
 *   {
 *     activeId,
 *     persistedActiveId,
 *     activeFallbackReason,
 *     docs: [{ id, name, version, description?, author?, isActive }, ...]
 *   }
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("themes", "list");
    }
    const themes = getRegisteredThemes();
    const activeState = await getActiveThemeState();
    // Phase F.1 — surface theme manifest.requires mismatches so
    // the admin switcher can warn the operator before activation.
    // The check is cheap (in-memory only, no DB) so we run it for
    // every listed theme; the future Phase F.8 CLI consumes the
    // same data shape.
    const collections = getAllCollectionSlugs().map((slug) => getCollectionConfig(slug));
    const docs = themes.map((theme) => {
      const check = checkThemeRequirements(theme.manifest, collections);
      return {
        id: theme.manifest.id,
        name: theme.manifest.name,
        version: theme.manifest.version,
        description: theme.manifest.description,
        author: theme.manifest.author,
        isActive: theme.manifest.id === activeState.effectiveActiveId,
        requirements: {
          hasMismatches: check.hasMismatches,
          hasHardMismatches: check.hasHardMismatches,
          missingCollections: check.missingCollections,
          missingFields: check.missingFields,
          typeConflicts: check.typeConflicts,
          relationConflicts: check.relationConflicts,
        },
      };
    });
    return npSuccessResponse({
      activeId: activeState.effectiveActiveId,
      persistedActiveId: activeState.persistedActiveId,
      activeFallbackReason: activeState.fallbackReason,
      docs,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
