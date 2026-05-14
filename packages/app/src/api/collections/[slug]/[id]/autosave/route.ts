import { NpValidationError, autosaveRevision } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { ensureFor } from "../../../../../lib/init-core";

/**
 * Editor autosave endpoint. Persists an in-flight snapshot to
 * np_revisions with status="autosave" without touching the main doc
 * row, so a crash/refresh mid-edit can recover via the revisions panel.
 *
 * Requires `versions.drafts.autosave === true` on the collection.
 * Falls back to 400 NpValidationError if the collection isn't opted in,
 * 404 if the doc id doesn't exist.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const user = await requireAuth(request);
    await ensureFor("write");

    const { slug, id } = await params;
    const parsed = await readJsonBody(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new NpValidationError("Invalid input", [
        { field: "body", message: "Body must be a JSON object" },
      ]);
    }
    const raw = parsed as Record<string, unknown>;
    // Strip the API-layer status sentinel — autosave is its own status.
    const { _status: _ignored, ...data } = raw;
    void _ignored;

    const result = await autosaveRevision(slug, id, data, user);
    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
