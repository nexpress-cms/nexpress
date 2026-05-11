import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";

import { npUsers, verifyTokenFull } from "@nexpress/core";
import {
  getRegisteredBlockMetadataForActiveSources,
  getRegisteredPatternsForActiveSources,
} from "@nexpress/blocks";
import { BlocksRegistryProvider } from "@nexpress/admin/client";
import { getCachedActiveThemeId } from "@nexpress/next";
import { ensureFor, getDb } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export default async function AdminProtectedLayout({ children }: { children: ReactNode }) {
  // `"plugins"` instead of `"read"` so plugin blocks land in the
  // shared registry before we snapshot it via
  // `getRegisteredBlockMetadata()` below — otherwise the admin's
  // Add-block popover (and any plugin-contributed block) would be
  // silently absent from the editor.
  await ensureFor("plugins");

  const token = (await cookies()).get("np-session")?.value;
  if (!token) {
    // No session AND no admin in the DB → first-boot wizard;
    // otherwise the regular login form.
    const db = getDb();
    const rows = await db
      .select({ value: count() })
      .from(npUsers)
      .where(eq(npUsers.role, "admin"));
    if ((rows[0]?.value ?? 0) === 0) redirect("/admin/setup");
    redirect("/admin/login");
  }

  const secret =
    process.env.NP_SECRET ?? process.env.NP_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error("NP_SECRET must be set");

  try {
    await verifyTokenFull(token, secret, getDb() as never);
  } catch {
    redirect("/admin/login");
  }

  // Block-metadata + contributed-patterns snapshots — server-side,
  // so plugin/theme-registered blocks AND patterns reach the
  // browser editor through React props. Filter by active-source
  // (#602) so theme blocks from inactive themes are hidden from
  // the Add-block popover — without the filter, every installed
  // theme's blocks would show regardless of which is active.
  // Plugin / built-in / custom blocks always pass.
  const themeId = (await getCachedActiveThemeId()) ?? null;
  const sourceContext = { themeId };
  const blocksMetadata = getRegisteredBlockMetadataForActiveSources(sourceContext);
  const patterns = getRegisteredPatternsForActiveSources(sourceContext);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a className="text-lg font-semibold" href="/admin">
            NexPress Admin
          </a>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="text-sm underline">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <BlocksRegistryProvider metadata={blocksMetadata} patterns={patterns}>
          {children}
        </BlocksRegistryProvider>
      </main>
    </div>
  );
}
