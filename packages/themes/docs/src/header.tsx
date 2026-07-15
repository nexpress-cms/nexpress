import * as React from "react";
import { NavMenu, getCachedSite } from "@nexpress/next";

import { SearchKeyboardShortcut } from "./components/search-keyboard-shortcut.js";
import { resolveDocsSettings } from "./settings-helpers.js";

const FALLBACK_SITE_NAME = "NexPress";

/**
 * Docs theme masthead. Brand strap (mark + wordmark + version
 * pill) on the left, ⌘K search form centered, primary nav on
 * the right — three intrinsic-width columns with the search
 * filling the middle track.
 *
 * Search is a plain GET form to `/docs/search` — the theme's
 * own route handles the query so the host's `(site)/search`
 * page doesn't shadow it (#609). The ⌘K affordance is purely
 * visual hint copy in a `<kbd>`; the `<SearchKeyboardShortcut>`
 * client island wires the actual focus shortcut.
 *
 * Operators who want a GitHub link in the header add it via the
 * primary nav (Settings → Menus → header), pointing at
 * `settings.githubRepo`. The doc-page footer's "Edit this
 * page" / "Report issue" links continue to read the same setting
 * independently.
 */
export async function DocsHeader(): Promise<React.ReactElement> {
  const [settings, site] = await Promise.all([resolveDocsSettings(), getCachedSite()]);
  const siteName = site?.name?.trim() || FALLBACK_SITE_NAME;
  return (
    <header className="np-docs-header">
      <div className="np-docs-header-inner">
        <a href="/" className="np-docs-brand">
          <span className="np-docs-brand-mark" aria-hidden="true" />
          <span>{siteName}</span>
          <span className="np-docs-brand-version">{settings.version}</span>
        </a>
        <form action="/docs/search" method="get" className="np-docs-search-form" role="search">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <label className="sr-only" htmlFor="np-docs-search-input">
            Search the docs
          </label>
          <input
            id="np-docs-search-input"
            type="search"
            name="q"
            maxLength={256}
            placeholder={settings.searchPlaceholder}
            className="np-docs-search-input"
          />
          <kbd className="np-docs-search-kbd">⌘K</kbd>
        </form>
        <SearchKeyboardShortcut targetId="np-docs-search-input" />
        <nav className="np-docs-nav" aria-label="Primary">
          <NavMenu location="header" className="np-docs-primary-nav" />
        </nav>
      </div>
    </header>
  );
}
