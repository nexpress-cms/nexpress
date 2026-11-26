import { AgentIncidentListView } from "@nexpress/admin/client";
import {
  requireAgentStudioPageAccess,
  agentActivitySearchString,
} from "../../../../lib/agents/studio-page";

export default async function AgentIncidentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgentStudioPageAccess();
  const query = agentActivitySearchString(await searchParams);
  return <AgentIncidentListView key={query} query={query} />;
}
