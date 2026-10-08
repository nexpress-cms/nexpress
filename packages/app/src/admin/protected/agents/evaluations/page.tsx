import { AgentEvaluationWorkbenchView } from "@nexpress/admin/client";
import { requireAgentStudioPageAccess } from "../../../../lib/agents/studio-page";

export default async function AgentEvaluationWorkbenchPage() {
  await requireAgentStudioPageAccess();
  return <AgentEvaluationWorkbenchView />;
}
