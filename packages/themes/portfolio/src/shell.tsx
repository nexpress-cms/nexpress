import type { CSSProperties, ReactNode } from "react";

import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Phase F.9.1-B — shell renders inline `<style>` block that
 * threads operator settings into CSS custom properties:
 *
 *   --np-color-primary       — settings.accentColor override
 *   --np-portfolio-aspect    — settings.cardAspect (CSS aspect-ratio value)
 *   --np-portfolio-hover     — settings.hoverStyle (data attribute consumed
 *                              by styles.ts hover variants)
 *
 * The card / hover styles inside `styles.ts` read the variables
 * + a `[data-hover-style="<x>"]` attribute set on this element
 * so the hover effect swaps without restructuring the cards
 * themselves.
 */
const ASPECT_VALUES = {
  square: "1 / 1",
  portrait: "3 / 4",
  landscape: "4 / 3",
  golden: "1 / 1.618",
} as const;

export async function PortfolioShell({ children }: { children: ReactNode }) {
  const settings = await resolvePortfolioSettings();
  const aspect = ASPECT_VALUES[settings.cardAspect];
  const styleVars: Record<string, string> = {
    "--np-portfolio-card-aspect": aspect,
  };
  if (settings.accentColor) {
    styleVars["--np-color-primary"] = settings.accentColor;
  }
  return (
    <div
      className="np-portfolio"
      data-hover-style={settings.hoverStyle}
      style={styleVars as CSSProperties}
    >
      {children}
    </div>
  );
}
