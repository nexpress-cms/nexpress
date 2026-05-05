import { NpThemeStyle } from "@nexpress/theme";
import { getCachedTheme } from "@nexpress/next";

import { getCachedActiveTheme } from "@/lib/cached-theme";
import { ensureFor } from "@/lib/init-core";

export const dynamic = "force-dynamic";

/**
 * Phase 11.2 — site layout reads the active theme from the
 * registry and renders its shell + header + footer slots.
 * Everything that used to live hardcoded in this file moved
 * into `@nexpress/theme-default`. Sites switch themes via the
 * settings UI (11.4 lands the picker) without redeploying.
 *
 * Fallbacks when the active theme doesn't expose a particular
 * piece are deliberately tolerant: an absent shell becomes a
 * fragment, an absent slot is omitted entirely. That lets a
 * theme intentionally remove the header (e.g. a fullscreen
 * landing-page theme) without a workaround.
 *
 * Phase 14.9 — `force-dynamic` here is technically redundant:
 * the root layout already calls `cookies()` (for the 11.5
 * dark-mode initial paint) and `headers()` (for the 12.2
 * `<html lang>` resolution), both of which mark every child
 * route as dynamic. Keeping the directive explicit so a
 * future refactor that lifts those calls out of the root
 * layout doesn't accidentally turn the (site) tree into
 * static pages — see `docs/caching.md`'s "What's NOT cached"
 * for the trade-off analysis.
 */
export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureFor("read");
  const tokens = await getCachedTheme();
  const active = await getCachedActiveTheme();

  const Shell = active?.impl.shell;
  const Header = active?.impl.slots?.header;
  const Footer = active?.impl.slots?.footer;
  const themeCss = active?.impl.css;
  const themeId = active?.manifest.id;

  const inner = (
    <>
      {Header ? <Header /> : null}
      <main className="np-site-main">{children}</main>
      {Footer ? <Footer /> : null}
    </>
  );

  return (
    <>
      <NpThemeStyle theme={tokens} />
      {/*
        Theme-owned CSS — emitted as `<style data-np-theme="{id}">`
        so DevTools makes the source obvious. Inactive themes
        don't leak their styles (only the active theme's CSS
        string is rendered).
      */}
      {themeCss ? (
        <style
          data-np-theme={themeId}
          dangerouslySetInnerHTML={{ __html: themeCss }}
        />
      ) : null}
      {/*
        Feed discovery link — stays at framework level, not theme
        level. Crawlers and reader apps look for this regardless
        of the theme rendering the page.
      */}
      <link
        rel="alternate"
        type="application/atom+xml"
        title="Posts feed"
        href="/feed.xml"
      />
      {Shell ? <Shell>{inner}</Shell> : inner}
    </>
  );
}
