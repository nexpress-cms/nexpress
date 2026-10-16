import type { NextRequest } from "next/server";
import { handleAgentEvaluationHistoryRequest } from "../../../../../lib/agents/evaluation-history-admin";
export async function GET(request: NextRequest) {
  return handleAgentEvaluationHistoryRequest(request);
}
export async function POST(request: NextRequest) {
  return handleAgentEvaluationHistoryRequest(request);
}
export const dynamic = "force-dynamic";
