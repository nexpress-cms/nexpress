import { AgentApprovalDetailView } from "@nexpress/admin/client";
import { requireAgentApprovalPageAccess } from "../../../../../lib/agents/studio-page";
export default async function Page({ params }: { params: Promise<{ approvalId: string }> }) {
  await requireAgentApprovalPageAccess();
  return <AgentApprovalDetailView id={(await params).approvalId} />;
}
