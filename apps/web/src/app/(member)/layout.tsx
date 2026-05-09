import { NpThemeStyle } from "@nexpress/theme";
import { getCachedTheme } from "@nexpress/next";

import { getCachedActiveTheme } from "@/lib/cached-theme";
import { ensureFor } from "@/lib/init-core";

export const dynamic = "force-dynamic";

/**
 * Phase M.1 — member-surface layout. Mirrors `(site)/layout.tsx` for
 * the `(member)/members/*` route tree (login / register /
 * forgot-password / reset-password / verify / me/notifications).
 *
 * Why a separate layout: route groups are siblings, not nested.
 * Next.js runs ONE root layout per request based on which group
 * the URL is in. So this layout duplicates the infrastructure pieces
 * `(site)/layout.tsx` ships (theme tokens emission, theme CSS
 * `<style>`, ensureFor("read")) instead of inheriting them. The
 * shell wrap differs: member pages prefer `impl.members.shell` over
 * `impl.shell`, with the explicit `null` opt-out and the eventual
 * fragment fallback per the locked contract on `NpThemeImpl.members`.
 *
 * Differences vs `(site)/layout.tsx`:
 * - Wraps content in the member shell (or fallback chain).
 * - Skips the `<link rel="alternate" type="application/atom+xml">`
 *   feed-discovery line — member pages don't carry feed metadata.
 *
 * See `docs/design/member-surface-skinning.md` § 5.1.1 for the
 * route-restructure rationale (locked decision E).
 */
export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureFor("read");
  const tokens = await getCachedTheme();
  const active = await getCachedActiveTheme();

  // Fallback chain per design doc § 5.1:
  //   1. `impl.members.shell` truthy → use it
  //   2. `impl.members.shell === null` → opt out (bare)
  //   3. `impl.members.shell === undefined` → fall back to top shell
  //   4. `impl.shell === undefined` → fragment
  const memberShell = active?.impl.members?.shell;
  const Shell =
    memberShell === null
      ? null // explicit opt-out — render bare
      : memberShell !== undefined
        ? memberShell
        : (active?.impl.shell ?? null);

  const themeCss = active?.impl.css;
  const themeId = active?.manifest.id;

  const inner = <main className="np-member-main">{children}</main>;

  return (
    <>
      <NpThemeStyle theme={tokens} />
      {themeCss ? (
        <style
          data-np-theme={themeId}
          dangerouslySetInnerHTML={{ __html: themeCss }}
        />
      ) : null}
      {Shell ? <Shell>{inner}</Shell> : inner}
    </>
  );
}
