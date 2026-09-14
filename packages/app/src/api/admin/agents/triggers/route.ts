import type { NextRequest } from "next/server";
import { handleAgentRuntimeAdminRequest } from "../../../../lib/agents/runtime-admin";

export async function GET(request: NextRequest) {
  return handleAgentRuntimeAdminRequest(request, "triggers");
}
export const dynamic = "force-dynamic";
