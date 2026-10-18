import type { NextRequest } from "next/server";
import { handleAgentGuardianResponseAdminRequest } from "../../../../../../../lib/agents/guardian-response-admin";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentGuardianResponseAdminRequest(request, "execute", (await context.params).id);
}
export const dynamic = "force-dynamic";
