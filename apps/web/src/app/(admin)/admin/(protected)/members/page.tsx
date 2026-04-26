import { hasRole, NxForbiddenError, nxMembers, verifyTokenFull } from "@nexpress/core";
import { MembersListView, type MemberListRow } from "@nexpress/admin/client";
import { desc } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { ensureCoreServices } from "@/lib/init-core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MembersAdminPage() {
  ensureCoreServices();
  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");
  if (!hasRole(user, "editor")) {
    // Editor-or-above can browse members. Per-row mod actions
    // (ban, role grant, purge) gate independently on the detail
    // page — admin for grants/purge, staff-mod for bans.
    throw new NxForbiddenError("members", "read");
  }
  const rows = (await db
    .select({
      id: nxMembers.id,
      handle: nxMembers.handle,
      email: nxMembers.email,
      displayName: nxMembers.displayName,
      status: nxMembers.status,
      reputation: nxMembers.reputation,
      createdAt: nxMembers.createdAt,
    })
    .from(nxMembers)
    .orderBy(desc(nxMembers.createdAt))
    .limit(100)) as Array<{
    id: string;
    handle: string;
    email: string;
    displayName: string;
    status: MemberListRow["status"];
    reputation: number;
    createdAt: Date;
  }>;

  const members: MemberListRow[] = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
  return <MembersListView members={members} totalDocs={members.length} />;
}
