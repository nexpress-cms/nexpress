import { NpForbiddenError, NpValidationError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import {
  createAndEnqueueWordPressImportRun,
  parseWordPressImportMappingConfig,
  runWordPressAdminImport,
  type WpImportAdminMode,
} from "../../../../lib/wp-import-admin";

const MAX_WXR_FILE_SIZE = 25 * 1024 * 1024;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("wp-import", "create");
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new NpValidationError("Invalid input", [
        { field: "file", message: "A WXR XML file is required" },
      ]);
    }
    if (file.size === 0) {
      throw new NpValidationError("Invalid input", [
        { field: "file", message: "The WXR file is empty" },
      ]);
    }
    if (file.size > MAX_WXR_FILE_SIZE) {
      throw new NpValidationError("Invalid input", [
        {
          field: "file",
          message: `File exceeds max size of ${MAX_WXR_FILE_SIZE} bytes`,
        },
      ]);
    }

    const mode = parseMode(formData.get("mode"));
    const options = {
      update: parseBoolean(formData.get("update"), false, "update"),
      strict: parseBoolean(formData.get("strict"), false, "strict"),
      createAuthors: parseBoolean(formData.get("createAuthors"), true, "createAuthors"),
      includeMedia: parseBoolean(formData.get("includeMedia"), true, "includeMedia"),
      collectionMappings: parseWordPressImportMappingConfig(formData.get("mappingConfig")),
    };
    const xmlPromise = file.text();
    await ensureFor(mode === "apply" ? "write" : "read");
    const xml = await xmlPromise;

    if (mode === "apply") {
      const run = await createAndEnqueueWordPressImportRun({
        xml,
        actor: user,
        sourceName: file.name || "wordpress-export.xml",
        sourceSize: file.size,
        sourceMimeType: file.type || null,
        options,
      });
      return npSuccessResponse({ mode, queued: true, run });
    }

    const result = await runWordPressAdminImport({
      xml,
      actor: user,
      options: {
        mode,
        sourceName: file.name || "wordpress-export.xml",
        ...options,
      },
    });

    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function parseMode(value: FormDataEntryValue | null): WpImportAdminMode {
  if (value === "preview" || value === "apply") return value;
  throw new NpValidationError("Invalid input", [
    { field: "mode", message: 'mode must be either "preview" or "apply"' },
  ]);
}

function parseBoolean(value: FormDataEntryValue | null, fallback: boolean, field: string): boolean {
  if (value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new NpValidationError("Invalid input", [
    { field, message: `${field} must be "true" or "false"` },
  ]);
}
