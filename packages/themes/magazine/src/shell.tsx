import type { CSSProperties, ReactNode } from "react";

import { resolveMagazineSettings } from "./settings-helpers.js";

/**
 * Wraps the entire site in the magazine class so theme CSS
 * can scope everything under a single root attribute. The
 * shell adds zero DOM beyond a wrapper div — themes that
 * want to layer in providers / banners / skip-to-main do
 * it here.
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
    <div
      className="np-magazine"
      style={
        Object.keys(styleVars).length > 0
          ? (styleVars as CSSProperties)
          : undefined
      }
    >
      {children}
    </div>
  );
}
