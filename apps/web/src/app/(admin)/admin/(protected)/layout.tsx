import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyTokenFull, type NxCollectionConfig } from "@nexpress/core";
import { AdminShell } from "@nexpress/admin/client";
import { ensureCoreServices } from "@/lib/init-core";
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
  ensureCoreServices();

  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");

  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");

  const collections = getCollectionConfigs();

  return (
    <AdminShell user={user} collections={collections}>
      {children}
    </AdminShell>
  );
}
