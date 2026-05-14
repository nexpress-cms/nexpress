import type { CSSProperties, ReactNode } from "react";

import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Portfolio shell. Renders a `--np-color-primary` override into
 * the wrapper when the operator picks a custom accent color in
 * settings; otherwise the theme tokens win. The redesigned card
 * grid uses hardcoded `aspect-ratio` per span level inside
 * `styles.ts`, so no per-aspect / per-hover CSS variables are
 * threaded through anymore.
 */
export async function PortfolioShell({ children }: { children: ReactNode }) {
  const settings = await resolvePortfolioSettings();
  const styleVars: Record<string, string> = {};
  if (settings.accentColor) {
    styleVars["--np-color-primary"] = settings.accentColor;
  }
  return (
    <div className="np-portfolio" style={styleVars as CSSProperties}>
      {children}
    </div>
  );
}
