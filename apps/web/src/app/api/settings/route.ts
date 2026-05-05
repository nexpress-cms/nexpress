import {
  NX_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  getCurrentSiteId,
  npSettings,
  validateSeoSettingsPatch,
  can,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("settings", "read");
    }

    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
    const rows = await db
      .select()
      .from(npSettings)
      .where(eq(npSettings.siteId, siteId));
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    return npSuccessResponse(settings);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("settings", "update");
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const key = typeof body.key === "string" ? body.key.trim() : "";

    if (!key) {
      throw new NpValidationError("Invalid input", [
        { field: "key", message: "Setting key is required" },
      ]);
    }

    if (body.value === undefined) {
      throw new NpValidationError("Invalid input", [
        { field: "value", message: "Setting value is required" },
      ]);
    }

    // Per-key validators run on the way in. The `seo` shape is
    // surfaced into public `<head>` tags, so a malformed string
    // (e.g. `javascript:` URL in defaultOgImage) would be a
    // content-injection hazard — `validateSeoSettingsPatch`
    // rejects those before storage.
    let value = body.value;
    if (key === "seo") {
      try {
        value = validateSeoSettingsPatch(body.value);
      } catch (err) {
        throw new NpValidationError("Invalid input", [
          {
            field: "value",
            message: err instanceof Error ? err.message : "Invalid SEO patch",
          },
        ]);
      }
    }

    const db = getDb();
    const now = new Date();
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;

    const [result] = await db
      .insert(npSettings)
      .values({ siteId, key, value, updatedAt: now, updatedBy: user.id })
      .onConflictDoUpdate({
        target: [npSettings.siteId, npSettings.key],
        set: { value, updatedAt: now, updatedBy: user.id },
      })
      .returning();

    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
