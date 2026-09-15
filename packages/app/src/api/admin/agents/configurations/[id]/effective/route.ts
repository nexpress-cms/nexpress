import type { NextRequest } from "next/server";
import { handleAgentRuntimeAdminRequest } from "../../../../../../lib/agents/runtime-admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentRuntimeAdminRequest(request, "effective", (await context.params).id);
}
export const dynamic = "force-dynamic";
