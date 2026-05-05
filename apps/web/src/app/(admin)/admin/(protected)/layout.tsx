import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { count, eq } from "drizzle-orm";
import { can, npUsers, verifyTokenFull } from "@nexpress/core";
import { AdminShell, BlocksRegistryProvider } from "@nexpress/admin/client";
import { getRegisteredBlockMetadata } from "@nexpress/blocks";
import nexpressConfig from "@/nexpress.config";
import { ensureFor } from "@/lib/init-core";
import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `"plugins"` instead of `"read"` so plugin blocks land in the
  // shared registry before we snapshot it via
  // `getRegisteredBlockMetadata()` below — otherwise the admin's
  // Add-block popover would silently miss every plugin contribution.
  await ensureFor("plugins");

  const cookieStore = await cookies();
  const token = cookieStore.get("np-session")?.value;
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

  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");

  // Pulls the list straight from `nexpress.config.ts` so the admin
  // sidebar lists every collection the app declares (Posts, Pages,
  // localized variants, taxonomies, discussions, etc.). Was a `[]`
  // stub before — sidebar rendered no collection nav.
  const collections = nexpressConfig.collections.map((c) => ({
    slug: c.slug,
    labels: { plural: c.labels.plural },
    admin: c.admin ? { group: c.admin.group, hidden: c.admin.hidden } : undefined,
  }));
  // Server-side capability resolution — keeps `@nexpress/core`
  // (which pulls `pg`/`sharp`/`argon2`) out of the admin client
  // bundle. The shell mirrors the same gates client-side via the
  // `caps` prop. (#343)
  const caps = {
    canManageAdmin: can(user, "admin.manage"),
    canPublish: can(user, "content.publish"),
    canModerate: can(user, "community.moderate"),
  };

  // Block metadata snapshot — server-side, so plugin-registered
  // blocks (which only land in the SERVER module-instance during
  // bootstrap) reach the browser editor through React props.
  const blocksMetadata = getRegisteredBlockMetadata();
  // Same trick for collection-slug options used by `propsSchema`
  // entries with `type: "collection"`. The picker can't ask the
  // browser for the registered slugs (block render runs on the
  // server, the registry is module-scoped), so we snapshot the
  // list once at request time. Label is the slug for now;
  // collections.label.plural would be friendlier — left as a
  // follow-up so this PR keeps moving.
  const collectionOptions = collections.map((c) => ({
    label: c.labels.plural,
    value: c.slug,
  }));

  return (
    <AdminShell user={user} collections={collections} caps={caps}>
      <BlocksRegistryProvider
        metadata={blocksMetadata}
        collectionOptions={collectionOptions}
      >
        {children}
      </BlocksRegistryProvider>
    </AdminShell>
  );
}
