import type { NextRequest } from "next/server";
import { handleAgentMemberResponseAdminRequest } from "../../../../../../lib/agents/member-response-admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentMemberResponseAdminRequest(request, "get", (await context.params).id);
}
export const dynamic = "force-dynamic";
