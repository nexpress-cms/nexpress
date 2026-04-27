import type { NxNavItem } from "@nexpress/core";
import { getCachedNavigation } from "@nexpress/next";

import { DarkModeToggle } from "./components/dark-mode-toggle.js";
import { MemberStatusWidget } from "./components/member-status-widget.js";

/**
 * Default theme header — server component. Reads the
 * `header` navigation menu and renders logo / nav items /
 * search form / member status widget. Themes that want a
 * different shape (centered logo, mega-menu, etc.) override
 * `slots.header` in their own `defineTheme()` call —
 * `@nexpress/theme-minimal` is the canonical sparse example.
 *
 * Previously hardcoded in `apps/web/src/app/(site)/layout.tsx`;
 * 11.2 moved it here so a theme swap actually changes the
 * rendered header (not just the styles around an unchanged DOM).
 */
export async function DefaultHeader() {
  const headerNav = await getCachedNavigation("header");

  return (
    <header className="nx-site-header">
      <nav>
        <a href="/" className="nx-site-logo">
          NexPress
        </a>
        <ul className="nx-site-nav">
          {headerNav.map((item: NxNavItem) => (
            <li key={item.label}>
              <a href={item.url}>{item.label}</a>
            </li>
          ))}
        </ul>
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
        <DarkModeToggle />
        <MemberStatusWidget />
      </nav>
    </header>
  );
}
