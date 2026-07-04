import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { npUsers } from "@nexpress/core";
import { listOAuthProvidersFor } from "@nexpress/core/auth";

import { getDb } from "../../lib/db";
import { ensureFor } from "../../lib/init-core";

import { LoginClient } from "./login-client";

/**
 * Admin login page. Redirects to `/admin/setup` when no admin
 * exists yet so a fresh install lands on the wizard instead of
 * a blank login form whose only outcome is "user not found."
 *
 * The OAuth-provider list is resolved server-side after
 * `ensureFor("plugins")` so plugin-contributed providers
 * (`@nexpress/plugin-oauth-github`, `…-google`) appear above the
 * email/password form. Empty list → email/password only.
 */
export default async function LoginPage() {
  await ensureFor("plugins");
  const db = getDb();
  const rows = await db.select({ value: count() }).from(npUsers).where(eq(npUsers.role, "admin"));
  if ((rows[0]?.value ?? 0) === 0) {
    redirect("/admin/setup");
  }

  const providers = listOAuthProvidersFor("staff").map((provider) => ({
    id: provider.id,
    label: provider.label ?? provider.id,
  }));

  return <LoginClient providers={providers} />;
}

export const dynamic = "force-dynamic";
