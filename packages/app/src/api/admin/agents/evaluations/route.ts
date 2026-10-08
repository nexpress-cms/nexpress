import type { NextRequest } from "next/server";
import { handleAgentEvaluationWorkbenchRequest } from "../../../../lib/agents/evaluation-workbench-admin";

export async function POST(request: NextRequest) {
  return handleAgentEvaluationWorkbenchRequest(request);
}
export const dynamic = "force-dynamic";
