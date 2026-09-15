import { AgentPolicyCreateView } from "@nexpress/admin/client";
import { notFound } from "next/navigation";
import { requireAgentStudioPageAccess } from "../../../../../lib/agents/studio-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgentStudioPageAccess();
  const query = await searchParams;
  const agentId = query.agentId;
  if (
    Object.keys(query).some((key) => key !== "agentId") ||
    (agentId !== undefined &&
      (typeof agentId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          agentId,
        )))
  )
    notFound();
  return <AgentPolicyCreateView agentId={agentId} />;
}
