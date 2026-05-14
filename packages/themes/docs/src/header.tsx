import * as React from "react";
import { NavMenu, getCachedSite } from "@nexpress/next";

import { SearchKeyboardShortcut } from "./components/search-keyboard-shortcut.js";
import { resolveDocsSettings } from "./settings-helpers.js";

const FALLBACK_SITE_NAME = "NexPress";

/**
 * Docs theme masthead. Brand strap (mark + wordmark + version
 * pill) on the left, ⌘K search form centered, primary nav +
 * GitHub repo link on the right.
 *
 * Search is a plain GET form to `/docs/search` — the theme's
 * own route handles the query so the host's `(site)/search`
 * page doesn't shadow it (#609). The ⌘K affordance is purely
 * visual hint copy in a `<kbd>`; wiring it to a global hotkey
 * is a separate client island sites can add on top.
 *
 * The GitHub link reads `settings.githubRepo`. When the admin
 * setting is unset, the link is hidden.
 */
export async function DocsHeader(): Promise<React.ReactElement> {
  const [settings, site] = await Promise.all([
    resolveDocsSettings(),
    getCachedSite(),
  ]);
  const siteName = site?.name?.trim() || FALLBACK_SITE_NAME;
  return (
    <header className="np-docs-header">
      <div className="np-docs-header-inner">
        <a href="/" className="np-docs-brand">
          <span className="np-docs-brand-mark" aria-hidden="true" />
          <span className="np-docs-brand-name">{siteName}</span>
          <span className="np-docs-brand-version">{settings.version}</span>
        </a>
        <form
          action="/docs/search"
          method="get"
          className="np-docs-search-form"
          role="search"
        >
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
            placeholder={settings.searchPlaceholder}
            className="np-docs-search-input"
          />
          <kbd className="np-docs-search-kbd">⌘K</kbd>
        </form>
        <SearchKeyboardShortcut targetId="np-docs-search-input" />
        <nav className="np-docs-nav" aria-label="Primary">
          <NavMenu location="primary" className="np-docs-primary-nav" />
          {settings.githubRepo ? (
            <a
              href={settings.githubRepo}
              className="np-docs-github"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub repository"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 .5a12 12 0 0 0-3.8 23.39c.6.11.82-.26.82-.58v-2c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
              </svg>
              GitHub
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
