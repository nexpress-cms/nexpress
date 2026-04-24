import { NxValidationError, type NxDocumentStatus, type NxSaveOptions } from "@nexpress/core";
import { createCollectionHelpers } from "@nexpress/next";

import { ensureWriteReady } from "@/lib/init-core";

export const {
  parseFindOptions,
  findCollectionDocuments,
  getCollectionDocument,
  saveCollectionDocument,
  deleteCollectionDocument,
} = createCollectionHelpers({
  ensureReady: ensureWriteReady,
});

const VALID_STATUSES: readonly NxDocumentStatus[] = [
  "draft",
  "scheduled",
  "published",
  "archived",
];

export function parseBodyRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Request body must be a JSON object" },
    ]);
  }

  return body as Record<string, unknown>;
}

export function extractSaveOptions(data: Record<string, unknown>): NxSaveOptions | undefined {
  const raw = data._status;
  if (raw === undefined) return undefined;
  delete data._status;
  if (typeof raw !== "string" || !VALID_STATUSES.includes(raw as NxDocumentStatus)) {
    throw new NxValidationError("Invalid input", [
      { field: "_status", message: `Must be one of: ${VALID_STATUSES.join(", ")}` },
    ]);
  }
  return { status: raw as NxDocumentStatus };
}
