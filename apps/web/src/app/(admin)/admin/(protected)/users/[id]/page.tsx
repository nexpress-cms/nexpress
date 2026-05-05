import {
  NpForbiddenError,
  NpNotFoundError,
  npUsers,
  verifyTokenFull,
  can,
} from "@nexpress/core";
import { LinkedIdentitiesPanel } from "@nexpress/admin/client";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  await ensureFor("read");
  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");
  // List of identities is admin-only — provider subjects can be used
  // to pivot back to provider accounts, so the read surface is gated
  // tighter than the member side.
  if (!can(user, "admin.manage")) {
    throw new NpForbiddenError("user", "read");
  }

  const { id } = await params;
  const [row] = (await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      createdAt: npUsers.createdAt,
    })
    .from(npUsers)
    .where(eq(npUsers.id, id))
    .limit(1)) as Array<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    createdAt: Date;
  }>;
  if (!row) throw new NpNotFoundError("user", id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/settings"
          className="text-[12.5px] text-neutral-500 underline-offset-[3px] hover:underline dark:text-neutral-400"
        >
          ← Settings
        </Link>
        <div className="mt-1.5 flex items-baseline gap-2.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
            {row.name ?? row.email}
          </h1>
          <span className="rounded-full bg-neutral-950/[0.045] px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-700 dark:bg-white/[0.06] dark:text-neutral-300">
            {row.role}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">{row.email}</p>
      </div>

      <LinkedIdentitiesPanel subjectKind="user" subjectId={row.id} canRevoke />
    </div>
  );
}
