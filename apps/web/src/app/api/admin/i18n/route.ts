import {
  NxForbiddenError,
  getI18nConfig,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 12.3 — read-only view of the configured i18n setup
 * (locales + defaultLocale). Drives the admin Settings →
 * Locales tab and the edit-form translation tabs (which need
 * to know which locales are valid before offering the
 * "create translation" action).
 *
 * Returns `{ enabled: false }` when no i18n config is set so
 * the admin UI can hide i18n-specific affordances on
 * single-locale sites without 404ing this endpoint.
 *
 * Editor-or-above gated; the locale list is technically
 * declared in nexpress.config.ts, but we keep it admin-area
 * to avoid leaking deployment internals to the public site.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NxForbiddenError("i18n", "read");
    }
    const config = getI18nConfig();
    if (!config) {
      return nxSuccessResponse({ enabled: false });
    }
    return nxSuccessResponse({
      enabled: true,
      locales: config.locales,
      defaultLocale: config.defaultLocale,
    });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
