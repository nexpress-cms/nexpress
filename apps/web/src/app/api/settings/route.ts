import {
  NX_DEFAULT_SITE_ID,
  NxForbiddenError,
  NxValidationError,
  getCurrentSiteId,
  hasRole,
  nxSettings,
  validateSeoSettingsPatch,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("settings", "read");
    }

    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
    const rows = await db
      .select()
      .from(nxSettings)
      .where(eq(nxSettings.siteId, siteId));
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    return nxSuccessResponse(settings);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("settings", "update");
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const key = typeof body.key === "string" ? body.key.trim() : "";

    if (!key) {
      throw new NxValidationError("Invalid input", [
        { field: "key", message: "Setting key is required" },
      ]);
    }

    if (body.value === undefined) {
      throw new NxValidationError("Invalid input", [
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
        throw new NxValidationError("Invalid input", [
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
      .insert(nxSettings)
      .values({ siteId, key, value, updatedAt: now, updatedBy: user.id })
      .onConflictDoUpdate({
        target: [nxSettings.siteId, nxSettings.key],
        set: { value, updatedAt: now, updatedBy: user.id },
      })
      .returning();

    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
