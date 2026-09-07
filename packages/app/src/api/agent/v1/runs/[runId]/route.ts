import { handleAgentHttpRequest } from "../../../../../lib/agents/agent-http";
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  return handleAgentHttpRequest(request, "run", await context.params);
}
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
