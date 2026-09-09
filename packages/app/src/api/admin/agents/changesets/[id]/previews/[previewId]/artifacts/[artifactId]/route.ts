import type { NextRequest } from "next/server";
import { handleAgentChangeSetAdminRequest } from "../../../../../../../../../lib/agents/changeset-admin";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; previewId: string; artifactId: string }> },
) {
  return handleAgentChangeSetAdminRequest(request, "artifact", await context.params);
}
export const dynamic = "force-dynamic";
