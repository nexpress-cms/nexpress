import type { ReactNode } from "react";

import { resolveMagazineSettings } from "./settings-helpers.js";

/**
 * Wraps the entire site in the magazine class so theme CSS
 * can scope everything under a single root attribute. The
 * shell adds zero DOM beyond a wrapper div — themes that
 * want to layer in providers / banners / skip-to-main do
 * it here.
 *
 * Phase F.9.1-B — `settings.accentColor` (hex) overrides the
 * `--np-color-primary` token via inline `<style>`. Unlike a
 * static token override (which would require an admin save +
 * cache bust to take effect across the site), the inline
 * variable is set per-request so the operator's hex flows
 * through immediately. Tokens still win on theme switch +
 * settings save (the existing `nx:theme` invalidation covers
 * both since `getThemeSettings` reuses that tag).
 */
export async function MagazineShell({ children }: { children: ReactNode }) {
  const settings = await resolveMagazineSettings();
  return (
    <div className="np-magazine">
      {settings.accentColor ? (
        <style
          // Scoped under `.np-magazine` so a multi-theme dev
          // preview (admin theme switcher with side-by-side)
          // doesn't leak the override outside the magazine
          // shell. The CSS specificity tradeoff: an admin
          // tokens panel that sets `--np-color-primary` at
          // `:root` still wins (more general selector loses to
          // class-scoped one is incorrect — class is more
          // specific, so the override here wins, which is the
          // intended UX since accentColor IS the operator's
          // pick).
          dangerouslySetInnerHTML={{
            __html: `.np-magazine { --np-color-primary: ${settings.accentColor}; }`,
          }}
        />
      ) : null}
      {children}
    </div>
  );
}
