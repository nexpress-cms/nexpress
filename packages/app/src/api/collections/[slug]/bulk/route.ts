import {
  NpValidationError,
  deleteDocument,
  getDocumentById,
  saveDocument,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth } from "../../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { ensureFor } from "../../../../lib/init-core";
import { revalidateCollection } from "../../../../lib/revalidate";

const MAX_IDS = 100;
const ACTIONS = ["publish", "unpublish", "delete"] as const;
type BulkAction = (typeof ACTIONS)[number];

interface BulkBody {
  action: BulkAction;
  ids: string[];
}

function validateBody(raw: unknown): BulkBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const body = raw as { action?: unknown; ids?: unknown };
  if (typeof body.action !== "string" || !ACTIONS.includes(body.action as BulkAction)) {
    throw new NpValidationError("Invalid input", [
      { field: "action", message: `action must be one of: ${ACTIONS.join(", ")}` },
    ]);
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "ids", message: "ids must be a non-empty array" },
    ]);
  }
  if (body.ids.length > MAX_IDS) {
    throw new NpValidationError("Invalid input", [
      { field: "ids", message: `ids may not exceed ${MAX_IDS} entries per request` },
    ]);
  }
  if (!body.ids.every((id) => typeof id === "string" && id.length > 0)) {
    throw new NpValidationError("Invalid input", [
      { field: "ids", message: "Every id must be a non-empty string" },
    ]);
  }
  return { action: body.action as BulkAction, ids: body.ids as string[] };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const user = await requireAuth(request);
    await ensureFor("write");

    const { slug } = await params;
    const { action, ids } = validateBody(await readJsonBody(request));

    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      try {
        if (action === "delete") {
          await deleteDocument(slug, id, user);
          succeeded.push(id);
          continue;
        }

        // publish / unpublish: fetch the doc, save it back with the new
        // status passed via the pipeline's `options.status` (the API
        // layer's `_status` convention isn't visible inside the pipeline).
        // Strip server-managed columns the pipeline writes itself so the
        // re-save doesn't trip validators or overwrite timestamps.
        const existing = await getDocumentById(slug, id, user);
        if (!existing) {
          failed.push({ id, error: "Not found" });
          continue;
        }
        const {
          id: _id,
          status: _status,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          createdBy: _createdBy,
          updatedBy: _updatedBy,
          ...rest
        } = existing;
        await saveDocument(slug, id, rest, user, {
          status: action === "publish" ? "published" : "draft",
        });
        succeeded.push(id);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // One revalidate per collection regardless of N, since paths like /blog
    // are slug-independent. Per-doc paths will pick up at the next read.
    if (succeeded.length > 0) {
      revalidateCollection(slug);
    }

    return npSuccessResponse({ action, succeeded, failed });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
