import { getLocaleDirection } from "@nexpress/core";
import { NxColorSchemeScript } from "@nexpress/theme";
import { headers } from "next/headers";

import "./globals.css";

import { i18nConfig } from "@/i18n.config";

/**
 * Root layout. Phase 12.2 reads the locale the proxy resolved
 * from the URL (`x-nx-locale` request header) so the
 * `<html lang>` attribute matches what the page is actually
 * rendering. Falls back to the default locale on any path the
 * proxy skipped (admin / API / static).
 *
 * Color scheme — `<NxColorSchemeScript />` runs as the first
 * body child to read the `nx-color-scheme` cookie + storage and
 * apply the right `data-theme` attribute on `<html>`
 * synchronously. We DON'T read the cookie server-side anymore
 * (Sprint S, doc caching.md §"What's NOT cached"): server
 * rendering the attribute would mean every (site) page is
 * dynamic via `cookies()`. Trade: visitors with a saved dark
 * preference see ~one frame of the light layer before the
 * script flips it. The script runs before paint in modern
 * browsers, so the flash is rarely perceptible.
 *
 * Phase 12.8 — text direction. `getLocaleDirection()` resolves
 * the lang's BCP-47 tag against CLDR's `textInfo` so RTL
 * locales (`ar`, `he`, `fa`, `ur`, …) automatically render
 * mirrored without each site declaring per-locale `dir`
 * config. Themes get `[dir="rtl"]` to scope flipped CSS rules
 * (e.g. `flex-direction: row-reverse` for the header).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const lang = headerList.get("x-nx-locale") ?? i18nConfig.defaultLocale;
  const dir = getLocaleDirection(lang);
  return (
    <html lang={lang} dir={dir}>
      <body>
        <NxColorSchemeScript />
        {children}
      </body>
    </html>
  );
}
