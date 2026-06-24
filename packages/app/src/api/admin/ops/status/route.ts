import { NpForbiddenError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import type * as OpsStatusCore from "../../../../scripts/ops-status-core";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("ops-status", "read");
    }

    const statusCore = await loadStatusCore();
    return npSuccessResponse(
      statusCore.buildOpsStatusJson(await statusCore.collectOpsStatusChecks(process.env)),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

async function loadStatusCore(): Promise<typeof OpsStatusCore> {
  return import("@nexpress/app/scripts/ops-status-core");
}
