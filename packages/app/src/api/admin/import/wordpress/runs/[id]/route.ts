import { NpForbiddenError, NpValidationError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import { requireAuth } from "../../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../../lib/init-core";
import { getWordPressImportRun } from "../../../../../../lib/wp-import-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("wp-import-runs", "read");
    }

    const { id } = await context.params;
    if (!id) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: "Import run id is required" },
      ]);
    }

    const run = await getWordPressImportRun(id);
    return npSuccessResponse({ run });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
