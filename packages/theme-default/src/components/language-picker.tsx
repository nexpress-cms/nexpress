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
 * Sibling-aware mode (Sprint S, doc i18n.md §13): the server
 * resolves which locales actually publish a translation of the
 * current page and passes the result via `availableLocales`.
 * Locales not in that set render as a disabled `<span>` with
 * `aria-disabled="true"` so the visitor can't jump to a
 * guaranteed 404. When the prop is omitted the picker keeps
 * its original "every locale is a live link" behavior — that's
 * the right default for static paths (`/`, `/blog`, `/search`)
 * where the URL space exists in every locale via the catch-all.
 */
export interface LanguagePickerProps {
  locales: string[];
  /**
   * Optional subset of `locales` that actually has a published
   * translation of the current page. Locales outside this set
   * render disabled. Pass `undefined` to leave every locale
   * enabled (the pre-Sprint-S behavior).
   */
  availableLocales?: readonly string[];
  /** Optional override for displaying the locale chip (e.g.
   *  uppercase code, native name). Defaults to the locale
   *  string upper-cased. */
  formatLabel?: (locale: string) => string;
}

export function LanguagePicker({
  locales,
  availableLocales,
  formatLabel = (locale) => locale.toUpperCase(),
}: LanguagePickerProps) {
  const pathname = usePathname();

  // The pathname always starts with `/`. Splitting and
  // filtering empty strings yields the segments. If the first
  // segment matches a known locale we strip it; otherwise we
  // treat the whole path as the locale-less remainder.
  const segments = (pathname ?? "/").split("/").filter(Boolean);
  const currentLocale = segments[0] && locales.includes(segments[0]) ? segments[0] : null;
  const remainder = currentLocale ? segments.slice(1).join("/") : segments.join("/");

  const availableSet = availableLocales ? new Set(availableLocales) : null;

  return (
    <nav className="nx-language-picker" aria-label="Language">
      {locales.map((locale) => {
        const href = remainder.length > 0 ? `/${locale}/${remainder}` : `/${locale}`;
        const isActive = locale === currentLocale;
        const isAvailable = availableSet ? availableSet.has(locale) : true;
        if (!isAvailable) {
          return (
            <span
              key={locale}
              className="nx-language-picker-link"
              aria-disabled="true"
              data-disabled="true"
              title="No translation available for this page"
            >
              {formatLabel(locale)}
            </span>
          );
        }
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
