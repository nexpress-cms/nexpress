import type { CSSProperties, ReactNode } from "react";

import { PortfolioFooter } from "./footer.js";
import { PortfolioHeader } from "./header.js";
import { resolvePortfolioSettings } from "./settings-helpers.js";

/**
 * Portfolio member-tree shell. Same wrapping shape as
 * `PortfolioShell` (provides `np-portfolio` root + accent-color +
 * card-aspect CSS variables) but pulls the header/footer inline
 * because `<ShellWrap surface="member">` opts OUT of the layout's
 * chrome-slot injection when a theme owns its own member shell
 * (F-track contract, see
 * `apps/web/src/components/shell-wrap.tsx`).
 *
 * Narrows the content column for auth forms (login / register /
 * reset / verify / notifications) — the portfolio public site
 * uses a wide image-led layout that would dwarf a 320-wide form.
 * Reuses `PortfolioHeader` / `PortfolioFooter` directly so a
 * theme-version bump touching the masthead reaches member pages
 * too — single source of truth for chrome.
 *
 * Does its own `<div className="np-portfolio">` root because the
 * (site) `PortfolioShell` is bypassed when this shell takes over.
 */
const ASPECT_VALUES = {
  square: "1 / 1",
  portrait: "3 / 4",
  landscape: "4 / 3",
  golden: "1 / 1.618",
} as const;

export async function PortfolioMembersShell({
  children,
}: {
  children: ReactNode;
}) {
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
      <PortfolioHeader />
      <div className="np-portfolio-members">
        <div className="np-portfolio-members-column">{children}</div>
      </div>
      <PortfolioFooter />
    </div>
  );
}
