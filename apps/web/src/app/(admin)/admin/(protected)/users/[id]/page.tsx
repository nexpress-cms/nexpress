import {
  NxForbiddenError,
  NxNotFoundError,
  hasRole,
  nxUsers,
  verifyTokenFull,
} from "@nexpress/core";
import { LinkedIdentitiesPanel } from "@nexpress/admin/client";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { ensureCoreServices } from "@/lib/init-core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  ensureCoreServices();
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
  if (!hasRole(user, "admin")) {
    throw new NxForbiddenError("user", "read");
  }

  const { id } = await params;
  const [row] = (await db
    .select({
      id: nxUsers.id,
      email: nxUsers.email,
      name: nxUsers.name,
      role: nxUsers.role,
      createdAt: nxUsers.createdAt,
    })
    .from(nxUsers)
    .where(eq(nxUsers.id, id))
    .limit(1)) as Array<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    createdAt: Date;
  }>;
  if (!row) throw new NxNotFoundError("user", id);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/settings"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Settings
        </Link>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {row.name ?? row.email}
          </h1>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {row.role}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{row.email}</p>
      </div>

      <LinkedIdentitiesPanel subjectKind="user" subjectId={row.id} canRevoke />
    </div>
  );
}
