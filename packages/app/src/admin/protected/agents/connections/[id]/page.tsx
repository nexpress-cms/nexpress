import { AgentConnectionDetailView } from "@nexpress/admin/client";

import { requireAgentStudioPageAccess } from "../../../../../lib/agents/studio-page";

export default async function AgentConnectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAgentStudioPageAccess();
  const { id } = await params;
  return <AgentConnectionDetailView connectionId={id} />;
}
