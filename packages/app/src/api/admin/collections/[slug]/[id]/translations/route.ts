import {
  NpForbiddenError,
  NpValidationError,
  createTranslation,
  findTranslations,
  can,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import { requireAuth } from "../../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../../lib/init-core";

/**
 * Phase 12.3 — translations sub-resource for an i18n
 * document.
 *
 *   GET    /api/admin/collections/{slug}/{id}/translations
 *     → { docs: [{ id, locale, slug, status, title }, ...] }
 *
 *   POST   /api/admin/collections/{slug}/{id}/translations
 *     body: { targetLocale: string }
 *     → { id }   // new row id
 *
 * The GET endpoint is editor-or-above (the data is a read-only
 * view of which siblings exist). The POST endpoint requires
 * admin (translations write to the DB and bypass the
 * collection's normal create flow's slug validation).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("translations", "list");
    }
    const { slug, id } = await context.params;
    const docs = await findTranslations(slug, id);
    return npSuccessResponse({ docs });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("translations", "create");
    }
    const { slug, id } = await context.params;
    const body = await readJsonBody(request);
    const targetLocale =
      typeof body === "object" && body !== null && "targetLocale" in body
        ? (body as { targetLocale?: unknown }).targetLocale
        : undefined;
    if (typeof targetLocale !== "string" || targetLocale.length === 0) {
      throw new NpValidationError("Invalid input", [
        { field: "targetLocale", message: "targetLocale is required" },
      ]);
    }
    const result = await createTranslation(slug, id, targetLocale, user);
    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
