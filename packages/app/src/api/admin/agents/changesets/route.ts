import type { NextRequest } from "next/server";
import { handleAgentChangeSetAdminRequest } from "../../../../lib/agents/changeset-admin";
export async function GET(request: NextRequest) {
  return handleAgentChangeSetAdminRequest(request, "list");
}
export async function POST(request: NextRequest) {
  return handleAgentChangeSetAdminRequest(request, "create");
}
export const dynamic = "force-dynamic";
