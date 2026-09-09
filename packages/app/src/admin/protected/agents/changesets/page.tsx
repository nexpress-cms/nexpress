import { AgentChangeSetListView } from "@nexpress/admin/client";
import {
  requireAgentChangeSetPageAccess,
  agentActivitySearchString,
} from "../../../../lib/agents/studio-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgentChangeSetPageAccess();
  return <AgentChangeSetListView queryString={agentActivitySearchString(await searchParams)} />;
}
