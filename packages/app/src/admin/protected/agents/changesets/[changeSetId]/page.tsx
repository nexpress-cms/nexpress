import { AgentChangeSetDetailView } from "@nexpress/admin/client";
import { requireAgentChangeSetPageAccess } from "../../../../../lib/agents/studio-page";
export default async function Page({ params }: { params: Promise<{ changeSetId: string }> }) {
  const { canViewActivity } = await requireAgentChangeSetPageAccess();
  return (
    <AgentChangeSetDetailView id={(await params).changeSetId} canViewActivity={canViewActivity} />
  );
}
