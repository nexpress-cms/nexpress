import { handleAgentHttpRequest } from "../../../../lib/agents/agent-http";
export async function GET(request: Request) {
  return handleAgentHttpRequest(request, "capabilities");
}
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
