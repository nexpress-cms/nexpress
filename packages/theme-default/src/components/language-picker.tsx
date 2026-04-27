"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Phase 12.6 — visitor-facing language picker for i18n sites.
 *
 * The locale list is passed in as a prop by the (server)
 * header that reads `getI18nConfig()`. Rendering a `<Link>`
 * for each configured locale lets the visitor jump to the
 * same path under a different locale prefix; the path's first
 * segment is replaced when it matches a known locale, or the
 * locale prefix is added when it doesn't.
 *
 * Translation siblings might be missing for the picked
 * locale; in that case the catch-all returns 404 like any
 * other unknown slug. A future revision can read the
 * `<link rel="alternate" hreflang>` tags emitted by
 * `buildPageMetadata` to disable picker entries with no
 * sibling — that's a separate enhancement, not a blocker
 * for the basic switcher.
 */
export interface LanguagePickerProps {
  locales: string[];
  /** Optional override for displaying the locale chip (e.g.
   *  uppercase code, native name). Defaults to the locale
   *  string upper-cased. */
  formatLabel?: (locale: string) => string;
}

export function LanguagePicker({
  locales,
  formatLabel = (locale) => locale.toUpperCase(),
}: LanguagePickerProps) {
  const pathname = usePathname();

  // The pathname always starts with `/`. Splitting and
  // filtering empty strings yields the segments. If the first
  // segment matches a known locale we strip it; otherwise we
  // treat the whole path as the locale-less remainder.
  const segments = (pathname ?? "/").split("/").filter(Boolean);
  const currentLocale = segments[0] && locales.includes(segments[0])
    ? segments[0]
    : null;
  const remainder = currentLocale ? segments.slice(1).join("/") : segments.join("/");

  return (
    <nav className="nx-language-picker" aria-label="Language">
      {locales.map((locale) => {
        const href = remainder.length > 0 ? `/${locale}/${remainder}` : `/${locale}`;
        const isActive = locale === currentLocale;
        return (
          <Link
            key={locale}
            href={href}
            className="nx-language-picker-link"
            hrefLang={locale}
            aria-current={isActive ? "true" : undefined}
            data-active={isActive ? "true" : undefined}
          >
            {formatLabel(locale)}
          </Link>
        );
      })}
    </nav>
  );
}
