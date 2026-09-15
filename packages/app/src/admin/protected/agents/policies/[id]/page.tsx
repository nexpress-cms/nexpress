import { AgentPolicyDetailView } from "@nexpress/admin/client";
import { requireAgentStudioPageAccess } from "../../../../../lib/agents/studio-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAgentStudioPageAccess();
  return <AgentPolicyDetailView id={(await params).id} />;
}
