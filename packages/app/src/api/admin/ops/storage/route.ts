import { NpForbiddenError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import type * as OpsStorageCore from "../../../../scripts/ops-storage-core";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("ops-storage", "read");
    }

    const storageCore = await loadStorageCore();
    return npSuccessResponse(await storageCore.collectOpsStorageStatus(process.env, "verify"));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

async function loadStorageCore(): Promise<typeof OpsStorageCore> {
  return (await import("@nexpress/app/scripts/ops-storage-core")) as unknown as typeof OpsStorageCore;
}
