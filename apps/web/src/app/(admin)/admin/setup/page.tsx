import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { nxUsers } from "@nexpress/core";

import { getDb } from "@/lib/db";
import { ensureFor } from "@/lib/init-core";

import { SetupWizard } from "./setup-client";

/**
 * First-boot Admin Setup wizard. Renders only when no admin row
 * exists yet — once one does, redirect straight to /admin/login
 * so the page can't be replayed by a stale tab. The matching API
 * route enforces the same gate server-side.
 */
export default async function SetupPage() {
  await ensureFor("read");
  const db = getDb();
  const rows = await db
    .select({ value: count() })
    .from(nxUsers)
    .where(eq(nxUsers.role, "admin"));
  const adminCount = rows[0]?.value ?? 0;
  if (adminCount > 0) redirect("/admin/login");

  return <SetupWizard />;
}

export const dynamic = "force-dynamic";
