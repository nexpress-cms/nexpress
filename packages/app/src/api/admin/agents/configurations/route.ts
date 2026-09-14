import type { NextRequest } from "next/server";
import { handleAgentRuntimeAdminRequest } from "../../../../lib/agents/runtime-admin";

export async function GET(request: NextRequest) {
  return handleAgentRuntimeAdminRequest(request, "configurations");
}
export async function POST(request: NextRequest) {
  return handleAgentRuntimeAdminRequest(request, "agents.configurations.create");
}
export const dynamic = "force-dynamic";
