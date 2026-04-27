import {
  NxForbiddenError,
  NxValidationError,
  createTranslation,
  findTranslations,
  hasRole,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

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
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!hasRole(user, "editor")) {
      throw new NxForbiddenError("translations", "list");
    }
    const { slug, id } = await context.params;
    const docs = await findTranslations(slug, id);
    return nxSuccessResponse({ docs });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    requireCsrf(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("translations", "create");
    }
    const { slug, id } = await context.params;
    const body = await readJsonBody(request);
    const targetLocale =
      typeof body === "object" && body !== null && "targetLocale" in body
        ? (body as { targetLocale?: unknown }).targetLocale
        : undefined;
    if (typeof targetLocale !== "string" || targetLocale.length === 0) {
      throw new NxValidationError("Invalid input", [
        { field: "targetLocale", message: "targetLocale is required" },
      ]);
    }
    const result = await createTranslation(slug, id, targetLocale, user);
    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
