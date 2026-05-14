import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { count, eq } from "drizzle-orm";
import {
  can,
  npUsers,
  verifyTokenFull,
} from "@nexpress/core";
import { AdminShell, BlocksRegistryProvider } from "@nexpress/admin/client";
import {
  getRegisteredBlockMetadataForActiveSources,
  getRegisteredPatternsForActiveSources,
} from "@nexpress/blocks";
import { getCachedActiveTheme } from "../../lib/cached-theme";
import nexpressConfig from "@/nexpress.config";
import { ensureFor } from "../../lib/init-core";
import { getAuthRuntimeConfig } from "../../lib/auth-helpers";
import { getDb } from "../../lib/db";

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
  let user: Awaited<ReturnType<typeof verifyTokenFull>> = null;
  try {
    user = await verifyTokenFull(token, secret, db);
  } catch {
    // Token verification threw (stale cookie signed by a different
    // NP_SECRET — common after re-scaffolding against the same
    // localhost). Treat exactly like an absent / invalid session
    // so the user lands on /admin/setup (when no admin exists) or
    // /admin/login. Without this catch the unhandled JWS error
    // bubbles up as a 500 on `/admin` and the operator can't
    // self-recover from an old cookie.
  }
  if (!user) {
    const rows = await db
      .select({ value: count() })
      .from(npUsers)
      .where(eq(npUsers.role, "admin"));
    if ((rows[0]?.value ?? 0) === 0) redirect("/admin/setup");
    redirect("/admin/login");
  }

  // `getCachedActiveTheme()` is read below for the block / pattern
  // filters; resolve it here too so the collection filter and the
  // block filter agree on which theme is active.
  const activeTheme = await getCachedActiveTheme();
  const activeThemeId = activeTheme?.manifest.id ?? null;

  // Pulls the list straight from `nexpress.config.ts` so the admin
  // sidebar lists every collection the app declares (Posts, Pages,
  // Categories, Tags, Discussions, etc.). Was a `[]` stub before —
  // sidebar rendered no collection nav.
  //
  // Filter out theme-synthesised collections whose owning theme
  // isn't active. The bundled-themes prebake unions every
  // built-in's `createIfAbsent` slug into the schema so
  // swap-from-admin needs no migration — but only the active
  // theme's synthesised slugs deserve sidebar real estate.
  // Operator-declared collections (no `_themeOrigin` tag) always
  // pass through.
  const collections = nexpressConfig.collections
    .filter((c) => {
      const origin = c.admin?._themeOrigin;
      return !origin || origin === activeThemeId;
    })
    .map((c) => ({
      slug: c.slug,
      labels: { plural: c.labels.plural },
      admin: c.admin
        ? {
            group: c.admin.group,
            hidden: c.admin.hidden,
            icon: c.admin.icon,
          }
        : undefined,
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
  //
  // Phase F.4 — filter by the active theme so multi-site
  // processes don't surface every installed theme's blocks in
  // the Add-block popover. Plugin and built-in blocks are
  // always included; only theme blocks are gated by themeId.
  //
  // Reuses `activeTheme` resolved above (fallback to the first
  // registered theme when `np_settings.activeTheme` is unset, via
  // `getCachedActiveTheme()`). Both the collection sidebar filter
  // and the block / pattern filters need to agree on which theme
  // is active, so they share one read.
  const sourceContext = { themeId: activeThemeId };
  const blocksMetadata = getRegisteredBlockMetadataForActiveSources(sourceContext);
  // Phase F.5 — same active-source filter for patterns. Theme
  // patterns from the inactive theme(s) are filtered out so the
  // page builder's pattern picker only shows the current site's
  // patterns. Plugin / built-in / custom patterns always pass.
  const patterns = getRegisteredPatternsForActiveSources(sourceContext);
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
        patterns={patterns}
      >
        {children}
      </BlocksRegistryProvider>
    </AdminShell>
  );
}
