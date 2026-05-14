import { can, NpForbiddenError, verifyTokenFull } from "@nexpress/core";
import { CommunitySettingsView } from "@nexpress/admin/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthRuntimeConfig } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { getDb } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export default async function CommunitySettingsPage() {
  await ensureFor("read");
  const cookieStore = await cookies();
  const token = cookieStore.get("np-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");
  if (!can(user, "community.moderate")) {
    throw new NpForbiddenError("community.settings", "read");
  }
  return <CommunitySettingsView canEdit={can(user, "admin.manage")} />;
}
