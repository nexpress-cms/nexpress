import {
  COLOR_SCHEME_COOKIE,
  NxColorSchemeScript,
  isColorScheme,
} from "@nexpress/theme";
import { cookies, headers } from "next/headers";

import "./globals.css";

import { i18nConfig } from "@/i18n.config";

/**
 * Root layout. Phase 12.2 reads the locale the middleware
 * resolved from the URL (`x-nx-locale` request header) so the
 * `<html lang>` attribute matches what the page is actually
 * rendering. Falls back to the default locale on any path the
 * middleware skipped (admin / API / static).
 *
 * Phase 11.5 — color scheme. If the visitor previously chose a
 * mode, the `nx-color-scheme` cookie carries it; we set
 * `<html data-theme="...">` server-side so the dark CSS layer
 * applies before the body renders (no FOUC). For first-time
 * visitors with no cookie, `<NxColorSchemeScript />` runs as
 * the first body child to detect `prefers-color-scheme` and
 * apply the right attribute synchronously.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const lang = headerList.get("x-nx-locale") ?? i18nConfig.defaultLocale;
  const cookieJar = await cookies();
  const stored = cookieJar.get(COLOR_SCHEME_COOKIE)?.value;
  const dataTheme = isColorScheme(stored) ? stored : undefined;
  return (
    <html lang={lang} data-theme={dataTheme}>
      <body>
        <NxColorSchemeScript />
        {children}
      </body>
    </html>
  );
}
