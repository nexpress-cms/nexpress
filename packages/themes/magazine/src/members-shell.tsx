import type { CSSProperties, ReactNode } from "react";

import { MagazineFooter } from "./footer.js";
import { MagazineHeader } from "./header.js";
import { resolveMagazineSettings } from "./settings-helpers.js";

/**
 * Phase M.ref — magazine's member-tree shell.
 *
 * Wraps the (member)/members/* route body in the magazine's
 * masthead + footer chrome, plus a narrow column container so
 * auth forms (login / register / verify / etc.) don't stretch
 * to the full editorial column width.
 *
 * Reuses `MagazineHeader` / `MagazineFooter` directly so a theme
 * version bump that touches the masthead also touches member
 * pages — single source of truth for chrome.
 *
 * Does its own `np-magazine` root wrapper (and accent-color
 * inline style) for the same reason `MagazineShell` does — the
 * (member)/layout.tsx replaces `impl.shell` with this for member
 * routes (per the M.1 fallback chain), so this component owns
 * the theme root attribute.
 */
export async function MagazineMembersShell({ children }: { children: ReactNode }) {
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
      <MagazineHeader />
      <main className="np-magazine-members">
        <div className="np-magazine-members-column">{children}</div>
      </main>
      <MagazineFooter />
    </div>
  );
}
