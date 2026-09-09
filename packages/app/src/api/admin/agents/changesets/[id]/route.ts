import type { NextRequest } from "next/server";
import { handleAgentChangeSetAdminRequest } from "../../../../../lib/agents/changeset-admin";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentChangeSetAdminRequest(request, "get", await context.params);
}
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentChangeSetAdminRequest(request, "update", await context.params);
}
export const dynamic = "force-dynamic";
