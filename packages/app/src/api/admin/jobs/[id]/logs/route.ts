import { NpForbiddenError, countJobLogs, listJobLogs, can } from "@nexpress/core";
import { npRequireJobLogsWire, npSerializeJobLogEntry } from "@nexpress/core/jobs-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireAuth } from "../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";
import {
  npParseJobId,
  npParseJobLogsQuery,
  npRequireJobApiResponse,
} from "../../../../../lib/job-api-contract";

/**
 * Phase 20.3b — read the captured log stream for one job. Backs the
 * collapsible "Logs" panel in the admin Jobs view; the operator
 * expands a row, the panel fetches once, and renders timestamped
 * entries inline. Optional `?limit=` / `?offset=` for pagination,
 * defaulting to the helper's 200 cap (max 1000).
 *
 * Gated to `admin.manage` — same level as the rest of the
 * jobs admin surface. Job logs can include payload snippets,
 * member/user ids, import metadata, and failure messages, so
 * they shouldn't leak to editors. No CSRF gate because GET
 * is read-only.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("job-logs", "read");
    }
    const id = npParseJobId((await context.params).id);
    const options = npParseJobLogsQuery(request.nextUrl.searchParams);

    const [entries, total] = await Promise.all([listJobLogs(id, options), countJobLogs(id)]);

    return npSuccessResponse(
      npRequireJobApiResponse(
        {
          jobId: id,
          total,
          entries: entries.map(npSerializeJobLogEntry),
        },
        npRequireJobLogsWire,
      ),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
