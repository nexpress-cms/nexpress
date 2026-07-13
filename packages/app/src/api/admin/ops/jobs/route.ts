import { NpForbiddenError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import type * as OpsJobsCore from "../../../../scripts/ops-jobs-core";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("ops-jobs", "read");
    }

    const jobsCore = await loadJobsCore();
    return npSuccessResponse(await jobsCore.collectOpsJobsStatus(process.env, new Date()));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

async function loadJobsCore(): Promise<typeof OpsJobsCore> {
  return (await import("@nexpress/app/scripts/ops-jobs-core")) as unknown as typeof OpsJobsCore;
}
