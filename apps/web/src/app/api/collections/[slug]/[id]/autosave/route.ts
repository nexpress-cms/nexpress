import { autosaveRevision } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Editor autosave endpoint. Persists an in-flight snapshot to
 * nx_revisions with status="autosave" without touching the main doc
 * row, so a crash/refresh mid-edit can recover via the revisions panel.
 *
 * Requires `versions.drafts.autosave === true` on the collection.
 * Falls back to 400 NxValidationError if the collection isn't opted in,
 * 404 if the doc id doesn't exist.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const user = await requireAuth(request);
    requireCsrf(request);
    await ensureWriteReady();

    const { slug, id } = await params;
    const raw = (await request.json()) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return nxErrorResponse(new Error("Body must be a JSON object"));
    }
    // Strip the API-layer status sentinel — autosave is its own status.
    const { _status: _ignored, ...data } = raw;
    void _ignored;

    const result = await autosaveRevision(slug, id, data, user);
    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
