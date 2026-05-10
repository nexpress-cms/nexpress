import { NpThemeStyle } from "@nexpress/theme";
import { getCachedTheme } from "@nexpress/next";

import { getCachedActiveTheme } from "@/lib/cached-theme";
import { ensureFor } from "@/lib/init-core";

export const dynamic = "force-dynamic";

/**
 * Phase M.1 — member-surface layout. After the v0.2 plugin-route
 * surface refactor (#623), this layout is a thin chrome-emission
 * shell mirroring `(site)/layout.tsx`. Both layouts emit the same
 * theme infrastructure (`NpThemeStyle`, theme CSS); the
 * member-side skips the feed-discovery `<link>` because member
 * pages don't carry feed metadata.
 *
 * Pages MUST wrap themselves in `<ShellWrap surface="member">`
 * (`components/shell-wrap.tsx`) — the layout no longer wraps in
 * shell. The same-named per-page wrap is what enables the (site)
 * catch-all to render `surface: "member"` plugin routes (e.g.
 * forum's `/discussions/new`) with member chrome without forcing
 * a parallel `(member)/[[...slug]]` file route.
 *
 * See `docs/design/member-surface-skinning.md` § 5.1.1 for the
 * F-track route-restructure rationale (locked decision E) and
 * the `impl.members.shell` fallback chain — that chain now lives
 * inside `ShellWrap` instead of the layout.
 */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  await ensureFor("read");
  const tokens = await getCachedTheme();
  const active = await getCachedActiveTheme();

  const themeCss = active?.impl.css;
  const themeId = active?.manifest.id;

  return (
    <>
      <NpThemeStyle theme={tokens} />
      {themeCss ? (
        <style data-np-theme={themeId} dangerouslySetInnerHTML={{ __html: themeCss }} />
      ) : null}
      {children}
    </>
  );
}
