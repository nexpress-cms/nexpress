import type { ReactNode } from "react";

import { defineTheme } from "@nexpress/theme";

/**
 * `@nexpress/theme-minimal` — v0.1-era sparse demo theme.
 *
 * **Status (v0.2):** kept for back-compat. New sites should
 * use `theme-magazine` / `theme-docs` / `theme-portfolio` for
 * v0.2 contract surfaces (settingsSchema, blocks, archives,
 * etc.). This theme remains a working `defineTheme` caller
 * but doesn't participate in the v0.2 operator-no-code flow.
 *
 * Phase 11.2 shipped this alongside `@nexpress/theme-default`
 * so the theme-swap UX (11.4) had something to swap to. Visibly
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
    <header className="np-site-header np-minimal-header">
      <a href="/" className="np-site-logo">
        NexPress
      </a>
    </header>
  );
}

function MinimalFooter() {
  // Empty footer renders just enough margin so the page
  // doesn't pin its last paragraph to the viewport bottom.
  return <footer className="np-site-footer np-minimal-footer" aria-hidden="true" />;
}

const minimalCss = `
.np-minimal-header {
  border-bottom: 1px dotted var(--np-color-border, #d1d5db);
  padding: 1.5rem 2rem;
  text-align: center;
  background: transparent;
}
.np-minimal-header .np-site-logo {
  font-family: var(--np-font-heading, "Georgia", serif);
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: inherit;
  text-decoration: none;
}
/* The minimal header doesn't render nav / search / member
   widget at all — the components return only the logo — so
   we don't need defensive display:none rules here. The default
   theme's CSS isn't injected when minimal is active either. */
.np-minimal-footer {
  margin-top: 4rem;
  padding: 2rem 0;
  border-top: 1px dotted var(--np-color-border, #d1d5db);
}
/* Wider body type for editorial reading. */
.np-site-main {
  font-family: var(--np-font-body, "Georgia", serif);
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
