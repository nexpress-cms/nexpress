import {
  NpForbiddenError,
  npMembers,
  verifyTokenFull,
  can,
} from "@nexpress/core";
import { MembersListView, type MemberListRow } from "@nexpress/admin/client";
import { and, desc, ilike, or, sql, type SQL } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_STATUSES = [
  "active",
  "pending",
  "suspended",
  "deleted",
] as const satisfies ReadonlyArray<MemberListRow["status"]>;
type Status = (typeof VALID_STATUSES)[number];

function isStatus(value: string): value is Status {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

interface MembersAdminPageProps {
  searchParams: Promise<{ q?: string; status?: string }>;
}

export default async function MembersAdminPage({
  searchParams,
}: MembersAdminPageProps) {
  await ensureFor("read");
  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");
  if (!can(user, "content.publish")) {
    // Editor-or-above can browse members. Per-row mod actions
    // (ban, role grant, purge) gate independently on the detail
    // page — admin for grants/purge, staff-mod for bans.
    throw new NpForbiddenError("members", "read");
  }

  // Phase 9.10 — search + status filter. `q` matches handle,
  // email, or display_name with a case-insensitive prefix.
  // `status` filters to one of the four enum values (anything
  // else is silently dropped — better than 400'ing a typed
  // URL param).
  const params = await searchParams;
  const rawQ = params.q?.trim() ?? "";
  const q = rawQ.length > 0 ? rawQ : null;
  const status =
    params.status && isStatus(params.status) ? params.status : null;

  const conditions: SQL[] = [];
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const like = or(
      ilike(npMembers.handle, pattern),
      ilike(npMembers.email, pattern),
      ilike(npMembers.displayName, pattern),
    );
    if (like) conditions.push(like);
  }
  if (status) {
    conditions.push(sql`${npMembers.status} = ${status}`);
  }

  const baseQuery = db
    .select({
      id: npMembers.id,
      handle: npMembers.handle,
      email: npMembers.email,
      displayName: npMembers.displayName,
      status: npMembers.status,
      reputation: npMembers.reputation,
      createdAt: npMembers.createdAt,
    })
    .from(npMembers);

  const filtered =
    conditions.length === 0
      ? baseQuery
      : baseQuery.where(and(...conditions));

  const rows = (await filtered
    .orderBy(desc(npMembers.createdAt))
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
  return (
    <MembersListView
      members={members}
      totalDocs={members.length}
      filterQuery={q ?? ""}
      filterStatus={status ?? ""}
    />
  );
}
