import type { CSSProperties, ReactNode } from "react";

import { MagazineFooter } from "./footer.js";
import { MagazineHeader } from "./header.js";
import { resolveMagazineSettings } from "./settings-helpers.js";

const MAGAZINE_TOKEN_FALLBACKS = `:root{--np-color-rule:#d8ccb4;--np-color-background-elev:#fcfaf3;--np-color-accent:#c08a3e;--np-font-chrome:"Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}`;

/**
 * Phase M.ref — magazine's member-tree shell.
 *
 * Wraps the (member)/members/* route body in the magazine's
 * masthead + footer chrome, plus a narrow column container so
 * auth forms (login / register / verify / etc.) don't stretch
 * to the full editorial column width.
 *
 * Mirrors `MagazineShell`'s font + token-fallback bootstrap so
 * member surfaces look identical to the public site without
 * relying on the public-site layout having rendered them first.
 */
export async function MagazineMembersShell({ children }: { children: ReactNode }) {
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
        style={
          Object.keys(styleVars).length > 0
            ? (styleVars as CSSProperties)
            : undefined
        }
      >
        <MagazineHeader />
        <div className="np-magazine-members">
          <div className="np-magazine-members-column">{children}</div>
        </div>
        <MagazineFooter />
      </div>
    </>
  );
}
