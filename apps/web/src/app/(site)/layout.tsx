import { NxThemeStyle } from "@nexpress/theme";
import { getCachedTheme } from "@nexpress/next";

import { getCachedActiveTheme } from "@/lib/cached-theme";
import { ensureCoreServices } from "@/lib/init-core";

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
 */
export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  ensureCoreServices();
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
      <main className="nx-site-main">{children}</main>
      {Footer ? <Footer /> : null}
    </>
  );

  return (
    <>
      <NxThemeStyle theme={tokens} />
      {/*
        Theme-owned CSS — emitted as `<style data-nx-theme="{id}">`
        so DevTools makes the source obvious. Inactive themes
        don't leak their styles (only the active theme's CSS
        string is rendered).
      */}
      {themeCss ? (
        <style
          data-nx-theme={themeId}
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
