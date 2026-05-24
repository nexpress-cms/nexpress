import type { ReactNode } from "react";

import { resolveMagazineSettings } from "./settings-helpers.js";

const MAGAZINE_TOKEN_FALLBACKS = `:root{--np-color-rule:#d8ccb4;--np-color-background-elev:#fcfaf3;--np-color-accent:#c08a3e;--np-font-chrome:"Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}`;

/**
 * Wraps the entire site in the magazine class so theme CSS
 * can scope everything under a single root attribute. The
 * shell also bootstraps two Google font families (Newsreader +
 * Hanken Grotesk) and emits an inline `<style>` block with the
 * `--np-*` custom properties that aren't part of the strict
 * `NpThemeColors` contract (rule + elevated background +
 * accent + chrome font) but are referenced throughout
 * `magazineCss`.
 *
 * Phase F.9.1-B — `settings.accentColor` (hex) overrides the
 * `--np-color-primary` token via the wrapper's inline `style`
 * (which sets a CSS custom property that cascades to
 * descendants). The schema regex (`/^#[0-9a-f]{6}$/i`)
 * validates at write + read; React escapes `style` values, so
 * the path is safe end-to-end. Per-request application means
 * operator changes show on next reload — no full build / token
 * save round-trip needed.
 */
export async function MagazineShell({ children }: { children: ReactNode }) {
  const settings = await resolveMagazineSettings();
  const styleVars: Record<string, string> = {};
  if (settings.accentColor) {
    styleVars["--np-color-primary"] = settings.accentColor;
  }
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..800;1,6..72,400..800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
      />
      <style>{MAGAZINE_TOKEN_FALLBACKS}</style>
      <div
        className="np-magazine"
        style={Object.keys(styleVars).length > 0 ? styleVars : undefined}
      >
        {children}
      </div>
    </>
  );
}
