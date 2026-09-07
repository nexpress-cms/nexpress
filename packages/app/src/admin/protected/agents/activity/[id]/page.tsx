import { AgentActivityRunDetailView } from "@nexpress/admin/client";

import { requireAgentStudioPageAccess } from "../../../../../lib/agents/studio-page";

export default async function AgentActivityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAgentStudioPageAccess();
  const { id } = await params;
  return <AgentActivityRunDetailView key={id} runId={id} />;
}
