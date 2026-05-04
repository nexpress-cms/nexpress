import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { count, eq } from "drizzle-orm";
import { can, nxUsers, verifyTokenFull } from "@nexpress/core";
import { AdminShell } from "@nexpress/admin/client";
import nexpressConfig from "@/nexpress.config";
import { ensureFor } from "@/lib/init-core";
import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureFor("read");

  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) {
    // No session AND no admin in the DB → first-boot wizard;
    // otherwise the regular login form.
    const db = getDb();
    const rows = await db
      .select({ value: count() })
      .from(nxUsers)
      .where(eq(nxUsers.role, "admin"));
    if ((rows[0]?.value ?? 0) === 0) redirect("/admin/setup");
    redirect("/admin/login");
  }

  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");

  // Pulls the list straight from `nexpress.config.ts` so the admin
  // sidebar lists every collection the app declares (Posts, Pages,
  // localized variants, taxonomies, discussions, etc.). Was a `[]`
  // stub before — sidebar rendered no collection nav.
  const collections = nexpressConfig.collections;
  // Server-side capability resolution — keeps `@nexpress/core`
  // (which pulls `pg`/`sharp`/`argon2`) out of the admin client
  // bundle. The shell mirrors the same gates client-side via the
  // `caps` prop. (#343)
  const caps = {
    canManageAdmin: can(user, "admin.manage"),
    canPublish: can(user, "content.publish"),
    canModerate: can(user, "community.moderate"),
  };

  return (
    <AdminShell user={user} collections={collections} caps={caps}>
      {children}
    </AdminShell>
  );
}
