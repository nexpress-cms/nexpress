import type { NextRequest } from "next/server";
import { handleAgentIncidentAdminRequest } from "../../../../../../lib/agents/incident-admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentIncidentAdminRequest(request, "assignment", (await context.params).id);
}
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentIncidentAdminRequest(request, "assign", (await context.params).id);
}
export const dynamic = "force-dynamic";
