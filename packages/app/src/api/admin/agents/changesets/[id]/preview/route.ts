import type { NextRequest } from "next/server";
import { handleAgentPreviewAdminRequest } from "../../../../../../lib/agents/preview-http";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAgentPreviewAdminRequest(request, "create", await context.params);
}
export const dynamic = "force-dynamic";
