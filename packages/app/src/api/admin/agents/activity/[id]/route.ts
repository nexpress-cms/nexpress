import { npRequireAgentActivityRunDetailV1 } from "@nexpress/core/agent-contract";
import { requireAgentStudioActivityRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import {
  normalizeAgentStudioError,
  requireAgentStudioAdmin,
} from "../../../../../lib/agents/studio-admin";
import { ensureFor } from "../../../../../lib/init-core";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("read");
    const { siteId, actor } = await requireAgentStudioAdmin(request);
    const { id } = await params;
    const { activity } = requireAgentStudioActivityRuntimeV1();
    const value = await activity.getRun({ siteId, actor, id });
    return npSuccessResponse(npRequireAgentActivityRunDetailV1(value), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error), {
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export const dynamic = "force-dynamic";
