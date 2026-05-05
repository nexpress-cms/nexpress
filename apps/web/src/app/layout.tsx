import { getLocaleDirection } from "@nexpress/core";
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
 * Phase 12.8 — text direction. `getLocaleDirection()` resolves
 * the lang's BCP-47 tag against CLDR's `textInfo` so RTL
 * locales (`ar`, `he`, `fa`, `ur`, …) automatically render
 * mirrored without each site declaring per-locale `dir`
 * config. Themes get `[dir="rtl"]` to scope flipped CSS rules
 * (e.g. `flex-direction: row-reverse` for the header).
 *
 * Color scheme handling intentionally lives outside the
 * framework: themes that want light/dark switching mount
 * `<NpColorSchemeScript />` (re-exported from `@nexpress/theme`)
 * inside their own shell and ship their own CSS overrides.
 * The framework no longer prescribes a dark-mode shape so
 * each theme can choose whatever color-mode policy fits its
 * design (saved choice, time-of-day, seasonal palette, none
 * at all).
 *
 * `<html suppressHydrationWarning>` is the escape hatch for
 * themes that mutate attributes on the root element before
 * hydration (the canonical case is the color-scheme script
 * adding `data-theme="dark"`). React's flag only silences the
 * attribute-level diff on `<html>` itself — child mismatches
 * still surface as warnings — so it's a low-cost concession to
 * keep the door open for theme-level color-mode policies
 * without bleeding the policy into the framework.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const lang = headerList.get("x-nx-locale") ?? i18nConfig.defaultLocale;
  const dir = getLocaleDirection(lang);
  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
