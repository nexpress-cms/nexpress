import { NpValidationError } from "@nexpress/core";
import { npBuildAgentEvaluationWorkbenchV1 } from "@nexpress/core/agents";
import { npAgentEvaluationWorkbenchRequestMaxBytesV1 } from "@nexpress/core/agent-contract";
import type { NextRequest } from "next/server";

import { npSuccessResponse } from "../api-response";
import { ensureFor } from "../init-core";
import { requireAgentStudioAdmin } from "./studio-admin";
import { readAgentAdminJsonBody } from "./changeset-admin";
import { agentStudioErrorResponse } from "./studio-error-response";

const headers = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
const invalid = () =>
  new NpValidationError("Evaluation files could not be validated.", [
    {
      field: "evaluation",
      message: "Use compatible evaluation and review files within the upload limit.",
    },
  ]);

/** Stateless offline processing. Staff admission does not grant the uploaded evidence authority. */
export async function handleAgentEvaluationWorkbenchRequest(
  request: NextRequest,
): Promise<Response> {
  try {
    await ensureFor("read");
    await requireAgentStudioAdmin(request);
    if (request.method !== "POST" || request.nextUrl.search) throw invalid();
    const body = await readAgentAdminJsonBody(request, npAgentEvaluationWorkbenchRequestMaxBytesV1);
    let result;
    try {
      result = await npBuildAgentEvaluationWorkbenchV1(body);
    } catch {
      // Uploaded evidence, labels and verifier internals never enter error bodies or logs.
      throw invalid();
    }
    return npSuccessResponse(result, { headers });
  } catch (error) {
    // This POST only recomputes evidence; no persisted mutation outcome needs reconciliation.
    return agentStudioErrorResponse(error, "read", { headers });
  }
}
