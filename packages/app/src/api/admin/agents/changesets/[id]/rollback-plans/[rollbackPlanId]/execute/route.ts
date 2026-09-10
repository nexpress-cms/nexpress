import type { NextRequest } from "next/server";
import { handleAgentChangeSetAdminRequest } from "../../../../../../../../lib/agents/changeset-admin";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; rollbackPlanId: string }> },
) {
  return handleAgentChangeSetAdminRequest(request, "executeRollback", await context.params);
}
export const dynamic = "force-dynamic";
