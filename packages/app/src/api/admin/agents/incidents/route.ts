import type { NextRequest } from "next/server";
import { handleAgentIncidentAdminRequest } from "../../../../lib/agents/incident-admin";

export async function GET(request: NextRequest) {
  return handleAgentIncidentAdminRequest(request, "list");
}
export const dynamic = "force-dynamic";
