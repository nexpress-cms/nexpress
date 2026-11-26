import type { NextRequest } from "next/server";
import { handleAgentGuardianSessionAdminRequest } from "../../../../../../lib/agents/guardian-session-admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentGuardianSessionAdminRequest(request, "get", (await context.params).id);
}
export const dynamic = "force-dynamic";
