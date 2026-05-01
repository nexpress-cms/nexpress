import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { can, verifyTokenFull, type NxCollectionConfig } from "@nexpress/core";
import { AdminShell } from "@nexpress/admin/client";
import { ensureFor } from "@/lib/init-core";
import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";

function getCollectionConfigs(): NxCollectionConfig[] {
  return [];
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureFor("read");

  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");

  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");

  const collections = getCollectionConfigs();
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
