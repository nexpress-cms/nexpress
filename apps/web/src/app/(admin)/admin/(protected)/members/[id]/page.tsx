import {
  NpForbiddenError,
  NpNotFoundError,
  npMembers,
  verifyTokenFull,
  can,
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
import { ensureFor } from "@/lib/init-core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface MemberDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function MemberDetailPage({ params }: MemberDetailPageProps) {
  await ensureFor("read");
  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");
  if (!can(user, "content.publish")) {
    throw new NpForbiddenError("member", "read");
  }

  const { id } = await params;
  const [row] = (await db
    .select({
      id: npMembers.id,
      handle: npMembers.handle,
      email: npMembers.email,
      displayName: npMembers.displayName,
      status: npMembers.status,
      reputation: npMembers.reputation,
      createdAt: npMembers.createdAt,
    })
    .from(npMembers)
    .where(eq(npMembers.id, id))
    .limit(1)) as Array<{
    id: string;
    handle: string;
    email: string;
    displayName: string;
    status: string;
    reputation: number;
    createdAt: Date;
  }>;
  if (!row) throw new NpNotFoundError("member", id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/members"
          className="text-[12.5px] text-neutral-500 underline-offset-[3px] hover:underline dark:text-neutral-400"
        >
          ← Members
        </Link>
        <div className="mt-1.5 flex items-baseline gap-2.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
            {row.displayName}
          </h1>
          <span className="font-mono text-[12px] text-neutral-500 dark:text-neutral-400">
            @{row.handle}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          {row.email} · status: {row.status} · reputation: {row.reputation}
        </p>
      </div>

      <LinkedIdentitiesPanel
        subjectKind="member"
        subjectId={row.id}
        canRevoke={can(user, "admin.manage")}
      />

      {/*
        Roles panel surfaces the `np_member_roles` grants. Read is
        staff-mod gated to match the API; write (Grant / Revoke) is
        admin-only because handing a member moderation capabilities
        is a privilege escalation editors don't get to perform.
      */}
      <MemberRolesPanel
        memberId={row.id}
        memberHandle={row.handle}
        canModify={can(user, "admin.manage")}
      />

      {/*
        Bans panel is staff-mod gated to match the API; the panel
        renders the active ban list read-only for non-mods (none of
        whom land on this page today, since editor is the floor).
      */}
      <MemberBansPanel
        memberId={row.id}
        memberHandle={row.handle}
        canModify={can(user, "community.moderate")}
      />

      {/*
        Mass-delete-by-member is admin-only — editor-and-mod roles
        already have per-target staff hide / staff delete on the
        moderation surfaces. Shown last so the page reads
        identity-first, dangerous-action-last.
      */}
      {can(user, "admin.manage") ? (
        <MemberPurgePanel memberId={row.id} memberHandle={row.handle} />
      ) : null}
    </div>
  );
}
