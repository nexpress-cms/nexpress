import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { nxUsers } from "@nexpress/core";

import { getDb } from "@/lib/bootstrap";

import { LoginClient } from "./login-client";

/**
 * Admin login. Redirects to `/admin/setup` when no admin exists
 * yet, so a fresh install lands on the wizard instead of a blank
 * login form whose only outcome is "user not found."
 */
export default async function AdminLoginPage() {
  const db = getDb();
  const rows = await db
    .select({ value: count() })
    .from(nxUsers)
    .where(eq(nxUsers.role, "admin"));
  if ((rows[0]?.value ?? 0) === 0) {
    redirect("/admin/setup");
  }
  return <LoginClient />;
}

export const dynamic = "force-dynamic";
