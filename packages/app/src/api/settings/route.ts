import {
  NpForbiddenError,
  NpValidationError,
  can,
  getAdminSettingsSnapshot,
  getCurrentSiteId,
  NP_DEFAULT_SITE_ID,
  setSeoSettings,
  setSiteGeneralSettings,
} from "@nexpress/core";
import { invalidateCacheTargets, readJsonBody, siteCacheTag } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";

function parseUpdate(value: unknown): { key: "site" | "seo"; value: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Body must be a plain object" },
    ]);
  }
  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).find((key) => key !== "key" && key !== "value");
  if (unknown) {
    throw new NpValidationError("Invalid input", [
      { field: unknown, message: `Unsupported settings request field "${unknown}"` },
    ]);
  }
  if (body.key !== "site" && body.key !== "seo") {
    throw new NpValidationError("Invalid input", [
      {
        field: "key",
        message:
          "General settings only accept 'site' or 'seo'; use the dedicated theme, community, or plugin endpoint for other settings.",
      },
    ]);
  }
  if (!("value" in body)) {
    throw new NpValidationError("Invalid input", [
      { field: "value", message: "Setting value is required" },
    ]);
  }
  return { key: body.key, value: body.value };
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("settings", "read");
    }
    await ensureFor("read");
    return npSuccessResponse(await getAdminSettingsSnapshot());
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
    await ensureFor("write");
    const update = parseUpdate(await readJsonBody(request));
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const value =
      update.key === "site"
        ? await setSiteGeneralSettings(update.value, siteId)
        : await setSeoSettings(update.value, user.id, siteId);

    await invalidateCacheTargets({
      source: "site",
      siteId,
      tags: [siteCacheTag(siteId), `nx:sitemap:${siteId}`, `nx:feed:${siteId}`],
      paths: [{ path: "/", type: "layout" }],
    });
    return npSuccessResponse({ key: update.key, value });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
