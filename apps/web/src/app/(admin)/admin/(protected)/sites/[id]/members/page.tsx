import { MembershipsView } from "@nexpress/admin/client";

export const dynamic = "force-dynamic";

export default async function SiteMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MembershipsView siteId={id} />;
}
