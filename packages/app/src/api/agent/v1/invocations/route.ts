import { handleAgentHttpRequest } from "../../../../lib/agents/agent-http";
export async function POST(request: Request) {
  return handleAgentHttpRequest(request, "invocations");
}
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
