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
  //   1. `impl.members.shell` truthy → use it (theme owns its own chrome)
  //   2. `impl.members.shell === null` → opt out (bare body)
  //   3. `impl.members.shell === undefined` → fall back to top
  //      shell, which expects Header + main + Footer per
  //      `(site)/layout.tsx`'s contract. We must include the
  //      slots in `inner` so themes whose `impl.shell` opens a
  //      `<body>` wrapper around its `children` see the Header
  //      and Footer they expect — otherwise member pages would
  //      lose chrome entirely on themes that haven't migrated to
  //      `impl.members.shell` yet.
  //   4. Both shells absent → fragment
  const memberShell = active?.impl.members?.shell;
  let Shell: NonNullable<typeof active>["impl"]["shell"] | null;
  let includeChromeSlots: boolean;
  if (memberShell === null) {
    Shell = null;
    includeChromeSlots = false; // explicit opt-out — render bare
  } else if (memberShell !== undefined) {
    Shell = memberShell;
    includeChromeSlots = false; // theme's member shell owns chrome
  } else {
    Shell = active?.impl.shell ?? null;
    includeChromeSlots = true; // mirror (site) layout's expectation
  }

  const Header = includeChromeSlots ? active?.impl.slots?.header : undefined;
  const Footer = includeChromeSlots ? active?.impl.slots?.footer : undefined;
  const themeCss = active?.impl.css;
  const themeId = active?.manifest.id;

  const inner = (
    <>
      {Header ? <Header /> : null}
      <main className="np-member-main">{children}</main>
      {Footer ? <Footer /> : null}
    </>
  );

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
