import type { NextRequest } from "next/server";
import { handleAgentRuntimeAdminRequest } from "../../../../lib/agents/runtime-admin";

export async function GET(request: NextRequest) {
  return handleAgentRuntimeAdminRequest(request, "budget");
}
export async function PATCH(request: NextRequest) {
  return handleAgentRuntimeAdminRequest(request, "agents.budgets.update");
}
export const dynamic = "force-dynamic";
