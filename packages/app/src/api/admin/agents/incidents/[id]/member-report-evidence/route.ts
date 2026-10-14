import type { NextRequest } from "next/server";
import { handleAgentIncidentAdminRequest } from "../../../../../../lib/agents/incident-admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentIncidentAdminRequest(
    request,
    "member-report-evidence",
    (await context.params).id,
  );
}
export const dynamic = "force-dynamic";
