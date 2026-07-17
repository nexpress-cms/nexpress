import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { getRegisteredThemes, npUsers } from "@nexpress/core";

import { getDb } from "../../lib/db";
import { ensureFor } from "../../lib/init-core";

import { SetupWizard, type SetupWizardThemeOption } from "./setup-client";

/**
 * First-boot Admin Setup wizard. Renders only when no admin row
 * exists yet — once one does, redirect straight to /admin/login
 * so the page can't be replayed by a stale tab. The matching API
 * route enforces the same gate server-side.
 *
 * Pre-fill from `NP_ADMIN_*` env vars (the same ones `pnpm seed:admin`
 * already reads) so an automated boot — Docker compose, secrets
 * manager, fly.io secrets, etc. — can hand the operator a half-filled
 * form instead of asking them to retype values they already wired up.
 * Password is NEVER pre-filled; we don't want it appearing in the
 * page source even on a localhost render.
 */
export default async function SetupPage() {
  await ensureFor("read");
  const db = getDb();
  const rows = await db.select({ value: count() }).from(npUsers).where(eq(npUsers.role, "admin"));
  const adminCount = rows[0]?.value ?? 0;
  if (adminCount > 0) redirect("/admin/login");

  // Theme picker source — registered themes from the operator's
  // `nexpress.config.ts`. The wizard renders a text-only picker;
  // visual preview happens later in the admin's Appearance panel
  // (already lets operators switch the active theme freely, now
  // that the bundled-themes prebake makes the swap migration-free).
  const themes: SetupWizardThemeOption[] = getRegisteredThemes().map((theme) => ({
    id: theme.manifest.id,
    name: theme.manifest.name,
    description: theme.manifest.description ?? null,
  }));

  // `NP_ADMIN_THEME` is the headless escape hatch — hand-written
  // into `.env` by an operator who can't open the wizard's browser
  // UI. The wizard interactive picker still wins when the operator
  // does reach the browser; this only seeds the initial selection.
  // Only forward when the value names a registered theme so a
  // typo'd env doesn't silently fall back, leaving the operator
  // unsure which pick is active.
  const envThemeId = process.env.NP_ADMIN_THEME;
  const themeId = envThemeId && themes.some((t) => t.id === envThemeId) ? envThemeId : undefined;

  const prefill = {
    email: process.env.NP_ADMIN_EMAIL ?? "",
    name: process.env.NP_ADMIN_NAME ?? "",
    siteName: process.env.NP_SITE_NAME ?? "",
    ...(themeId ? { themeId } : {}),
  };

  return <SetupWizard prefill={prefill} themes={themes} />;
}

export const dynamic = "force-dynamic";
