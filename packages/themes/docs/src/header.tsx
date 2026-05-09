import * as React from "react";
import { NavMenu } from "@nexpress/next";

import { resolveDocsSettings } from "./settings-helpers.js";

/**
 * Phase F.9-B — docs theme masthead.
 *
 * Brand strap: site title (left), search input (center), nav
 * + version label (right). Reads settings via
 * `resolveDocsSettings()` so the version label and search
 * placeholder match the operator's admin choices.
 *
 * The search input is a plain GET form to `/search` — F.2's
 * theme route on `/search` handles the actual query. No
 * client-side JS for the input itself; works without
 * hydration.
 */
export async function DocsHeader(): Promise<React.ReactElement> {
  const settings = await resolveDocsSettings();
  return (
    <header className="np-docs-header">
      <div className="np-docs-header-inner">
        <a href="/" className="np-docs-brand">
          <span className="np-docs-brand-name">Docs</span>
          <span className="np-docs-brand-version">{settings.version}</span>
        </a>
        <form
          action="/search"
          method="get"
          className="np-docs-search-form"
          role="search"
        >
          <input
            type="search"
            name="q"
            placeholder={settings.searchPlaceholder}
            className="np-docs-search-input"
            aria-label="Search the docs"
          />
        </form>
        <nav className="np-docs-nav" aria-label="Primary">
          <NavMenu location="primary" className="np-docs-primary-nav" />
          {settings.githubRepo ? (
            <a
              href={settings.githubRepo}
              className="np-docs-github-link"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
