import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  getCurrentSiteId,
  getTheme,
  npSettings,
  can,
} from "@nexpress/core";
import { npAnalyzeThemeTokens } from "@nexpress/core/theme";
import { bustThemeCache, readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { getDb } from "../../../lib/db";

export async function GET(_request: NextRequest) {
  try {
    return npSuccessResponse(await getTheme());
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("settings/theme", "update");
    }

    const theme = await readJsonBody(request);

    const tokenIssues = npAnalyzeThemeTokens(theme);
    if (tokenIssues.length > 0) {
      throw new NpValidationError(
        "Invalid input",
        tokenIssues.map((issue) => ({ field: issue.path, message: issue.message })),
      );
    }

    const db = getDb();
    const now = new Date();
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;

    await db
      .insert(npSettings)
      .values({
        siteId,
        key: "theme",
        value: theme,
        updatedAt: now,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: [npSettings.siteId, npSettings.key],
        set: { value: theme, updatedAt: now, updatedBy: user.id },
      });

    // Phase 14.3 — site-scoped tag matches the cache helpers in
    // `@nexpress/next`. `bustThemeCache` also forwards the same
    // hints to any configured CDN purge adapter.
    await bustThemeCache(siteId);

    return npSuccessResponse(theme);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export { PUT as PATCH };
