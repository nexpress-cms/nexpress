import { AgentActivityView } from "@nexpress/admin/client";

import {
  requireAgentStudioPageAccess,
  agentActivitySearchString,
} from "../../../../../lib/agents/studio-page";

export default async function AgentActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgentStudioPageAccess();
  const section = "actions";
  const queryString = agentActivitySearchString(await searchParams);
  return (
    <AgentActivityView
      key={`${section}:${queryString}`}
      section={section}
      queryString={queryString}
    />
  );
}
