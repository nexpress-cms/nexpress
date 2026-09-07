import { handleAgentHttpRequest } from "../../../../../../../lib/agents/agent-http";
export async function GET(
  request: Request,
  context: { params: Promise<{ previewId: string; artifactId: string }> },
) {
  return handleAgentHttpRequest(request, "artifact", await context.params);
}
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
