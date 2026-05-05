import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { npUsers } from "@nexpress/core";

import { getDb } from "@/lib/bootstrap";

import { SetupWizard } from "./setup-client";

/**
 * First-boot Admin Setup wizard. Renders only when no admin row
 * exists yet — once one does, redirect straight to /admin/login
 * so the page can't be replayed by a stale tab. The matching API
 * route enforces the same gate server-side.
 *
 * Pre-fill `NX_ADMIN_EMAIL` / `NX_ADMIN_NAME` from env so an
 * automated boot (compose / fly / secrets manager) doesn't make
 * the operator retype values they've already wired up. Password
 * is never pre-filled; we don't want it in the page source.
 */
export default async function SetupPage() {
  const db = getDb();
  const rows = await db
    .select({ value: count() })
    .from(npUsers)
    .where(eq(npUsers.role, "admin"));
  const adminCount = rows[0]?.value ?? 0;
  if (adminCount > 0) redirect("/admin/login");

  const prefill = {
    email: process.env.NX_ADMIN_EMAIL ?? "",
    name: process.env.NX_ADMIN_NAME ?? "",
  };

  return <SetupWizard prefill={prefill} />;
}

export const dynamic = "force-dynamic";
