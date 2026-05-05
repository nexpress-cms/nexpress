import {
  NpForbiddenError,
  NpValidationError,
  getThemeTemplateSummaries,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 11.3 — admin-side endpoint that returns the list of
 * page templates the active theme registers for a given
 * collection. The page edit form's `template` picker calls this
 * to populate its dropdown so the choices stay in sync with
 * whichever theme the admin has activated.
 *
 * Output shape:
 *   { docs: [{ id, label, description? }, ...] }
 *
 * Empty array (rather than 404) when the active theme doesn't
 * register any templates for the requested collection — the
 * admin form treats that as "no template picker, plain text
 * field." Editor-or-above gated; this is admin-internal data
 * (theme metadata) that doesn't belong on the public site.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("themeTemplates", "list");
    }
    const collection = request.nextUrl.searchParams.get("collection");
    if (!collection) {
      throw new NpValidationError("Invalid input", [
        { field: "collection", message: "collection query param required" },
      ]);
    }
    const docs = await getThemeTemplateSummaries(collection);
    return npSuccessResponse({ docs });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
