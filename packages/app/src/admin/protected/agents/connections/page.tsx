import { AgentStudioView } from "@nexpress/admin/client";

import { requireAgentStudioPageAccess } from "../../../../lib/agents/studio-page";

export default async function AgentConnectionsPage() {
  await requireAgentStudioPageAccess();
  return <AgentStudioView section="connections" />;
}
