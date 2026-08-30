import { AgentStudioView } from "@nexpress/admin/client";

import { requireAgentStudioPageAccess } from "../../../lib/agents/studio-page";

export default async function AgentStudioPage() {
  await requireAgentStudioPageAccess();
  return <AgentStudioView section="overview" />;
}
