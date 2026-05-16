import type { CSSProperties, ReactNode } from "react";

import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Portfolio shell. Loads the Instrument Serif + Hanken Grotesk
 * webfonts the design relies on, then aliases the theme's
 * canonical `--np-font-heading` / `--np-font-body` tokens to
 * the portfolio-internal `--np-font-display` / `--np-font-chrome`
 * names referenced throughout `styles.ts`. The same inline
 * style threads operator-controlled `settings.accentColor`
 * through `--np-color-accent` (and keeps the legacy
 * `--np-color-primary` override too) so admin token edits
 * cascade through the whole shell.
 */
export async function PortfolioShell({ children }: { children: ReactNode }) {
  const settings = await resolvePortfolioSettings();
  const styleVars: Record<string, string> = {};
  if (settings.accentColor) {
    styleVars["--np-color-primary"] = settings.accentColor;
    styleVars["--np-color-accent"] = settings.accentColor;
  }
  const aliasCss = `.np-portfolio { --np-font-display: var(--np-font-heading); --np-font-chrome: var(--np-font-body); }`;
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
      />
      <style>{aliasCss}</style>
      <div className="np-portfolio" style={styleVars as CSSProperties}>
        {children}
      </div>
    </>
  );
}
