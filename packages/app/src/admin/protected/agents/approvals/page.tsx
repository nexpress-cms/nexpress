import { AgentApprovalListView } from "@nexpress/admin/client";
import {
  requireAgentApprovalPageAccess,
  agentActivitySearchString,
} from "../../../../lib/agents/studio-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgentApprovalPageAccess();
  return <AgentApprovalListView queryString={agentActivitySearchString(await searchParams)} />;
}
