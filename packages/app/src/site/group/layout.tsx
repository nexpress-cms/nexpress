import { NpThemeStyle } from "@nexpress/theme";
import { getCachedTheme } from "@nexpress/next";

import { getCachedActiveTheme } from "../../lib/cached-theme";
import { ensureFor } from "../../lib/init-core";

export const dynamic = "force-dynamic";

/**
 * Phase 11.2 — site layout. After the v0.2 plugin-route surface
 * refactor (#623, member shell wrap), the layout is a thin
 * chrome-emission shell: it renders theme tokens, theme CSS, and
 * the feed-discovery link, then passes `children` through
 * untouched. The site/member shell wrap is a per-page concern
 * via `<ShellWrap surface="site" | "member">` in `components/
 * shell-wrap.tsx` — the catch-all (`[[...slug]]/page.tsx`) picks
 * the surface based on whether a matched plugin route declared
 * `surface: "member"`, and a parallel `(member)/[[...slug]]`
 * catch-all isn't possible in Next.js (file-route conflict).
 *
 * Pages MUST wrap themselves in `<ShellWrap surface="site">` (or
 * `"member"` if they live in `(member)`). A page that forgets
 * renders bare body without chrome — a visible regression. There
 * is no auto-wrap because we need per-route surface dispatch in
 * the catch-all.
 *
 * `force-dynamic` is technically redundant here: the root layout
 * already calls `cookies()` (for the 11.5 dark-mode initial
 * paint) and `headers()` (for the 12.2 `<html lang>`
 * resolution), both of which mark every child route as dynamic.
 * Keeping the directive explicit so a future refactor that lifts
 * those calls out of the root layout doesn't accidentally turn
 * the (site) tree into static pages.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  await ensureFor("read");
  const tokens = await getCachedTheme();
  const active = await getCachedActiveTheme();

  const themeCss = active?.impl.css;
  const themeId = active?.manifest.id;

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
        <style data-np-theme={themeId} dangerouslySetInnerHTML={{ __html: themeCss }} />
      ) : themeId ? (
        // Theme with no `impl.css` still needs the active-theme
        // marker in the DOM so `(site)/error.tsx`'s F.7.1 lazy-
        // import picks the right client subpath (#601). Emit an
        // empty marker tag — no styles leak, just the id sits in
        // a data attribute the boundary's `useActiveThemeId()`
        // reads.
        <style data-np-theme={themeId} />
      ) : null}
      {/*
        Feed discovery link — stays at framework level, not theme
        level. Crawlers and reader apps look for this regardless
        of the theme rendering the page. Member surface skips
        this (see `(member)/layout.tsx`).
      */}
      <link rel="alternate" type="application/atom+xml" title="Posts feed" href="/feed.xml" />
      {children}
    </>
  );
}
