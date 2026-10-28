import type { ReactNode } from "react";

import { portfolioFontCss } from "./fonts.js";
import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Portfolio shell. Loads the Instrument Serif + Hanken Grotesk
 * vendored webfonts the design relies on, then aliases the theme's
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
      <style>{portfolioFontCss}</style>
      <style>{aliasCss}</style>
      <div className="np-portfolio" style={styleVars}>
        {children}
      </div>
    </>
  );
}
