import { AgentIncidentDetailView } from "@nexpress/admin/client";
import { requireAgentStudioPageAccess } from "../../../../../lib/agents/studio-page";

export default async function AgentIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAgentStudioPageAccess();
  const { id } = await params;
  return <AgentIncidentDetailView key={id} id={id} />;
}
