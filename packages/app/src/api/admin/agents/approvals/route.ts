import type { NextRequest } from "next/server";
import { handleAgentApprovalAdminRequest } from "../../../../lib/agents/approval-admin";
export async function GET(request: NextRequest) {
  return handleAgentApprovalAdminRequest(request, "list");
}
export const dynamic = "force-dynamic";
