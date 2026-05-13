import { NpValidationError, type NpDocumentStatus, type NpSaveOptions } from "@nexpress/core";
import { createCollectionHelpers } from "@nexpress/next";

import { ensureFor } from "@/lib/init-core";

export const {
  parseFindOptions,
  findCollectionDocuments,
  getCollectionDocument,
  saveCollectionDocument,
  deleteCollectionDocument,
} = createCollectionHelpers({
  ensureReady: () => ensureFor("write"),
});

const VALID_STATUSES: readonly NpDocumentStatus[] = [
  "draft",
  "scheduled",
  "published",
  "archived",
  "pending",
];

export function parseBodyRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be a JSON object" },
    ]);
  }

  return body as Record<string, unknown>;
}

export function extractSaveOptions(data: Record<string, unknown>): NpSaveOptions | undefined {
  const raw = data._status;
  if (raw === undefined) return undefined;
  delete data._status;
  if (typeof raw !== "string" || !VALID_STATUSES.includes(raw as NpDocumentStatus)) {
    throw new NpValidationError("Invalid input", [
      { field: "_status", message: `Must be one of: ${VALID_STATUSES.join(", ")}` },
    ]);
  }
  return { status: raw as NpDocumentStatus };
}
