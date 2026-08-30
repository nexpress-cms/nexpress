import { AgentConnectionCreateView } from "@nexpress/admin/client";

import { requireAgentStudioPageAccess } from "../../../../../lib/agents/studio-page";

export default async function AgentConnectionNewPage() {
  await requireAgentStudioPageAccess();
  return <AgentConnectionCreateView />;
}
