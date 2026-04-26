import type { ReactNode } from "react";

import { defineTheme } from "@nexpress/theme";

/**
 * `@nexpress/theme-minimal` — sparse demo theme. Phase 11.2
 * ships this alongside `@nexpress/theme-default` so the
 * theme-swap UX (11.4) has something to swap to. Visibly
 * different from the default:
 *
 *   - centered single-line header (no nav menu, no search,
 *     no member widget)
 *   - no footer — just margin
 *   - serif body font, larger reading width
 *   - subtle dotted top border instead of the default solid line
 *
 * The point isn't to be production-ready. It's to prove that
 * the registry / slot system actually swaps the rendered
 * shell, not just the brand color.
 */

function MinimalShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function MinimalHeader() {
  return (
    <header className="nx-site-header nx-minimal-header">
      <a href="/" className="nx-site-logo">
        NexPress
      </a>
    </header>
  );
}

function MinimalFooter() {
  // Empty footer renders just enough margin so the page
  // doesn't pin its last paragraph to the viewport bottom.
  return <footer className="nx-site-footer nx-minimal-footer" aria-hidden="true" />;
}

const minimalCss = `
.nx-minimal-header {
  border-bottom: 1px dotted var(--nx-color-border, #d1d5db);
  padding: 1.5rem 2rem;
  text-align: center;
  background: transparent;
}
.nx-minimal-header .nx-site-logo {
  font-family: var(--nx-font-heading, "Georgia", serif);
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: inherit;
  text-decoration: none;
}
/* Override the default theme's flex nav layout — the minimal
   theme intentionally drops nav links / search / member widget. */
.nx-minimal-header > nav,
.nx-minimal-header .nx-site-nav,
.nx-minimal-header .nx-site-search,
.nx-minimal-header .nx-member-status {
  display: none;
}
.nx-minimal-footer {
  margin-top: 4rem;
  padding: 2rem 0;
  border-top: 1px dotted var(--nx-color-border, #d1d5db);
}
/* Wider body type for editorial reading. */
.nx-site-main {
  font-family: var(--nx-font-body, "Georgia", serif);
  font-size: 1.0625rem;
  line-height: 1.7;
}
`.trim();

export const minimalTheme = defineTheme({
  manifest: {
    id: "minimal",
    name: "Minimal",
    version: "0.1.0",
    description:
      "Editorial single-page layout — centered logo, no nav menu, serif body, more whitespace. Demo theme that proves the 11.x slot system swaps the rendered shell.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
  },
  impl: {
    shell: MinimalShell,
    slots: {
      header: MinimalHeader,
      footer: MinimalFooter,
    },
    css: minimalCss,
  },
});
