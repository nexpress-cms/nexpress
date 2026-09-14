import { AgentRuntimeCreateView } from "@nexpress/admin/client";
import { requireAgentStudioPageAccess } from "../../../../../lib/agents/studio-page";

export default async function Page() {
  await requireAgentStudioPageAccess();
  return <AgentRuntimeCreateView />;
}
