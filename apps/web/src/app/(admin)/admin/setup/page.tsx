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
 *
 * Pre-fill from `NX_ADMIN_*` env vars (the same ones `pnpm seed:admin`
 * already reads) so an automated boot — Docker compose, secrets
 * manager, fly.io secrets, etc. — can hand the operator a half-filled
 * form instead of asking them to retype values they already wired up.
 * Password is NEVER pre-filled; we don't want it appearing in the
 * page source even on a localhost render.
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

  const prefill = {
    email: process.env.NX_ADMIN_EMAIL ?? "",
    name: process.env.NX_ADMIN_NAME ?? "",
  };

  return <SetupWizard prefill={prefill} />;
}

export const dynamic = "force-dynamic";
