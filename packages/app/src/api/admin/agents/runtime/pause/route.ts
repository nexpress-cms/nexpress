import type { NextRequest } from "next/server";
import { handleAgentRuntimeAdminRequest } from "../../../../../lib/agents/runtime-admin";

export async function POST(request: NextRequest) {
  return handleAgentRuntimeAdminRequest(request, "agents.runtime.pause");
}
export const dynamic = "force-dynamic";
