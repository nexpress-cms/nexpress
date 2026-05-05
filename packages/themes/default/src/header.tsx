import { getI18nConfig } from "@nexpress/core";
import type { NpNavItem } from "@nexpress/core";
import { getCachedNavigation, resolveAvailableLocales } from "@nexpress/next";
import { headers } from "next/headers";

import { DarkModeToggle } from "./components/dark-mode-toggle.js";
import { LanguagePicker } from "./components/language-picker.js";
import { MemberStatusWidget } from "./components/member-status-widget.js";
import { MobileNav } from "./components/mobile-nav.js";

/**
 * Default theme header — server component. Reads the
 * `header` navigation menu and renders the desktop / mobile
 * surfaces in one go:
 *
 *   - Desktop (≥768px): inline link list, search bar, lang
 *     picker, dark toggle, member widget.
 *   - Mobile (<768px): the inline list collapses (CSS-only) and
 *     a hamburger button opens a slide-in drawer (`<MobileNav />`,
 *     a small client component that owns its own open/closed
 *     state). The same nav items feed both surfaces — markup is
 *     server-rendered once and reused.
 *
 * The header is `position: sticky` (see styles.ts) so the search
 * + member widget stay reachable as the page scrolls.
 */
export async function DefaultHeader() {
  const headerNav = await getCachedNavigation("header");
  const i18n = getI18nConfig();
  const showLanguagePicker = (i18n?.locales.length ?? 0) > 1;

  let availableLocales: string[] | null = null;
  if (showLanguagePicker) {
    const headerList = await headers();
    const pathname = headerList.get("x-nx-pathname");
    if (pathname) {
      try {
        availableLocales = await resolveAvailableLocales(pathname);
      } catch {
        availableLocales = null;
      }
    }
  }

  return (
    <header className="nx-site-header">
      <div className="nx-site-header-inner">
        <a href="/" className="nx-site-logo">
          NexPress
        </a>
        <nav className="nx-site-nav-desktop" aria-label="Primary">
          <ul className="nx-site-nav">
            {headerNav.map((item: NpNavItem, index: number) => (
              <li key={`nav-${index.toString()}`} className="nx-site-nav-item">
                <a href={item.url}>{item.label}</a>
                {item.children && item.children.length > 0 ? (
                  <ul className="nx-site-subnav">
                    {item.children.map((child: NpNavItem, childIndex: number) => (
                      <li key={`nav-${index.toString()}-${childIndex.toString()}`}>
                        <a href={child.url}>{child.label}</a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
        <div className="nx-site-header-tools">
          <form
            action="/search"
            method="GET"
            role="search"
            className="nx-site-search"
          >
            <label className="sr-only" htmlFor="nx-site-search-input">
              Search
            </label>
            <input
              id="nx-site-search-input"
              type="search"
              name="q"
              placeholder="Search…"
              autoComplete="off"
              className="nx-site-search-input"
            />
          </form>
          {showLanguagePicker && i18n ? (
            <LanguagePicker
              locales={i18n.locales}
              availableLocales={availableLocales ?? undefined}
            />
          ) : null}
          <DarkModeToggle />
          <MemberStatusWidget />
          <MobileNav items={headerNav} />
        </div>
      </div>
    </header>
  );
}
