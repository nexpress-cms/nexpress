import type { NextRequest } from "next/server";
import { handleAgentApprovalAdminRequest } from "../../../../../../lib/agents/approval-admin";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentApprovalAdminRequest(request, "reject", (await context.params).id);
}
export const dynamic = "force-dynamic";
