import { NxForbiddenError, isStaffMod, verifyTokenFull } from "@nexpress/core";
import { ReportsQueueView } from "@nexpress/admin/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { ensureCoreServices } from "@/lib/init-core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CommunityReportsPage() {
  ensureCoreServices();
  const cookieStore = await cookies();
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");
  if (!isStaffMod(user)) {
    throw new NxForbiddenError("reports", "list");
  }
  return <ReportsQueueView />;
}
