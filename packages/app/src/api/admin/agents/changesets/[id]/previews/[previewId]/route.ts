import type { NextRequest } from "next/server";
import { handleAgentPreviewAdminRequest } from "../../../../../../../lib/agents/preview-http";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; previewId: string }> },
) {
  return handleAgentPreviewAdminRequest(request, "get", await context.params);
}
export const dynamic = "force-dynamic";
