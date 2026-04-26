import { headers } from "next/headers";

import "./globals.css";

import { i18nConfig } from "@/i18n.config";

/**
 * Root layout. Phase 12.2 reads the locale the middleware
 * resolved from the URL (`x-nx-locale` request header) so the
 * `<html lang>` attribute matches what the page is actually
 * rendering. Falls back to the default locale on any path the
 * middleware skipped (admin / API / static).
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const lang = headerList.get("x-nx-locale") ?? i18nConfig.defaultLocale;
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
