import {
  NxForbiddenError,
  getTranslationProgress,
  hasRole,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Phase 12.6 — translation completeness snapshot for the
 * admin Settings → Locales view. Returns one entry per
 * i18n-enabled collection: total distinct translation groups,
 * per-locale row counts, and the per-locale "missing" delta
 * so the admin can see which locales are lagging at a glance.
 *
 * Editor-or-above; same gate as `GET /api/admin/i18n`.
 * Returns `null` (200) when no i18n config is set so the UI
 * can render the empty state without an error toast.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!hasRole(user, "editor")) {
      throw new NxForbiddenError("i18n/progress", "read");
    }
    const progress = await getTranslationProgress();
    return nxSuccessResponse(progress);
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
