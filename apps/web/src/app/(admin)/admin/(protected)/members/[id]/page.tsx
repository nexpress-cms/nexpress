import {
  NxForbiddenError,
  NxNotFoundError,
  hasRole,
  isStaffMod,
  nxMembers,
  verifyTokenFull,
} from "@nexpress/core";
import {
  LinkedIdentitiesPanel,
  MemberBansPanel,
  MemberPurgePanel,
  MemberRolesPanel,
} from "@nexpress/admin/client";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { ensureCoreServices } from "@/lib/init-core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface MemberDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function MemberDetailPage({ params }: MemberDetailPageProps) {
  ensureCoreServices();
  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");
  if (!hasRole(user, "editor")) {
    throw new NxForbiddenError("member", "read");
  }

  const { id } = await params;
  const [row] = (await db
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
    .where(eq(nxMembers.id, id))
    .limit(1)) as Array<{
    id: string;
    handle: string;
    email: string;
    displayName: string;
    status: string;
    reputation: number;
    createdAt: Date;
  }>;
  if (!row) throw new NxNotFoundError("member", id);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/members"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Members
        </Link>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{row.displayName}</h1>
          <span className="text-muted-foreground">@{row.handle}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {row.email} · status: {row.status} · reputation: {row.reputation}
        </p>
      </div>

      <LinkedIdentitiesPanel
        subjectKind="member"
        subjectId={row.id}
        canRevoke={hasRole(user, "admin")}
      />

      {/*
        Roles panel surfaces the `nx_member_roles` grants. Read is
        staff-mod gated to match the API; write (Grant / Revoke) is
        admin-only because handing a member moderation capabilities
        is a privilege escalation editors don't get to perform.
      */}
      <MemberRolesPanel
        memberId={row.id}
        memberHandle={row.handle}
        canModify={hasRole(user, "admin")}
      />

      {/*
        Bans panel is staff-mod gated to match the API; the panel
        renders the active ban list read-only for non-mods (none of
        whom land on this page today, since editor is the floor).
      */}
      <MemberBansPanel
        memberId={row.id}
        memberHandle={row.handle}
        canModify={isStaffMod(user)}
      />

      {/*
        Mass-delete-by-member is admin-only — editor-and-mod roles
        already have per-target staff hide / staff delete on the
        moderation surfaces. Shown last so the page reads
        identity-first, dangerous-action-last.
      */}
      {hasRole(user, "admin") ? (
        <MemberPurgePanel memberId={row.id} memberHandle={row.handle} />
      ) : null}
    </div>
  );
}
