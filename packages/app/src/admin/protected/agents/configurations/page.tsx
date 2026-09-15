import { AgentRuntimeListView } from "@nexpress/admin/client";
import {
  requireAgentStudioPageAccess,
  agentActivitySearchString,
} from "../../../../lib/agents/studio-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgentStudioPageAccess();
  const query = agentActivitySearchString(await searchParams);
  return <AgentRuntimeListView key={query} query={query} />;
}
