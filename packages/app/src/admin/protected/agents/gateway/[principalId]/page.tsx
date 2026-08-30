import { AgentPrincipalDetailView } from "@nexpress/admin/client";

import { requireAgentStudioPageAccess } from "../../../../../lib/agents/studio-page";

export default async function AgentGatewayPrincipalPage({
  params,
}: {
  params: Promise<{ principalId: string }>;
}) {
  await requireAgentStudioPageAccess();
  const { principalId } = await params;
  return <AgentPrincipalDetailView principalId={principalId} />;
}
