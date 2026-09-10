import type { NextRequest } from "next/server";
import { handleAgentChangeSetAdminRequest } from "../../../../../../lib/agents/changeset-admin";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentChangeSetAdminRequest(request, "prepareRollback", await context.params);
}
export const dynamic = "force-dynamic";
